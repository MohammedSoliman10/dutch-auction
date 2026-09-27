// Safe handling of NFT metadata URIs (FR-019 clause 2, R13): only http/https/
// ipfs schemes are ever fetched or linked, IPFS is rewritten to a public
// gateway, and fetches are bounded in time and size.

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 100_000;

/**
 * Rewrites ipfs:// URIs through the public gateway, passes http(s) through,
 * and rejects every other scheme (data:, javascript:, blob:, ...).
 * Returns null when the URI is not safe to use.
 */
export function resolveMediaUrl(uri: string | undefined | null): string | null {
  if (!uri) return null;
  const trimmed = uri.trim();
  if (trimmed.startsWith("ipfs://")) {
    const path = trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
    return path.length > 0 ? `${IPFS_GATEWAY}${path}` : null;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

export interface BoundedFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetches JSON with a hard timeout and size cap. Resolves the URI through
 * resolveMediaUrl first, so only http(s)/ipfs sources are contacted.
 * Rejects on any network, size, timeout, or parse failure - callers fall
 * back to a placeholder instead of surfacing raw errors.
 */
export async function fetchJsonBounded(
  uri: string,
  options: BoundedFetchOptions = {},
): Promise<unknown> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = options;
  const url = resolveMediaUrl(uri);
  if (!url) {
    throw new Error("Unsupported metadata URI scheme");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`Metadata request failed with status ${response.status}`);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw new Error("Metadata document exceeds the size limit");
    }
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
  }
}
