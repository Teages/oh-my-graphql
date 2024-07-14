# @teages/ographql

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]

<!-- [![bundle][bundle-src]][bundle-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

Another simple GraphQL client, base on [😱ofetch](https://github.com/unjs/ofetch).

## Quick Start

Install package:

```sh
# ✨ Auto-detect
npx nypm install @teages/ographql

# npm
npm install @teages/ographql

# yarn
yarn add @teages/ographql

# pnpm
pnpm install @teages/ographql

# bun
bun install @teages/ographql
```

Example:
```ts
import { createClient } from '@teages/ographql'

const client = createClient('https://graphql-test.teages.xyz/graphql-user')

const res = await client.query('query { hello }')
console.log(res) // { hello: 'hello, World' }
```

## Usage Reference

### Create Client

```ts
function createClient(url: string, options?: ClientOptions): GraphQLClient
```

Example:
```ts
const client = createClient('https://graphql-test.teages.xyz/graphql-user', {
  preferMethod: 'POST',
  headers: {
    Authorization: 'Bearer token'
  }
})
```

### Request

```ts
function request<
  Result = Record<string, any>,
  Variables = Record<string, any>
>(
  query: DocumentInput<Result, Variables>,
  variables?: Variables,
  optionsOverride?: ClientOptions
): Promise<Result>
```

Example:
```ts
const res = await client.request('query { hello }')
console.log(res) // { hello: 'hello, World' }
```

You can use `client.query` or `client.mutation` to limit the type of your query.

Example:
```ts
const res = await client.mutation('query { hello }') // will throw error
```

### Prepare

Create a request function to reuse the query.

```ts
function request<
  Result = Record<string, any>,
  Variables = Record<string, any>
>(
  query: DocumentInput<Result, Variables>,
  optionsOverride?: ClientOptions
): GraphQLPreparedRequest<Result, Variables>

interface GraphQLPreparedRequest<Result, Variables> {
  (
    variables?: Variables,
    optionsOverride?: ClientOptions
  ): Promise<Result>
}
```

Example:
```ts
const fetchHello = client.prepare('query { hello }')
const res = await fetchHello()
console.log(res) // { hello: 'hello, World' }
```

### Error Handling

The client throws errors when the request failed or server response with errors.

You may need `GraphQLClientError` type.

Example:
```ts
import { GraphQLClientError } from '@teages/ographql'
import { FetchError } from 'ofetch'

try {
  await client.request('query { hello }')
}
catch (error: GraphQLClientError) {
  if (error instanceof FetchError) {
    console.log(error.response) // network error or other fetch error
  }
  console.log(error.errors) // graphql errors
}
```

## Type Reference

### `ClientOptions`

```ts
export type ClientOptions = Omit<
  FetchOptions, // from 'ofetch'
  'body' | 'method' | 'ResponseType'
> & {
  /**
   * Default method to use for query.
   * Only effective when `type` is `'query'`.
   * @default 'POST'
   */
  preferMethod: 'POST' | 'GET'
}
```

### `GraphQLClientError`

```ts
export type GraphQLClientError = FetchError | GraphQLErrors

export class GraphQLErrors extends Error {
  errors: GraphQLError[]
  // ...
}
```

## Development

- Clone this repository
- Install latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

## License

Published under [MIT License](./LICENSE).

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@teages/ographql?style=flat&color=blue
[npm-version-href]: https://npmjs.com/package/@teages/ographql
[npm-downloads-src]: https://img.shields.io/npm/dm/@teages/ographql?style=flat&color=blue
[npm-downloads-href]: https://npmjs.com/package/@teages/ographql

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/Teages/oh-my-graphql/main?style=flat&color=blue
[codecov-href]: https://codecov.io/gh/Teages/oh-my-graphql

[bundle-src]: https://img.shields.io/bundlephobia/minzip/@teages/ographql?style=flat&color=blue
[bundle-href]: https://bundlephobia.com/result?p=@teages/ographql -->
