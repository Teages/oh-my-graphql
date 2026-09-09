import type { $Fetch } from 'ofetch'
import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client'
import { apqFetch, resetApqRegistry, setApqNotFoundStyle } from './apq-schema'
import { $fetch } from './schema'

describe('server', () => {
  it('works', async () => {
    expect(
      await $fetch('/graphql', {
        method: 'POST',
        body: JSON.stringify({
          query: 'query { hello }',
        }),
      }),
    ).toEqual(
      { data: { hello: 'hello, World' } },
    )
  })
})

describe('integration: APQ against the local APQ server', () => {
  const APQ_URL = '/graphql-user-apq'

  function wrapWithRecorder(requestBodies: any[]): $Fetch {
    return ((url: string, init: any) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
      requestBodies.push(body)
      return apqFetch(url, init)
    }) as any
  }

  it('sends registration request after PersistedQueryNotFound, then hash-only succeeds', async () => {
    resetApqRegistry()
    // the unique operation name makes the hash unique per run — comments would
    // be stripped by print() and produce a hash already registered on the server
    const query = `query GetHello_${crypto.randomUUID().replaceAll('-', '_')} { hello }`
    const requestBodies: any[] = []

    const client = createClient(APQ_URL, {
      ofetch: wrapWithRecorder(requestBodies),
      persistedQueries: true,
    })

    const res1 = await client.query(query)
    expect(res1).toEqual({ hello: 'hello, World' })
    const firstCallBodies = requestBodies.splice(0)

    expect(firstCallBodies.length).toBe(2)

    expect(firstCallBodies[0].query).toBeUndefined()
    expect(firstCallBodies[0].extensions?.persistedQuery?.version).toBe(1)
    expect(firstCallBodies[0].extensions.persistedQuery.sha256Hash).toHaveLength(64)

    expect(firstCallBodies[1].query).toBeTruthy()
    expect(firstCallBodies[1].extensions?.persistedQuery?.version).toBe(1)
    expect(firstCallBodies[1].extensions.persistedQuery.sha256Hash).toBe(
      firstCallBodies[0].extensions.persistedQuery.sha256Hash,
    )

    const res2 = await client.query(query)
    expect(res2).toEqual({ hello: 'hello, World' })
    const secondCallBodies = requestBodies.splice(0)

    expect(secondCallBodies.length).toBe(1)
    expect(secondCallBodies[0].extensions?.persistedQuery).toBeDefined()
    expect(secondCallBodies[0].query).toBeUndefined()
  })

  it('registers via extensions.code when the server reports PERSISTED_QUERY_NOT_FOUND that way', async () => {
    resetApqRegistry()
    setApqNotFoundStyle('code')
    const query = `query GetHello_${crypto.randomUUID().replaceAll('-', '_')} { hello }`
    const requestBodies: any[] = []

    const client = createClient(APQ_URL, {
      ofetch: wrapWithRecorder(requestBodies),
      persistedQueries: true,
    })

    const res = await client.query(query)

    expect(res).toEqual({ hello: 'hello, World' })
    expect(requestBodies.length).toBe(2)
    expect(requestBodies[0].query).toBeUndefined()
    expect(requestBodies[1].query).toBeTruthy()
  })
})
