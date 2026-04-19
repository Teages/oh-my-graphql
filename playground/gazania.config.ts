import { defineConfig } from 'gazania/codegen'

export default defineConfig({
  schema: 'https://graphql.anilist.co',
  output: 'gazania/schema.ts',
})
