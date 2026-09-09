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
    throw new GraphQLErrors(
      [e instanceof GraphQLError ? e : new GraphQLError(e instanceof Error ? e.message : 'Failed to parse GraphQL document')],
      { cause: e },
    )
  }
}

function hasPersistedQueryError(error: GraphQLErrors, message: string, code: string): boolean {
  return error.errors.some(
    err => err.message === message || err.extensions?.code === code,
  )
}

type HashFn = (query: string) => string | Promise<string>

interface QueryCache {
  printed?: string
  hashes?: Map<HashFn | undefined, Promise<string>>
}

async function computeHash(
  printedQuery: string,
  hashFn?: (query: string) => string | Promise<string>,
): Promise<string> {
  let hash: unknown
  try {
    hash = await (hashFn?.(printedQuery) ?? sha256(printedQuery))
  }
  catch (e) {
    throw new GraphQLErrors(
      [new GraphQLError(`Failed to compute the query hash: ${e instanceof Error ? e.message : String(e)}`)],
      { cause: e },
    )
  }
  if (typeof hash !== 'string') {
    throw new GraphQLErrors([
      new GraphQLError('Custom `hash` function must return a string'),
    ])
  }
  return hash
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
        // Key by the hash function identity so a runtime override with a
        // different function cannot reuse a stale hash, and drop entries
        // that reject so a single failure does not poison the prepared query.
        cache.hashes ??= new Map()
        let cached = cache.hashes.get(hashFn)
        if (cached == null) {
          cached = computeHash(printedQuery, hashFn)
          cached.catch(() => cache.hashes?.delete(hashFn))
          cache.hashes.set(hashFn, cached)
        }
        hashPromise = cached
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
  const { beforeAll, describe, expect, it, vi } = import.meta.vitest
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
        await client.query('query { hello }', {}, { preferQueryMethod: 'GET' }),
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

  describe('fetch init', () => {
    it('does not leak client-only options into the fetch init', async () => {
      let captured: any
      const mockFetch: typeof $fetch = ((_url: string, init: any) => {
        captured = init
        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: false,
        preferQueryMethod: 'POST',
      })

      await client.query('query { hello }')

      expect(captured.preferQueryMethod).toBeUndefined()
      expect(captured.persistedQueries).toBeUndefined()
      expect(captured.ofetch).toBeUndefined()
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

  describe('response contract', () => {
    it('converts a non-2xx GraphQL error body into GraphQLErrors', async () => {
      const { createFetch } = await import('ofetch')
      const serverErrorFetch = createFetch({
        fetch: async () => new Response(
          JSON.stringify({ errors: [{ message: 'Internal GraphQL failure' }] }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      })
      const client = createClient('/graphql', { ofetch: serverErrorFetch })

      const error = await client.query('query { hello }').catch(e => e)

      expect(error).toBeInstanceOf(GraphQLErrors)
      expect(error.message).toContain('Internal GraphQL failure')
    })

    it('keeps FetchError for non-2xx responses without a GraphQL errors body', async () => {
      const { createFetch } = await import('ofetch')
      const serverErrorFetch = createFetch({
        fetch: async () => new Response('gateway timeout', { status: 504 }),
      })
      const client = createClient('/graphql', { ofetch: serverErrorFetch })

      const error = await client.query('query { hello }').catch(e => e)

      expect(error.name).toBe('FetchError')
      expect(error).not.toBeInstanceOf(GraphQLErrors)
    })

    it('rejects with GraphQLErrors when the response body is null', async () => {
      const mockFetch: typeof $fetch = (() => null) as any
      const client = createClient('/graphql', { ofetch: mockFetch })

      const error = await client.query('query { hello }').catch(e => e)

      expect(error).toBeInstanceOf(GraphQLErrors)
      expect(error.message).toContain('Malformed GraphQL response')
    })

    it('rejects with GraphQLErrors when the body has neither data nor errors', async () => {
      const mockFetch: typeof $fetch = (() => ({})) as any
      const client = createClient('/graphql', { ofetch: mockFetch })

      const error = await client.query('query { hello }').catch(e => e)

      expect(error).toBeInstanceOf(GraphQLErrors)
      expect(error.message).toContain('Malformed GraphQL response')
    })

    it('carries partial data when errors and data coexist', async () => {
      const mockFetch: typeof $fetch = (() => ({
        data: { hello: 'hello, World' },
        errors: [{ message: 'field was deprecated with attitude' }],
      })) as any
      const client = createClient('/graphql', { ofetch: mockFetch })

      const error = await client.query('query { hello }').catch(e => e)

      expect(error).toBeInstanceOf(GraphQLErrors)
      expect(error.data).toEqual({ hello: 'hello, World' })
    })

    it('carries data from a non-2xx GraphQL error body', async () => {
      const { createFetch } = await import('ofetch')
      const serverErrorFetch = createFetch({
        fetch: async () => new Response(
          JSON.stringify({ data: null, errors: [{ message: 'Internal GraphQL failure' }] }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      })
      const client = createClient('/graphql', { ofetch: serverErrorFetch })

      const error = await client.query('query { hello }').catch(e => e)

      expect(error).toBeInstanceOf(GraphQLErrors)
      expect(error.data).toBeNull()
    })
  })

  describe('error fidelity', () => {
    it('preserves locations from server JSON errors', async () => {
      const mockFetch: typeof $fetch = (() => ({
        errors: [{
          message: 'boom',
          locations: [{ line: 3, column: 5 }],
          path: ['hello'],
        }],
      })) as any
      const client = createClient('/graphql', { ofetch: mockFetch })

      const error = await client.query('query { hello }').catch(e => e)

      expect(error).toBeInstanceOf(GraphQLErrors)
      expect(error.errors[0].locations).toEqual([{ line: 3, column: 5 }])
      expect(error.errors[0].path).toEqual(['hello'])
    })

    it('preserves the parser error as cause for syntax errors', async () => {
      // @0no-co/graphql-web's parser only embeds the offset in the message
      // text (`Syntax Error: Unexpected token at N`) — it never attaches a
      // source, so `locations` cannot be derived for syntax errors.
      const client = createClient('/graphql', { ofetch: $fetch })

      const error = await client.query('query {').catch(e => e)

      expect(error).toBeInstanceOf(GraphQLErrors)
      expect(error.cause).toBeInstanceOf(GraphQLError)
      expect(error.message).toContain('Syntax Error')
    })

    it('sets name and cause', async () => {
      const client = createClient('/graphql', { ofetch: $fetch })

      const error = await client.query('query {').catch(e => e)

      expect(error.name).toBe('GraphQLErrors')
      expect(error.cause).toBeDefined()
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

    it('does not duplicate an explicit Content-Type on POST', async () => {
      const client = createClient('/graphql', {
        ofetch: $fetch,
        headers: {
          'content-type': 'application/json',
        },
      })

      const res = await client.query('query { headers }')
      const headers = (res.headers.split('\n') as string[])
        .map(line => line.trim().toLowerCase())

      expect(headers.filter(line => line.startsWith('content-type:')))
        .toEqual(['content-type:application/json'])
    })

    it('does not send Content-Type on GET requests', async () => {
      const client = createClient('/graphql', { ofetch: $fetch })

      const res = await client.query('query { headers }', {}, { preferQueryMethod: 'GET' })
      const headers = (res.headers.split('\n') as string[])
        .map(line => line.trim().toLowerCase())

      expect(headers.some(line => line.startsWith('content-type:'))).toBe(false)
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
        preferQueryMethod: 'GET',
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

    it('recomputes the hash when a runtime override uses a different hash function', async () => {
      const bodies: any[] = []
      const mockFetch: typeof $fetch = ((_url: string, _init: any) => {
        bodies.push(_init.body)
        return { data: { hello: 'hello, World' } }
      }) as any

      let calls = 0
      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: {
          hash: () => `default-${++calls}`,
        },
      })

      const getHello = client.prepare('query { hello }')
      await getHello()
      await getHello({}, { persistedQueries: { hash: () => 'runtime-hash' } })

      expect(bodies[0].extensions.persistedQuery.sha256Hash).toBe('default-1')
      expect(bodies[1].extensions.persistedQuery.sha256Hash).toBe('runtime-hash')
    })

    it('retries hash computation after a failure', async () => {
      let attempts = 0
      const mockFetch: typeof $fetch = (() => ({ data: { hello: 'hello, World' } })) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: {
          hash: (query) => {
            attempts++
            if (attempts === 1) {
              throw new Error('hsm hiccup')
            }
            return sha256(query)
          },
        },
      })

      const getHello = client.prepare('query { hello }')

      await expect(getHello()).rejects.toThrowError('hsm hiccup')

      const res = await getHello()

      expect(res).toEqual({ hello: 'hello, World' })
      expect(attempts).toBe(2)
    })

    it('rejects before sending when the custom hash returns a non-string', async () => {
      let callCount = 0
      const mockFetch: typeof $fetch = ((_url: string, _init: any) => {
        callCount++
        return { data: { hello: 'hello, World' } }
      }) as any

      const client = createClient('/graphql', {
        ofetch: mockFetch,
        persistedQueries: {
          hash: (() => 42) as any,
        },
      })

      await expect(
        client.query('query { hello }'),
      ).rejects.toBeInstanceOf(GraphQLErrors)
      await expect(
        client.query('query { hello }'),
      ).rejects.toThrowError('must return a string')
      expect(callCount).toBe(0)
    })

    it('reports a clear error when WebCrypto is unavailable', async () => {
      // simulate a non-secure context without WebCrypto
      vi.stubGlobal('crypto', {})

      try {
        const client = createClient('/graphql', { persistedQueries: true })

        await expect(
          client.query('query { hello }'),
        ).rejects.toBeInstanceOf(GraphQLErrors)
        await expect(
          client.query('query { hello }'),
        ).rejects.toThrowError('WebCrypto is unavailable')
      }
      finally {
        vi.unstubAllGlobals()
      }
    })

    it('wraps errors thrown by the custom hash function in GraphQLErrors', async () => {
      const client = createClient('/graphql', {
        ofetch: $fetch,
        persistedQueries: {
          hash: () => {
            throw new Error('hsm offline')
          },
        },
      })

      const error = await client.query('query { hello }').catch(e => e)

      expect(error).toBeInstanceOf(GraphQLErrors)
      expect(error.message).toContain('hsm offline')
      expect(error.cause).toBeInstanceOf(Error)
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
