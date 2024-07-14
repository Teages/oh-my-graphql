import { describe, expect, it } from 'vitest'
import { gqf } from '@teages/gqf/core'
import { createClient } from '../src'

import { $fetch } from './schema'

describe('operation type check', () => {
  const client = createClient('/graphql', { ofetch: $fetch })

  it('operation type check', async () => {
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
    expect(
      () => client.mutation('fragment F on Query { hello }'),
    ).toThrowError()

    expect(
      () => client.request('query A { hello }\n query B { hello }'),
    ).toThrowError()
  })
})
