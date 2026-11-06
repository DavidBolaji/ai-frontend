const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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
    exports, require: id => id === '@/lib/api-client' ? { apiClient } : id.includes('module.css') ? { default: {} } : requireAliased(id, require),
    URL,
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
  const seen = [];
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap', onStatusChange: row => row && seen.push(row) })); });
  act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Reviewed answer' } }));
  let pending;
  act(() => {
    pending = root.root.findByType('form').props.onSubmit({ preventDefault() {} });
    root.root.findByType('form').props.onSubmit({ preventDefault() {} });
  });
  assert.equal(calls, 1);
  assert.equal(root.root.findByProps({ type: 'submit' }).props.disabled, true);
  await act(async () => { finish({ id: 'job', status: 'accepted', attempts: 0 }); await pending; });
  assert.equal(seen.at(-1).status, 'ingesting');
  assert.ok(!seen.some(row => row.status === 'available'));
  status = 'available';
  await act(async () => { const [id, fn] = timers.entries().next().value; timers.delete(id); await fn(); });
  assert.equal(seen.at(-1).status, 'available');
  assert.equal(root.root.findByType('textarea').props.disabled, true);
  assert.equal(root.root.findByProps({ type: 'submit' }).props.disabled, true);
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(calls, 1);
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
  const notices = [];
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap', onNotice: n => notices.push(n) })); });
  act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Keep this answer' } }));
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(root.root.findByType('textarea').props.value, 'Keep this answer');
  assert.match(notices.at(-1).body, /Unable to confirm submission/);
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  act(() => root.unmount());
});

test('reopening a gap restores completed status without polling', async () => {
  const { Component, timers } = setup({ readKnowledge: async () => ({ resolution: { id: 'job', status: 'available', attempts: 0 } }) });
  let root;
  const seen = [];
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap', onStatusChange: row => seen.push(row) })); });
  assert.equal(seen.at(-1).status, 'available');
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
    const seen = [];
    await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'record', source, onStatusChange: row => row && seen.push(row) })); });
    assert.equal(calls[0].source, source);
    act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Reviewed answer' } }));
    await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.equal(seen.at(-1).status, 'available');
    act(() => root.unmount());
  });
}

test('submission displays the API error and retains the answer', async () => {
  const { Component } = setup({
    readKnowledge: async () => ({ resolution: null }),
    submitKnowledgeAnswer: async () => { throw { errors: [{ detail: 'The original question is unavailable for this feedback.' }] }; },
  });
  let root;
  const notices = [];
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'record', source: 'feedback', onNotice: n => notices.push(n) })); });
  act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Retain this answer' } }));
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.match(notices.at(-1).body, /The original question is unavailable/);
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
  assert.equal(root.root.findByType('textarea').props.disabled, true);
  assert.equal(root.root.findByProps({ type: 'submit' }).props.disabled, true);
  act(() => root.unmount());
});

test('oversized draft stays intact and cannot be submitted', async () => {
  let calls = 0;
  const { Component } = setup({ readKnowledge: async () => ({ resolution: null }), submitKnowledgeAnswer: async () => { calls++; } });
  let root;
  const notices = [];
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap', onNotice: n => notices.push(n) })); });
  const draft = 'x'.repeat(5001);
  act(() => root.root.findByType('textarea').props.onChange({ target: { value: draft } }));
  assert.equal(root.root.findByType('textarea').props.value, draft);
  assert.equal(root.root.findByType('textarea').props.maxLength, undefined);
  assert.equal(root.root.findByProps({ type: 'submit' }).props.disabled, true);
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(calls, 0);
  assert.match(notices.at(-1).body, /full draft is kept/);
  act(() => root.unmount());
});

test('5,000 characters and optional destinations are submitted separately', async () => {
  let args;
  const { Component } = setup({ readKnowledge: async () => ({ resolution: null }), submitKnowledgeAnswer: async (...values) => { args = values; return { id: 'job', status: 'available', attempts: 0 }; } });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  act(() => {
    root.root.findByType('textarea').props.onChange({ target: { value: 'x'.repeat(5000) } });
    root.root.findByProps({ id: 'source-url-gap-0' }).props.onChange({ target: { value: 'https://example.com/source' } });
    root.root.findByProps({ id: 'action-url-gap' }).props.onChange({ target: { value: 'https://example.com/locator' } });
    root.root.findByProps({ id: 'action-label-gap' }).props.onChange({ target: { value: 'Find a shop' } });
  });
  assert.equal(root.root.findByProps({ type: 'submit' }).props.disabled, false);
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(args[1].length, 5000);
  assert.deepEqual(JSON.parse(JSON.stringify(args[4])), { source_urls: ['https://example.com/source'], action_url: 'https://example.com/locator', action_label: 'Find a shop' });
  act(() => root.unmount());
});

test('several source URLs can be added, removed and submitted in order', async () => {
  let args;
  const { Component } = setup({ readKnowledge: async () => ({ resolution: null }), submitKnowledgeAnswer: async (...values) => { args = values; return { id: 'job', status: 'available', attempts: 0 }; } });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  const type = (index, value) => root.root.findByProps({ id: `source-url-gap-${index}` }).props.onChange({ target: { value } });
  const addRow = () => root.root.findAllByType('button').find(node => node.children.includes('Add another source URL'));

  act(() => { root.root.findByType('textarea').props.onChange({ target: { value: 'Reviewed answer' } }); });
  act(() => { type(0, 'https://example.com/rules'); });
  act(() => addRow().props.onClick());
  act(() => { type(1, 'https://example.com/fees'); });
  act(() => addRow().props.onClick());
  act(() => { type(2, 'https://example.com/drop-me'); });

  // Removing the third row leaves the first two in the order they were entered.
  const removals = root.root.findAllByType('button').filter(node => node.children.includes('Remove'));
  assert.equal(removals.length, 3);
  act(() => removals[2].props.onClick());

  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.deepEqual(JSON.parse(JSON.stringify(args[4])), { source_urls: ['https://example.com/rules', 'https://example.com/fees'] });
  act(() => root.unmount());
});

test('an internal source URL is refused in the form and never submitted', async () => {
  let called = false;
  const { Component } = setup({ readKnowledge: async () => ({ resolution: null }), submitKnowledgeAnswer: async () => { called = true; return { id: 'job', status: 'available', attempts: 0 }; } });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  act(() => {
    root.root.findByType('textarea').props.onChange({ target: { value: 'Reviewed answer' } });
    root.root.findByProps({ id: 'source-url-gap-0' }).props.onChange({ target: { value: 'https://169.254.169.254/latest/meta-data/' } });
  });
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(called, false);
  const alerts = root.root.findAllByProps({ role: 'alert' }).map(node => node.children.join(''));
  assert.ok(alerts.some(text => /internal host/.test(text)), alerts.join(' | '));
  act(() => root.unmount());
});

test('a stored single source_url still fills the first row', async () => {
  const { Component } = setup({ readKnowledge: async () => ({ resolution: { id: 'job', status: 'review_needed', attempts: 0, answer: 'Saved', source_url: 'https://example.com/only' } }) });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  assert.equal(root.root.findByProps({ id: 'source-url-gap-0' }).props.value, 'https://example.com/only');
  act(() => root.unmount());
});
