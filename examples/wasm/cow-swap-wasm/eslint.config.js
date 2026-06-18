import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// The recommended-latest preset of eslint-plugin-react-hooks ships the React
// Compiler lint rules, so the same config that checks the Rules of Hooks also
// flags anything that would defeat the compiler's automatic memoization.
export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs['recommended-latest'].rules },
  },
)
