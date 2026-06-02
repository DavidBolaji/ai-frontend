/**
 * Streaming proxy for POST /api/proxy/documents/upload
 *
 * Next.js rewrites buffer the full response before forwarding, which breaks
 * SSE (Server-Sent Events). This API route pipes the backend SSE stream
 * directly to the browser so progress events arrive incrementally.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import http from 'http';
import https from 'https';

export const config = {
  api: {
    // Don't let Next.js parse the body — we pipe it raw to the backend
    bodyParser: false,
    // No size limit on the response
    responseLimit: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const backendBase =
    process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || '';

  if (!backendBase) {
    res.status(503).json({ error: 'Backend URL not configured' });
    return;
  }

  // Strip trailing slash from base, then append the backend path
  const targetUrl = new URL(`${backendBase.replace(/\/$/, '')}/documents/upload`);
  const isHttps = targetUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  // Forward all request headers except host (let Node set that automatically)
  const forwardHeaders: Record<string, string | string[]> = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (key.toLowerCase() !== 'host' && val !== undefined) {
      forwardHeaders[key] = val as string | string[];
    }
  }

  // SSE response headers — tell every intermediary not to buffer
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Send headers immediately so the browser opens the stream

  const proxyReq = transport.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port
        ? parseInt(targetUrl.port, 10)
        : isHttps
        ? 443
        : 80,
      path: targetUrl.pathname + targetUrl.search,
      method: 'POST',
      headers: forwardHeaders,
    },
    (proxyRes) => {
      proxyRes.on('data', (chunk: Buffer) => {
        // Write each chunk to the client as it arrives — no buffering
        res.write(chunk);
        // res.flush() exists on http.ServerResponse in Node; call it if present
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      });

      proxyRes.on('end', () => {
        res.end();
      });

      proxyRes.on('error', (err) => {
        console.error('[upload-proxy] backend stream error', err);
        res.end();
      });
    }
  );

  proxyReq.on('error', (err) => {
    console.error('[upload-proxy] proxy request error', err);
    if (!res.headersSent) {
      res.status(502).end();
    } else {
      res.end();
    }
  });

  // Pipe the incoming multipart request body straight to the backend
  req.pipe(proxyReq);
}
