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
const isReactHook = (name) => name === 'use' || /^use[A-Z]/.test(name);
const isReactModule = (name) => name === 'react' || name === 'react-dom';
const CLASS_BASES = new Set(['Component', 'PureComponent']);
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
  const importedName = (specifier) => (specifier.propertyName ?? specifier.name).text;
  const isUnboundRequire = (node) => ts.isIdentifier(node) && node.text === 'require' &&
    !(checker.getSymbolAtLocation(node)?.declarations ?? []).some((declaration) =>
      declaration.getSourceFile() === file);
  const isGlobalReact = (node) => {
    if (!ts.isIdentifier(node) || node.text !== 'React') return false;
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || !(symbol.declarations ?? []).some((declaration) =>
      declaration.getSourceFile() === file)) return true;
    return (symbol.declarations ?? []).some((declaration) => {
      if (!ts.isVariableDeclaration(declaration) || declaration.initializer) return false;
      for (let parent = declaration.parent; parent; parent = parent.parent) {
        if (parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return true;
        if (ts.isSourceFile(parent)) break;
      }
      return false;
    });
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
  const isRequireLoader = (receiver, seen = new Set()) => {
    const node = unwrap(receiver);
    if (!ts.isIdentifier(node)) return false;
    if (isUnboundRequire(node)) return true;
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || seen.has(symbol)) return false;
    seen.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer &&
          isRequireLoader(declaration.initializer, new Set(seen))) return true;
    }
    return (assignments.get(symbol) ?? []).some((value) =>
      isRequireLoader(value, new Set(seen)));
  };
  const bindingHasName = (binding, name) => ts.isIdentifier(binding)
    ? binding.text === name
    : binding.elements.some((element) =>
      ts.isBindingElement(element) && bindingHasName(element.name, name));
  const hasLocalShadow = (node) => {
    for (let scope = node.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) =>
        bindingHasName(parameter.name, node.text))) return true;
      if (ts.isCatchClause(scope) && scope.variableDeclaration &&
          bindingHasName(scope.variableDeclaration.name, node.text)) return true;
      if (ts.isSourceFile(scope) || ts.isBlock(scope)) {
        for (const statement of scope.statements) {
          if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
            bindingHasName(declaration.name, node.text))) return true;
          if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
              statement.name?.text === node.text) return true;
        }
      }
    }
    return false;
  };
  const isGlobalObject = (receiver, names) => {
    const node = unwrap(receiver);
    if (!ts.isIdentifier(node) || !names.includes(node.text)) return false;
    return !hasLocalShadow(node) &&
      !(checker.getSymbolAtLocation(node)?.declarations ?? []).some((declaration) =>
      declaration.getSourceFile() === file);
  };
  const isGlobalReactAccess = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      return node.name.text === 'React' &&
        isGlobalObject(node.expression, ['globalThis', 'window', 'self']);
    }
    if (ts.isElementAccessExpression(node)) {
      return staticName(node.argumentExpression) === 'React' &&
        isGlobalObject(node.expression, ['globalThis', 'window', 'self']);
    }
    return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'get' &&
      isGlobalObject(node.expression.expression, ['Reflect']) &&
      node.arguments.length >= 2 &&
      isGlobalObject(node.arguments[0], ['globalThis', 'window', 'self']) &&
      staticName(node.arguments[1]) === 'React';
  };
  const isReactNamespace = (receiver, seen = new Set()) => {
    const node = unwrap(receiver);
    if (isGlobalReactAccess(node)) return true;
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (!symbol) return node.text === 'React';
      if (seen.has(symbol)) return false;
      seen.add(symbol);
      for (const declaration of symbol.declarations ?? []) {
        if ((ts.isNamespaceImport(declaration) || ts.isImportClause(declaration) ||
             (ts.isImportSpecifier(declaration) && importedName(declaration) === 'default')) &&
            isReactModule(importSource(declaration))) return true;
        if (isGlobalReact(node)) return true;
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
    return ts.isCallExpression(node) && isRequireLoader(node.expression) &&
      node.arguments.length >= 1 && isReactModule(staticName(node.arguments[0]));
  };
  const record = (hook, node, predicate = isReactHook) => {
    if (hook && predicate(hook)) {
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      violations.push({ hook, line });
    }
  };
  const staticName = (node) => {
    if (!node) return undefined;
    node = unwrap(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
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

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && isReactModule(statement.moduleSpecifier.text)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))) {
        unsafeReactAccess.push(statement);
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const entry of clause.namedBindings.elements) {
          if (entry.isTypeOnly) continue;
          const name = importedName(entry);
          if (name === 'default') unsafeReactAccess.push(entry);
          else if (statement.moduleSpecifier.text === 'react' && CLASS_BASES.has(name)) {
            const line = file.getLineAndCharacterOfPosition(entry.getStart(file)).line + 1;
            violations.push({ hook: 'React class component base', line });
          }
          else record(name, entry);
        }
      }
    }
    if (ts.isExportDeclaration(statement) && isReactModule(statement.moduleSpecifier?.text) &&
        !statement.isTypeOnly) {
      if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) {
        unsafeReactAccess.push(statement);
      } else {
        for (const entry of statement.exportClause.elements) {
          if (entry.isTypeOnly) continue;
          const name = importedName(entry);
          if (name === 'default') unsafeReactAccess.push(entry);
          else if (statement.moduleSpecifier.text === 'react' && CLASS_BASES.has(name)) {
            const line = file.getLineAndCharacterOfPosition(entry.getStart(file)).line + 1;
            violations.push({ hook: 'React class component base', line });
          }
          else record(name, entry);
        }
      }
    }
    if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        isReactModule(staticName(statement.moduleReference.expression))) unsafeReactAccess.push(statement);
  }

  const isErased = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isTypeNode(parent)) return true;
      if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) ||
          ts.isImportEqualsDeclaration(parent)) return true;
    }
    return false;
  };
  const isDeclarationName = (node) => node.parent?.name === node &&
    (ts.isVariableDeclaration(node.parent) || ts.isParameter(node.parent) ||
     ts.isFunctionDeclaration(node.parent) || ts.isClassDeclaration(node.parent));
  const recordUnresolved = (node) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    violations.push({ hook: 'unresolved React member', line });
  };

  function visit(node) {
    if (isGlobalReactAccess(node) && !isErased(node)) unsafeReactAccess.push(node);
    if (ts.isIdentifier(node) && isGlobalReact(node) && !isErased(node) && !isDeclarationName(node)) {
      unsafeReactAccess.push(node);
    }
    if (ts.isCallExpression(node)) {
      if (node.arguments.length >= 1 &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequireLoader(node.expression))) {
        const moduleName = staticName(node.arguments[0]);
        if (isReactModule(moduleName) || moduleName === undefined) unsafeReactAccess.push(node);
      }
      if (ts.isIdentifier(node.expression) && BANNED.has(node.expression.text) &&
          !isErased(node.expression)) {
        const symbol = checker.getSymbolAtLocation(node.expression);
        const importedFromReact = (symbol?.declarations ?? []).some((declaration) =>
          ts.isImportSpecifier(declaration) && isReactModule(importSource(declaration)));
        if (!importedFromReact) record(node.expression.text, node.expression, (name) => BANNED.has(name));
      }
    }
    if (ts.isPropertyAccessExpression(node) && isReactNamespace(node.expression)) {
      record(node.name.text, node);
    }
    if (ts.isElementAccessExpression(node)) {
      const name = staticName(node.argumentExpression);
      if (isReactNamespace(node.expression)) {
        if (name === undefined) recordUnresolved(node);
        else record(name, node);
      } else if (ts.isIdentifier(unwrap(node.expression)) &&
                 !checker.getSymbolAtLocation(unwrap(node.expression))) {
        record(name, node);
      }
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) &&
        ts.isVariableDeclaration(node.parent.parent) &&
        node.parent.parent.initializer && isReactNamespace(node.parent.parent.initializer)) {
      const property = node.propertyName ?? node.name;
      const name = ts.isComputedPropertyName(property) ? staticName(property.expression) : property.text;
      if (name === undefined) recordUnresolved(property);
      else record(name, property);
    }
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
    console.error('FAIL: React hooks and local state are banned in gvid-ui (use Grip):');
    for (const violation of violations) console.error(`  ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: no React hook or local-state violations in ${files} GVid UI source files.`);
  }
}
