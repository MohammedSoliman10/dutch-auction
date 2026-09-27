// T059: bounded, best-effort token metadata fetch (R13). Scheme allowlist only
// (http/https/ipfs), 5 s timeout, 100 KB cap. ANY failure returns nulls - the
// indexer must never wedge on metadata.

export interface TokenMetadata {
  name: string | null;
  image: string | null;
}

const MAX_BYTES = 100 * 1024;
const TIMEOUT_MS = 5_000;
const IPFS_GATEWAY_PREFIX = "https://ipfs.io/ipfs/";
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function noMetadata(): TokenMetadata {
  return { name: null, image: null };
}

export async function resolveTokenMetadata(tokenUri: string): Promise<TokenMetadata> {
  try {
    const url = toHttpUrl(tokenUri);
    if (url === null) {
      return noMetadata();
    }
    const body = await fetchBounded(url);
    if (body === null) {
      return noMetadata();
    }
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return noMetadata();
    }
    const record = parsed as Record<string, unknown>;
    return {
      name: optionalText(record.name),
      image: optionalText(record.image),
    };
  } catch {
    return noMetadata();
  }
}

function toHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith("ipfs://")) {
    const pathPart = trimmed.slice("ipfs://".length);
    const withoutPrefix = pathPart.toLowerCase().startsWith("ipfs/")
      ? pathPart.slice("ipfs/".length)
      : pathPart;
    return withoutPrefix === "" ? null : IPFS_GATEWAY_PREFIX + withoutPrefix;
  }
  try {
    const url = new URL(trimmed);
    return HTTP_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchBounded(url: string): Promise<string | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok || response.body === null) {
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || value === undefined) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
