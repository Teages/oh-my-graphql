export async function sha256(text: string): Promise<string> {
  if (typeof crypto?.subtle?.digest !== 'function') {
    throw new TypeError(
      'WebCrypto is unavailable: SHA-256 hashing requires a secure context (HTTPS or localhost), '
      + 'or provide a custom `hash` function via the `persistedQueries` option.',
    )
  }
  const data = new TextEncoder().encode(text)
  const buffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
