import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { decodeEventLog } from "viem";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { Countdown } from "@/components/auction/Countdown";
import { PriceTicker } from "@/components/auction/PriceTicker";
import { StatusBadge } from "@/components/auction/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { TxSummaryModal } from "@/components/wallet/TxSummaryModal";
import {
  DEFAULT_DURATION,
  validateAuctionParams,
} from "@/lib/auctionParams";
import type { ParamIssue } from "@/lib/auctionParams";
import { auctionFactoryAbi, dutchAuctionNftAbi } from "@/config/contracts";
import { deployments } from "@/config/deployments";
import { useCurrentPrice } from "@/hooks/useCurrentPrice";
import { useTxFlow } from "@/hooks/useTxFlow";
import { assertTxConfirmed } from "@/lib/errors";
import { formatDuration, formatEthWithUnit, formatRate } from "@/lib/format";
import { deriveStatus } from "@/lib/price";
import type { AuctionParams } from "@/lib/price";

// Narrowed AuctionCreated event so decodeEventLog returns typed fields; the
// layout mirrors the generated factory ABI (3 indexed + 6 data words).
const AUCTION_CREATED_EVENT_ABI = [
  {
    type: "event",
    name: "AuctionCreated",
    anonymous: false,
    inputs: [
      { name: "auction", type: "address", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "nft", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "startingPrice", type: "uint256", indexed: false },
      { name: "discountRate", type: "uint256", indexed: false },
      { name: "duration", type: "uint256", indexed: false },
      { name: "startAt", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint256", indexed: false },
    ],
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const REDIRECT_MS = 5_000;

interface LogLike {
  data: Hex;
  topics: readonly Hex[];
}

interface CreatedAuction {
  address: `0x${string}`;
  tokenId: bigint;
  startingPrice: bigint;
  discountRate: bigint;
  duration: bigint;
  startAt: bigint;
  expiresAt: bigint;
}

function parseAuctionCreated(logs: readonly LogLike[]): CreatedAuction | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: AUCTION_CREATED_EVENT_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      return {
        address: decoded.args.auction,
        tokenId: decoded.args.tokenId,
        startingPrice: decoded.args.startingPrice,
        discountRate: decoded.args.discountRate,
        duration: decoded.args.duration,
        startAt: decoded.args.startAt,
        expiresAt: decoded.args.expiresAt,
      };
    } catch {
      // Not an AuctionCreated log - keep scanning.
    }
  }
  return null;
}

/** Token-id validation lives next to the form (the FR-011 rules are in lib). */
type FormIssue = ParamIssue | { field: "tokenId"; what: string; next: string };

/**
 * Create-auction flow (FR-011, US2.2, US2.3, US2.6):
 * 1. every input is validated BEFORE any transaction, with a plain-language
 *    reason naming the violated rule (no tx is sent on invalid input);
 * 2. a pre-flight ownership/approval check guides the one-time approval tx
 *    first - `createAuction` is only offered after the approval confirms;
 * 3. on success the page confirms escrow, shows the auction live at its
 *    starting price with a countdown from `startAt`, and redirects to it.
 */
