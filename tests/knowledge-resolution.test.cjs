const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const { act } = renderer;

function setup(apiClient) {
  const exports = {};
  const timers = new Map();
  let nextTimer = 0;
  const code = ts.transpileModule(fs.readFileSync('components/KnowledgeResolution.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: id => id === '@/lib/api-client' ? { apiClient } : id.includes('module.css') ? { default: {} } : require(id),
    crypto: require('node:crypto').webcrypto,
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  });
  return { Component: exports.default, timers };
}
const text = root => JSON.stringify(root.toJSON());

test('single submission waits for confirmed availability and blocks repeated clicks', async () => {
  let finish;
  let calls = 0;
  let status = 'ingesting';
  const api = {
    readKnowledge: async params => params.operation === 'resolutionLatest' ? { resolution: null } : { id: 'job', status, attempts: 0 },
    submitKnowledgeAnswer: async (id, answer, key) => {
      calls++;
      assert.equal(id, 'gap');
      assert.equal(answer, 'Reviewed answer');
      assert.ok(key);
      return new Promise(resolve => { finish = resolve; });
    },
  };
  const { Component, timers } = setup(api);
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Reviewed answer' } }));
  let pending;
  act(() => {
    pending = root.root.findByType('form').props.onSubmit({ preventDefault() {} });
    root.root.findByType('form').props.onSubmit({ preventDefault() {} });
  });
  assert.equal(calls, 1);
  assert.equal(root.root.findByType('button').props.disabled, true);
  await act(async () => { finish({ id: 'job', status: 'accepted', attempts: 0 }); await pending; });
  assert.match(text(root), /Adding your answer/);
  assert.doesNotMatch(text(root), /Answer is available in the system/);
  status = 'available';
  await act(async () => { const [id, fn] = timers.entries().next().value; timers.delete(id); await fn(); });
  assert.match(text(root), /Answer is available in the system/);
  assert.equal(root.root.findByType('textarea').props.disabled, false);
  act(() => root.unmount());
  assert.equal(timers.size, 0);
});

test('network failure retains answer and reuses the idempotency key', async () => {
  const keys = [];
  const api = {
    readKnowledge: async () => ({ resolution: null }),
    submitKnowledgeAnswer: async (id, answer, key) => { keys.push(key); throw new Error('network'); },
  };
  const { Component } = setup(api);
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Keep this answer' } }));
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(root.root.findByType('textarea').props.value, 'Keep this answer');
  assert.match(text(root), /Unable to confirm submission/);
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  act(() => root.unmount());
});

test('reopening a gap restores completed status without polling', async () => {
  const { Component, timers } = setup({ readKnowledge: async () => ({ resolution: { id: 'job', status: 'available', attempts: 0 } }) });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  assert.match(text(root), /Answer is available in the system/);
  assert.equal(timers.size, 0);
  act(() => root.unmount());
});

for (const source of ['feedback', 'vote']) {
  test(`${source} form submits the source identity and restores its status`, async () => {
    const calls = [];
    const { Component } = setup({
      readKnowledge: async params => { calls.push(params); return params.operation === 'resolutionLatest' ? { resolution: null } : { id: 'job', status: 'available', attempts: 0 }; },
      submitKnowledgeAnswer: async (id, answer, key, kind) => {
        assert.equal(id, 'record'); assert.equal(kind, source); assert.equal(answer, 'Reviewed answer');
        return { id: 'job', status: 'accepted', attempts: 0 };
      },
    });
    let root;
    await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'record', source })); });
    assert.equal(calls[0].source, source);
    act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Reviewed answer' } }));
    await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.match(text(root), /Answer is available in the system/);
    act(() => root.unmount());
  });
}

test('submission displays the API error and retains the answer', async () => {
  const { Component } = setup({
    readKnowledge: async () => ({ resolution: null }),
    submitKnowledgeAnswer: async () => { throw { errors: [{ detail: 'The original question is unavailable for this feedback.' }] }; },
  });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'record', source: 'feedback' })); });
  act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Retain this answer' } }));
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.match(text(root), /The original question is unavailable/);
  assert.equal(root.root.findByType('textarea').props.value, 'Retain this answer');
  act(() => root.unmount());
});


test('submitted answer stays visible and submission callback fires for the toast', async () => {
  let notified;
  let updated;
  const { Component } = setup({
    readKnowledge: async params => params.operation === 'resolutionLatest' ? { resolution: null } : { id: 'job', status: 'ingesting', attempts: 0, answer: 'Reviewed answer' },
    submitKnowledgeAnswer: async () => ({ id: 'job', status: 'accepted', attempts: 0, answer: 'Reviewed answer' }),
  });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap', onSubmitted: value => { notified = value; }, onStatusChange: value => { updated = value; } })); });
  act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Reviewed answer' } }));
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(root.root.findByType('textarea').props.value, 'Reviewed answer');
  assert.equal(root.root.findByType('textarea').props.disabled, true);
  assert.equal(notified.status, 'accepted');
  assert.equal(updated.status, 'ingesting');
  act(() => root.unmount());
});

test('reopening restores the saved answer in the textarea', async () => {
  const { Component } = setup({ readKnowledge: async () => ({ resolution: { id: 'job', status: 'available', attempts: 0, answer: 'Previously reviewed answer' } }) });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  assert.equal(root.root.findByType('textarea').props.value, 'Previously reviewed answer');
  act(() => root.unmount());
});
