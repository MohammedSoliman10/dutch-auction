import { useAccount, useBalance, useChainId, useSwitchChain } from "wagmi";

import { SEPOLIA_CHAIN_ID } from "../../config/chains";
import { Button } from "../ui/Button";

const SEPOLIA_FAUCET_URL =
  "https://cloud.google.com/application/web3/faucet/ethereum/sepolia";

/**
 * Wrong-network switch prompt and zero-balance faucet notice (FR-002, US1.6):
 * the prompt must appear before any transaction is requested, and a wallet
 * with no test ETH gets clear funding guidance.
 */
export function NetworkGuard() {
  const account = useAccount();
  const fallbackChainId = useChainId();
  const chainId = account.chainId ?? fallbackChainId;
  const { switchChain } = useSwitchChain();
  const balance = useBalance({ address: account.address });

  const wrongNetwork = account.isConnected === true && chainId !== SEPOLIA_CHAIN_ID;
  const outOfFunds = account.isConnected === true && balance.data?.value === 0n;

  if (!wrongNetwork && !outOfFunds) return null;

  return (
    <div className="flex flex-col gap-3">
      {wrongNetwork ? (
        <section
          role="alert"
          aria-label="Network"
          className="border border-ember bg-panel p-4"
        >
          <p className="font-display text-sm uppercase tracking-wide text-display">
            Wrong network
          </p>
          <p className="mt-1 text-muted">
            Your wallet is connected to a different network than Sepolia. Switch
            networks before buying - no transaction can be requested until then.
          </p>
          <Button className="mt-3" onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}>
            Switch to Sepolia
          </Button>
        </section>
      ) : null}
      {outOfFunds ? (
        <section aria-label="Funding" className="border border-hairline bg-panel p-4">
          <p className="font-display text-sm uppercase tracking-wide text-display">
            No test ETH in this wallet
          </p>
          <p className="mt-1 text-muted">
            You need a little Sepolia ETH to pay the network fee for a purchase.
          </p>
          <a
            href={SEPOLIA_FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-display underline underline-offset-4 transition-colors hover:text-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
          >
            Get Sepolia ETH from a faucet
          </a>
        </section>
      ) : null}
    </div>
  );
}
