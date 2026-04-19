import antfu from '@antfu/eslint-config'

export default antfu({
  rules: {
    'curly': ['error', 'all'],
    'eslint-comments/no-unlimited-disable': 'off',
  },
})
