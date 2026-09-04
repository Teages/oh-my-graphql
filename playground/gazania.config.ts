import { defineConfig } from 'gazania/config'

export default defineConfig({
  schemas: [
    {
      schema: 'https://graphql.anilist.co',
      output: 'gazania/schema.ts',
    },
  ],
})
