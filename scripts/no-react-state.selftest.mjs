#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkTree, scanSource } from './no-react-state.test.mjs';

const hooks = [
  'useState', 'useEffect', 'useRef', 'useReducer',
  'useMemo', 'useCallback', 'useLayoutEffect',
];

for (const hook of hooks) {
  test(`rejects imports, aliases, and member calls for ${hook}`, () => {
    const samples = [
      `import { ${hook} } from 'react';`,
      `import { ${hook} as local } from 'react'; local();`,
      `const { ${hook}: local } = React; local();`,
      `React.${hook}();`,
      `R["${hook}"]();`,
      `R['${hook}']();`,
      `R[\`${hook}\`]();`,
      `R["${hook}"] /* Approved: ${hook}: Approval ID 1 */ ();`,
    ];
    for (const source of samples) {
      assert.deepEqual(scanSource(source), [{ hook, line: 1 }], source);
    }

    const escaped = `${hook.slice(0, 3)}\\u${hook.charCodeAt(3).toString(16).padStart(4, '0')}${hook.slice(4)}`;
    assert.deepEqual(scanSource(`React.${escaped}();`), [{ hook, line: 1 }]);
    assert.deepEqual(scanSource(`import { ${escaped} as local } from 'react'; local();`), [{ hook, line: 1 }]);
  });
}

test('rejects the filed escaped React member counterexample', () => {
  const source = String.raw`import * as React from 'react'; export function Panel() { return React.use\u0053tate(0)[0]; }`;
  assert.deepEqual(scanSource(source), [{ hook: 'useState', line: 1 }]);
});

test('rejects constant computed hooks and unresolved React member calls', () => {
  for (const source of [
    'React["use" + "State"](0);',
    'React[`use${"State"}`](0);',
    'import * as R from "react"; R["use" + "State"](0);',
  ]) {
    assert.deepEqual(scanSource(source), [{ hook: 'useState', line: 1 }], source);
  }
  assert.deepEqual(scanSource('React[hookName](0);'), [
    { hook: 'unresolved React member', line: 1 },
  ]);
  assert.deepEqual(scanSource('const hook = React[hookName];'), [
    { hook: 'unresolved React member', line: 1 },
  ]);
  assert.deepEqual(scanSource('other[hookName](0);'), []);
});

test('rejects wrapped and locally aliased React namespace receivers', () => {
  for (const source of [
    'import * as React from "react"; const hookName="useState"; function Panel() { return (React)[hookName](0)[0]; }',
    'import * as React from "react"; const hookName="useState"; function Panel() { const R=React; return R[hookName](0)[0]; }',
    'import * as React from "react"; const hookName="useState"; function Panel() { const R=(React); const S=R; return (S as typeof React)[hookName](0)[0]; }',
    'import ReactAlias from "react"; const hookName="useState"; function Panel() { return ReactAlias[hookName](0)[0]; }',
  ]) {
    assert.deepEqual(scanSource(source), [{ hook: 'unresolved React member', line: 1 }], source);
  }
  assert.deepEqual(scanSource('const hookName="safe"; const other={}; other[hookName](0);'), []);
});

test('resolves React aliases by lexical symbol rather than file-wide spelling', () => {
  const shadowed = [
    'import * as React from "react";',
    'const R = React;',
    'const hookName = "useState";',
    'function Panel() { return R[hookName](0)[0]; }',
    'function unrelated() { const R = {}; return R[hookName](0); }',
  ].join('\n');
  assert.deepEqual(scanSource(shadowed), [{ hook: 'unresolved React member', line: 4 }]);

  const localReact = [
    'import { Fragment as React } from "react";',
    'const hookName = "safe";',
    'function Panel() { const React = {}; return React[hookName](0); }',
  ].join('\n');
  assert.deepEqual(scanSource(localReact), []);
});

test('fails closed on runtime React namespace entry points but permits type-only imports', () => {
  for (const source of [
    'import * as React from "react";',
    'import React from "react";',
    'const React = require("react");',
    'const React = import("react");',
    'export * from "react";',
  ]) {
    assert.deepEqual(scanSource(source), [{ hook: 'React runtime namespace access', line: 1 }], source);
  }
  assert.deepEqual(scanSource('import type * as React from "react";'), []);
  assert.deepEqual(scanSource('import { type ReactElement } from "react";'), []);
  assert.deepEqual(scanSource('export { type ReactElement } from "react";'), []);
  assert.deepEqual(scanSource('import { Fragment as React } from "react";'), []);
});

