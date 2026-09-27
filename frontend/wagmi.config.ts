import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

// ABIs only: contract addresses are injected at runtime from
// src/config/deployments.ts (VITE_* env), never from codegen.
export default defineConfig({
  out: "src/config/contracts.ts",
  plugins: [
    foundry({
      // No trailing slash: the plugin appends "/**/<include>", and a trailing
      // slash would form a "out//**" double-slash glob that matches nothing.
      artifacts: "../out",
      include: [
        "DutchAuctionNFT.sol/DutchAuctionNFT.json",
        "AuctionFactory.sol/AuctionFactory.json",
        "DutchAuction.sol/DutchAuction.json",
      ],
      // Run after `forge build` (see contracts.ts header); the plugin's own
      // build step would target frontend/ as a Foundry root, which has no foundry.toml.
      forge: {
        build: false,
      },
    }),
  ],
});
