/* eslint-disable no-console */
import { createClient } from '../src'
import { $fetch } from '../test/schema'

const client = createClient('/graphql', {
  ofetch: $fetch,
  query: {
    a: 'test',
  },
})
const getQueries = client.prepare(`query { queries }`)

const res = await getQueries()

console.log(JSON.parse(res.queries))