test('ignores comments, ordinary strings, regexes, and longer identifiers', () => {
  const source = [
    '// useState()',
    '/* React["useEffect"]() */',
    'const message = "useRef";',
    'const matcher = /useMemo/;',
    'const useStateful = true;',
    'const note = `useCallback`;',
    'const longer = `React.useLayoutEffect`;',
    'const regex = /React\\.useReducer\\(/;',
  ].join('\n');
  assert.deepEqual(scanSource(source), []);
});

test('finds computed members through whitespace, comments, escapes, and template expressions', () => {
  const source = [
    'React[ /* member */ "use\\u0053tate" ]();',
    'React[\n  "useEffect"\n]();',
    'const value = `${useRef()}`;',
    'React[`useReducer`]();',
    'const { ["useCallback"]: local } = React;',
  ].join('\n');
  assert.deepEqual(scanSource(source), [
    { hook: 'useState', line: 1 },
    { hook: 'useEffect', line: 2 },
    { hook: 'useRef', line: 5 },
    { hook: 'useReducer', line: 6 },
    { hook: 'useCallback', line: 7 },
  ]);
});

test('rejects string-named React hooks and newer state-owning hooks through scanner and CLI', () => {
  const cases = [];
  for (const hook of hooks) {
    const escaped = `${hook.slice(0, 3)}\\u${hook.charCodeAt(3).toString(16).padStart(4, '0')}${hook.slice(4)}`;
    for (const extension of ['js', 'tsx']) {
      cases.push({ source: `import { "${hook}" as local } from "react"; local();`, hook, extension });
      cases.push({ source: `import { "${escaped}" as local } from "react"; local();`, hook, extension });
    }
  }
  for (const hook of ['useActionState', 'useOptimistic', 'useTransition']) {
    cases.push({ source: `import { ${hook} as local } from "react"; local();`, hook, extension: 'tsx' });
  }
  assertCliCases(cases);
});

test('rejects alternate React namespace acquisition and global extraction', () => {
  assertCliCases([
    { source: 'import { default as R } from "react"; const h="useState"; R[h](0);', hook: 'unresolved React member', extension: 'tsx' },
    { source: 'import { "default" as R } from "react"; R["useState"](0);', hook: 'useState', extension: 'tsx' },
    { source: 'const R = await import(`react`); R["useState"](0);', hook: 'React runtime namespace access', extension: 'tsx' },
    { source: 'const R = await import("re" + "act"); R["useState"](0);', hook: 'React runtime namespace access', extension: 'tsx' },
    { source: 'const R = await import(moduleName);', hook: 'React runtime namespace access', extension: 'tsx' },
    { source: 'const h="use"+"State"; const { [h]: state } = React; state(0);', hook: 'unresolved React member', extension: 'js' },
    { source: 'const h="use"+"State"; const state=Reflect.get(React,h); state(0);', hook: 'React runtime namespace access', extension: 'js' },
    { source: 'declare const React: typeof import("react"); const h="useState" as const; const { [h]: state }=React; state(0);', hook: 'unresolved React member', extension: 'tsx' },
    { source: 'const React = require("react");', hook: 'React runtime namespace access', extension: 'js' },
  ]);
});

test('permits type-only React names and unrelated runtime APIs through scanner and CLI', () => {
  const cases = [];
  for (const hook of [...hooks, 'useActionState', 'useOptimistic', 'useTransition']) {
    cases.push({ source: `import type { ${hook} as Hook } from "react"; type T = typeof Hook;`, extension: 'tsx' });
    cases.push({ source: `export type { ${hook} } from "react";`, extension: 'tsx' });
  }
  cases.push(
    { source: 'import type { default as R } from "react"; type T = typeof R;', extension: 'tsx' },
    { source: 'const o={useState:()=>1}; o["useState"]();', extension: 'tsx' },
    { source: 'const require=()=>({}); require("react");', extension: 'js' },
    { source: 'const React={useState:()=>1}; const h="useState"; const {[h]:state}=React; state();', extension: 'js' },
    { source: 'const R=await import("unrelated-module");', extension: 'tsx' },
    { source: 'import { Fragment } from "react"; export const x=Fragment;', extension: 'tsx' },
    { source: 'import { useGrip } from "@owebeeone/grip-react"; export const x=useGrip;', extension: 'tsx' },
  );
  assertCliCases(cases, true);
});

