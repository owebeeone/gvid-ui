import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';

const hooks = ['useState', 'useEffect', 'useRef', 'useReducer', 'useMemo', 'useCallback', 'useLayoutEffect'];
const restricted = hooks.flatMap((hook) => [
  { selector: `CallExpression[callee.name='${hook}']`, message: `${hook} is banned; use Grip taps.` },
  { selector: `ImportSpecifier[imported.name='${hook}']`, message: `Do not import ${hook}.` },
]);

export default tseslint.config([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['app/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    rules: { 'no-restricted-syntax': ['error', ...restricted] },
  },
]);
