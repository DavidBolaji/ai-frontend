const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function lib() {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync('lib/source-urls.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, URL },
  );
  return exports;
}

test('public pages are accepted', () => {
  const { urlProblem } = lib();
  for (const url of [
    'https://www.amsterdam.nl/stuur-ons-een-bericht',
    'https://example.com/path?query=1#fragment',
    'https://sub.domain.co.uk/a-b-c',
    'https://example.com:443/explicit-port',
  ]) {
    assert.equal(urlProblem(url), '', url);
  }
});

test('internal and malformed addresses are refused', () => {
  const { urlProblem } = lib();
  const refused = [
    'http://example.com',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://user:secret@example.com',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://[::1]/x',
    'https://redis.internal/x',
    'https://thing.cluster.local/x',
    'https://box.local/x',
    'https://metadata.google.internal/x',
    'https://example.com:8443/x',
    'https://intranet/x',
    'not a url',
    'https://exa mple.com/x',
    `https://example.com/a${String.fromCharCode(10)}Source: evil`,
    `https://example.com/a${String.fromCharCode(0)}`,
    `https://example.com/${'x'.repeat(2100)}`,
  ];
  for (const url of refused) {
    assert.notEqual(urlProblem(url), '', `should refuse ${JSON.stringify(url)}`);
  }
});

test('rows are trimmed, blanks dropped, duplicates collapsed and order kept', () => {
  const { normaliseSourceUrls } = lib();
  const result = normaliseSourceUrls([
    '  https://example.com/b  ',
    '',
    'https://example.com/a',
    '   ',
    'https://example.com/b',
  ]);
  assert.deepEqual(Array.from(result.urls), ['https://example.com/b', 'https://example.com/a']);
  assert.equal(result.error, '');
});

test('a bad row is reported with its position and nothing is sent', () => {
  const { normaliseSourceUrls } = lib();
  const result = normaliseSourceUrls(['https://example.com/a', 'https://127.0.0.1/x']);
  assert.deepEqual(Array.from(result.urls), []);
  assert.equal(result.index, 1);
  assert.match(result.error, /internal host/);
});

test('more than ten distinct URLs is refused', () => {
  const { normaliseSourceUrls, MAX_SOURCE_URLS } = lib();
  const many = Array.from({ length: MAX_SOURCE_URLS + 1 }, (_, n) => `https://example.com/${n}`);
  assert.match(normaliseSourceUrls(many).error, /at most 10/);
  assert.equal(normaliseSourceUrls(many.slice(0, MAX_SOURCE_URLS)).urls.length, MAX_SOURCE_URLS);
});

test('an empty form sends no source URLs at all', () => {
  const { normaliseSourceUrls } = lib();
  const result = normaliseSourceUrls(['', '  ']);
  assert.deepEqual(Array.from(result.urls), []);
  assert.equal(result.error, '');
});
