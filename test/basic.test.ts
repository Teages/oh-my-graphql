import { gqf } from '@teages/gqf/core'
import { describe, expect, it } from 'vitest'
import { createClient } from '../src'

import { $fetch } from './schema'

describe('basic', () => {
  const client = createClient('/graphql', { ofetch: $fetch })

  it('works', async () => {
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
