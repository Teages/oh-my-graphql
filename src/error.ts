import type { FetchError } from 'ofetch'
import { GraphQLError } from 'graphql'

export type GraphQLClientError = FetchError | GraphQLErrors

export class GraphQLErrors extends Error {
  errors: GraphQLError[]
  constructor(errors: [GraphQLError, ...GraphQLError[]]) {
    const hint = errors.length > 1
      ? `${errors[0].message}... (and ${errors.length - 1} more errors)`
      : errors[0].message

    super(`GraphQL request error: ${hint}`)
    this.errors = errors.map(e => new GraphQLError(
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
