import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/main.orig.js', 'test/e2e/**', 'v_*.png'] },
  js.configs.recommended,
  { files: ['src/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['server/**/*.js', 'shared/**/*.js', 'test/**/*.{js,mjs}', 'deploy/**/*.mjs', 'vite.config.js', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
  { files: ['site/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { rules: { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-empty': ['warn', { allowEmptyCatch: true }], 'no-constant-condition': 'off' } },
];
