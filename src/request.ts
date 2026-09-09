import type { DocumentNode } from '@0no-co/graphql.web'
import type { FetchOptions } from 'ofetch'
import type { ClientOptions, TypedDocumentNode } from './type'
import { GraphQLError, Kind, print } from '@0no-co/graphql.web'

import { FetchError, ofetch } from 'ofetch'
import { GraphQLErrors } from './error'

export function getDocumentType(doc: DocumentNode) {
  let type: 'query' | 'mutation' | 'subscription' | undefined

  doc.definitions.forEach((def) => {
    if (def.kind === Kind.OPERATION_DEFINITION) {
      if (type !== undefined) {
        throw new GraphQLErrors([
          new GraphQLError('Multiple operation definitions in document'),
        ])
      }
      type = def.operation
    }
  })

  if (!type) {
    throw new GraphQLErrors([
      new GraphQLError('No operation definition in document'),
    ])
  }

  return type
}

function hasNonEmptyErrors(value: unknown): value is { errors: unknown[], data?: unknown } {
  if (value == null || typeof value !== 'object' || !('errors' in value)) {
    return false
  }
  const errors: unknown = value.errors
  return Array.isArray(errors) && errors.length > 0
}

function isResponseObject(value: unknown): boolean {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  return 'data' in value || hasNonEmptyErrors(value)
}

function toGraphQLErrors(body: { errors?: unknown[], data?: unknown }, cause?: unknown): GraphQLErrors {
  // entry validation and locations preservation live in the GraphQLErrors
  // constructor, which is the single place normalizing server error payloads.
  return new GraphQLErrors(body.errors ?? [], { data: body.data, cause })
}

export interface PersistedQueryPayload {
  version: number
  sha256Hash: string
}

export interface GraphqlRequestQuery<
  Result = Record<string, any>,
  Variables = Record<string, any>,
> {
  document: DocumentNode | TypedDocumentNode<Result, Variables>
  variables: Variables
  type: 'query' | 'mutation'
  url: string
  persistedQuery?: PersistedQueryPayload
  includeQuery?: boolean
  /** Pre-printed query source, reused across retries to skip re-printing. */
  printedQuery?: string
}

export async function graphqlRequest<
  Result = Record<string, any>,
  Variables = Record<string, any>,
>(
  query: GraphqlRequestQuery<Result, Variables>,
  options?: ClientOptions,
) {
  const opts: ClientOptions = options ?? {}
  const {
    preferQueryMethod,
    persistedQueries: _persistedQueries,
    ofetch: customFetch,
    ...fetchInit
  } = opts

  const method: 'GET' | 'POST' = query.type === 'query'
    ? preferQueryMethod ?? 'POST'
    : 'POST'

  // Merge into a Headers instance so an explicit `Content-Type` from the user
  // wins (`set` semantics) instead of being appended to the default value.
  const headers = new Headers(opts.headers)
  if (method === 'POST' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const fetchOptions: FetchOptions = {
    ...fetchInit,
    headers,
    method,
  }

  const payload: Record<string, any> = {
    variables: query.variables,
  }

  if (query.persistedQuery) {
    payload.extensions = { persistedQuery: query.persistedQuery }
    if (query.includeQuery) {
      payload.query = query.printedQuery ?? print(query.document)
    }
  }
  else {
    payload.query = query.printedQuery ?? print(query.document)
  }

  if (fetchOptions.method === 'POST') {
    fetchOptions.body = payload
  }
  else { // GET
    const queryParams: Record<string, any> = { ...fetchOptions.query }
    for (const [key, value] of Object.entries(payload)) {
      queryParams[key] = typeof value === 'object' ? JSON.stringify(value) : value
    }
    fetchOptions.query = queryParams
  }

  const $fetch = customFetch ?? ofetch

  let res: { data: Result, errors?: GraphQLError[] }
  try {
    res = await $fetch<{ data: Result, errors?: GraphQLError[] }>(query.url, {
      ...fetchOptions,
      responseType: 'json',
    })
  }
  catch (error: unknown) {
    // ofetch rejects with a FetchError on non-2xx responses and keeps the
    // parsed body on `error.data`. A GraphQL errors payload there is a
    // GraphQL error, not a transport failure, so convert it to keep the
    // documented error contract (`GraphQLClientError`).
    const body: unknown = error instanceof FetchError ? error.data : undefined
    if (hasNonEmptyErrors(body)) {
      throw toGraphQLErrors(body, error)
    }
    throw error
  }

  if (!isResponseObject(res)) {
    throw new GraphQLErrors([
      new GraphQLError('Malformed GraphQL response: expected an object with `data` or `errors`'),
    ])
  }

  if (res.errors != null && (!Array.isArray(res.errors) || res.errors.length > 0)) {
    throw toGraphQLErrors(res)
  }

  return res.data
}

export function mergeHeaders(
  ...inits: (HeadersInit | undefined)[]
): HeadersInit {
  const headers = new Headers()

  inits.forEach((init) => {
    if (!init) {
      return
    }

    const h = new Headers(init)

    h.forEach((value, key) => {
      headers.set(key, value)
    })
  })

  return Object.fromEntries(headers)
}
