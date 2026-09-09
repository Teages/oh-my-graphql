import SchemaBuilder from '@pothos/core'
import { createYoga } from 'graphql-yoga'
import { createFetch } from 'ofetch'

const builder = new SchemaBuilder<{
  Context: { event: { headers: Headers, url: URL } }
}>({})

builder.queryType({
  fields: t => ({
    hello: t.string({
      resolve: () => 'hello, World',
    }),
  }),
})

const yoga = createYoga<{
  event: { headers: Headers, url: URL }
}>({
  schema: builder.toSchema(),
  graphqlEndpoint: '/graphql-user-apq',
})

interface ApqPayload {
  version: number
  sha256Hash: string
}

interface RequestBody {
  query?: string
  variables?: Record<string, any>
  extensions?: { persistedQuery?: ApqPayload }
}

const registeredQueries = new Map<string, string>()
let notFoundStyle: 'message' | 'code' = 'message'

export function resetApqRegistry() {
  registeredQueries.clear()
  notFoundStyle = 'message'
}

export function setApqNotFoundStyle(style: 'message' | 'code') {
  notFoundStyle = style
}

function notFoundResponse(): Response {
  return notFoundStyle === 'code'
    ? Response.json({
        errors: [{
          message: 'Persisted query not found',
          extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' },
        }],
      })
    : Response.json({ errors: [{ message: 'PersistedQueryNotFound' }] })
}

function forwardToYoga(request: Request, body: Record<string, any>): Promise<Response> {
  const forwarded = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(body),
  })
  return yoga.handleRequest(forwarded, {
    event: { headers: forwarded.headers, url: new URL(request.url) },
  })
}

async function handleApq(request: Request): Promise<Response> {
  const body = await request.json() as RequestBody
  const persistedQuery = body.extensions?.persistedQuery

  if (!persistedQuery) {
    return forwardToYoga(request, body)
  }

  const { sha256Hash } = persistedQuery

  if (!body.query) {
    const registered = registeredQueries.get(sha256Hash)
    if (!registered) {
      return notFoundResponse()
    }
    return forwardToYoga(request, { query: registered, variables: body.variables })
  }

  registeredQueries.set(sha256Hash, body.query)
  return forwardToYoga(request, body)
}

export const apqFetch = createFetch({
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? new URL(input, 'http://localhost')
      : input instanceof URL
        ? input
        : new URL(input.url, 'http://localhost')
    const request = new Request(url, init)
    return handleApq(request)
  },
})
