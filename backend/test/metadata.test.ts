// T059: bounded tokenURI fetch - http/https/ipfs scheme allowlist, ipfs:// gateway
// rewrite, 5s timeout signal, 100KB cap; any failure yields nulls and never throws.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTokenMetadata } from "../src/metadata.js";

const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const NULLS = { name: null, image: null };

function okJson(body: string): Response {
  return new Response(body, { status: 200 });
}

describe("resolveTokenMetadata - success paths", () => {
  it("parses name and image from an https JSON document", async () => {
    fetchMock.mockResolvedValue(
      okJson(JSON.stringify({ name: "Soliman #12", image: "https://img.example/12.png" })),
    );

    const meta = await resolveTokenMetadata("https://example.com/meta/12.json");

    expect(meta).toEqual({ name: "Soliman #12", image: "https://img.example/12.png" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/meta/12.json");
    // 5s timeout is wired through an AbortSignal on the request.
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rewrites ipfs:// URIs through the gateway", async () => {
    fetchMock.mockResolvedValue(okJson(JSON.stringify({ name: "A", image: "ipfs://img" })));

    await resolveTokenMetadata("ipfs://bafyhash/meta.json");
    expect(fetchMock.mock.calls[0][0]).toBe("https://ipfs.io/ipfs/bafyhash/meta.json");

    fetchMock.mockClear();
    await resolveTokenMetadata("ipfs://ipfs/bafyhash/meta.json");
    expect(fetchMock.mock.calls[0][0]).toBe("https://ipfs.io/ipfs/bafyhash/meta.json");
  });

  it("nulls individual fields that are missing or not strings", async () => {
    fetchMock.mockResolvedValue(okJson(JSON.stringify({ name: 42, description: "ignored" })));
    expect(await resolveTokenMetadata("https://example.com/m.json")).toEqual(NULLS);

    fetchMock.mockResolvedValue(okJson(JSON.stringify({ name: "", image: "https://i.example/x.png" })));
    expect(await resolveTokenMetadata("https://example.com/m.json")).toEqual({
      name: null,
      image: "https://i.example/x.png",
    });
  });
});

describe("resolveTokenMetadata - scheme allowlist (SSRF surface, R13)", () => {
  it("rejects every scheme other than http/https/ipfs without calling fetch", async () => {
    const rejected = [
      "file:///etc/passwd",
      "data:application/json,{\"name\":\"x\"}",
      "ftp://example.com/meta.json",
      "javascript:alert(1)",
      "",
      "   ",
      "meta.json",
    ];
    for (const uri of rejected) {
      expect(await resolveTokenMetadata(uri)).toEqual(NULLS);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveTokenMetadata - bounded failure handling (never throws upward)", () => {
  it("returns nulls when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await resolveTokenMetadata("https://example.com/m.json")).toEqual(NULLS);
  });

  it("returns nulls for non-2xx responses", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await resolveTokenMetadata("https://example.com/m.json")).toEqual(NULLS);
  });

  it("returns nulls for invalid or non-object JSON", async () => {
    fetchMock.mockResolvedValue(okJson("not json {"));
    expect(await resolveTokenMetadata("https://example.com/m.json")).toEqual(NULLS);

    fetchMock.mockResolvedValue(okJson("[1, 2, 3]"));
    expect(await resolveTokenMetadata("https://example.com/m.json")).toEqual(NULLS);
  });

  it("stops reading past the 100KB cap", async () => {
    const oversized = JSON.stringify({ name: "x".repeat(100 * 1024) });
    expect(oversized.length).toBeGreaterThan(100 * 1024);
    fetchMock.mockResolvedValue(okJson(oversized));

    expect(await resolveTokenMetadata("https://example.com/huge.json")).toEqual(NULLS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
