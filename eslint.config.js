import js from '@eslint/js';
import globals from 'globals';
import solid from 'eslint-plugin-solid/configs/typescript';
import tseslint from 'typescript-eslint';

/**
 * Static analysis on top of the compiler.
 *
 * tsc --noEmit already runs in strict mode, so the rules that earn their place
 * here are the ones a type checker does not have an opinion about: reactivity
 * mistakes in Solid, floating promises, and the small set of escape hatches
 * that should never appear without an argument next to them.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // The capture and the protocol code do a lot of bit twiddling on typed
      // arrays, where a non-null assertion after a bounds check is clearer
      // than a branch that cannot be taken. It is still flagged, just not
      // fatally, so it stays visible in review.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // A dropped promise in the render loop is a scene that silently never
      // updates, which is the hardest kind of bug to see in a simulation.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // The UI, where Solid's reactivity rules apply.
  {
    ...solid,
    files: ['src/ui/**/*.tsx', 'src/content/**/*.ts'],
  },

  // Tests may reach for anything the production code may not.
  {
    files: ['tests/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },

  // The capture scripts are plain Node ESM, outside the TypeScript project.
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
