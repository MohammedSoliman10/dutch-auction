#!/usr/bin/env node
// Keeps runtime address config in sync with deployments/<network>.json after a
// contract deploy: writes frontend/.env.local and updates the root .env.
// Constitution: addresses live only in manifests + env — never hardcoded.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const network = process.argv[2] ?? "sepolia";
const manifestPath = path.join(root, "deployments", `${network}.json`);

if (!existsSync(manifestPath)) {
  console.error(`manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (typeof manifest.factory !== "string" || typeof manifest.nft !== "string") {
  console.error(`manifest missing factory/nft addresses: ${manifestPath}`);
  process.exit(1);
}

/** Upsert `key=value` lines into a dotenv-style file (created when missing). */
function upsert(filePath, values) {
  const lines = existsSync(filePath) ? readFileSync(filePath, "utf8").split("\n") : [];
  for (const [key, value] of Object.entries(values)) {
    const idx = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  const content = lines.join("\n").replace(/\n*$/, "\n");
  writeFileSync(filePath, content);
  console.log(`updated ${path.relative(root, filePath)}`);
}

upsert(path.join(root, "frontend", ".env.local"), {
  VITE_FACTORY_ADDRESS: manifest.factory,
  VITE_NFT_ADDRESS: manifest.nft,
});
if (existsSync(path.join(root, ".env"))) {
  upsert(path.join(root, ".env"), {
    FACTORY_ADDRESS: manifest.factory,
    NFT_ADDRESS: manifest.nft,
  });
}

console.log(`network: ${network} (chainId ${manifest.chainId})`);
console.log(`VITE_FACTORY_ADDRESS=${manifest.factory}`);
console.log(`VITE_NFT_ADDRESS=${manifest.nft}`);
console.log("Copy the VITE_* lines into the Vercel dashboard when redeploying.");
