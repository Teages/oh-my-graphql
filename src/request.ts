import type { DocumentNode } from '@0no-co/graphql.web'
import type { FetchOptions } from 'ofetch'
import type { ClientOptions, TypedDocumentNode } from './type'
import { GraphQLError, Kind, print } from '@0no-co/graphql.web'

import { ofetch } from 'ofetch'
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
  const fetchOptions: FetchOptions = {
    ...options,
    headers: {
      ...options?.headers,
      'Content-Type': 'application/json',
    },
    method: query.type === 'query'
      ? options?.preferMethod ?? 'POST'
      : 'POST',
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

  const res = await $fetch<{ data: Result, errors?: GraphQLError[] }>(query.url, {
    ...fetchOptions,
    responseType: 'json',
  })

  if (res.errors != null && (!Array.isArray(res.errors) || res.errors.length > 0)) {
    const rawErrors = Array.isArray(res.errors) ? res.errors : []
    const validErrors = rawErrors.filter(
      (e): e is GraphQLError => e != null && typeof e === 'object' && typeof e.message === 'string',
    )
    throw new GraphQLErrors(
      validErrors.length > 0
        ? validErrors as [GraphQLError, ...GraphQLError[]]
        : [new GraphQLError('Server returned a malformed errors array')],
    )
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
