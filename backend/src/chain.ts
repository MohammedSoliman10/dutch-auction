import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type Abi } from "viem";
import { sepolia } from "viem/chains";
import { getConfig } from "./config.js";

const config = getConfig();
// ESM has no __dirname; derive it so artifact lookup works under tsx and after tsc.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const client = createPublicClient({
  chain: sepolia,
  transport: http(config.rpcUrl),
});

export const chainId = sepolia.id;

export const addresses = {
  factory: config.factoryAddress,
  nft: config.nftAddress,
} as const;

function loadAbi(sourceDir: string, contract: string): Abi {
  const artifact = path.join("out", sourceDir, `${contract}.json`);
  const candidates = [path.resolve(process.cwd(), artifact), path.resolve(moduleDir, "..", "..", artifact)];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (file === undefined) {
    throw new Error(`Forge artifact for ${contract} not found (looked in ${candidates.join(" and ")}). Run \`forge build\` first.`);
  }
  return readAbi(file);
}

function readAbi(file: string): Abi {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("abi" in parsed)) {
    throw new Error(`Forge artifact ${file} has no "abi" field. Run \`forge build\` first.`);
  }
  const abi = (parsed as { abi: unknown }).abi;
  if (!Array.isArray(abi)) {
    throw new Error(`Forge artifact ${file} has a malformed "abi" field. Run \`forge build\` first.`);
  }
  return abi as Abi;
}

export const abis = {
  auctionFactory: loadAbi("AuctionFactory.sol", "AuctionFactory"),
  dutchAuction: loadAbi("DutchAuction.sol", "DutchAuction"),
  dutchAuctionNFT: loadAbi("DutchAuctionNFT.sol", "DutchAuctionNFT"),
} as const;
