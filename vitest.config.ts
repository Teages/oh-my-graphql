import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    includeSource: ['src/**/*'],
    coverage: {
      include: ['src/**/*'],
    },
  },
})
