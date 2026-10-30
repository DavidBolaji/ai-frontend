import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  const authorization = req.headers.authorization;
  if (!authorization || !/^Bearer \S+$/.test(authorization)) return res.status(401).json({ error: 'Sign in with a staff account to review knowledge.' });
  const base = process.env.API_BASE_URL;
  if (!base) return res.status(503).json({ error: 'The backend API URL is not configured.' });
  try {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('Invalid backend URL');
  } catch {
    return res.status(503).json({ error: 'Configure a valid HTTPS backend API URL.' });
  }
  const { operation, status, before, id, offset, sort } = req.query;
  let endpoint: string;
  if (operation === 'gaps') endpoint = '/admin/kaya/knowledge/gaps';
  else if (operation === 'gap' && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) endpoint = `/admin/kaya/knowledge/gaps/${id}`;
  else if (operation === 'feedback') endpoint = '/admin/kaya/feedback/reports';
  else return res.status(400).json({ error: 'Unsupported read operation.' });
  if ((status !== undefined && typeof status !== 'string') || (before !== undefined && (typeof before !== 'string' || before.length > 256))) return res.status(400).json({ error: 'Invalid filters.' });
  if (offset !== undefined && (typeof offset !== 'string' || !/^\d{1,7}$/.test(offset) || Number(offset) > 1000000)) return res.status(400).json({ error: 'Invalid page offset.' });
  if (sort !== undefined && sort !== 'newest' && sort !== 'oldest') return res.status(400).json({ error: 'Invalid date sort.' });
  const query = new URLSearchParams();
  if (sort) query.set('sort', sort);
  if (operation === 'gaps' && offset) query.set('offset', offset);
  if (status) query.set('status', status);
  if (before && operation === 'feedback') query.set('before', before);
  if (operation !== 'gap') query.set('limit', '25');
  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}${endpoint}?${query}`, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      cache: 'no-store', signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!upstream.ok) {
      const message = upstream.status === 401 ? 'Your session expired. Please sign in again.' : upstream.status === 403 || upstream.status === 404 ? 'Staff access is required, or this record is unavailable.' : upstream.status === 422 || upstream.status === 400 ? 'Invalid review filters. Refresh and try again.' : 'The backend could not load review data.';
      return res.status(upstream.status).json({ error: message });
    }
    return res.status(200).json(await upstream.json());
  } catch {
    return res.status(502).json({ error: 'Unable to reach the backend. Check API_BASE_URL and backend availability.' });
  }
}
