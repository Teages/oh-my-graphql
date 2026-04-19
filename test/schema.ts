import SchemaBuilder from '@pothos/core'
import { createYoga } from 'graphql-yoga'
import { createFetch } from 'ofetch'

const builder = new SchemaBuilder<{
  Context: { event: { headers: Headers, url: URL } }
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
        return [...event.headers.entries()]
          .map(([key, value]) => `${key}:${value}`)
          .join('\n')
      },
    }),

    queries: t.string({
      resolve: (_p, _a, { event }) => {
        const params = event.url.searchParams
        const obj: Record<string, string> = {}
        params.forEach((v, k) => {
          obj[k] = v
        })
        return JSON.stringify(obj)
      },
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

const yoga = createYoga<{
  event: { headers: Headers, url: URL }
}>({
  schema: builder.toSchema(),
})

export const $fetch = createFetch({
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? new URL(input, 'http://localhost')
      : input instanceof URL
        ? input
        : new URL(input.url, 'http://localhost')
    const request = new Request(url, init)
    const headers = request.headers
    const response = await yoga.handleRequest(request, {
      event: { headers, url },
    })
    return response
  },
})
