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
      payload.query = print(query.document)
    }
  }
  else {
    payload.query = print(query.document)
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

  if (res.errors && res.errors.length > 0) {
    throw new GraphQLErrors(res.errors as [GraphQLError, ...GraphQLError[]])
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
