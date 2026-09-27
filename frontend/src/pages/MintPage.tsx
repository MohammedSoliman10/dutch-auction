import { useState } from "react";
import { Link } from "react-router-dom";
import { decodeEventLog } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { TxSummaryModal } from "@/components/wallet/TxSummaryModal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { dutchAuctionNftAbi } from "@/config/contracts";
import { deployments } from "@/config/deployments";
import { useTxFlow } from "@/hooks/useTxFlow";
import { assertTxConfirmed, ERROR_MESSAGES } from "@/lib/errors";
import type { AppError } from "@/lib/errors";

// Narrowed Transfer event so decodeEventLog returns a typed tokenId; the
// selector and layout mirror ERC-721 (all three args are indexed).
const TRANSFER_EVENT_ABI = [
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface LogLike {
  data: `0x${string}`;
  topics: readonly `0x${string}`[];
}

/**
 * Extracts the minted token id from the ERC-721 Transfer logs (mint = from
 * zero address to the buyer's wallet). Returns null when the receipt does not
 * carry a decodable Transfer - the success UI degrades gracefully (FR-003).
 */
function parseMintedTokenId(logs: readonly LogLike[], account: string | undefined): bigint | null {
  if (!account) return null;
  const target = account.toLowerCase();
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_EVENT_ABI,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (
        decoded.args.from.toLowerCase() === ZERO_ADDRESS &&
        decoded.args.to.toLowerCase() === target
      ) {
        return decoded.args.tokenId;
      }
    } catch {
      // Not a Transfer log for this wallet - keep scanning.
    }
  }
  return null;
}

/**
 * Mint flow (FR-010, US2.1): the seller pastes a metadata URI, reviews a
 * plain-language summary before the wallet prompt (FR-019), and on success
 * sees the new token id plus confirmation that their wallet owns it.
 */
