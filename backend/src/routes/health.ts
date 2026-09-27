import type { FastifyInstance } from "fastify";
import { addresses, chainId, client } from "../chain.js";
import type { Db } from "../db.js";

// contracts/api.md: status is "ok" while lag <= 60 blocks, otherwise "syncing".
const MAX_HEALTH_LAG_BLOCKS = 60;

interface HealthResponse {
  status: "ok" | "syncing";
  chainId: number;
  factoryAddress: `0x${string}`;
  lastIndexedBlock: number;
  headBlock: number;
  lagBlocks: number;
}

export async function registerHealthRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get("/api/health", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");

    const lastIndexedBlock = db.getSyncState()?.lastBlock ?? 0;
    let headBlock = 0;
    let headUnavailable = false;
    try {
      headBlock = Number(await client.getBlockNumber());
    } catch {
      // api.md requires 200 while the process is up: an unreachable RPC reports
      // "syncing" with headBlock 0 instead of failing the probe.
      headUnavailable = true;
    }

    const lagBlocks = Math.max(headBlock - lastIndexedBlock, 0);
    const status = headUnavailable || lagBlocks > MAX_HEALTH_LAG_BLOCKS ? "syncing" : "ok";

    const body: HealthResponse = {
      status,
      chainId,
      factoryAddress: addresses.factory,
      lastIndexedBlock,
      headBlock,
      lagBlocks,
    };
    return body;
  });
}
