import type { FetchError } from 'ofetch'
import { GraphQLError } from '@0no-co/graphql.web'

export type GraphQLClientError = FetchError | GraphQLErrors

export interface GraphQLErrorsOptions {
  /** Partial response data returned alongside the errors, if any. */
  data?: unknown
  /** The underlying error (parse failure, hash failure, original FetchError...). */
  cause?: unknown
}

/**
 * Shape an error entry must have to be surfaced on `GraphQLErrors.errors`.
 * Covers both `GraphQLError` instances and raw server JSON entries.
 */
interface GraphQLErrorInit {
  message: string
  nodes?: GraphQLError['nodes']
  source?: GraphQLError['source']
  positions?: GraphQLError['positions']
  path?: GraphQLError['path']
  originalError?: GraphQLError['originalError']
  extensions?: GraphQLError['extensions']
  locations?: GraphQLError['locations']
}

function isGraphQLErrorLike(value: unknown): value is GraphQLErrorInit {
  if (value == null || typeof value !== 'object' || !('message' in value)) {
    return false
  }
  return typeof value.message === 'string'
}

interface GraphQLErrorLocation {
  line: number
  column: number
}

function getLocation(body: string, position: number): GraphQLErrorLocation {
  let line = 1
  let column = 1
  for (let i = 0; i < position; i++) {
    if (body.charCodeAt(i) === 10) {
      line++
      column = 1
    }
    else {
      column++
    }
  }
  return { line, column }
}

function locationsFromSource(
  source: GraphQLErrorInit['source'],
  positions: GraphQLErrorInit['positions'],
): GraphQLErrorLocation[] | undefined {
  const body: unknown = source?.body
  if (typeof body !== 'string' || positions == null) {
    return undefined
  }
  return positions.map(position => getLocation(body, position))
}

function toGraphQLError(e: GraphQLErrorInit): GraphQLError {
  const rebuilt = new GraphQLError(
    e.message,
    e.nodes,
    e.source,
    e.positions,
    e.path,
    e.originalError,
    e.extensions,
  )
  // graphql-web never populates `locations`: server errors arrive as JSON
  // carrying the already-computed locations, and parse errors only carry the
  // source with positions. Materialize them on the rebuilt error either way.
  const locations = e.locations ?? locationsFromSource(e.source, e.positions)
  if (locations != null) {
    Object.defineProperty(rebuilt, 'locations', {
      value: locations,
      configurable: true,
      enumerable: true,
      writable: true,
    })
  }
  return rebuilt
}

export class GraphQLErrors extends Error {
  errors: GraphQLError[]
  /**
   * Partial response data returned by the server alongside the errors,
   * when the server sent both (per the GraphQL specification it may).
   */
  data?: unknown
  constructor(errors: unknown[], options?: GraphQLErrorsOptions) {
    const list = (Array.isArray(errors) ? errors : [])
      .filter(isGraphQLErrorLike)
      .map(toGraphQLError)
    const finalErrors = list.length > 0
      ? list
      : [new GraphQLError('Server returned a malformed errors array')]

    const hint = finalErrors.length > 1
      ? `${finalErrors[0].message}... (and ${finalErrors.length - 1} more errors)`
      : finalErrors[0].message

    super(`GraphQL request error: ${hint}`)
    this.name = 'GraphQLErrors'
    this.data = options?.data
    if (options?.cause !== undefined) {
      this.cause = options.cause
    }
    this.errors = finalErrors
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('GraphQLErrors', () => {
    it('derives locations from source and positions when absent', () => {
      const source = { body: 'query {\n  hello', name: 'test', locationOffset: { line: 1, column: 1 } }
      const original = new GraphQLError('bad', undefined, source, [4, 10])

      const error = new GraphQLErrors([original])

      expect(error.errors[0].locations).toEqual([
        { line: 1, column: 5 },
        { line: 2, column: 3 },
      ])
    })

    it('keeps explicit locations from server JSON errors', () => {
      const error = new GraphQLErrors([{
        message: 'boom',
        locations: [{ line: 3, column: 7 }],
      }])

      expect(error.errors[0].locations).toEqual([{ line: 3, column: 7 }])
    })

    it('normalizes malformed entries into a single fallback error', () => {
      const error = new GraphQLErrors([null, 42])

      expect(error.errors).toHaveLength(1)
      expect(error.errors[0].message).toContain('malformed errors array')
    })
  })
}
