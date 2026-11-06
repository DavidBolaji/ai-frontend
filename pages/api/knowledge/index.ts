import type { NextApiRequest, NextApiResponse } from 'next';
import { MAX_SOURCE_URLS, MAX_URL_LENGTH, urlProblem } from '@/lib/source-urls';

export const config = { api: { bodyParser: false } };
const mediaType = 'application/vnd.api+json';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(res: NextApiResponse, status: number, detail: string, pointer?: string) {
  return res.status(status).send(JSON.stringify({ jsonapi: { version: '1.1' }, errors: [{
    status: String(status), code: `knowledge.http_${status}`, title: 'Request failed', detail,
    ...(pointer ? { source: { pointer } } : {}),
  }] }));
}

function media(value: string) {
  const [type, ...parts] = value.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const params = Object.fromEntries(parts.map(part => {
    const i = part.indexOf('=');
    return [part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim().replace(/^"|"$/g, '')];
  }));
  return { type: type.trim().toLowerCase(), params };
}

function accepts(value: string) {
  return value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).some(offer => {
    const { type, params } = media(offer);
    const quality = Number(params.q ?? '1');
    delete params.q;
    return quality > 0 && quality <= 1 && (['*/*', 'application/*'].includes(type) ||
      (type === mediaType && Object.keys(params).every(key => ['ext', 'profile'].includes(key)) && !('ext' in params)));
  });
}