export default function MintPage() {
  const account = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const tx = useTxFlow();

  const nftAddress = deployments.nft;
  const [uri, setUri] = useState("");
  const [issue, setIssue] = useState<AppError | null>(null);
  const [mintedTokenId, setMintedTokenId] = useState<bigint | null>(null);

  // Ownership proof for the freshly minted token (US2.1): only read once a
  // confirmed mint produced a token id.
  const ownerOf = useReadContract({
    address: nftAddress,
    abi: dutchAuctionNftAbi,
    functionName: "ownerOf",
    args: [mintedTokenId ?? 0n],
    query: {
      enabled: nftAddress !== undefined && mintedTokenId !== null && tx.state === "success",
    },
  });

  const inFlight =
    tx.state === "awaiting_signature" ||
    tx.state === "pending" ||
    tx.state === "confirming";
  const mintDisabled =
    !account.isConnected || inFlight || tx.state === "success" || nftAddress === undefined;

  function handleMint(): void {
    if (mintDisabled || nftAddress === undefined) return;
    const trimmed = uri.trim();
    // Pre-submit guard: nothing reaches the wallet with an empty URI (the
    // contract would revert EmptyURI anyway).
    if (trimmed.length === 0) {
      setIssue({ code: "EmptyURI", ...ERROR_MESSAGES.EmptyURI });
      return;
    }
    setIssue(null);
    void tx.run({
      summary: {
        action: "Mint NFT",
        detail: `Metadata: ${trimmed}`,
      },
      execute: async () => {
        setMintedTokenId(null);
        const hash = await writeContractAsync({
          address: nftAddress,
          abi: dutchAuctionNftAbi,
          functionName: "mintNFT",
          args: [trimmed],
        });
        return {
          hash,
          wait: async () => {
            if (!publicClient) {
              throw new Error("Network client unavailable");
            }
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            assertTxConfirmed(receipt);
            setMintedTokenId(parseMintedTokenId(receipt.logs, account.address));
            return receipt;
          },
        };
      },
    });
  }

  const successBlock =
    tx.state === "success" && mintedTokenId !== null ? (
      <section
        aria-label="Mint result"
        data-testid="mint-success"
        className="mt-6 border border-hairline bg-panel p-4"
      >
        <p className="font-display text-sm uppercase tracking-wide text-display">
          Mint confirmed
        </p>
        <p data-testid="minted-token" className="mt-2 text-display">
          Minted token #{mintedTokenId.toString()}
        </p>
        {ownerOf.data === undefined ? (
          <p className="mt-1 text-muted">Confirming wallet ownership...</p>
        ) : ownerOf.data.toLowerCase() === (account.address ?? "").toLowerCase() ? (
          <p data-testid="wallet-owns" className="mt-1 text-display">
            Your wallet owns token #{mintedTokenId.toString()}.
          </p>
        ) : (
          <p className="mt-1 text-muted">
            Token #{mintedTokenId.toString()} was minted - check the collection for its owner.
          </p>
        )}
        <Link
          to="/create"
          className="mt-4 inline-block font-display text-sm uppercase tracking-wide text-display underline underline-offset-4 transition-colors hover:text-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
        >
          Create an auction for it
        </Link>
      </section>
    ) : tx.state === "success" ? (
      <section
        aria-label="Mint result"
        data-testid="mint-success"
        className="mt-6 border border-hairline bg-panel p-4"
      >
        <p className="font-display text-sm uppercase tracking-wide text-display">
          Mint confirmed
        </p>
        <p className="mt-2 text-muted">
          Your new NFT is in your wallet - open your wallet to see it.
        </p>
      </section>
    ) : null;

  return (
    <main data-testid="MintPage" className="mx-auto w-full max-w-6xl px-6 py-12">
      <h1 className="text-display-lg">Mint</h1>

      <NetworkGuard />

      <section aria-label="Mint" className="mt-8 max-w-xl border border-hairline bg-panel p-4">
        <h2 className="font-display text-sm uppercase tracking-wide text-muted">
          Mint a new NFT
        </h2>
        <p className="mt-2 text-muted">
          Paste the link to your NFT&apos;s metadata (name, image, description) - http,
          https, or ipfs.
        </p>

        {nftAddress === undefined ? (
          <p className="mt-3 text-display">
            This app&apos;s NFT collection address is not configured - reload the page or
            contact the operator.
          </p>
        ) : null}
        {!account.isConnected ? (
          <p className="mt-3 text-display">Connect your wallet to mint an NFT.</p>
        ) : null}

        <div className="mt-4">
          <Input
            label="Metadata URI"
            placeholder="https://example.com/token.json"
            value={uri}
            error={issue?.what}
            disabled={inFlight || tx.state === "success"}
            onChange={(event) => {
              setUri(event.target.value);
              setIssue(null);
            }}
          />
          {issue ? <p className="mt-1 text-sm text-muted">{issue.next}</p> : null}
        </div>

        <Button className="mt-4" onClick={handleMint} disabled={mintDisabled}>
          Mint NFT
        </Button>

        {tx.state === "rejected" || tx.state === "failed" ? (
          <Button variant="secondary" className="mt-3" onClick={() => void tx.retry()}>
            Retry
          </Button>
        ) : null}
        {tx.state === "success" ? (
          <Button variant="secondary" className="mt-3" onClick={() => {
            tx.reset();
            setMintedTokenId(null);
          }}>
            Close
          </Button>
        ) : null}
      </section>

      {successBlock}

      {/* FR-018: transaction status changes announced for screen readers. */}
      <div
        role="status"
        aria-live="polite"
        className="mt-4 max-w-xl border border-hairline bg-ink p-3 text-sm"
      >
        {tx.message ? (
          <>
            <p className="font-display text-xs uppercase tracking-wide text-display">
              {tx.message.what}
            </p>
            <p className="mt-1 text-muted">{tx.message.next}</p>
          </>
        ) : null}
      </div>

      {tx.state === "awaiting_signature" && tx.summary ? (
        <TxSummaryModal
          summary={tx.summary}
          onConfirm={() => void tx.confirm()}
          onCancel={tx.reset}
        />
      ) : null}
    </main>
  );
}
