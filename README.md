# @teages/oh-my-graphql

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]

<!-- [![bundle][bundle-src]][bundle-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

Another simple GraphQL client, base on [😱ofetch](https://github.com/unjs/ofetch).

## Quick Start

Install package:

```sh
# ✨ Auto-detect
npx nypm install @teages/oh-my-graphql

# npm
npm install @teages/oh-my-graphql

# yarn
yarn add @teages/oh-my-graphql

# pnpm
pnpm install @teages/oh-my-graphql

# bun
bun install @teages/oh-my-graphql
```

Example:
```ts
import { createClient } from '@teages/oh-my-graphql'

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
const res = await client.mutation('query { hello }') // will reject with an error
```

> [!NOTE]
> Subscription documents are rejected: the client does not support subscriptions. Top-level response `extensions` are currently not surfaced either.

### Headers

Headers from `createClient`, `prepare` and per-request overrides are merged together, later levels winning. Merged keys are normalized to lowercase.

`POST` requests carry a default `Content-Type: application/json`; an explicit `Content-Type` from any level always wins. `GET` requests carry no `Content-Type`.

### Prepare

Create a request function to reuse the query. The document is parsed once when `prepare` is called, and the printed query (and its APQ hash) is reused across invocations.

```ts
function prepare<
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

All errors are delivered as promise rejections, so `await` / `.catch()` always works. The client rejects with:

- `GraphQLErrors` for GraphQL-level errors: a response body carrying `errors` (whether the HTTP status is 2xx or not), malformed response bodies, and invalid documents (syntax errors, wrong operation types).
- ofetch's `FetchError` for transport-level failures: network errors and non-2xx responses without a GraphQL errors body.

Each `GraphQLErrors` exposes the normalized `errors` array, the partial `data` returned alongside the errors when the server sent both, and the underlying failure as `cause` when one exists (the original parse error, a hash failure, or the converted `FetchError`).

You may need the `GraphQLClientError` type (`FetchError | GraphQLErrors`).

Example:
```ts
import { GraphQLErrors } from '@teages/oh-my-graphql'
import { FetchError } from 'ofetch'

try {
  await client.request('query { hello }')
}
catch (error) {
  if (error instanceof FetchError) {
    console.log(error.response) // network error or other fetch error
  }
  else if (error instanceof GraphQLErrors) {
    console.log(error.errors) // graphql errors
  }
}
```

### Automatic Persisted Queries (APQ)

Enable APQ with `persistedQueries`:

```ts
const client = createClient('https://example.com/graphql', {
  persistedQueries: true,
})
```

Behavior:

- Requests are sent with the query hash only (`extensions.persistedQuery`).
- If the server answers `PersistedQueryNotFound`, the client sends the full query once to register it, following the APQ protocol.
- If the server answers `PersistedQueryNotSupported`, the client disables APQ for the lifetime of the client instance and falls back to plain requests.
- Both sentinels are recognized by message or by Apollo's `extensions.code` (`PERSISTED_QUERY_NOT_FOUND` / `PERSISTED_QUERY_NOT_SUPPORTED`).

The client never re-sends a request on any other error (network failures, GraphQL errors), so a mutation can never execute twice because of the client.

Do not set ofetch's `retry` on the client, though: it passes through as-is and would apply to mutations as well (an explicit `retry` overrides ofetch's method-aware default). Enable retries per request on queries instead:

```ts
const client = createClient('https://example.com/graphql', {
  persistedQueries: true,
})

// retried on transient failures (e.g. 502/503); mutations are unaffected
const res = await client.query('query { hello }', {}, { retry: 2 })
```

> [!NOTE]
> ofetch retries `GET` requests once by default and never retries `POST` unless `retry` is set explicitly. Retries happen on network errors and on the statuses listed in `retryStatusCodes` (408, 409, 425, 429, 500, 502, 503 and 504 by default).

A custom hash function is useful for servers that don't expect SHA-256:

```ts
const client = createClient('https://example.com/graphql', {
  persistedQueries: {
    hash: async query => await myHash(query),
  },
})
```

> [!NOTE]
> The built-in hash uses WebCrypto (`crypto.subtle`), which requires a secure context (HTTPS or `localhost`). In non-secure contexts, provide a custom `hash` function.

## Type Reference

### `ClientOptions`

Extends ofetch's `FetchOptions` (except `body`, `method` and `responseType`, which are managed by the client).

```ts
export type ClientOptions = Omit<
  FetchOptions, // from 'ofetch'
  'body' | 'method' | 'responseType'
> & {
  /**
   * Default method to use for queries.
   * Only effective when the operation type is `'query'`.
   * @default 'POST'
   */
  preferMethod?: 'POST' | 'GET'

  /**
   * Custom ofetch instance.
   *
   * It's useful if you want to use a exist ofetch instance (like in-server $fetch in nitro/nuxt) to make an internal request.
   */
  ofetch?: $Fetch

  /**
   * Enable Automatic Persisted Queries.
   * - `true`: enable with the built-in SHA-256 hash
   * - `PersistedQueryConfig`: enable with a custom `hash` function
   */
  persistedQueries?: boolean | PersistedQueryConfig
}
```

> [!WARNING]
> With `preferMethod: 'GET'`, the query and variables are serialized into the URL query string, where they may be visible to servers, proxies and access logs.

### `PersistedQueryConfig`

```ts
export interface PersistedQueryConfig {
  hash?: (query: string) => string | Promise<string>
}
```

### `sha256`

The built-in hash function is also exported if you need it elsewhere:

```ts
import { sha256 } from '@teages/oh-my-graphql'

const hash = await sha256('some text')
```

### `GraphQLClientError`

```ts
export type GraphQLClientError = FetchError | GraphQLErrors

export class GraphQLErrors extends Error {
  name: 'GraphQLErrors'
  errors: GraphQLError[]
  data?: unknown // partial data returned alongside the errors, if any
  cause?: unknown // the underlying error, when one exists
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

[npm-version-src]: https://img.shields.io/npm/v/@teages/oh-my-graphql?style=flat&color=blue
[npm-version-href]: https://npmjs.com/package/@teages/oh-my-graphql
[npm-downloads-src]: https://img.shields.io/npm/dm/@teages/oh-my-graphql?style=flat&color=blue
[npm-downloads-href]: https://npmjs.com/package/@teages/oh-my-graphql

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/Teages/oh-my-graphql/main?style=flat&color=blue
[codecov-href]: https://codecov.io/gh/Teages/oh-my-graphql

[bundle-src]: https://img.shields.io/bundlephobia/minzip/@teages/oh-my-graphql?style=flat&color=blue
[bundle-href]: https://bundlephobia.com/result?p=@teages/oh-my-graphql -->
