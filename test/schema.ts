import type { H3Event } from 'h3'
import SchemaBuilder from '@pothos/core'
import { createYoga } from 'graphql-yoga'
import { createH3, defineEventHandler, getNodeContext, getQuery, getWebContext } from 'h3'
import { createFetch } from 'ofetch'

const builder = new SchemaBuilder<{
  Context: { event: H3Event }
}>({})

builder.queryType({
  fields: t => ({
    hello: t.string({
      args: {
        name: t.arg.string(),
      },
      resolve: (_p, { name }) => `hello, ${name || 'World'}`,
    }),

    headers: t.string({
      resolve: (_p, _a, { event }) => {
        const headers = event.headers
        return [...headers.entries()]
          .map(([key, value]) => `${key}:${value}`)
          .join('\n')
      },
    }),

    queries: t.string({
      resolve: (_p, _a, { event }) => JSON.stringify(getQuery(event)),
    }),
  }),
})

builder.mutationType({
  fields: t => ({
    submit: t.string({
      resolve: () => 'received',
    }),
  }),
})

const yoga = createYoga({
  schema: builder.toSchema(),
})

const app = createH3()

app.use('/graphql', defineEventHandler(async (event) => {
  const web = getWebContext(event)
  const node = getNodeContext(event)

  if (web) {
    const res = await yoga.handleRequest(web.request, { event })
    return new Response(res.body, res)
  }

  if (node) {
    return yoga(node.req, node.res, { event })
  }

  throw new Error('Unknown runtime')
}))

export const $fetch = createFetch(app)
