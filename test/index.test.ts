import type { $Fetch } from 'ofetch'
import { ofetch } from 'ofetch'
import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client'
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

describe('integration: APQ against real server', () => {
  const APQ_URL = 'https://graphql-test.teages.xyz/graphql-user-apq'

  it('sends registration request after PersistedQueryNotFound, then hash-only succeeds', async () => {
    const query = `query GetHello { hello } \n# ${crypto.randomUUID()}`
    const requestBodies: any[] = []
    const wrappedFetch: $Fetch = ((url: string, init: any) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
      requestBodies.push(body)
      return ofetch(url, init)
    }) as any

    const client = createClient(APQ_URL, {
      ofetch: wrappedFetch,
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
  })
})
