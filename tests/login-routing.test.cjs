const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

function compile(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: id => imports[id] || require(id) });
  return exports;
}
const navigation = compile('lib/login-destination.ts');

test('login defaults to knowledge and rejects external or unsupported destinations', () => {
  for (const next of [undefined, ['chat'], '//evil.example', 'https://evil.example', '/unknown', '/\\evil.example']) {
    assert.equal(navigation.loginDestination(next), '/knowledge');
  }
  assert.equal(navigation.loginDestination('/knowledge'), '/knowledge');
  assert.equal(navigation.loginDestination('/chat'), '/chat');
});

for (const [next, expected] of [[undefined, '/knowledge'], ['/knowledge', '/knowledge'], ['/chat', '/chat']]) {
  test(`successful login redirects to ${expected} for next=${next}`, async () => {
    const calls = [];
    const router = { query: { next }, replace: path => calls.push(path) };
    const { default: Login } = compile('pages/login.tsx', {
      'next/router': { useRouter: () => router }, 'next/link': { default: 'a' },
      '@/lib/login-destination': navigation,
      '@/lib/api-client': { apiClient: { login: async () => {} } },
    });
    let root;
    await act(async () => { root = create(React.createElement(Login)); });
    await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.deepEqual(calls, [expected]);
    act(() => root.unmount());
  });
}

test('signed-in home route redirects to knowledge', async () => {
  const calls = [];
  const router = { replace: path => calls.push(path) };
  const { default: Home } = compile('pages/index.tsx', {
    'next/router': { useRouter: () => router },
    '@/lib/api-client': { apiClient: { isAuthenticated: () => true } },
  });
  let root;
  await act(async () => { root = create(React.createElement(Home)); });
  assert.deepEqual(calls, ['/knowledge']);
  act(() => root.unmount());
});