test('rejects global React access and aliased CommonJS loaders', () => {
  assertCliCases([
    { source: 'const R=globalThis["React"]; const {useState:state}=R; state(0);', hook: 'useState', extension: 'js' },
    { source: 'const R=window[`React`]; R["useState"](0);', hook: 'useState', extension: 'js' },
    { source: 'const R=self["Re"+"act"]; R.useState(0);', hook: 'useState', extension: 'js' },
    { source: 'globalThis["React"]["useState"](0);', hook: 'useState', extension: 'js' },
    { source: 'const R=Reflect.get(globalThis,"React"); R.useState(0);', hook: 'useState', extension: 'js' },
    { source: 'const load=require; const {useState:state}=load("react"); state(0);', hook: 'useState', extension: 'cjs' },
    { source: 'const load=require; const load2=load; const {useState:state}=load2("react"); state(0);', hook: 'useState', extension: 'cjs' },
    { source: 'export {}; declare global { var React: typeof import("react"); } export function Panel(){ return React.useState(0)[0]; }', hook: 'useState', extension: 'tsx' },
  ]);
});

test('rejects React class bases, React DOM hooks, and dynamic import options', () => {
  assertCliCases([
    { source: 'import {Component} from "react"; export class Panel extends Component { state={count:0}; render(){ return this.state.count; } }', hook: 'React class component base', extension: 'tsx' },
    { source: 'import {PureComponent as Base} from "react"; export class Panel extends Base { state={count:0}; render(){ return this.state.count; } }', hook: 'React class component base', extension: 'tsx' },
    { source: 'import {useFormState as action} from "react-dom"; action(()=>0,0);', hook: 'useFormState', extension: 'tsx' },
    { source: 'import * as DOM from "react-dom"; DOM.useFormState(()=>0,0);', hook: 'useFormState', extension: 'tsx' },
    { source: 'import * as DOM from "react-dom"; DOM["useFormState"](()=>0,0);', hook: 'useFormState', extension: 'tsx' },
    { source: 'const R=await import("react",{}); R.useState(0);', hook: 'React runtime namespace access', extension: 'tsx' },
    { source: 'const R=await import(moduleName,{});', hook: 'React runtime namespace access', extension: 'tsx' },
  ]);
  assertCliCases([
    { source: 'import type {Component, PureComponent} from "react"; type C=Component;', extension: 'tsx' },
    { source: 'import type {useFormState} from "react-dom"; type F=typeof useFormState;', extension: 'tsx' },
    { source: 'import {createPortal} from "react-dom"; export const portal=createPortal;', extension: 'tsx' },
    { source: 'import ReactDOM from "react-dom/client"; ReactDOM.createRoot(document.body);', extension: 'tsx' },
    { source: 'const globalThis={React:{useState:()=>1}}; globalThis["React"]["useState"]();', extension: 'js' },
    { source: 'const require=()=>({useState:()=>1}); const load=require; load("react").useState();', extension: 'js' },
    { source: 'const R=await import("unrelated-module",{});', extension: 'tsx' },
  ], true);
});

