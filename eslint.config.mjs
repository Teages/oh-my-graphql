import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: [
    'playground/gazania/schema.ts',
  ],
  rules: {
    'curly': ['error', 'all'],
    'eslint-comments/no-unlimited-disable': 'off',
  },
})
