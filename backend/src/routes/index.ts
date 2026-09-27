import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { registerAuctionRoutes } from "./auctions.js";
import { registerHealthRoutes } from "./health.js";

export async function registerRoutes(app: FastifyInstance, db: Db): Promise<void> {
  await registerHealthRoutes(app, db);
  await registerAuctionRoutes(app, db);
}
