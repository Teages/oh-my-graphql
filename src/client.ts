import type { DocumentNode } from '@0no-co/graphql.web'
import type { PersistedQueryPayload } from './request'
import type { ClientOptions, GraphQLClient, GraphQLPrepare, GraphQLRequest, TypedDocumentNode } from './type'
import { GraphQLError, parse, print } from '@0no-co/graphql.web'

import { defu } from 'defu'
import { GraphQLErrors } from './error'
import { sha256 } from './hash'
import { getDocumentType, graphqlRequest, mergeHeaders } from './request'

function parseDocument(query: string | DocumentNode | TypedDocumentNode<any, any>): DocumentNode {
  if (typeof query !== 'string') {
    return query
  }
  try {
    return parse(query)
  }
  catch (e) {
    throw new GraphQLErrors([
      new GraphQLError(e instanceof Error ? e.message : 'Failed to parse GraphQL document'),
    ])
  }
}

function hasPersistedQueryError(error: GraphQLErrors, message: string, code: string): boolean {
  return error.errors.some(
    err => err.message === message || err.extensions?.code === code,
  )
}

interface QueryCache {
  printed?: string
  hash?: Promise<string>
}

async function computeHash(
  printedQuery: string,
  hashFn?: (query: string) => string | Promise<string>,
): Promise<string> {
  return hashFn?.(printedQuery) ?? sha256(printedQuery)
}

export function createClient(url: string, options?: ClientOptions): GraphQLClient {
  let apqDisabled = false

  const execute = async <Result, Variables>(
    document: DocumentNode,
    variables: Variables | undefined,
    runtimeOptions: ClientOptions | undefined,
    optionsOverride: ClientOptions | undefined,
    cache?: QueryCache,
  ): Promise<Result> => {
    const clientOptions = defu(runtimeOptions, optionsOverride, options)
    clientOptions.query = defu(runtimeOptions?.query, optionsOverride?.query, options?.query)
    clientOptions.headers = mergeHeaders(
      options?.headers,
      optionsOverride?.headers,
      runtimeOptions?.headers,
    )
    const type = getDocumentType(document)

    if (type === 'subscription') {
      throw new GraphQLErrors([
        new GraphQLError('Subscriptions are not supported'),
      ])
    }

    let printedQuery: string
    if (cache) {
      cache.printed ??= print(document)
      printedQuery = cache.printed
    }
    else {
      printedQuery = print(document)
    }

    const pqConfig = clientOptions.persistedQueries

    if (pqConfig && !apqDisabled) {
      const hashFn = typeof pqConfig === 'object' ? pqConfig.hash : undefined
      let hashPromise: Promise<string>
      if (cache) {
        cache.hash ??= computeHash(printedQuery, hashFn)
        hashPromise = cache.hash
      }
      else {
        hashPromise = computeHash(printedQuery, hashFn)
      }
      const persistedQuery: PersistedQueryPayload = { version: 1, sha256Hash: await hashPromise }

      try {
        return await graphqlRequest<Result>(
          { url, document, variables: variables ?? {}, type, persistedQuery, printedQuery, includeQuery: false },
          clientOptions,
        )
      }
      catch (e) {
        if (!(e instanceof GraphQLErrors)) {
          throw e
        }
        if (hasPersistedQueryError(e, 'PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND')) {
          // APQ protocol: register the query by sending it once.
          // A failure here is the actual error and is surfaced as-is.
          return await graphqlRequest<Result>(
            { url, document, variables: variables ?? {}, type, persistedQuery, printedQuery, includeQuery: true },
            clientOptions,
          )
        }
        if (hasPersistedQueryError(e, 'PersistedQueryNotSupported', 'PERSISTED_QUERY_NOT_SUPPORTED')) {
          apqDisabled = true
          return await graphqlRequest<Result>(
            { url, document, variables: variables ?? {}, type, printedQuery },
            clientOptions,
          )
        }
        throw e
      }
    }

    return graphqlRequest<Result>(
      { url, document, variables: variables ?? {}, type, printedQuery },
      clientOptions,
    )
  }

  const prepare: GraphQLPrepare = (query, optionsOverride) => {
    let setup: { document: DocumentNode } | { error: unknown }
    try {
      const document = parseDocument(query)
      getDocumentType(document)
      setup = { document }
    }
    catch (e) {
      setup = { error: e }
    }
    const cache: QueryCache = {}

    return (...params) => {
      if ('error' in setup) {
        return Promise.reject(setup.error)
      }
      const [variables, runtimeOptions] = params
      return execute(setup.document, variables, runtimeOptions, optionsOverride, cache)
    }
  }

  const request: GraphQLRequest = async (query, ...params) => {
    const document = parseDocument(query)
    return execute(document, params[0], params[1], undefined)
  }

  const query: GraphQLRequest = async (query, ...params) => {
    const document = parseDocument(query)
    const type = getDocumentType(document)
    if (type !== 'query') {
      throw new GraphQLErrors([
        new GraphQLError(`Expected query document, got ${type}`),
      ])
    }
    return execute(document, params[0], params[1], undefined)
  }

  const mutation: GraphQLRequest = async (query, ...params) => {
    const document = parseDocument(query)
    const type = getDocumentType(document)
    if (type !== 'mutation') {
      throw new GraphQLErrors([
        new GraphQLError(`Expected mutation document, got ${type}`),
      ])
    }
    return execute(document, params[0], params[1], undefined)
  }

  return { prepare, request, query, mutation }
}

