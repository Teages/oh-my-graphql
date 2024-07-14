import type { DocumentNode } from '@0no-co/graphql.web'
import type { $Fetch, FetchOptions } from 'ofetch'

export type { GraphQLClientError } from './error'

export type ClientOptions = Omit<
  FetchOptions,
  'body' | 'method' | 'ResponseType'
> & {
  /**
   * Default method to use for queries.
   * Only effective when `type` is `'query'`.
   * @default 'POST'
   */
  preferMethod?: 'POST' | 'GET'

  /**
   * Custom ofetch instance.
   *
   * It's useful if you want to use a exist ofetch instance (like in-server $fetch in nitro/nuxt) to make an internal request.
   */
  ofetch?: $Fetch
}

export interface DocumentTypeDecoration<TResult, TVariables> {
  /**
   * Type to support `@graphql-typed-document-node/core`
   * @internal
   */
  __apiType?: (variables: TVariables) => TResult
  /**
   * Type to support `TypedQueryDocumentNode` from `graphql`
   * @internal
   */
  __ensureTypesOfVariablesAndResultMatching?: (variables: TVariables) => TResult
}

// From https://github.com/urql-graphql/urql (MIT License)
/**
 * A GraphQL `DocumentNode` with attached generics for its result data and variables.
 *
 * @remarks
 * A GraphQL {@link DocumentNode} defines both the variables it accepts on request and the `data`
 * shape it delivers on a response in the GraphQL query language.
 *
 * To bridge the gap to TypeScript, tools may be used to generate TypeScript types that define the shape
 * of `data` and `variables` ahead of time. These types are then attached to GraphQL documents using this
 * `TypedDocumentNode` type.
 *
 * Using a `DocumentNode` that is typed like this will cause any `urql` API to type its input `variables`
 * and resulting `data` using the types provided.
 *
 * @privateRemarks
 * For compatibility reasons this type has been copied and internalized from:
 * https://github.com/dotansimha/graphql-typed-document-node/blob/3711b12/packages/core/src/index.ts#L3-L10
 *
 * @see {@link https://github.com/dotansimha/graphql-typed-document-node} for more information.
 */
export interface TypedDocumentNode<
  Result = { [key: string]: any },
  Variables = { [key: string]: any },
> extends DocumentNode,
  DocumentTypeDecoration<Result, Variables> {}

export type DocumentInput<
  Result = Record<string, any>,
  Variables = Record<string, any>,
> = string | DocumentNode | TypedDocumentNode<Result, Variables>

export interface GraphQLClient {
  /**
   * Create a request function to reuse the query.
   */
  prepare: GraphQLPrepare

  /**
   * Send a request with client.
   */
  request: GraphQLRequest

  /**
   * Send a query request with client.
   */
  query: GraphQLRequest

  /**
   * Send a mutation request with client.
   */
  mutation: GraphQLRequest
}

export interface GraphQLPrepare {
  <
    Result = Record<string, any>,
    Variables = Record<string, any>,
  >(
    query: DocumentInput<Result, Variables>,
    optionsOverride?: ClientOptions,
  ): GraphQLPreparedRequest<Result, Variables>
}

export interface GraphQLPreparedRequest<
  Result = Record<string, any>,
  Variables = Record<string, any>,
> {
  (...params: GraphQLRequestParams<Variables>): Promise<Result>
}

export interface GraphQLRequest {
  <
    Result = Record<string, any>,
    Variables = Record<string, any>,
  >(
    query: DocumentInput<Result, Variables>,
    ...params: GraphQLRequestParams<Variables>
  ): Promise<Result>
}

type GraphQLRequestParams<
  TVariables = Record<string, any>,
> = Record<string, never> extends TVariables
  ? [variables?: TVariables, optionsOverride?: ClientOptions]
  : [variables: TVariables, optionsOverride?: ClientOptions]
