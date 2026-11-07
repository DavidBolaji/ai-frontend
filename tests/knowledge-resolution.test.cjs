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
  return { Component: props => React.createElement(exports.default, { initialApplicability: { scope: 'national' }, ...props }), timers };
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
    assert.equal(calls.find(call => call.operation === 'resolutionLatest').source, source);
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
  assert.deepEqual(JSON.parse(JSON.stringify(args[4])), { applicability: { scope: 'national', municipality_code: null }, source_urls: ['https://example.com/source'], action_url: 'https://example.com/locator', action_label: 'Find a shop' });
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
  assert.deepEqual(JSON.parse(JSON.stringify(args[4])), { applicability: { scope: 'national', municipality_code: null }, source_urls: ['https://example.com/rules', 'https://example.com/fees'] });
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

test('stopped job correction uses its existing ID and never creates a submission', async () => {
  let corrected;
  const saved = { id: 'existing-job', status: 'review_needed', attempts: 0, answer: 'Saved answer', can_correct: true,
    applicability: { scope: 'municipality', municipality_code: 'GM0603' },
    failure: { owner: 'submitter', message: 'Select Rijswijk', stage: 'prepare' } };
  const { Component } = setup({
    readKnowledge: async p => p.operation === 'municipalities' ? { municipalities: [{ name: 'Rijswijk', code: 'GM0603' }] } : p.operation === 'resolutionLatest' ? { resolution: saved } : { ...saved, status: 'accepted' },
    submitKnowledgeAnswer: async () => assert.fail('must not create another job'),
    correctKnowledgeAnswer: async (id, values, key) => { corrected = { id, values, key }; return { ...saved, status: 'accepted' }; },
  });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  assert.match(text(root), /Select Rijswijk/);
  assert.match(text(root), /Save corrections and retry/);
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(corrected.id, 'existing-job');
  assert.equal(corrected.values.answer, 'Saved answer');
  assert.equal(corrected.values.applicability.municipality_code, 'GM0603');
  assert.ok(corrected.key);
  act(() => root.unmount());
});

test('missing location selection retains draft and does not queue', async () => {
  let called = false;
  const { Component } = setup({
    readKnowledge: async () => ({ resolution: null }),
    submitKnowledgeAnswer: async () => { called = true; },
  });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap', initialApplicability: { scope: 'municipality' } })); });
  act(() => root.root.findByType('textarea').props.onChange({ target: { value: 'Saved draft' } }));
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(called, false);
  assert.equal(root.root.findByType('textarea').props.value, 'Saved draft');
  assert.match(text(root), /Choose applicability/);
  act(() => root.unmount());
});

test('municipality picker works without a catalog API and includes all 342 locations', async () => {
  const calls = [];
  const { Component } = setup({ readKnowledge: async p => { calls.push(p.operation); return { resolution: null }; } });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap', initialApplicability: { scope: 'municipality' } })); });
  const dropdown = root.root.findByType('select');
  assert.equal(dropdown.findAllByType('option').length, 343);
  assert.ok(dropdown.findAllByType('option').some(o => o.props.value === 'GM0603' && o.children[0] === 'Rijswijk'));
  assert.ok(dropdown.findAllByType('option').some(o => o.props.value === 'GM1959' && o.children[0] === 'Altena'));
  assert.ok(!calls.includes('municipalities'));
  assert.ok(!text(root).includes('Unable to load municipalities'));
  assert.match(text(root), /Across the Netherlands/);
  act(() => root.unmount());
});

test('temporary failure offers a retry of the saved job without resubmitting the question', async () => {
  let retried;
  const saved = { id: 'saved-job', status: 'failed', attempts: 5, answer: 'Saved answer', can_retry: true,
    failure: { message: 'Temporary timeout', owner: 'system', retryable: true } };
  const { Component } = setup({
    readKnowledge: async p => p.operation === 'resolutionLatest' ? { resolution: saved } : { ...saved, status: 'accepted', attempts: 0 },
    retryKnowledgeSubmission: async id => { retried = id; return { ...saved, status: 'accepted', attempts: 0 }; },
    submitKnowledgeAnswer: async () => assert.fail('must not create a new job'),
  });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  assert.match(text(root), /do not need to ask the question again/);
  const button = root.root.findAllByType('button').find(b => b.children.includes('Retry saved submission'));
  assert.ok(button);
  await act(async () => { await button.props.onClick(); });
  assert.equal(retried, 'saved-job');
  act(() => root.unmount());
});

