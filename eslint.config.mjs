// @ts-check
/**
 * Flat config, ESLint 10 (legacy `.eslintrc` no longer loads).
 *
 * Formatting rules live in `@stylistic/*` rather than ESLint core: the core
 * copies have been deprecated since 8.53 and are removed in ESLint 11, so
 * writing them as core rules would buy one major version of silence and then
 * break the lint step. Correctness rules stay in core / typescript-eslint.
 *
 * The stylistic set is deliberately the same one the review checklist enforces
 * — `object-curly-spacing: never`, `arrow-parens: as-needed`, 120 columns —
 * so a clean `npm run lint` and a clean review mean the same thing.
 */
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const STYLISTIC = {
  // Rule numbers refer to the review checklist.
  '@stylistic/quotes': ['error', 'single', {avoidEscape: true, allowTemplateLiterals: 'always'}],
  '@stylistic/semi': ['error', 'always'],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/max-len': ['error', {code: 120, ignoreUrls: true, ignoreRegExpLiterals: true}],
  // Functions are the exception: a trailing comma after the last argument is
  // legal ES2017 but the checklist reserves dangling commas for objects,
  // arrays and import/export lists.
  '@stylistic/comma-dangle': ['error', {
    arrays: 'always-multiline',
    objects: 'always-multiline',
    imports: 'always-multiline',
    exports: 'always-multiline',
    functions: 'never',
  }],
  // `exceptions: {Property: true}` is the default, which is what keeps the
  // column-aligned cue and fixture tables readable.
  '@stylistic/no-multi-spaces': 'error',
  '@stylistic/comma-spacing': ['error', {before: false, after: true}],
  '@stylistic/space-infix-ops': 'error',
  '@stylistic/space-before-function-paren': ['error', {
    anonymous: 'always',
    named: 'never',
    asyncArrow: 'always',
  }],
  '@stylistic/spaced-comment': ['error', 'always', {markers: ['/']}],
  '@stylistic/key-spacing': ['error', {beforeColon: false, afterColon: true}],
  '@stylistic/keyword-spacing': 'error',
  '@stylistic/object-curly-spacing': ['error', 'never'],
  '@stylistic/space-before-blocks': 'error',
  '@stylistic/arrow-parens': ['error', 'as-needed'],
  '@stylistic/arrow-spacing': 'error',
  // Off by decision, not by oversight: `curly`'s fixer rewrites a single-line
  // early return as `if (x) {return x;}`, which this rule then rejects. Turning
  // it on would require expanding 1,244 of those across 152 files. To adopt the
  // expanded form instead, drop this line and add
  // `'@stylistic/brace-style': ['error', '1tbs', {allowSingleLine: false}]`,
  // whose fixer does the expansion automatically.
  // '@stylistic/max-statements-per-line': ['error', {max: 1}],
  '@stylistic/no-mixed-spaces-and-tabs': 'error',
  '@stylistic/no-confusing-arrow': 'error',
  '@stylistic/eol-last': ['error', 'always'],
};

const CORRECTNESS = {
  curly: ['error', 'all'],
  eqeqeq: ['error', 'always'],
  'dot-notation': 'error',
  radix: 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-wrappers': 'error',
  'no-debugger': 'error',
  'no-caller': 'error',
  'no-fallthrough': 'error',
  'no-unused-labels': 'error',
  // A leading underscore marks a parameter the signature requires but the body
  // does not read — `update(dt, _ts)` and the like. Deleting those would break
  // the position of the parameters after them.
  '@typescript-eslint/no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
    destructuredArrayIgnorePattern: '^_',
  }],
  // `warn`/`error` are the engine's diagnostic channel (unsupported object
  // types, missing prop loaders); `log` is a leftover.
  'no-console': ['error', {allow: ['warn', 'error', 'info', 'debug']}],
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'node_modules/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {'@stylistic': stylistic},
    rules: {...STYLISTIC, ...CORRECTNESS},
  },
  {
    // Engine, editor, examples and the WebGL preview all run in the browser.
    files: ['src/**/*.ts', 'examples/**/*.ts', 'webgl-next/**/*.ts'],
    languageOptions: {globals: globals.browser},
  },
  {
    // Examples are read as documentation; printing to the console is the point.
    files: ['examples/**/*.ts'],
    rules: {'no-console': 'off'},
  },
  {
    files: ['scripts/**/*.mjs', '*.config.ts', '*.config.mjs', 'playwright.webgl.config.ts'],
    languageOptions: {globals: globals.node},
    rules: {
      // Build and CI scripts talk to the operator through stdout.
      'no-console': 'off',
    },
  },
  {
    files: ['src/__tests__/**/*.ts', 'webgl-next/e2e/**/*.ts'],
    languageOptions: {globals: {...globals.browser, ...globals.node}},
    rules: {
      // Fakes stand in for canvas and WebGL contexts, which cannot be typed
      // structurally without reimplementing them.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  }
);
