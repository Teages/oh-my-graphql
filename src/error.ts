import type { FetchError } from 'ofetch'
import { GraphQLError } from '@0no-co/graphql.web'

export type GraphQLClientError = FetchError | GraphQLErrors

export class GraphQLErrors extends Error {
  errors: GraphQLError[]
  /**
   * Partial response data returned by the server alongside the errors,
   * when the server sent both (per the GraphQL specification it may).
   */
  data?: unknown
  constructor(errors: [GraphQLError, ...GraphQLError[]], data?: unknown) {
    const valid = errors.filter(e => e != null && typeof e === 'object' && typeof e.message === 'string')
    const list = valid.length > 0 ? valid : [new GraphQLError('Unknown GraphQL error')]

    const hint = list.length > 1
      ? `${list[0].message}... (and ${list.length - 1} more errors)`
      : list[0].message

    super(`GraphQL request error: ${hint}`)
    this.data = data
    this.errors = list.map(e => new GraphQLError(
      e.message,
      e.nodes,
      e.source,
      e.positions,
      e.path,
      e.originalError,
      e.extensions,
    ))
  }
}
