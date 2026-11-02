const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const exportsObject = {};
const code = ts.transpileModule(fs.readFileSync('components/ResolutionIndicator.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
vm.runInNewContext(code, { exports: exportsObject, require });
for (const [status, label] of [['accepted', /pending ingestion/], ['ingesting', /pending ingestion/], ['verifying', /pending ingestion/], ['available', /ingested and available/], ['failed', /processing failed/], ['review_needed', /needs review/], ['deleted', /job deleted/]]) {
  test(`attendance marker distinguishes ${status}`, () => {
    const root = renderer.create(React.createElement(exportsObject.default, { status }));
    assert.match(root.root.findByProps({ role: 'img' }).props['aria-label'], label);
    root.unmount();
  });
}
