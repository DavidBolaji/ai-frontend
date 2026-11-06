const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

// `@/lib/*` is a tsconfig path alias Node cannot resolve, so shared TypeScript
// modules are transpiled into this harness on demand.
function requireAliased(id, fallback) {
  if (id.startsWith('@/lib/')) {
    const file = `lib/${id.slice('@/lib/'.length)}.ts`;
    if (fs.existsSync(file)) {
      const exports = {};
      vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        { exports, URL, console },
      );
      return exports;
    }
  }
  return fallback(id);
}

const fs = require('node:fs');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const media = 'application/vnd.api+json';
const id = '11111111-1111-1111-1111-111111111111';
const doc = (attributes = { status: 'accepted' }) => ({ jsonapi: { version: '1.1' }, data: { type: 'knowledge-resolutions', id, attributes } });
const answer = value => ({ data: { type: 'knowledge-resolutions', attributes: { answer: value } } });
const source = ts.transpileModule(fs.readFileSync('pages/api/knowledge/index.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup(fetch, base = 'https://backend.example/api/v1') {
  const exports = {};
  vm.runInNewContext(source, { exports, fetch, process: { env: { API_BASE_URL: base } }, URL, URLSearchParams, AbortSignal, Buffer, require: id => requireAliased(id, require) });
  const res = { code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = JSON.parse(body); return this; }, end() { return this; } };
  return { handler: exports.default, res, config: exports.config };
}
function request(operation = 'gaps', options = {}) {
  const { query = {}, headers = {}, body, method = 'GET' } = options;
  return Object.assign(Readable.from(body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]), {
    method, headers: { authorization: 'Bearer staff', accept: media, 'content-type': media, 'idempotency-key': 'key', ...headers },
    query: { reviewOperation: operation, ...query },
  });
}
function assertError(res, status) {
  assert.equal(res.code, status);
  assert.equal(res.headers['Content-Type'], media);
  assert.equal(res.body.errors[0].status, String(status));
  assert.equal(res.body.data, undefined);
}