async function readDocument(req: NextApiRequest): Promise<any> {
  let text: string;
  if (req.body !== undefined) {
    text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  } else {
    const parts: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += part.length;
      if (length > 65536) throw new RangeError('body too large');
      parts.push(part);
    }
    text = Buffer.concat(parts).toString('utf8');
  }
  if (Buffer.byteLength(text, 'utf8') > 65536) throw new RangeError('body too large');
  return JSON.parse(text);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Content-Type', mediaType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Accept');
  if (!accepts(req.headers.accept || '*/*')) return failure(res, 406, 'Accept application/vnd.api+json.');
  if (!['GET', 'POST'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, POST');
    return failure(res, 405, 'This method is not supported.');
  }
  if (req.method === 'POST') {
    const { type, params } = media(String(req.headers['content-type'] || ''));
    if (type !== mediaType || Object.keys(params).some(key => !['ext', 'profile'].includes(key)) || 'ext' in params)
      return failure(res, 415, 'Use application/vnd.api+json without unsupported extensions or parameters.');
  }
  const authorization = req.headers.authorization;
  if (!authorization || !/^Bearer \S+$/.test(authorization)) return failure(res, 401, 'Sign in with a staff account to review knowledge.');
  const base = process.env.API_BASE_URL;
  if (!base) return failure(res, 503, 'The backend API URL is not configured.');
  try {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error();
  } catch {
    return failure(res, 503, 'Configure a valid HTTPS backend API URL.');
  }
  const allowed = new Set(['reviewOperation', 'sourceKind', 'sourceId', 'filter[status]', 'filter[signal]', 'sort', 'page[offset]', 'page[before]']);
  if (Object.keys(req.query).some(key => !allowed.has(key)) || Object.values(req.query).some(value => typeof value !== 'string'))
    return failure(res, 400, 'Unsupported query parameters.');
  const operation = req.query.reviewOperation;
  const id = req.query.sourceId as string;
  const source = req.query.sourceKind;
  if (source !== undefined && !['gap', 'feedback', 'vote'].includes(source as string)) return failure(res, 400, 'Unsupported resolution source.');
  const path = source === 'feedback' || source === 'vote' ? `/admin/kaya/knowledge/sources/${source}` : '/admin/kaya/knowledge/gaps';
  let endpoint: string;
  if (operation === 'resolve' && uuid.test(id)) endpoint = `${path}/${id}/resolutions`;
  else if (operation === 'resolutionLatest' && uuid.test(id)) endpoint = `${path}/${id}/resolutions/latest`;
  else if (operation === 'resolution' && uuid.test(id)) endpoint = `/admin/kaya/knowledge/resolutions/${id}`;
  else if (operation === 'groups') endpoint = '/admin/kaya/knowledge/gap-groups';
  else if (operation === 'occurrences' && uuid.test(id)) endpoint = `/admin/kaya/knowledge/gap-groups/${id}/occurrences`;
  else if (operation === 'gaps') endpoint = '/admin/kaya/knowledge/gaps';
  else if (operation === 'gap' && uuid.test(id)) endpoint = `/admin/kaya/knowledge/gaps/${id}`;
  else if (operation === 'messages') endpoint = '/admin/kaya/feedback/messages';
  else if (operation === 'feedback') endpoint = '/admin/kaya/feedback/reports';
  else return failure(res, 400, 'Unsupported review operation.');
  if ((operation === 'resolve') !== (req.method === 'POST')) {
    res.setHeader('Allow', operation === 'resolve' ? 'POST' : 'GET');
    return failure(res, 405, 'This method is not supported for this resource.');
  }
  const key = req.headers['idempotency-key'];
  let body: any;
  if (operation === 'resolve') {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) return failure(res, 400, 'Provide an Idempotency-Key header.');
    try { body = await readDocument(req); }
    catch (error) { return failure(res, error instanceof RangeError ? 413 : 400, 'The request must contain a valid JSON:API document of at most 64 KiB.'); }
    if (!body || typeof body !== 'object' || !body.data || Array.isArray(body.data) || typeof body.data !== 'object') return failure(res, 400, 'Provide a single resource in data.', '/data');
    if (body.data.type !== 'knowledge-resolutions') return failure(res, 409, 'Expected resource type knowledge-resolutions.', '/data/type');
    if ('id' in body.data || 'lid' in body.data) return failure(res, 403, 'Resolution IDs are assigned by the server.', '/data/id');
    const attrs = body.data.attributes;
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs) || typeof attrs.answer !== 'string' || !attrs.answer.trim() || Array.from(attrs.answer).length > 5000 || Object.keys(attrs).some(k => !['answer', 'source_url', 'source_urls', 'action_url', 'action_label'].includes(k)))
      return failure(res, 422, 'Enter an answer of at most 5,000 characters. Use the optional source and action fields for links.', '/data/attributes/answer');
    for (const field of ['source_url', 'action_url']) {
      if (attrs[field] === undefined || attrs[field] === null || attrs[field] === '') continue;
      if (typeof attrs[field] !== 'string' || attrs[field].length > MAX_URL_LENGTH) return failure(res, 422, 'URLs must contain at most 2,000 characters.', `/data/attributes/${field}`);
      const problem = urlProblem(attrs[field]);
      if (problem) return failure(res, 422, problem, `/data/attributes/${field}`);
    }
    if (attrs.source_urls !== undefined && attrs.source_urls !== null) {
      if (!Array.isArray(attrs.source_urls) || attrs.source_urls.length > MAX_SOURCE_URLS)
        return failure(res, 422, `Send source_urls as a list of at most ${MAX_SOURCE_URLS} URLs.`, '/data/attributes/source_urls');
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (let index = 0; index < attrs.source_urls.length; index += 1) {
        const entry = attrs.source_urls[index];
        if (typeof entry !== 'string') return failure(res, 422, 'Each source URL must be text.', `/data/attributes/source_urls/${index}`);
        const trimmed = entry.trim();
        if (!trimmed) continue;
        if (trimmed.length > MAX_URL_LENGTH) return failure(res, 422, 'URLs must contain at most 2,000 characters.', `/data/attributes/source_urls/${index}`);
        const problem = urlProblem(trimmed);
        if (problem) return failure(res, 422, problem, `/data/attributes/source_urls/${index}`);
        if (!seen.has(trimmed)) { seen.add(trimmed); cleaned.push(trimmed); }
      }
      if (cleaned.length) attrs.source_urls = cleaned; else delete attrs.source_urls;
    }
    if (attrs.action_label !== undefined && attrs.action_label !== null && (typeof attrs.action_label !== 'string' || Array.from(attrs.action_label).length > 200 || (attrs.action_label.trim() && !attrs.action_url)))
      return failure(res, 422, 'Use an action label of at most 200 characters with an action URL.', '/data/attributes/action_label');
    body = { data: { type: 'knowledge-resolutions', attributes: attrs } };
  }
  const query = new URLSearchParams();
  const status = req.query['filter[status]'];
  const signal = req.query['filter[signal]'];
  const offset = req.query['page[offset]'];
  const before = req.query['page[before]'];
  const sort = req.query.sort;
  if (offset !== undefined && (!/^\d{1,7}$/.test(offset as string) || Number(offset) > 1000000)) return failure(res, 400, 'Invalid page offset.');
  if (before !== undefined && (before as string).length > 256) return failure(res, 400, 'Invalid pagination cursor.');
  if (sort !== undefined && sort !== 'created_at' && sort !== '-created_at') return failure(res, 400, 'Invalid date sort.');
  if (signal !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(signal as string)) return failure(res, 400, 'Invalid signal filter.');
  const collection = ['gaps', 'groups', 'occurrences', 'messages', 'feedback'].includes(operation as string);
  if (collection) {
    query.set('page[limit]', '25');
    if (sort && operation !== 'occurrences') query.set('sort', sort as string);
    if (status && !['messages', 'occurrences'].includes(operation as string)) query.set('filter[status]', status as string);
    if (offset && ['gaps', 'groups', 'occurrences'].includes(operation as string)) query.set('page[offset]', offset as string);
    if (signal && ['gaps', 'groups'].includes(operation as string)) query.set('filter[signal]', signal as string);
    if (before && ['messages', 'feedback'].includes(operation as string)) query.set('page[before]', before as string);
  } else if ([status, signal, offset, before, sort].some(value => value !== undefined)) return failure(res, 400, 'Filters apply only to collections.');
  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}${endpoint}${query.size ? `?${query}` : ''}`, {
      method: req.method,
      headers: { Authorization: authorization, Accept: mediaType, ...(body ? { 'Content-Type': mediaType, 'Idempotency-Key': key as string } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store', signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    const payload = await upstream.json().catch(() => null);
    for (const name of ['www-authenticate', 'retry-after']) {
      const value = upstream.headers?.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!payload?.jsonapi || (upstream.ok ? !('data' in payload) : !Array.isArray(payload.errors)))
      return failure(res, upstream.ok ? 502 : upstream.status, 'The backend did not return a valid JSON:API response.');
    if (upstream.ok) payload.links = { ...payload.links, self: `/api/knowledge?${new URLSearchParams(req.query as Record<string, string>)}` };
    if (upstream.ok && payload.data?.type === 'knowledge-resolutions') {
      const self = `/api/knowledge?${new URLSearchParams({ reviewOperation: 'resolution', sourceId: payload.data.id })}`;
      payload.data.links = { ...payload.data.links, self };
      if (upstream.status === 202) res.setHeader('Location', self);
    }
    return res.status(upstream.status).send(JSON.stringify(payload));
  } catch {
    return failure(res, 502, 'Unable to reach the backend. Check API_BASE_URL and backend availability.');
  }
}
