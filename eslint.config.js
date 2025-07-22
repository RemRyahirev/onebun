const typescriptParser = require('@typescript-eslint/parser');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const jestPlugin = require('eslint-plugin-jest');
const tsdocPlugin = require('eslint-plugin-tsdoc');
const importPlugin = require('eslint-plugin-import');
const importNewlinesPlugin = require('eslint-plugin-import-newlines');

module.exports = (async () => {
  const stylisticPlugin = await import('@stylistic/eslint-plugin');

  return [
    {
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: {
        parser: typescriptParser,
        parserOptions: {
          project: true,
          tsconfigRootDir: __dirname,
          sourceType: 'module',
        },
        globals: {
          node: true,
          jest: true,
        },
      },
      plugins: {
        jest: jestPlugin,
        '@typescript-eslint': typescriptPlugin,
        tsdoc: tsdocPlugin,
        import: importPlugin,
        'import-newlines': importNewlinesPlugin,
        '@stylistic': stylisticPlugin.default,
      },
      settings: {
        'import/parsers': {
          '@typescript-eslint/parser': ['.ts', '.tsx'],
        },
        'import/resolver': {
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      rules: {
        // disabled rules
        'no-await-in-loop': 'off',
        'no-continue': 'off',
        'no-plusplus': 'off',
        'no-prototype-builtins': 'off',
        'no-restricted-syntax': 'off',
        'no-void': 'off',
        'jest/no-hooks': 'off',
        'jest/no-disabled-tests': 'off',
        'jest/no-conditional-in-test': 'off',
        'jest/prefer-expect-assertions': 'off',
        'import/prefer-default-export': 'off',
        'import/extensions': 'off',
        'class-methods-use-this': 'off',
        'require-await': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        'new-cap': 'off',
        indent: 'off',

        // error rules
        'no-console': 'error',
        'jest/no-restricted-matchers': [
          'error',
          {
            toBeTruthy: 'Avoid `toBeTruthy`',
            toBeFalsy: 'Avoid `toBeFalsy`',
          },
        ],
        'import/order': [
          'error',
          {
            'newlines-between': 'always',
            groups: [
              'builtin',
              'external',
              'type',
              'internal',
              'parent',
              'sibling',
              'index',
              'object',
            ],
            distinctGroup: false,
            alphabetize: {
              order: 'asc',
              caseInsensitive: true,
              orderImportKind: 'asc',
            },
            pathGroupsExcludedImportTypes: ['builtin'],
            pathGroups: [
              // OneBun core imports
              {
                pattern: '@onebun/**',
                group: 'internal',
                position: 'before',
              },
              // Internal paths for OneBun project structure
              {
                pattern: '@core/**',
                group: 'internal',
                position: 'before',
              },
              {
                pattern: '@common/**',
                group: 'internal',
                position: 'before',
              },
              {
                pattern: '@modules/**',
                group: 'internal',
                position: 'before',
              },
              {
                pattern: '@config/**',
                group: 'internal',
                position: 'before',
              },
              {
                pattern: '@types/**',
                group: 'internal',
                position: 'before',
              },
              {
                pattern: '@utils/**',
                group: 'internal',
                position: 'after',
              },
            ],
          },
        ],
        'import/no-extraneous-dependencies': [
          'error',
          { devDependencies: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*'] },
        ],
        '@typescript-eslint/naming-convention': [
          'error',
          {
            selector: 'default',
            format: ['camelCase'],
            leadingUnderscore: 'allow',
          },
          {
            selector: 'memberLike',
            format: ['camelCase', 'UPPER_CASE', 'snake_case'],
            leadingUnderscore: 'allow',
          },
          {
            selector: 'enumMember',
            format: ['PascalCase', 'UPPER_CASE'],
          },
          {
            selector: 'property',
            filter: {
              regex: '\\d+',
              match: false,
            },
            format: ['camelCase', 'UPPER_CASE', 'snake_case'],
            leadingUnderscore: 'allow',
          },
          {
            selector: 'variable',
            format: ['camelCase', 'UPPER_CASE'],
            leadingUnderscore: 'allow',
          },
          {
            selector: 'variable',
            filter: {
              regex: '^Use|Enum$',
              match: true,
            },
            format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
            leadingUnderscore: 'allow',
          },
          {
            selector: 'typeLike',
            format: ['PascalCase'],
            leadingUnderscore: 'allow',
          },
          {
            selector: 'function',
            filter: {
              regex: '^Is|^Use|Dto$|Factory$|Module$|Controller$|Service$',
              match: true,
            },
            format: ['camelCase', 'PascalCase'],
            leadingUnderscore: 'allow',
          },
        ],
        '@typescript-eslint/explicit-module-boundary-types': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        'object-shorthand': [
          'error',
          'always',
          { avoidQuotes: true, avoidExplicitReturnArrows: true },
        ],
        'padding-line-between-statements': [
          'error',
          { blankLine: 'always', prev: '*', next: 'return' },
        ],
        'brace-style': ['error', '1tbs'],
        'comma-dangle': ['error', 'always-multiline'],
        quotes: ['error', 'single', { avoidEscape: true }],
        'import-newlines/enforce': [
          'error',
          {
            items: 2,
            'max-len': 130,
            semi: true,
          },
        ],
        'no-multiple-empty-lines': [
          'error',
          {
            max: 2,
            maxEOF: 0,
            maxBOF: 0,
          },
        ],
        'object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
        'object-curly-spacing': ['error', 'always'],
        'object-curly-newline': [
          'error',
          {
            ObjectExpression: {
              minProperties: 4,
              multiline: true,
              consistent: true,
            },
            ObjectPattern: {
              minProperties: 4,
              multiline: true,
              consistent: true,
            },
            ImportDeclaration: {
              minProperties: 4,
              multiline: true,
              consistent: true,
            },
            ExportDeclaration: {
              minProperties: 4,
              multiline: true,
              consistent: true,
            },
          },
        ],
        curly: ['error', 'all'],
        '@stylistic/member-delimiter-style': 'error',
        '@stylistic/semi': ['error', 'always'],
        'max-len': [
          'error',
          {
            code: 130,
            tabWidth: 2,
            ignoreUrls: true,
            ignoreStrings: true,
            ignoreTemplateLiterals: true,
            ignoreRegExpLiterals: true,
          },
        ],

        // typescript extension
        'no-useless-constructor': 'off',
        '@typescript-eslint/no-useless-constructor': 'error',
        'no-shadow': 'off',
        '@typescript-eslint/no-shadow': 'error',
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            ignoreRestSiblings: true,
            destructuredArrayIgnorePattern: '^_',
            argsIgnorePattern: '^_',
          },
        ],
        'default-param-last': 'off',
        '@typescript-eslint/default-param-last': 'error',
        'no-empty-function': 'off',
        '@typescript-eslint/no-empty-function': [
          'error',
          {
            allow: [
              'private-constructors',
              'protected-constructors',
              'decoratedFunctions',
              'overrideMethods',
            ],
          },
        ],
        '@stylistic/indent': [
          'error',
          2,
          {
            SwitchCase: 1,
            ignoredNodes: [
              `FunctionExpression > .params[decorators.length > 0]`,
              `FunctionExpression > .params > :matches(Decorator, :not(:first-child))`,
              `ClassBody.body > PropertyDefinition[decorators.length > 0] > .key`,
              'TSTypeParameterInstantiation',
            ],
          },
        ],
        'no-return-await': 'off',
        '@typescript-eslint/return-await': ['error', 'always'],

        // warning rules
        'tsdoc/syntax': 'warn',
        'no-magic-numbers': [
          'warn',
          {
            ignore: [-1, 0, 1, 2, 4, 8, 10, 16, 32, 64, 100, 1000, 3000, 8080],
            ignoreDefaultValues: true,
            ignoreClassFieldInitialValues: true,
            detectObjects: true,
          },
        ],
      },
    },
    {
      files: ['**/*.spec.ts', '**/*.test.ts'],
      plugins: {
        jest: jestPlugin,
      },
      rules: {
        '@typescript-eslint/unbound-method': 'off',
        'jest/unbound-method': 'error',
        'no-magic-numbers': 'off',
      },
    },
  ];
})();
