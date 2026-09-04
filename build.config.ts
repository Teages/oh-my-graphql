import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [{
    type: 'bundle',
    input: 'src/index.ts',
    rolldown: {
      transform: {
        define: {
          'import.meta.vitest': 'undefined',
        },
      },
    },
  }],
})
