// Runtime deployment addresses for the Sepolia environment.
//
// Populated from the VITE_FACTORY_ADDRESS / VITE_NFT_ADDRESS env vars (kept in
// sync with deployments/sepolia.json by scripts/sync-deployments.mjs). NEVER
// hardcode addresses in source (Constitution: no secrets / no committed config).
export const deployments = {
  factory: (import.meta.env.VITE_FACTORY_ADDRESS as `0x${string}` | undefined) ?? undefined,
  nft: (import.meta.env.VITE_NFT_ADDRESS as `0x${string}` | undefined) ?? undefined,
} as const;
