import { useEffect, useState } from "react";

import { fetchJsonBounded, resolveMediaUrl } from "../lib/ipfs";

export interface NftMetadata {
  name?: string;
  image?: string;
  description?: string;
  externalUrl?: string;
}

export type MetadataStatus = "idle" | "loading" | "ready" | "failed";

export interface MetadataResult {
  status: MetadataStatus;
  metadata: NftMetadata | null;
}

interface MetadataDocument {
  name?: unknown;
  image?: unknown;
  description?: unknown;
  external_url?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Loads NFT metadata for a token URI with a bounded fetch. Failures resolve
 * to status "failed" (placeholder fallback in the UI) - never raw errors.
 * Stale responses for a previous URI are discarded.
 */
export function useMetadata(tokenUri: string | undefined): MetadataResult {
  const [result, setResult] = useState<MetadataResult>({
    status: "idle",
    metadata: null,
  });

  useEffect(() => {
    if (!tokenUri) {
      setResult({ status: "idle", metadata: null });
      return;
    }

    let cancelled = false;
    setResult({ status: "loading", metadata: null });

    fetchJsonBounded(tokenUri)
      .then((data) => {
        if (cancelled) return;
        const doc: MetadataDocument =
          typeof data === "object" && data !== null ? (data as MetadataDocument) : {};
        const rawImage = asString(doc.image);
        const image = rawImage ? resolveMediaUrl(rawImage) ?? undefined : undefined;
        setResult({
          status: "ready",
          metadata: {
            name: asString(doc.name),
            image,
            description: asString(doc.description),
            externalUrl: asString(doc.external_url),
          },
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ status: "failed", metadata: null });
      });

    return () => {
      cancelled = true;
    };
  }, [tokenUri]);

  return result;
}