test('body parsing is explicitly handled for the vendor media type', () => {
  assert.equal(setup().config.api.bodyParser, false);
});
test('authentication and unknown operations return JSON:API errors', async () => {
  const { handler, res } = setup(() => assert.fail('unexpected upstream request'));
  await handler(request('gaps', { headers: { authorization: '' } }), res);
  assertError(res, 401);
  await handler(request('promote'), res);
  assertError(res, 400);
});
test('collection filters and pagination use JSON:API query families and preserve metadata', async () => {
  let called;
  const payload = { jsonapi: { version: '1.1' }, data: [], meta: { total: 40, has_next: true } };
  const { handler, res } = setup(async (url, options) => { called = { url, options }; return { ok: true, status: 200, json: async () => payload }; });
  await handler(request('gaps', { query: { 'filter[status]': 'open', 'page[offset]': '25', sort: '-created_at' } }), res);
  const url = new URL(called.url);
  assert.equal(url.searchParams.get('page[limit]'), '25');
  assert.equal(url.searchParams.get('page[offset]'), '25');
  assert.equal(url.searchParams.get('filter[status]'), 'open');
  assert.equal(called.options.headers.Accept, media);
  assert.equal(called.options.redirect, 'error');
  assert.equal(res.body.meta.total, 40);
});
for (const sourceKind of ['gap', 'feedback', 'vote']) {
  test(`${sourceKind} submission parses a raw JSON:API body and preserves 202 and Location`, async () => {
    let called;
    const { handler, res } = setup(async (url, options) => { called = { url, options }; return { ok: true, status: 202, json: async () => doc() }; });
    await handler(request('resolve', { method: 'POST', query: { sourceId: id, sourceKind }, body: answer('Reviewed answer') }), res);
    assert.equal(res.code, 202);
    assert.equal(called.options.headers['Content-Type'], media);
    assert.equal(called.options.headers['Idempotency-Key'], 'key');
    assert.deepEqual(JSON.parse(called.options.body), answer('Reviewed answer'));
    assert.match(called.url, new RegExp(sourceKind === 'gap' ? `/gaps/${id}/resolutions` : `/sources/${sourceKind}/${id}/resolutions`));
    assert.match(res.headers.Location, /reviewOperation=resolution/);
    assert.equal(res.body.data.type, 'knowledge-resolutions');
  });
}
for (const [headers, expected] of [
  [{ 'content-type': 'application/json' }, 415],
  [{ 'content-type': `${media};charset=utf-8` }, 415],
  [{ 'content-type': `${media};ext="https://unsupported.example"` }, 415],
  [{ accept: 'text/html' }, 406],
  [{ accept: `${media};ext="https://unsupported.example"` }, 406],
  [{ accept: `${media};charset=utf-8` }, 406],
]) {
  test(`unsupported media negotiation returns ${expected}: ${JSON.stringify(headers)}`, async () => {
    const { handler, res } = setup(() => assert.fail('unexpected upstream request'));
    await handler(request('resolve', { method: 'POST', query: { sourceId: id }, headers, body: answer('Valid') }), res);
    assertError(res, expected);
  });
}
test('unknown profiles are ignored and a supported Accept alternative is accepted', async () => {
  const { handler, res } = setup(async () => ({ ok: true, status: 202, json: async () => doc() }));
  await handler(request('resolve', { method: 'POST', query: { sourceId: id }, headers: {
    'content-type': `${media};profile="https://unknown.example/profile"`,
    accept: `${media};ext="https://unsupported.example", ${media}`,
  }, body: answer('Valid') }), res);
  assert.equal(res.code, 202);
});
for (const [body, status] of [
  ['{invalid', 400], [{ answer: 'unwrapped' }, 400], [{ data: { type: 'other', attributes: { answer: 'Valid' } } }, 409],
  [{ data: { type: 'knowledge-resolutions', id, attributes: { answer: 'Valid' } } }, 403],
  [answer('   '), 422], [answer('x'.repeat(5001)), 422],
  [{ data: { type: 'knowledge-resolutions', attributes: { answer: 'Valid', environments: ['prod'] } } }, 422],
  ['x'.repeat(65537), 413],
]) {
  test(`invalid submission returns ${status}`, async () => {
    const { handler, res } = setup(() => assert.fail('unexpected upstream request'));
    await handler(request('resolve', { method: 'POST', query: { sourceId: id }, body }), res);
    assertError(res, status);
  });
}
test('unsupported queries and path injection are rejected', async () => {
  const { handler, res } = setup(() => assert.fail('unexpected upstream request'));
  await handler(request('gap', { query: { sourceId: '../../auth' } }), res);
  assertError(res, 400);
  await handler(request('gaps', { query: { status: 'open' } }), res);
  assertError(res, 400);
});
test('backend error documents retain status and actionable details', async () => {
  const payload = { jsonapi: { version: '1.1' }, errors: [{ status: '422', title: 'Invalid answer', detail: 'The original question is unavailable.' }] };
  const { handler, res } = setup(async () => ({ ok: false, status: 422, json: async () => payload }));
  await handler(request('resolve', { method: 'POST', query: { sourceId: id }, body: answer('Valid') }), res);
  assertError(res, 422);
  assert.equal(res.body.errors[0].detail, payload.errors[0].detail);
});
test('network and configuration failures return JSON:API errors without private details', async () => {
  const { handler, res } = setup(async () => { throw new Error('private connection details'); });
  await handler(request(), res);
  assertError(res, 502);
  assert.doesNotMatch(res.body.errors[0].detail, /private connection/);
});

test('shared client sends the JSON:API envelope and reconstructs view data with pagination metadata', async () => {
  const compiled = ts.transpileModule(fs.readFileSync('lib/api-client.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const calls = [];
  vm.runInNewContext(compiled, {
    exports, require: id => requireAliased(id, () => ({ getUserLanguage: () => 'en' })), URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => calls.length === 1 ? doc() : { jsonapi: { version: '1.1' }, data: [{ type: 'knowledge-gaps', id, attributes: { question: 'Question' } }], meta: { total: 3 } } };
    },
  });
  const result = await exports.apiClient.submitKnowledgeAnswer(id, 'Reviewed answer', 'key', 'vote');
  assert.equal(result.status, 'accepted');
  assert.equal(calls[0].options.headers['Content-Type'], media);
  assert.equal(calls[0].options.headers.Accept, media);
  assert.deepEqual(JSON.parse(calls[0].options.body), answer('Reviewed answer'));
  const list = await exports.apiClient.readKnowledge({ operation: 'gaps', status: 'open', offset: '25', sort: 'oldest' });
  assert.equal(list.gaps[0].question, 'Question');
  assert.equal(list.meta.total, 3);
  const url = new URL(calls[1].url, 'http://local');
  assert.equal(url.searchParams.get('filter[status]'), 'open');
  assert.equal(url.searchParams.get('page[offset]'), '25');
  assert.equal(url.searchParams.get('sort'), 'created_at');
});

