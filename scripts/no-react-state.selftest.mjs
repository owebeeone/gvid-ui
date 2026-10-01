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
    assert.match(failed.stderr, /FAIL: React local state hooks/);
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
