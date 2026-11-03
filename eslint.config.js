import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/main.orig.js', 'test/e2e/**', 'server/admin-ui/**', 'admin-ui/.output/**', 'admin-ui/.nuxt/**', 'apps/desktop/src-tauri/target/**', 'apps/desktop/src-tauri/gen/**', '.shrink2.cjs', 'v_*.png'] },
  js.configs.recommended,
  { files: ['src/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['server/**/*.js', 'shared/**/*.js', 'test/**/*.{js,mjs}', 'deploy/**/*.mjs', 'vite.config.js', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
  { files: ['test/soak/**/*.cjs', 'admin-ui/scripts/**'], languageOptions: { globals: { ...globals.node } } },
  { files: ['admin-ui/app/**', 'apps/launcher/**'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['site/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { rules: { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-empty': ['warn', { allowEmptyCatch: true }], 'no-constant-condition': 'off' } },
];
