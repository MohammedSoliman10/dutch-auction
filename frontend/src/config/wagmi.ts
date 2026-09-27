import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;

// WalletConnect is only offered when a project id is configured; the injected
// (browser) connector is always available.
const connectors = walletConnectProjectId
  ? [injected(), walletConnect({ projectId: walletConnectProjectId })]
  : [injected()];

const rpcUrl = (import.meta.env.VITE_RPC_URL as string | undefined) ||
  "https://ethereum-sepolia-rpc.publicnode.com";

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors,
  transports: {
    [sepolia.id]: http(rpcUrl),
  },
});