if (import.meta.vitest) {
  const { beforeAll, describe, expect, it } = import.meta.vitest
  let $fetch: typeof import('../test/schema')['$fetch']
  let gazania: typeof import('gazania')['gazania']

  beforeAll(async () => {
    const schema = await import('../test/schema')
    const gazaniaModule = await import('gazania')
    $fetch = schema.$fetch
    gazania = gazaniaModule.gazania
  })

  describe('basic', () => {
    it('works', async () => {
      const client = createClient('/graphql', { ofetch: $fetch })

      expect(
        await client.query('query { hello }'),
      ).toEqual(
        { hello: 'hello, World' },
      )

      expect(
        await client.query(
          gazania.query().select($ => $.select(['hello'])),
        ),
      ).toEqual(
        { hello: 'hello, World' },
      )

      expect(
        await client.query('query { hello }', {}, { preferMethod: 'GET' }),
      ).toEqual(
        { hello: 'hello, World' },
      )

      expect(
        await client.mutation('mutation { submit }'),
      ).toEqual(
        { submit: 'received' },
      )
    })
  })

  describe('error', () => {
    it('fetch error', async () => {
      const client = createClient('http://localhost:1')

      await expect(
        () => client.query('query { hello }'),
      ).rejects.toThrowError(
        'fetch failed',
      )
    })

    it('graphql error', async () => {
      const client = createClient('/graphql', { ofetch: $fetch })

      await expect(
        () => client.query('query { notFound }'),
      ).rejects.toThrowError(
        'Cannot query field "notFound" on type "Query".',
      )

      await expect(
        () => client.query('query { notFound, another }'),
      ).rejects.toThrowError(
        '(and 1 more errors)',
      )
    })
  })

  describe('malformed response', () => {
    it('rejects with GraphQLErrors instead of crashing on malformed errors', async () => {
      const bodies: any[] = [
        { errors: [null] },
        { errors: ['oops'] },
        { errors: { code: 'X' } },
        { errors: [{ nope: true }] },
        { errors: [{ message: 42 }] },
      ]

      for (const body of bodies) {
        const mockFetch: typeof $fetch = (() => body) as any
        const client = createClient('/graphql', { ofetch: mockFetch })

        await expect(
          client.query('query { hello }'),
        ).rejects.toBeInstanceOf(GraphQLErrors)
      }
    })

    it('reports a malformed errors array when no valid entry exists', async () => {
      const mockFetch: typeof $fetch = (() => ({ errors: [null] })) as any
      const client = createClient('/graphql', { ofetch: mockFetch })

      await expect(
        client.query('query { hello }'),
      ).rejects.toThrowError('malformed errors array')
    })

    it('filters invalid entries and keeps valid ones', async () => {
      const mockFetch: typeof $fetch = (() => ({
        errors: [null, { message: 'real error' }],
      })) as any
      const client = createClient('/graphql', { ofetch: mockFetch })

      const error = await client.query('query { hello }').catch(e => e)

      expect(error).toBeInstanceOf(GraphQLErrors)
      expect(error.errors).toHaveLength(1)
      expect(error.errors[0].message).toBe('real error')
    })
  })

  describe('header', () => {
    it('merge', async () => {
      const client = createClient('/graphql', {
        ofetch: $fetch,
        headers: {
          'X-Test': 'test',
        },
      })

      const res = await client.query('query { headers }', {}, {
        headers: {
          'X-Another-Test': 'test2',
        },
      })
      const headers = (res.headers.split('\n') as string[])
        .map(line => line.trim().toLowerCase())

      expect(headers).toContain('x-test:test')
      expect(headers).toContain('x-another-test:test2')
    })

    it('override', async () => {
      const client = createClient('/graphql', {
        ofetch: $fetch,
        headers: {
          'X-Test': 'test',
        },
      })

      const getHeader = client.prepare('query { headers }', {
        headers: {
          'X-Test': 'test2',
        },
      })

      expect(
        ((await getHeader({})).headers.split('\n') as string[])
          .map(line => line.trim().toLowerCase()),
      ).toContain('x-test:test2')

      expect(
        ((await getHeader({}, {
          headers: {
            'X-Test': 'test3',
          },
        })).headers.split('\n') as string[])
          .map(line => line.trim().toLowerCase()),
      ).toContain('x-test:test3')
    })
  })

  describe('query', () => {
    it('merge', async () => {
      const client = createClient('/graphql', {
        ofetch: $fetch,
        query: {
          a: 'apple',
        },
      })

      const getQueries = client.prepare(`query { queries }`, {
        preferMethod: 'GET',
        query: {
          b: 'banana',
        },
      })

      const res = await getQueries({}, {
        query: {
          c: 'cherry',
        },
      })
      const queries = JSON.parse(res.queries)

      expect(queries.a).toMatch('apple')
      expect(queries.b).toMatch('banana')
      expect(queries.c).toMatch('cherry')
    })

    it('override', async () => {
      const client = createClient('/graphql', {
        ofetch: $fetch,
        query: {
          a: 'apple',
        },
      })

      const getQueries = client.prepare(`query { queries }`, {
        query: { a: 'apollo' },
      })

      expect(JSON.parse(((await getQueries()).queries)).a).toMatch('apollo')

      expect(JSON.parse((await getQueries({}, {
        query: { a: 'arbutus' },
      })).queries).a).toMatch('arbutus')
    })
  })

  describe('operation type check', () => {
    it('operation type check', async () => {
      const client = createClient('/graphql', { ofetch: $fetch })

      await expect(
        client.mutation('query { hello }'),
      ).rejects.toThrowError()

      await expect(
        client.query('mutation { hello }'),
      ).rejects.toThrowError()

      await expect(
        client.request('subscription { hello }'),
      ).rejects.toThrowError()

      await expect(
        client.mutation(
          gazania.query().select($ => $.select(['hello'])),
        ),
      ).rejects.toThrowError()
    })

    it('operation count check', async () => {
      const client = createClient('/graphql', { ofetch: $fetch })

      await expect(
        client.mutation('fragment F on Query { hello }'),
      ).rejects.toThrowError()

      await expect(
        client.request('query A { hello }\n query B { hello }'),
      ).rejects.toThrowError()
    })

    it('wraps syntax errors in GraphQLErrors', async () => {
      const client = createClient('/graphql', { ofetch: $fetch })

      await expect(
        client.query('query {'),
      ).rejects.toBeInstanceOf(GraphQLErrors)

      await expect(
        client.query('query {'),
      ).rejects.toThrowError('Syntax Error')
    })

    it('returns rejected promises instead of throwing synchronously', async () => {
      const client = createClient('/graphql', { ofetch: $fetch })

      // the call itself must not throw before producing a promise
      const promise = client.query('mutation { hello }')
      expect(promise).toBeInstanceOf(Promise)
      await expect(promise).rejects.toThrowError('Expected query document, got mutation')
    })
  })

  describe('persisted queries', () => {
    it('sends hash without query on first attempt', async () => {
      const bodies: any[] = []
      const mockFetch: typeof $fetch = ((url: string, init: any) => {
        bodies.push(init.body)
        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: true,
      })

      await client.query('query { hello }')

      expect(bodies.length).toBe(1)
      expect(bodies[0].query).toBeUndefined()
      expect(bodies[0].extensions?.persistedQuery).toEqual({
        version: 1,
        sha256Hash: expect.any(String),
      })
      expect(bodies[0].extensions.persistedQuery.sha256Hash).toHaveLength(64)
    })

    it('retries with full query on PersistedQueryNotFound', async () => {
      let callCount = 0
      const bodies: any[] = []
      const mockFetch: typeof $fetch = ((url: string, init: any) => {
        callCount++
        bodies.push(init.body)

        if (callCount === 1) {
          return {
            errors: [{ message: 'PersistedQueryNotFound' }],
          }
        }

        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: true,
      })

      const res = await client.query('query { hello }')

      expect(callCount).toBe(2)
      expect(res).toEqual({ hello: 'hello, World' })
      expect(bodies[0].query).toBeUndefined()
      expect(bodies[1].query).toBeTruthy()
      expect(bodies[1].extensions?.persistedQuery).toEqual({
        version: 1,
        sha256Hash: expect.any(String),
      })
    })

    it('disables APQ after PersistedQueryNotSupported and falls back', async () => {
      let callCount = 0
      const bodies: any[] = []
      const mockFetch: typeof $fetch = ((_url: string, _init: any) => {
        callCount++
        bodies.push(_init.body)
        if (callCount === 1) {
          return {
            errors: [{ message: 'PersistedQueryNotSupported' }],
          }
        }
        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: true,
      })

      const res1 = await client.query('query { hello }')
      expect(res1).toEqual({ hello: 'hello, World' })
      expect(callCount).toBe(2)
      expect(bodies[0].extensions?.persistedQuery).toBeDefined()
      expect(bodies[1].extensions).toBeUndefined()

      const res2 = await client.query('query { hello }')
      expect(res2).toEqual({ hello: 'hello, World' })
      expect(callCount).toBe(3)
      expect(bodies[2].extensions).toBeUndefined()
    })

    it('uses custom hash function', async () => {
      const bodies: any[] = []
      const mockFetch: typeof $fetch = ((url: string, init: any) => {
        bodies.push(init.body)
        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: {
          hash: () => 'custom-hash',
        },
      })

      await client.query('query { hello }')

      expect(bodies[0].extensions?.persistedQuery?.sha256Hash).toBe('custom-hash')
    })

    it('computes the hash once per prepared query', async () => {
      let hashCount = 0
      let callCount = 0
      const mockFetch: typeof $fetch = ((_url: string, _init: any) => {
        callCount++
        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: {
          hash: (query) => {
            hashCount++
            return sha256(query)
          },
        },
      })

      const getHello = client.prepare('query { hello }')
      await getHello()
      await getHello()

      expect(callCount).toBe(2)
      expect(hashCount).toBe(1)
    })

    it('reuses the cached hash for the registration retry', async () => {
      let hashCount = 0
      let callCount = 0
      const mockFetch: typeof $fetch = ((_url: string, _init: any) => {
        callCount++
        if (callCount === 1) {
          return { errors: [{ message: 'PersistedQueryNotFound' }] }
        }
        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: {
          hash: (query) => {
            hashCount++
            return sha256(query)
          },
        },
      })

      const getHello = client.prepare('query { hello }')
      const res = await getHello()

      expect(callCount).toBe(2)
      expect(hashCount).toBe(1)
      expect(res).toEqual({ hello: 'hello, World' })
    })

    it('skips APQ when persistedQueries is false', async () => {
      const bodies: any[] = []
      const mockFetch: typeof $fetch = ((url: string, init: any) => {
        bodies.push(init.body)
        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: false,
      })

      await client.query('query { hello }')

      expect(bodies.length).toBe(1)
      expect(bodies[0].query).toBeTruthy()
      expect(bodies[0].extensions).toBeUndefined()
    })

    it('skips APQ when persistedQueries is not set', async () => {
      const bodies: any[] = []
      const mockFetch: typeof $fetch = ((url: string, init: any) => {
        bodies.push(init.body)
        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', { ofetch: mockFetch })

      await client.query('query { hello }')

      expect(bodies.length).toBe(1)
      expect(bodies[0].query).toBeTruthy()
      expect(bodies[0].extensions).toBeUndefined()
    })

    describe('protocol errors', () => {
      it('registers the query on PERSISTED_QUERY_NOT_FOUND via extensions code', async () => {
        let callCount = 0
        const bodies: any[] = []
        const mockFetch: typeof $fetch = ((_url: string, init: any) => {
          callCount++
          bodies.push(init.body)
          if (callCount === 1) {
            return {
              errors: [{
                message: 'Persisted query not found',
                extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' },
              }],
            }
          }
          return { data: { hello: 'hello, World' } }
        }) as any

        const client = createClient('/graphql', {
          ofetch: mockFetch,
          persistedQueries: true,
        })

        const res = await client.query('query { hello }')

        expect(callCount).toBe(2)
        expect(res).toEqual({ hello: 'hello, World' })
        expect(bodies[0].query).toBeUndefined()
        expect(bodies[1].query).toBeTruthy()
        expect(bodies[1].extensions?.persistedQuery).toBeDefined()
      })

      it('falls back to plain request on PERSISTED_QUERY_NOT_SUPPORTED and disables APQ', async () => {
        let callCount = 0
        const bodies: any[] = []
        const mockFetch: typeof $fetch = ((_url: string, init: any) => {
          callCount++
          bodies.push(init.body)
          if (callCount === 1) {
            return {
              errors: [{
                message: 'Persisted queries are not supported',
                extensions: { code: 'PERSISTED_QUERY_NOT_SUPPORTED' },
              }],
            }
          }
          return { data: { hello: 'hello, World' } }
        }) as any

        const client = createClient('/graphql', {
          ofetch: mockFetch,
          persistedQueries: true,
        })

        const res = await client.query('query { hello }')
        expect(res).toEqual({ hello: 'hello, World' })
        expect(callCount).toBe(2)
        expect(bodies[1].extensions).toBeUndefined()

        await client.query('query { hello }')
        expect(callCount).toBe(3)
        expect(bodies[2].extensions).toBeUndefined()
      })

      it('does not retry on network errors', async () => {
        let callCount = 0
        const mockFetch: typeof $fetch = (() => {
          callCount++
          throw new Error('Network error')
        }) as any

        const client = createClient('/graphql', {
          ofetch: mockFetch,
          persistedQueries: true,
        })

        await expect(
          () => client.query('query { hello }'),
        ).rejects.toThrowError('Network error')
        expect(callCount).toBe(1)
      })

      it('does not retry on other GraphQL errors', async () => {
        let callCount = 0
        const mockFetch: typeof $fetch = (() => {
          callCount++
          return { errors: [{ message: 'Some unexpected error' }] }
        }) as any

        const client = createClient('/graphql', {
          ofetch: mockFetch,
          persistedQueries: true,
        })

        await expect(
          () => client.query('query { hello }'),
        ).rejects.toThrowError('Some unexpected error')
        expect(callCount).toBe(1)
      })

      it('does not retry mutations on GraphQL errors', async () => {
        let callCount = 0
        const mockFetch: typeof $fetch = (() => {
          callCount++
          return { errors: [{ message: 'Insufficient balance' }] }
        }) as any

        const client = createClient('/graphql', {
          ofetch: mockFetch,
          persistedQueries: true,
        })

        await expect(
          () => client.mutation('mutation { submit }'),
        ).rejects.toThrowError('Insufficient balance')
        expect(callCount).toBe(1)
      })

      it('surfaces the registration retry error when it fails', async () => {
        let callCount = 0
        const mockFetch: typeof $fetch = ((_url: string, _init: any) => {
          callCount++
          if (callCount === 1) {
            return { errors: [{ message: 'PersistedQueryNotFound' }] }
          }
          return { errors: [{ message: 'Server error' }] }
        }) as any

        const client = createClient('/graphql', {
          ofetch: mockFetch,
          persistedQueries: true,
        })

        await expect(
          () => client.query('query { hello }'),
        ).rejects.toThrowError('Server error')
        expect(callCount).toBe(2)
      })
    })
  })
}
