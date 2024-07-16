import type { FetchOptions } from 'ofetch'
import { ofetch } from 'ofetch'
import { type DocumentNode, GraphQLError, Kind, print } from 'graphql'

import type { ClientOptions, TypedDocumentNode } from './type'
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

export async function graphqlRequest<
  Result = Record<string, any>,
  Variables = Record<string, any>,
>(
  query: {
    document: DocumentNode | TypedDocumentNode<Result, Variables>
    variables: Variables
    type: 'query' | 'mutation'
    url: string
  },
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

  const payload = {
    query: print(query.document),
    variables: query.variables,
  }
  if (fetchOptions.method === 'POST') {
    fetchOptions.body = payload
  }
  else { // GET
    fetchOptions.query = {
      ...fetchOptions.query,
      ...payload,
    }
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
