import { getConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = getConfig();
  // RPC URLs may embed a provider API key in the path; log only the origin.
  const rpcOrigin = new URL(config.rpcUrl).origin;
  console.log(
    `backend config: port=${config.port} dbPath=${config.dbPath} factory=${config.factoryAddress} nft=${config.nftAddress} rpc=${rpcOrigin}`,
  );

  const app = await createServer();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
