// Fail-fast environment parsing. FACTORY_ADDRESS / NFT_ADDRESS mirror the
// `factory` / `nft` keys of deployments/sepolia.json (public values, not secrets).
// No secret values live in the repository: only RPC_URL may embed a provider API
// key, so it is read from the environment exclusively (see .env.example).

export type Config = {
  rpcUrl: string;
  factoryAddress: `0x${string}`;
  nftAddress: `0x${string}`;
  port: number;
  dbPath: string;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DEFAULT_PORT = 3001;
const DEFAULT_DB_PATH = "./data/index.db";

export function createConfig(overrides: Partial<Config> = {}): Config {
  const problems: string[] = [];

  const rpcUrl = overrides.rpcUrl ?? envValue("RPC_URL");
  if (!rpcUrl) {
    problems.push("RPC_URL: missing (Sepolia JSON-RPC endpoint, e.g. https://sepolia.infura.io/v3/<key>)");
  } else if (!isHttpUrl(rpcUrl)) {
    problems.push("RPC_URL: invalid (expected an http(s) URL)");
  }

  const factoryAddress = parseAddress("FACTORY_ADDRESS", overrides.factoryAddress ?? envValue("FACTORY_ADDRESS"), problems);
  const nftAddress = parseAddress("NFT_ADDRESS", overrides.nftAddress ?? envValue("NFT_ADDRESS"), problems);

  let port = DEFAULT_PORT;
  const portRaw = overrides.port !== undefined ? String(overrides.port) : envValue("PORT");
  if (portRaw !== undefined && portRaw !== "") {
    const parsed = Number(portRaw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      port = parsed;
    } else {
      problems.push(`PORT: invalid ("${portRaw}" must be an integer between 1 and 65535)`);
    }
  }

  // DB_PATH is canonical (tasks T026); DATABASE_PATH is accepted because the
  // root .env.example uses that name for the same setting.
  const dbPath =
    overrides.dbPath ?? envValue("DB_PATH") ?? envValue("DATABASE_PATH") ?? DEFAULT_DB_PATH;

  if (problems.length > 0 || rpcUrl === undefined || factoryAddress === null || nftAddress === null) {
    throw configurationError(problems);
  }

  return { rpcUrl, factoryAddress, nftAddress, port, dbPath };
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= createConfig();
  return cached;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" || value === undefined ? undefined : value;
}

function parseAddress(label: string, raw: string | undefined, problems: string[]): `0x${string}` | null {
  if (!raw) {
    problems.push(`${label}: missing (expected 0x followed by 40 hex characters)`);
    return null;
  }
  if (!ADDRESS_PATTERN.test(raw)) {
    problems.push(`${label}: invalid (expected 0x followed by 40 hex characters)`);
    return null;
  }
  return raw.toLowerCase() as `0x${string}`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function configurationError(problems: string[]): Error {
  const heading = `Invalid backend configuration (${problems.length} problem${problems.length === 1 ? "" : "s"}):`;
  return new Error(
    [heading, ...problems.map((problem) => `  - ${problem}`),
      "Set these via the environment (see .env.example); no secret values belong in the repository.",
    ].join("\n"),
  );
}
