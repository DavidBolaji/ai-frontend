const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');

const source = ts.transpileModule(fs.readFileSync('pages/api/knowledge/index.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup(fetch, base = 'https://backend.example/api/v1') {
  const exports = {};
  vm.runInNewContext(source, { exports, fetch, process: { env: { API_BASE_URL: base } }, URL, URLSearchParams, AbortSignal });
  const res = { code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  return { handler: exports.default, res };
}
const request = query => ({ method: 'GET', headers: { authorization: 'Bearer user-token' }, query });

test('anonymous requests and mutations never reach the backend', async () => {
  const { handler, res } = setup(() => assert.fail('unexpected upstream request'));
  await handler({ ...request({ operation: 'gaps' }), headers: {} }, res);
  assert.equal(res.code, 401);
  await handler({ ...request({ operation: 'gaps' }), method: 'POST' }, res);
  assert.equal(res.code, 405);
  await handler(request({ operation: 'promote' }), res);
  assert.equal(res.code, 400);
});
test('forwards bearer authentication and bounded filters to fixed routes', async () => {
  let called;
  const { handler, res } = setup(async (url, options) => {
    called = { url, options };
    return { ok: true, json: async () => ({ reports: [], meta: { next_before: null } }) };
  });
  await handler(request({ operation: 'feedback', status: 'quarantined', before: 'cursor' }), res);
  assert.equal(res.code, 200);
  assert.equal(called.url, 'https://backend.example/api/v1/admin/kaya/feedback/reports?status=quarantined&before=cursor&limit=25');
  assert.equal(called.options.headers.Authorization, 'Bearer user-token');
  assert.equal(called.options.redirect, 'error');
  assert.equal(called.options.cache, 'no-store');
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});
test('invalid IDs cannot alter upstream paths', async () => {
  const { handler, res } = setup(() => assert.fail('unexpected upstream request'));
  await handler(request({ operation: 'gap', id: '../../auth' }), res);
  assert.equal(res.code, 400);
});
test('upstream auth errors preserve status without leaking backend responses', async () => {
  const { handler, res } = setup(async () => ({ ok: false, status: 401 }));
  await handler(request({ operation: 'gaps' }), res);
  assert.equal(res.code, 401);
  assert.match(res.body.error, /session expired/);
});
test('network failures and missing configuration fail closed', async () => {
  const { handler, res } = setup(async () => { throw new Error('private connection details'); });
  await handler(request({ operation: 'gaps' }), res);
  assert.equal(res.code, 502);
  assert.doesNotMatch(res.body.error, /private connection/);
  const missing = setup(() => assert.fail('unexpected upstream request'), '');
  await missing.handler(request({ operation: 'gaps' }), missing.res);
  assert.equal(missing.res.code, 503);
});

test('session refresh retries the knowledge route with the new access token', async () => {
  const compiled = ts.transpileModule(fs.readFileSync('lib/api-client.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const storage = new Map([['accessToken', 'old-token'], ['refreshToken', 'refresh-token']]);
  const exports = {};
  const calls = [];
  vm.runInNewContext(compiled, {
    exports, require: () => ({ getUserLanguage: () => 'en' }), window: {},
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    navigator: { language: 'en' }, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return { ok: false, status: 401 };
      if (calls.length === 2) return { ok: true, json: async () => ({ attributes: { accessToken: 'new-token', refreshToken: 'new-refresh' } }) };
      return { ok: true, status: 200, json: async () => ({ gaps: [] }) };
    },
  });
  const data = await exports.apiClient.readKnowledge({ operation: 'gaps', status: 'open' });
  assert.equal(data.gaps.length, 0);
  assert.equal(calls[1].url, '/api/proxy/auth/refresh');
  assert.equal(calls[2].url, '/api/knowledge?operation=gaps&status=open');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer new-token');
});

test('gap pagination forwards the offset and rejects invalid page offsets', async () => {
  let url;
  const { handler, res } = setup(async target => {
    url = target;
    return { ok: true, json: async () => ({ gaps: [], meta: { has_next: false } }) };
  });
  await handler(request({ operation: 'gaps', status: 'open', offset: '50' }), res);
  assert.equal(url, 'https://backend.example/api/v1/admin/kaya/knowledge/gaps?offset=50&status=open&limit=25');
  await handler(request({ operation: 'gaps', offset: '-1' }), res);
  assert.equal(res.code, 400);
});
