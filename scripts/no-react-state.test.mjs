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
  const sourceName = resolve(fileName);
  const options = { target: ts.ScriptTarget.Latest, noLib: true, noResolve: true, allowJs: true };
  const file = ts.createSourceFile(sourceName, source, options.target, true, scriptKind(fileName));
  const host = ts.createCompilerHost(options);
  const sameFile = (name) => resolve(name).toLowerCase() === sourceName.toLowerCase();
  host.getSourceFile = (name) => sameFile(name) ? file : undefined;
  host.fileExists = sameFile;
  host.readFile = (name) => sameFile(name) ? source : undefined;
  const checker = ts.createProgram([sourceName], options, host).getTypeChecker();
  const violations = [];
  const unsafeReactAccess = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === 'react') {
      const clause = statement.importClause;
      if (clause && !clause.isTypeOnly &&
          (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)))) {
        unsafeReactAccess.push(statement);
      }
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier?.text === 'react' &&
        !statement.isTypeOnly &&
        !(statement.exportClause && ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.every((entry) => entry.isTypeOnly))) {
      unsafeReactAccess.push(statement);
    }
    if (ts.isImportEqualsDeclaration(statement) &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        statement.moduleReference.expression?.text === 'react') unsafeReactAccess.push(statement);
  }
  const unwrap = (node) => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
           ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) ||
           ts.isNonNullExpression(node)) node = node.expression;
    return node;
  };
  const importSource = (node) => {
    for (let parent = node; parent; parent = parent.parent) {
      if (ts.isImportDeclaration(parent)) return parent.moduleSpecifier.text;
    }
    return undefined;
  };
  const assignments = new Map();
  function collectAssignments(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrap(node.left);
      if (ts.isIdentifier(left)) {
        const symbol = checker.getSymbolAtLocation(left);
        if (symbol) assignments.set(symbol, [...(assignments.get(symbol) ?? []), node.right]);
      }
    }
    ts.forEachChild(node, collectAssignments);
  }
  collectAssignments(file);
  const isReactNamespace = (receiver, seen = new Set()) => {
    const node = unwrap(receiver);
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (!symbol) return node.text === 'React';
      if (seen.has(symbol)) return false;
      seen.add(symbol);
      for (const declaration of symbol.declarations ?? []) {
        if ((ts.isNamespaceImport(declaration) || ts.isImportClause(declaration)) &&
            importSource(declaration) === 'react') return true;
        if ((ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) &&
            declaration.initializer && isReactNamespace(declaration.initializer, new Set(seen))) return true;
      }
      return (assignments.get(symbol) ?? []).some((value) =>
        isReactNamespace(value, new Set(seen)));
    }
    if (ts.isConditionalExpression(node)) {
      return isReactNamespace(node.whenTrue, new Set(seen)) ||
        isReactNamespace(node.whenFalse, new Set(seen));
    }
    if (ts.isBinaryExpression(node) &&
        [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.CommaToken]
          .includes(node.operatorToken.kind)) {
      return isReactNamespace(node.left, new Set(seen)) ||
        isReactNamespace(node.right, new Set(seen));
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'React' &&
        ts.isIdentifier(node.expression) &&
        ['globalThis', 'window', 'self'].includes(node.expression.text) &&
        !checker.getSymbolAtLocation(node.expression)) return true;
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
    if (ts.isCallExpression(node) && node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'react' &&
        ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
         node.expression.kind === ts.SyntaxKind.ImportKeyword)) unsafeReactAccess.push(node);
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
  if (!violations.length && unsafeReactAccess.length) {
    for (const node of unsafeReactAccess) {
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      violations.push({ hook: 'React runtime namespace access', line });
    }
  }
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
