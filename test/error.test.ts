import { describe, expect, it } from 'vitest'
import { createClient } from '../src'

import { $fetch } from './schema'

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
