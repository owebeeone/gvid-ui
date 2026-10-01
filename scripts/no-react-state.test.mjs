#!/usr/bin/env node
// GVR-UI-004/005: UI state lives in Grip, with no React hook approvals.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const BANNED = new Set([
  'useState', 'useEffect', 'useRef', 'useReducer',
  'useMemo', 'useCallback', 'useLayoutEffect',
]);
const EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const SKIP_DIRS = new Set(['.git', '.next', '.vite', 'build', 'coverage', 'dist', 'node_modules']);
const UI_DIRS = ['src', 'entries', 'app', 'packages'];

function sourceFiles(root) {
  const files = new Set();
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) walk(path);
      else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) files.add(path);
    }
  }
  for (const dir of UI_DIRS) walk(join(root, dir));
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && EXTENSIONS.has(extname(entry.name)) &&
        /^(main|index)\./.test(basename(entry.name))) files.add(join(root, entry.name));
  }
  return [...files].sort();
}

function scriptKind(fileName) {
  switch (extname(fileName)) {
    case '.js': case '.mjs': case '.cjs': return ts.ScriptKind.JS;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.tsx': return ts.ScriptKind.TSX;
    default: return ts.ScriptKind.TS;
  }
}

export function scanSource(source, fileName = 'source.tsx') {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const violations = [];
  const reactNamespaces = new Set(['React']);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'react') continue;
    const clause = statement.importClause;
    if (clause?.name) reactNamespaces.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      reactNamespaces.add(clause.namedBindings.name.text);
    }
  }
  const aliases = new Map();
  function collectAliases(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      aliases.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectAliases);
  }
  collectAliases(file);
  const unwrap = (node) => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
           ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) ||
           ts.isNonNullExpression(node)) node = node.expression;
    return node;
  };
  const isReactNamespace = (receiver, seen = new Set()) => {
    const node = unwrap(receiver);
    if (ts.isIdentifier(node)) {
      if (reactNamespaces.has(node.text)) return true;
      if (seen.has(node.text) || !aliases.has(node.text)) return false;
      seen.add(node.text);
      return isReactNamespace(aliases.get(node.text), seen);
    }
    return ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' && node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'react';
  };
  const record = (hook, node) => {
    if (BANNED.has(hook)) {
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      violations.push({ hook, line });
    }
  };
  const staticName = (node) => {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isParenthesizedExpression(node)) return staticName(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticName(node.left);
      const right = staticName(node.right);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const part = staticName(span.expression);
        if (part === undefined) return undefined;
        value += part + span.literal.text;
      }
      return value;
    }
    return undefined;
  };

  function visit(node) {
    if (ts.isIdentifier(node)) record(node.text, node);
    if (ts.isElementAccessExpression(node)) {
      const name = staticName(node.argumentExpression);
      record(name, node);
      if (name === undefined && isReactNamespace(node.expression)) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        violations.push({ hook: 'unresolved React member', line });
      }
    }
    if (ts.isComputedPropertyName(node)) record(staticName(node.expression), node);
    ts.forEachChild(node, visit);
  }

  visit(file);
  return violations;
}

export function checkTree(root) {
  const violations = [];
  const files = sourceFiles(root);
  for (const file of files) {
    const path = relative(root, file).replaceAll('\\', '/');
    for (const { hook, line } of scanSource(readFileSync(file, 'utf8'), file)) {
      violations.push(`${path}:${line}  uses ${hook}`);
    }
  }
  return { files: files.length, violations };
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  if (process.argv.length > 2 && (process.argv.length !== 4 || process.argv[2] !== '--root')) {
    console.error('Usage: node scripts/no-react-state.test.mjs [--root DIRECTORY]');
    process.exit(2);
  }
  const root = resolve(process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const { files, violations } = checkTree(root);
  if (violations.length) {
    console.error('FAIL: React local state hooks are banned in gvid-ui (use Grip):');
    for (const violation of violations) console.error(`  ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: no banned React hooks in ${files} GVid UI source files.`);
  }
}
