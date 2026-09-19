/**
 * Fresh ids for features and documents.
 *
 * `crypto.randomUUID` exists only in a secure context, so a page served
 * over plain http - a dev server reached by IP from another machine, say -
 * does not have it. The fallback builds the same version 4 shape from
 * `crypto.getRandomValues`, which carries no such restriction.
 */
export function newId(): string {
  // Typed as always present, but absent outside a secure context.
  const webCrypto = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 1
  let hex = '';
  bytes.forEach((b) => {
    hex += b.toString(16).padStart(2, '0');
  });
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
