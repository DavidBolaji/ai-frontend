const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
function compile(path, requireModule, timers) {
  const exports = {};
  let next = 0;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: requireModule, AbortController, DOMException,
    setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id),
  });
  return exports;
}

for (const grouping_status of ['pending', 'grouped']) {
test(`knowledge page distinguishes ${grouping_status} grouping and tracks ingestion`, async () => {
  const timers = new Map();
  const toast = compile('components/NotificationToast.tsx', require, timers);
  const indicator = compile('components/ResolutionIndicator.tsx', require, timers);
  const resolution = { id: 'job', status: 'accepted', attempts: 0 };
  const record = { id: 'gap', question: 'A question', status: 'open', resolution, grouping_status, occurrence_count: 2 };
  const router = { replace() {} };
  let formProps;
  const modules = {
    'next/head': { default: ({ children }) => React.createElement(React.Fragment, null, children) },
    'next/router': { useRouter: () => router },
    '@/styles/knowledge.module.css': { default: {} },
    '@/components/NotificationToast': toast,
    '@/components/ResolutionIndicator': indicator,
    '@/components/GapOccurrences': { default: () => null },
    '@/components/KnowledgeResolution': { default: props => { formProps = props; return React.createElement('div', { 'data-form': true }); } },
    '@/lib/api-client': { apiClient: {
      hasValidSession: () => true,
      readKnowledge: async params => params.operation === 'groups' ? { gaps: [record], meta: { total: 1 } } : record,
    } },
  };
  const { default: Page } = compile('pages/knowledge.tsx', id => modules[id] || require(id), timers);
  let root;
  await act(async () => { root = create(React.createElement(Page)); });
  assert.match(root.root.findByProps({ role: 'img' }).props['aria-label'], /pending ingestion/);
  assert.doesNotMatch(JSON.stringify(root.toJSON()), /Grouping pending|2 occurrences/);
  if (grouping_status === 'pending') assert.doesNotMatch(JSON.stringify(root.toJSON()), /2 occurrences/);
  const button = root.root.findAllByType('button').find(node => node.findAllByType('h2').length === 1);
  await act(async () => { await button.props.onClick(); });
  act(() => formProps.onSubmitted(resolution));
  assert.match(JSON.stringify(root.toJSON()), /Answer submitted/);
  assert.ok(root.root.findByProps({ 'aria-label': 'Dismiss notification' }));
  act(() => formProps.onStatusChange({ ...resolution, status: 'available' }));
  assert.match(root.root.findByProps({ role: 'img' }).props['aria-label'], /ingested and available/);
  assert.match(JSON.stringify(root.toJSON()), /Answer available/);
  act(() => root.unmount());
});

}
