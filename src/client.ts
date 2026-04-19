import type { ClientOptions, GraphQLClient, GraphQLPrepare, GraphQLRequest } from './type'
import { GraphQLError, parse } from '@0no-co/graphql.web'

import { defu } from 'defu'
import { GraphQLErrors } from './error'
import { getDocumentType, graphqlRequest, mergeHeaders } from './request'

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

if (import.meta.vitest) {
  const { beforeAll, describe, expect, it } = import.meta.vitest
  let $fetch: typeof import('../test/schema')['$fetch']
  let gqf: typeof import('@teages/gqf/core')['gqf']

  beforeAll(async () => {
    const schema = await import('../test/schema')
    const gqfModule = await import('@teages/gqf/core')
    $fetch = schema.$fetch
    gqf = gqfModule.gqf
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
        await client.query(gqf(['hello'])),
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
      const client = createClient('http://localhost')

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

      expect(
        () => client.mutation('query { hello }'),
      ).toThrowError()

      expect(
        () => client.query('mutation { hello }'),
      ).toThrowError()

      expect(
        () => client.request('subscription { hello }'),
      ).toThrowError()

      expect(
        () => client.mutation(gqf(['hello'])),
      ).toThrowError()
    })

    it('operation count check', async () => {
      const client = createClient('/graphql', { ofetch: $fetch })

      expect(
        () => client.mutation('fragment F on Query { hello }'),
      ).toThrowError()

      expect(
        () => client.request('query A { hello }\n query B { hello }'),
      ).toThrowError()
    })
  })
}