test('conflict compares answers and explicitly overwrites the existing record', async () => {
  let overwritten;
  const saved = { id: 'conflict-job', status: 'review_needed', attempts: 0, answer: 'New answer',
    failure: { action: 'review_conflict', owner: 'submitter', message: 'Answer conflict' } };
  const existing = { record_id: 'staff-existing', row_hash: 'a'.repeat(64), question: 'Question?', answer: 'Old answer' };
  const { Component } = setup({
    readKnowledge: async p => p.operation === 'conflictReview' ? { existing_record: existing, submitted_answer: 'New answer', conflicts: ['Incompatible location claims'] } : p.operation === 'resolutionLatest' ? { resolution: saved } : { ...saved, status: 'accepted' },
    overwriteKnowledgeAnswer: async (...args) => { overwritten = args; return { ...saved, status: 'accepted' }; },
  });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  await act(async () => { await root.root.findAllByType('button').find(b => b.children.includes('Resolve conflicting claims')).props.onClick(); });
  assert.match(text(root), /Incompatible location claims/);
  assert.doesNotMatch(text(root), /Old answer/);
  act(() => root.root.findByProps({id: 'final-answer-gap'}).props.onChange({target:{value:'Final edited answer'}}));
  const overwrite = () => root.root.findAllByType('button').find(b => b.children.includes('Save final answer'));
  assert.equal(overwrite().props.disabled, true);
  act(() => root.root.findByProps({id:'overwrite-reason-gap'}).props.onChange({target:{value:'Staff correction'}}));
  act(() => root.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
  await act(async () => { await overwrite().props.onClick(); });
  assert.equal(overwritten[0], 'conflict-job');
  assert.equal(overwritten[1].record_id, 'staff-existing');
  assert.equal(overwritten[1].row_hash, 'a'.repeat(64));
  assert.equal(overwritten[2], 'Staff correction');
  assert.equal(overwritten[3], 'Final edited answer');
  act(() => root.unmount());
});

test('restores the saved grouped job instead of looking up another occurrence', async () => {
  const calls = [];
  const saved = { id: 'persisted-review-job', status: 'review_needed', answer: 'Saved answer', attempts: 0,
    failure: { owner: 'submitter', action: 'review_conflict', message: 'Saved conflict' } };
  const { Component } = setup({ readKnowledge: async p => { calls.push(p); return saved; } });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'different-occurrence', initialResolution: saved })); });
  assert.equal(calls[0].operation, 'resolution');
  assert.equal(calls[0].id, 'persisted-review-job');
  assert.match(text(root), /Saved conflict/);
  assert.match(text(root), /Resolve conflicting claims/);
  act(() => root.unmount());
});


test('location hold explains blocked ingestion and saves national applicability on the same submission', async () => {
  const saved = { id: 'location-job', status: 'review_needed', attempts: 0,
    answer: 'Nationwide insurance comparison', can_correct: true,
    applicability: { scope: 'municipality', municipality_code: 'GM0753' },
    failure: { message: 'The answer location does not match the saved location.',
      owner: 'submitter', action: 'correct_metadata', fields: ['applicability'] } };
  let corrected;
  const { Component } = setup({
    readKnowledge: async params => params.operation === 'resolutionLatest' ? { resolution: saved } : { id: 'location-job', status: 'accepted', attempts: 0 },
    correctKnowledgeAnswer: async (id, payload) => { corrected = { id, payload }; return { id, status: 'accepted', attempts: 0 }; },
  });
  let root;
  await act(async () => { root = renderer.create(React.createElement(Component, { sourceId: 'gap' })); });
  assert.match(text(root), /Your answer has not been ingested/);
  assert.match(text(root), /Reason: the location needs correction/);
  assert.match(text(root), /Changing the selection alone does not restart publication/);
  assert.equal(root.root.findByProps({ 'aria-label': 'Resolve knowledge record' }).findAllByProps({ 'aria-label': 'Conflicting answer' }).length, 0);
  act(() => root.root.findByProps({ type: 'radio', value: 'national' }).props.onChange());
  await act(async () => { await root.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(corrected.id, 'location-job');
  assert.equal(corrected.payload.applicability.scope, 'national');
  assert.equal(corrected.payload.applicability.municipality_code, null);
  assert.equal(corrected.payload.answer, saved.answer);
  act(() => root.unmount());
});
