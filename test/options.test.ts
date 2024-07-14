import { describe, expect, it } from 'vitest'
import { createClient } from '../src'

import { $fetch } from './schema'

describe('header', () => {
  const client = createClient('/graphql', {
    ofetch: $fetch,
    headers: {
      'X-Test': 'test',
    },
  })

  it('merge', async () => {
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
  const client = createClient('/graphql', {
    ofetch: $fetch,
    query: {
      a: 'apple',
    },
  })

  it('merge', async () => {
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
    const getQueries = client.prepare(`query { queries }`, {
      query: { a: 'apollo' },
    })

    expect(JSON.parse(((await getQueries()).queries)).a).toMatch('apollo')

    expect(JSON.parse((await getQueries({}, {
      query: { a: 'arbutus' },
    })).queries).a).toMatch('arbutus')
  })
})
