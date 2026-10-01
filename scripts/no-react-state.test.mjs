#!/usr/bin/env node
// GVR-UI-004/005: UI state lives in Grip, with no React hook approvals.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Tokenize enough JS/TS to distinguish code from comments and literal text.
// Keep static string tokens so bracket members such as React['useState'] count.
export function scanSource(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const advance = () => { if (source[i++] === '\n') line++; };
  const push = (kind, value, atLine) => tokens.push({ kind, value, line: atLine });

  function escapeValue() {
    advance();
    if (i >= source.length) return '';
    const kind = source[i];
    if (kind === '\n' || kind === '\r') {
      advance();
      if (kind === '\r' && source[i] === '\n') advance();
      return '';
    }
    if (kind === 'x' || kind === 'u') {
      const braced = kind === 'u' && source[i + 1] === '{';
      const digits = braced ? source.slice(i + 2).match(/^[0-9a-fA-F]+(?=})/)?.[0]
        : source.slice(i + 1, i + (kind === 'x' ? 3 : 5)).match(kind === 'x' ? /^[0-9a-fA-F]{2}$/ : /^[0-9a-fA-F]{4}$/)?.[0];
      if (digits && parseInt(digits, 16) <= 0x10ffff) {
        const count = digits.length + (braced ? 3 : 1);
        for (let n = 0; n < count; n++) advance();
        return String.fromCodePoint(parseInt(digits, 16));
      }
    }
    advance();
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[kind] ?? kind;
  }

  function quoted(quote) {
    const atLine = line;
    let value = '';
    advance();
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') { value += escapeValue(); continue; }
      value += source[i];
      advance();
    }
    if (source[i] === quote) advance();
    push('string', value, atLine);
  }

  function template() {
    const atLine = line;
    let value = '';
    let dynamic = false;
    advance();
    while (i < source.length && source[i] !== '`') {
      if (source[i] === '\\') { value += escapeValue(); continue; }
      if (source[i] === '$' && source[i + 1] === '{') {
        dynamic = true;
        advance(); advance();
        scan(true);
        continue;
      }
      value += source[i];
      advance();
    }
    if (source[i] === '`') advance();
    if (!dynamic) push('string', value, atLine);
  }

  function regex() {
    advance();
    let inClass = false;
    while (i < source.length) {
      if (source[i] === '\\') { advance(); if (i < source.length) advance(); continue; }
      if (source[i] === '[') inClass = true;
      if (source[i] === ']') inClass = false;
      if (source[i] === '/' && !inClass) { advance(); break; }
      advance();
    }
    while (/[a-z]/i.test(source[i] ?? '')) advance();
    push('literal', '', line);
  }

  function scan(inTemplate = false) {
    let braces = 0;
    while (i < source.length) {
      const char = source[i];
      if (/\s/.test(char)) { advance(); continue; }
      if (char === '/' && source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') advance();
        continue;
      }
      if (char === '/' && source[i + 1] === '*') {
        advance(); advance();
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) advance();
        if (i < source.length) { advance(); advance(); }
        continue;
      }
      if (char === '\'' || char === '"') { quoted(char); continue; }
      if (char === '`') { template(); continue; }
      if (char === '/' && (!tokens.length || /^(=|\(|\[|\{|:|,|;|!|\?|>|return|throw)$/.test(tokens.at(-1).value))) {
        regex();
        continue;
      }
      if (/[A-Za-z_$]/.test(char)) {
        const atLine = line;
        let word = '';
        while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) { word += source[i]; advance(); }
        push('identifier', word, atLine);
        continue;
      }
      if (inTemplate && char === '}') {
        if (braces === 0) { advance(); return; }
        braces--;
      } else if (inTemplate && char === '{') braces++;
      push('punctuation', char, line);
      advance();
    }
  }

  scan();
  const violations = [];
  tokens.forEach((token, index) => {
    if (token.kind === 'identifier' && BANNED.has(token.value)) {
      violations.push({ hook: token.value, line: token.line });
    }
    if (token.value === '[' && tokens[index + 1]?.kind === 'string' &&
        BANNED.has(tokens[index + 1].value) && tokens[index + 2]?.value === ']') {
      violations.push({ hook: tokens[index + 1].value, line: token.line });
    }
  });
  return violations;
}

export function checkTree(root) {
  const violations = [];
  const files = sourceFiles(root);
  for (const file of files) {
    const path = relative(root, file).replaceAll('\\', '/');
    for (const { hook, line } of scanSource(readFileSync(file, 'utf8'))) {
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
