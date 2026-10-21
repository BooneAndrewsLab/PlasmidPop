// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * `title` on an HTML or SVG element is the browser's own tooltip, slow and
 * plain; the app's is `data-tip` (item 95, `TooltipLayer`). An `<iframe>`
 * keeps `title` as its accessible name, and an `<option>` keeps it because
 * nothing of ours can draw inside a native select's list.
 * @type {import('@typescript-eslint/utils').TSESLint.RuleModule<'title', []>}
 */
const noTitleAttribute = {
  meta: {
    type: 'problem',
    messages: {
      title:
        'Use data-tip instead of title: the app draws its own tooltip (item 95, TooltipLayer).',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXAttribute(node) {
        // `name.name` is a string for a plain attribute, a node for `ns:name`.
        if (typeof node.name.name !== 'string' || node.name.name !== 'title') return;
        const tag = node.parent.name;
        if (!('name' in tag) || typeof tag.name !== 'string') return;
        if (tag.name !== tag.name.toLowerCase() || tag.name === 'iframe' || tag.name === 'option')
          return;
        context.report({ node, messageId: 'title' });
      },
    };
  },
};

export default defineConfig(
  {
    ignores: ['dist', 'coverage', 'node_modules', '.idea', '.stryker-tmp', 'reports'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    plugins: {
      plasmidpop: {
        rules: {
          // typescript-eslint's rule type names the JSX nodes; ESLint's own
          // does not, so the two are only compatible by way of `unknown`.
          'no-title-attribute': /** @type {import('eslint').Rule.RuleModule} */ (
            /** @type {unknown} */ (noTitleAttribute)
          ),
        },
      },
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'plasmidpop/no-title-attribute': 'error',
    },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js', 'scripts/*.mjs', 'scripts/bench/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      // Project convention: no `any`, ever.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Bio code legitimately uses numeric literals everywhere (offsets, codon
      // sizes); the restrict-template-expressions default is too noisy.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
);
