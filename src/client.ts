import { GraphQLError, parse } from '@0no-co/graphql.web'
import { defu } from 'defu'

import type { ClientOptions, GraphQLClient, GraphQLPrepare, GraphQLRequest } from './type'
import { getDocumentType, graphqlRequest, mergeHeaders } from './request'
import { GraphQLErrors } from './error'

export function createClient(url: string, options?: ClientOptions): GraphQLClient {
  const prepare: GraphQLPrepare = (query, optionsOverride) => {
    return (...params) => {
      const [variables, runtimeOptions] = params

      const clientOptions = defu(runtimeOptions, optionsOverride, options)
      clientOptions.query = defu(runtimeOptions?.query, optionsOverride?.query, options?.query)
      clientOptions.headers = mergeHeaders(
        options?.headers,
        optionsOverride?.headers,
        runtimeOptions?.headers,
      )
      const document = typeof query === 'string' ? parse(query) : query
      const type = getDocumentType(document)

      if (type === 'subscription') {
        throw new GraphQLErrors([
          new GraphQLError('Subscriptions are not supported'),
        ])
      }

      return graphqlRequest(
        { url, document, variables: variables ?? {}, type },
        clientOptions,
      )
    }
  }

  const request: GraphQLRequest = (query, ...params) => {
    return prepare(query)(...params)
  }

  const query: GraphQLRequest = (query, ...params) => {
    const document = typeof query === 'string' ? parse(query) : query
    const type = getDocumentType(document)
    if (type !== 'query') {
      throw new GraphQLErrors([
        new GraphQLError(`Expected query document, got ${type}`),
      ])
    }
    return request(query, ...params)
  }

  const mutation: GraphQLRequest = (query, ...params) => {
    const document = typeof query === 'string' ? parse(query) : query
    const type = getDocumentType(document)
    if (type !== 'mutation') {
      throw new GraphQLErrors([
        new GraphQLError(`Expected mutation document, got ${type}`),
      ])
    }
    return request(query, ...params)
  }

  return { prepare, request, query, mutation }
}
