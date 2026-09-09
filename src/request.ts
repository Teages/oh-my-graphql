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

function hasNonEmptyErrors(value: unknown): value is { errors: unknown[] } {
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

function toGraphQLErrors(errors: unknown): GraphQLErrors {
  const rawErrors = Array.isArray(errors) ? errors : []
  const validErrors = rawErrors.filter(
    (e): e is GraphQLError => e != null && typeof e === 'object' && typeof e.message === 'string',
  )
  return new GraphQLErrors(
    validErrors.length > 0
      ? validErrors as [GraphQLError, ...GraphQLError[]]
      : [new GraphQLError('Server returned a malformed errors array')],
  )
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
  const method: 'GET' | 'POST' = query.type === 'query'
    ? options?.preferMethod ?? 'POST'
    : 'POST'

  // Merge into a Headers instance so an explicit `Content-Type` from the user
  // wins (`set` semantics) instead of being appended to the default value.
  const headers = new Headers(options?.headers)
  if (method === 'POST' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const fetchOptions: FetchOptions = {
    ...options,
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

  const $fetch = options?.ofetch ?? ofetch

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
    const data: unknown = error instanceof FetchError ? error.data : undefined
    if (hasNonEmptyErrors(data)) {
      throw toGraphQLErrors(data.errors)
    }
    throw error
  }

  if (!isResponseObject(res)) {
    throw new GraphQLErrors([
      new GraphQLError('Malformed GraphQL response: expected an object with `data` or `errors`'),
    ])
  }

  if (res.errors != null && (!Array.isArray(res.errors) || res.errors.length > 0)) {
    throw toGraphQLErrors(res.errors)
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
