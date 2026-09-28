import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveMediaUrl } from "./ipfs";

describe("resolveMediaUrl gateway handling (FR-019, R13)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rewrites ipfs:// URIs through VITE_IPFS_GATEWAY when configured", () => {
    vi.stubEnv("VITE_IPFS_GATEWAY", "https://dapp-gw.mypinata.cloud/ipfs");
    expect(resolveMediaUrl("ipfs://bafyabc")).toBe(
      "https://dapp-gw.mypinata.cloud/ipfs/bafyabc",
    );
  });

  it("normalizes a bare origin to an /ipfs/ path prefix", () => {
    vi.stubEnv("VITE_IPFS_GATEWAY", "https://gw.example");
    expect(resolveMediaUrl("ipfs://bafyabc")).toBe("https://gw.example/ipfs/bafyabc");
  });

  it("falls back to the public gateway when the env var is absent", () => {
    vi.stubEnv("VITE_IPFS_GATEWAY", "");
    expect(resolveMediaUrl("ipfs://bafyabc")).toBe("https://ipfs.io/ipfs/bafyabc");
    expect(resolveMediaUrl("ipfs://ipfs/bafyabc")).toBe("https://ipfs.io/ipfs/bafyabc");
  });

  it("keeps the safety rules: http(s) passes through, other schemes rejected", () => {
    expect(resolveMediaUrl("https://x.example/a.png")).toBe("https://x.example/a.png");
    expect(resolveMediaUrl("http://x.example/a.png")).toBe("http://x.example/a.png");
    expect(resolveMediaUrl("javascript:alert(1)")).toBeNull();
    expect(resolveMediaUrl("data:text/html,x")).toBeNull();
    expect(resolveMediaUrl("ipfs://")).toBeNull();
    expect(resolveMediaUrl("")).toBeNull();
    expect(resolveMediaUrl(null)).toBeNull();
    expect(resolveMediaUrl(undefined)).toBeNull();
  });
});