function assertCliCases(cases, shouldPass = false) {
  const root = mkdtempSync(join(tmpdir(), 'gvid-hook-cases-'));
  try {
    for (const [index, { source, hook, extension }] of cases.entries()) {
      const path = `app/src/case-${index}.${extension}`;
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
      const found = scanSource(source, target);
      if (shouldPass) assert.deepEqual(found, [], source);
      else assert.ok(found.some((violation) => violation.hook === hook), source);
    }
    const result = checkTree(root);
    assert.equal(result.files, cases.length);
    if (shouldPass) assert.deepEqual(result.violations, []);
    else assert.equal(result.violations.length, cases.length);
    const guard = fileURLToPath(new URL('./no-react-state.test.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [guard, '--root', root], { encoding: 'utf8' });
    assert.equal(run.status, shouldPass ? 0 : 1, run.stderr);
    for (const [index, { hook, extension }] of cases.entries()) {
      const path = `app/src/case-${index}.${extension}:1`;
      if (shouldPass) assert.doesNotMatch(run.stderr, new RegExp(path.replace('.', '\\.')));
      else assert.ok(run.stderr.includes(`${path}  uses ${hook}`), run.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('checks source, entries, app, packages, and a root entry point', () => {
  const root = mkdtempSync(join(tmpdir(), 'gvid-hook-'));
  try {
    const fixtures = [
      ['src/panel.tsx', 'useState();'],
      ['src/escaped.tsx', String.raw`import * as React from 'react'; export function Panel() { return React.use\u0053tate(0)[0]; }`],
      ['src/concat.tsx', 'React["use" + "State"](0);'],
      ['src/template.tsx', 'React[`use${"State"}`](0);'],
      ['src/wrapped.tsx', 'import * as React from "react"; const hookName="useState"; function Panel() { return (React)[hookName](0)[0]; }'],
      ['src/alias.tsx', 'import * as React from "react"; const hookName="useState"; function Panel() { const R=React; return R[hookName](0)[0]; }'],
      ['src/shadowed.tsx', 'import * as React from "react"; const R=React; const hookName="useState"; function Panel() { return R[hookName](0)[0]; } function unrelated() { const R={}; }'],
      ['src/local-react.tsx', 'import { Fragment as React } from "react"; const hookName="safe"; function Panel() { const React={}; return React[hookName](0); }'],
      ['src/runtime-react.tsx', 'import * as React from "react";'],
      ['entries/desktop/main.tsx', 'useEffect();'],
      ['app/src/view.tsx', 'useRef();'],
      ['packages/plugins/view/src/index.tsx', 'useMemo();'],
      ['main.tsx', 'useReducer();'],
      ['scripts/ignored.tsx', 'useCallback();'],
      ['dist/ignored.tsx', 'useLayoutEffect();'],
    ];
    for (const [path, source] of fixtures) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    const result = checkTree(root);
    assert.equal(result.files, 13);
    assert.equal(result.violations.length, 12);
    assert.ok(result.violations.includes('src/escaped.tsx:1  uses useState'));
    assert.ok(result.violations.includes('src/concat.tsx:1  uses useState'));
    assert.ok(result.violations.includes('src/template.tsx:1  uses useState'));
    assert.ok(result.violations.includes('src/wrapped.tsx:1  uses unresolved React member'));
    assert.ok(result.violations.includes('src/alias.tsx:1  uses unresolved React member'));
    assert.ok(result.violations.includes('src/shadowed.tsx:1  uses unresolved React member'));
    assert.ok(result.violations.includes('src/runtime-react.tsx:1  uses React runtime namespace access'));
    assert.ok(!result.violations.some((v) => v.startsWith('src/local-react.tsx:')));
    assert.ok(result.violations.some((v) => v === 'entries/desktop/main.tsx:1  uses useEffect'));
    assert.ok(result.violations.some((v) => v === 'packages/plugins/view/src/index.tsx:1  uses useMemo'));

    const guard = fileURLToPath(new URL('./no-react-state.test.mjs', import.meta.url));
    const failed = spawnSync(process.execPath, [guard, '--root', root], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /FAIL: React hooks and local state/);
    assert.match(failed.stderr, /main\.tsx:1  uses useReducer/);
    assert.match(failed.stderr, /src\/escaped\.tsx:1  uses useState/);
    assert.match(failed.stderr, /src\/concat\.tsx:1  uses useState/);
    assert.match(failed.stderr, /src\/template\.tsx:1  uses useState/);
    assert.match(failed.stderr, /src\/wrapped\.tsx:1  uses unresolved React member/);
    assert.match(failed.stderr, /src\/alias\.tsx:1  uses unresolved React member/);
    assert.match(failed.stderr, /src\/shadowed\.tsx:1  uses unresolved React member/);
    assert.match(failed.stderr, /src\/runtime-react\.tsx:1  uses React runtime namespace access/);
    assert.doesNotMatch(failed.stderr, /src\/local-react\.tsx:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