for (const operation of ['groups', 'occurrences']) {
  test(`${operation} forwards group pagination as JSON:API and preserves counts`, async () => {
    let called;
    const { handler, res } = setup(async url => {
      called = new URL(url);
      return { ok: true, status: 200, json: async () => ({ jsonapi: { version: '1.1' }, data: [], meta: { total: 3, has_next: false } }) };
    });
    await handler(request(operation, { query: { sourceId: id, 'page[offset]': '25', ...(operation === 'groups' ? { 'filter[status]': 'open' } : {}) } }), res);
    assert.equal(res.code, 200);
    assert.equal(called.pathname, `/api/v1/admin/kaya/knowledge/gap-groups${operation === 'occurrences' ? `/${id}/occurrences` : ''}`);
    assert.equal(called.searchParams.get('page[offset]'), '25');
    assert.equal(called.searchParams.get('page[limit]'), '25');
    assert.equal(res.body.meta.total, 3);
  });
}

test('optional source and action fields reach backend unchanged', async () => {
  let forwarded;
  const { handler, res } = setup(async (url, options) => { forwarded = JSON.parse(options.body); return { ok: true, status: 202, json: async () => doc() }; });
  const body = answer('Reviewed text');
  Object.assign(body.data.attributes, { source_url: 'https://example.com/source', action_url: 'https://example.com/locator', action_label: 'Find a shop' });
  await handler(request('resolve', { method: 'POST', query: { sourceId: id }, body }), res);
  assert.equal(res.code, 202);
  assert.deepEqual(forwarded, body);
});

for (const fields of [{ source_url: 'http://example.com' }, { action_url: 'javascript:alert(1)' }, { action_label: 'Find a shop' }]) {
  test(`invalid optional link fields rejected: ${JSON.stringify(fields)}`, async () => {
    const { handler, res } = setup(() => assert.fail('unexpected upstream request'));
    const body = answer('Reviewed text');
    Object.assign(body.data.attributes, fields);
    await handler(request('resolve', { method: 'POST', query: { sourceId: id }, body }), res);
    assertError(res, 422);
  });
}

test('corrections route to existing job and preserve applicability', async () => {
  let called;
  const { handler, res } = setup(async (url, options) => { called = { url, options }; return { ok: true, status: 202, json: async () => doc() }; });
  const body = answer('Corrected');
  body.data.attributes.applicability = { scope: 'municipality', municipality_code: 'GM0603' };
  await handler(request('correct', { method: 'POST', query: { sourceId: id }, body }), res);
  assert.equal(res.code, 202);
  assert.equal(new URL(called.url).pathname, `/api/v1/admin/kaya/knowledge/resolutions/${id}/correct`);
  assert.equal(JSON.parse(called.options.body).data.attributes.applicability.municipality_code, 'GM0603');
});

test('municipality catalog is a read-only proxy route', async () => {
  let called;
  const { handler, res } = setup(async url => { called = url; return { ok: true, status: 200, json: async () => ({ jsonapi: { version: '1.1' }, data: [] }) }; });
  await handler(request('municipalities'), res);
  assert.equal(res.code, 200);
  assert.equal(new URL(called).pathname, '/api/v1/admin/kaya/knowledge/municipalities');
});

test('retry proxy preserves the existing job ID', async () => {
  let called;
  const { handler, res } = setup(async (url, options) => { called = { url, options }; return { ok: true, status: 202, json: async () => ({ jsonapi: { version: '1.1' }, data: { type: 'knowledge-resolution-retries', id, attributes: { resolution_id: id, status: 'accepted' } } }) }; });
  await handler(request('retry', { method: 'POST', query: { sourceId: id }, body: { data: { type: 'knowledge-resolution-retries', attributes: {} } } }), res);
  assert.equal(res.code, 202);
  assert.equal(new URL(called.url).pathname, `/api/v1/ops/queues/jobs/${id}/retry`);
});

test('overwrite forwards version-bound approval without creating a submission', async () => {
  let called;
  const { handler, res } = setup(async (url, options) => { called = {url,options}; return {ok:true,status:202,json:async()=>doc()}; });
  await handler(request('overwrite', {method:'POST', query:{sourceId:id}, body:{data:{type:'knowledge-resolution-approvals',attributes:{record_id:'staff-existing',expected_row_hash:'a'.repeat(64),reason:'Verified correction'}}}}), res);
  assert.equal(res.code,202);
  assert.equal(new URL(called.url).pathname, `/api/v1/ops/queues/jobs/${id}/force-approve`);
  assert.equal(JSON.parse(called.options.body).data.attributes.expected_row_hash,'a'.repeat(64));
});
