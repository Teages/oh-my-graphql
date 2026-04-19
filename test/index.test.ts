import { describe, expect, it } from 'vitest'
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