export default function CreateAuctionPage() {
  const account = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const tx = useTxFlow();
  const navigate = useNavigate();

  const factory = deployments.factory;
  const nft = deployments.nft;

  const [tokenIdInput, setTokenIdInput] = useState("");
  const [startingPriceInput, setStartingPriceInput] = useState("");
  const [discountRateInput, setDiscountRateInput] = useState("");
  const [durationInput, setDurationInput] = useState(String(DEFAULT_DURATION));
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const [approvedNow, setApprovedNow] = useState(false);
  const [lastAction, setLastAction] = useState<"approve" | "create" | null>(null);
  const [created, setCreated] = useState<CreatedAuction | null>(null);

  const tokenId = /^\d+$/.test(tokenIdInput.trim())
    ? BigInt(tokenIdInput.trim())
    : null;

  // --- Pre-flight: ownership (T050 edge: "not owned or not approved") ---
  const ownerOf = useReadContract({
    address: nft,
    abi: dutchAuctionNftAbi,
    functionName: "ownerOf",
    args: [tokenId ?? 0n],
    query: {
      enabled: nft !== undefined && tokenId !== null && account.address !== undefined,
    },
  });
  const ownerQueryEnabled =
    nft !== undefined && tokenId !== null && account.address !== undefined;
  const ownership: "unknown" | "checking" | "owned" | "not_owned" =
    !ownerQueryEnabled
      ? "unknown"
      : ownerOf.data === undefined
        ? "checking"
        : ownerOf.data.toLowerCase() === (account.address ?? "").toLowerCase()
          ? "owned"
          : "not_owned";

  // --- Pre-flight: factory approval (US2.6) ---
  const operatorApproval = useReadContract({
    address: nft,
    abi: dutchAuctionNftAbi,
    functionName: "isApprovedForAll",
    args: [(account.address ?? ZERO_ADDRESS) as `0x${string}`, factory ?? ZERO_ADDRESS],
    query: { enabled: ownership === "owned" && factory !== undefined },
  });
  const tokenApproval = useReadContract({
    address: nft,
    abi: dutchAuctionNftAbi,
    functionName: "getApproved",
    args: [tokenId ?? 0n],
    query: { enabled: ownership === "owned" && tokenId !== null },
  });
  const approvalReadFailed =
    ownership === "owned" &&
    operatorApproval.isError === true &&
    tokenApproval.isError === true;
  const approved =
    approvedNow ||
    operatorApproval.data === true ||
    (typeof tokenApproval.data === "string" &&
      factory !== undefined &&
      tokenApproval.data.toLowerCase() === factory.toLowerCase());
  const notOwnedOrNotApproved =
    ownership === "not_owned" || approvalReadFailed;

  const inFlight =
    tx.state === "awaiting_signature" ||
    tx.state === "pending" ||
    tx.state === "confirming";
  const createDone = lastAction === "create" && tx.state === "success";
  const primaryDisabled =
    !account.isConnected ||
    factory === undefined ||
    nft === undefined ||
    ownership === "checking" ||
    notOwnedOrNotApproved ||
    inFlight ||
    createDone;

  // Refs keep the stable callbacks (tx effects) able to refresh the reads.
  const approvalReadsRef = useRef<Array<{ refetch: () => unknown }>>([]);
  approvalReadsRef.current = [operatorApproval, tokenApproval];
  const ownerOfRef = useRef(ownerOf);
  ownerOfRef.current = ownerOf;

  // Refetch ownership once the auction exists so the escrow line can confirm
  // the factory now holds the NFT.
  useEffect(() => {
    if (created !== null) void ownerOfRef.current.refetch();
  }, [created]);

  // Post-creation redirect to the auction page (US2.2).
  useEffect(() => {
    if (created === null) return;
    const timer = setTimeout(() => navigate(`/auction/${created.address}`), REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [created, navigate]);

  const createdParams = useMemo<AuctionParams | null>(
    () =>
      created === null
        ? null
        : {
            startingPrice: created.startingPrice,
            discountRate: created.discountRate,
            duration: created.duration,
            startAt: created.startAt,
            expiresAt: created.expiresAt,
          },
    [created],
  );
  const current = useCurrentPrice(created?.address ?? undefined, createdParams);

  function handlePrimary(): void {
    if (primaryDisabled || factory === undefined || nft === undefined) return;

    const formIssues: FormIssue[] = [];
    const trimmedToken = tokenIdInput.trim();
    if (!/^\d+$/.test(trimmedToken)) {
      formIssues.push({
        field: "tokenId",
        what: "Token ID must be a whole number",
        next: "Enter the token number you received when minting, like 7.",
      });
    }
    const validation = validateAuctionParams({
      startingPrice: startingPriceInput,
      discountRate: discountRateInput,
      duration: durationInput,
    });
    if (!validation.ok) formIssues.push(...validation.issues);
    // FR-011 / US2.3: reject before ANY transaction - approval included.
    const params = validation.ok ? validation.params : null;
    if (params === null || formIssues.length > 0) {
      setIssues(formIssues);
      return;
    }
    setIssues([]);

    if (!approved) {
      setLastAction("approve");
      void tx.run({
        summary: {
          action: "Approve NFT for auction",
          detail:
            "One-time step: the auction factory may move your NFT into escrow when the auction is created.",
        },
        execute: async () => {
          const hash = await writeContractAsync({
            address: nft,
            abi: dutchAuctionNftAbi,
            functionName: "setApprovalForAll",
            args: [factory, true],
          });
          return {
            hash,
            wait: async () => {
              if (!publicClient) throw new Error("Network client unavailable");
              const receipt = await publicClient.waitForTransactionReceipt({ hash });
              assertTxConfirmed(receipt);
              setApprovedNow(true);
              approvalReadsRef.current.forEach((read) => void read.refetch());
              return receipt;
            },
          };
        },
      });
      return;
    }

    setLastAction("create");
    void tx.run({
      summary: {
        action: "Create auction",
        detail: `Token #${trimmedToken} starts at ${formatEthWithUnit(params.startingPrice)} and drops ${formatRate(params.discountRate)} over ${formatDuration(Number(params.duration))}.`,
      },
      execute: async () => {
        const hash = await writeContractAsync({
          address: factory,
          abi: auctionFactoryAbi,
          functionName: "createAuction",
          args: [
            nft,
            BigInt(trimmedToken),
            params.startingPrice,
            params.discountRate,
            params.duration,
          ],
        });
        return {
          hash,
          wait: async () => {
            if (!publicClient) throw new Error("Network client unavailable");
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            assertTxConfirmed(receipt);
            setCreated(parseAuctionCreated(receipt.logs as readonly LogLike[]));
            return receipt;
          },
        };
      },
    });
  }

  const escrowConfirmed =
    created !== null &&
    typeof ownerOf.data === "string" &&
    ownerOf.data.toLowerCase() === created.address.toLowerCase();

  return (
    <main data-testid="CreateAuctionPage" className="mx-auto w-full max-w-6xl px-6 py-12">
      <h1 className="text-display-lg">Create Auction</h1>

      <NetworkGuard />

      {created !== null ? (
        // Post-creation success flow (T051, US2.2): escrow confirmation,
        // status live at the starting price, countdown from startAt.
        <section
          aria-label="Auction created"
          data-testid="auction-created"
          className="mt-8 max-w-xl border border-hairline bg-panel p-4"
        >
          <h2 className="font-display text-display-md text-display">
            Your auction is live!
          </h2>
          <p data-testid="escrow-confirmation" className="mt-3 text-display">
            {escrowConfirmed
              ? `Escrow confirmed - the auction contract now holds your NFT (token #${created.tokenId.toString()}).`
              : "Confirming escrow - the auction contract should now hold your NFT."}
          </p>
          <dl className="mt-4 grid gap-3">
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Status
              </dt>
              <dd className="mt-0.5">
                <StatusBadge
                  status={deriveStatus(
                    { sold: false, cancelled: false, expiresAt: created.expiresAt },
                    current.now,
                  )}
                />
              </dd>
            </div>
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Starting price
              </dt>
              <dd data-testid="created-starting-price" className="mt-0.5 text-display">
                {formatEthWithUnit(created.startingPrice)}
              </dd>
            </div>
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Current price
              </dt>
              <dd className="mt-0.5">
                <PriceTicker price={current.price} />
              </dd>
            </div>
            <div>
              <dt className="font-display text-xs uppercase tracking-wide text-muted">
                Time remaining
              </dt>
              <dd className="mt-0.5">
                <Countdown expiresAt={created.expiresAt} now={current.now} />
              </dd>
            </div>
          </dl>
          <Link
            to={`/auction/${created.address}`}
            className="mt-4 inline-block font-display text-sm uppercase tracking-wide text-display underline underline-offset-4 transition-colors hover:text-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
          >
            View auction
          </Link>
          <p className="mt-2 text-muted">Opening your auction in a few seconds...</p>
        </section>
      ) : (
        <section
          aria-label="Auction settings"
          className="mt-8 max-w-xl border border-hairline bg-panel p-4"
        >
          <h2 className="font-display text-sm uppercase tracking-wide text-muted">
            Auction settings
          </h2>
          <p className="mt-2 text-muted">
            Set the starting price, discount rate, and duration for your Dutch auction.
          </p>

          {!account.isConnected ? (
            <p className="mt-3 text-display">Connect your wallet to create an auction.</p>
          ) : null}
          {factory === undefined || nft === undefined ? (
            <p className="mt-3 text-display">
              This app&apos;s contract addresses are not configured - reload the page or
              contact the operator.
            </p>
          ) : null}

          {notOwnedOrNotApproved ? (
            <div role="alert" className="mt-3 border border-ember bg-ink p-3">
              <p className="text-display">
                This NFT is not owned or not approved for this auction
              </p>
              <p className="mt-1 text-muted">
                Check the token ID - the connected wallet must own the NFT and the auction
                factory must be approved before it can be listed. Mint a new NFT if you
                need one.
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-4">
            <Input
              label="Token ID"
              inputMode="numeric"
              placeholder="7"
              value={tokenIdInput}
              disabled={inFlight}
              onChange={(event) => {
                setTokenIdInput(event.target.value);
                setIssues([]);
              }}
            />
            <Input
              label="Starting price (ETH)"
              inputMode="decimal"
              placeholder="0.05"
              value={startingPriceInput}
              disabled={inFlight}
              onChange={(event) => {
                setStartingPriceInput(event.target.value);
                setIssues([]);
              }}
            />
            <Input
              label="Discount rate (ETH per second)"
              inputMode="decimal"
              placeholder="0.0001"
              value={discountRateInput}
              disabled={inFlight}
              onChange={(event) => {
                setDiscountRateInput(event.target.value);
                setIssues([]);
              }}
            />
            <div>
              <Input
                label="Duration (seconds)"
                inputMode="numeric"
                value={durationInput}
                disabled={inFlight}
                onChange={(event) => {
                  setDurationInput(event.target.value);
                  setIssues([]);
                }}
              />
              <p className="mt-1 text-sm text-muted">
                60s ≤ duration ≤ 2_592_000 (60 seconds to 30 days), default 300 seconds
                (5 minutes).
              </p>
            </div>
          </div>

          {issues.length > 0 ? (
            <div role="alert" className="mt-4 border border-ember bg-ink p-3">
              <p className="font-display text-xs uppercase tracking-wide text-ember">
                Check these settings
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {issues.map((issue, index) => (
                  <li key={`${issue.field}-${index}`}>
                    <p className="text-display">{issue.what}</p>
                    <p className="mt-0.5 text-sm text-muted">{issue.next}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!approved && account.isConnected && !notOwnedOrNotApproved ? (
            <p className="mt-3 text-muted">
              One-time approval first: the auction factory must be approved to move your
              NFT into escrow. The auction is only created after the approval confirms.
            </p>
          ) : null}

          <Button className="mt-4" onClick={handlePrimary} disabled={primaryDisabled}>
            {approved ? "Create auction" : "Approve NFT first"}
          </Button>

          {tx.state === "rejected" || tx.state === "failed" ? (
            <Button variant="secondary" className="mt-3" onClick={() => void tx.retry()}>
              Retry
            </Button>
          ) : null}

          {lastAction === "approve" && tx.state === "success" && approved ? (
            <p data-testid="approval-confirmed" className="mt-3 text-display">
              Approval confirmed - your NFT is ready to list.
            </p>
          ) : null}
        </section>
      )}

      {lastAction === "create" && tx.state === "success" && created === null ? (
        <section
          aria-label="Auction created"
          className="mt-8 max-w-xl border border-hairline bg-panel p-4"
        >
          <p className="text-display">Auction created - find it in My Auctions.</p>
          <Link
            to="/my"
            className="mt-3 inline-block font-display text-sm uppercase tracking-wide text-display underline underline-offset-4 transition-colors hover:text-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
          >
            Open My Auctions
          </Link>
        </section>
      ) : null}

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
