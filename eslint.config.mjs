import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  ...tseslint.configs.recommended,
  { ignores: ['**/dist', '**/generated', 'materials/*/packages/*/src', '**/node_modules'] },
  {
    files: ['**/*.ts'],
    plugins: { '@nx': nx },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: [],
          depConstraints: [
            { sourceTag: 'type:material', onlyDependOnLibsWithTags: ['type:material'] },
            { sourceTag: 'type:emitter', onlyDependOnLibsWithTags: ['type:emitter', 'type:material'] },
            { sourceTag: 'type:recipe', onlyDependOnLibsWithTags: ['type:recipe', 'type:tool'] },
            { sourceTag: 'type:product', onlyDependOnLibsWithTags: ['type:product'] },
            { sourceTag: 'type:tool', onlyDependOnLibsWithTags: ['type:tool', 'type:material'] },
            { sourceTag: 'scope:*', onlyDependOnLibsWithTags: ['scope:*'] }
          ]
        }
      ]
    }
  }
];
