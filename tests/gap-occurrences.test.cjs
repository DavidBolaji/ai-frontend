const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
function component() {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/GapOccurrences.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, AbortController, require: id => id.includes('module.css') ? { default: {} } : id.includes('ResolutionIndicator') ? { default: () => null } : require(id) });
  return exports.default;
}
test('occurrences load lazily, page independently and select the original gap', async () => {
  const calls = [];
  let picked;
  const read = async params => { calls.push(params); return { gaps: [{ id: params.offset === '0' ? 'first' : 'second', question: 'A rephrased question', status: 'open' }], meta: { total: 26, has_next: params.offset === '0' } }; };
  let root;
  await act(async () => { root = create(React.createElement(component(), { groupId: 'group', selectedId: 'first', read, onSelect: row => { picked = row; } })); });
  assert.equal(calls.length, 0);
  await act(async () => root.root.findByProps({ 'aria-expanded': false }).props.onClick());
  assert.equal(calls[0].operation, 'occurrences');
  assert.equal(calls[0].id, 'group');
  assert.equal(root.root.findByProps({ 'aria-pressed': true }).findByType('strong').children[0], 'A rephrased question');
  const next = root.root.findAllByType('button').find(node => node.children.includes('Next occurrences'));
  await act(async () => next.props.onClick());
  assert.equal(calls[1].offset, '25');
  act(() => root.root.findByProps({ 'aria-pressed': false }).props.onClick());
  assert.equal(picked.id, 'second');
  act(() => root.unmount());
});
