export interface AppError {
  code: string;
  what: string;
  next: string;
}

export interface PlainMessage {
  what: string;
  next: string;
}

// Contract custom errors (specs/001-dutch-auction-web-app/contracts/
// smart-contract-interface.md, mirrored from data-model.md section 1.2) plus
// app-level failure codes. Every entry is plain language stating what happened
// and what to do next - never hex data or raw revert strings (FR-003).
export const ERROR_MESSAGES = {
  AlreadySold: {
    what: "This NFT has already been sold to another buyer",
    next: "No payment went through - browse the gallery to find another auction",
  },
  AlreadyCancelled: {
    what: "This auction was cancelled by its seller",
    next: "No payment went through - browse the gallery to find another auction",
  },
  AuctionExpired: {
    what: "This auction has expired",
    next: "No payment went through - browse the gallery for a live auction",
  },
  SellerCannotBuy: {
    what: "The seller cannot buy their own auction",
    next: "Only other wallets can purchase - you lose nothing but the network fee",
  },
  SelfBidding: {
    what: "A seller cannot bid on their own auction",
    next: "Use a different wallet to bid, or cancel the auction instead",
  },
  InsufficientPayment: {
    what: "The amount offered is below the current price",
    next: "Increase the amount to at least the current price and try again",
  },
  NotSeller: {
    what: "Only the seller can do this",
    next: "Connect with the seller's wallet and try again",
  },
  NotLive: {
    what: "This auction is no longer live",
    next: "Refresh the page to see its current status, then try a live auction",
  },
  AuctionNotExpired: {
    what: "The auction has not expired yet",
    next: "Wait until the countdown reaches zero before reclaiming, or cancel while it is still live",
  },
  PriceWouldGoNegative: {
    what: "These settings would push the price below zero before the auction ends",
    next: "Lower the discount rate or raise the starting price so the price reaches zero only at the end",
  },
  InvalidDuration: {
    what: "The duration must be between 60 seconds and 30 days",
    next: "Pick a duration in that range (5 minutes is the default) and try again",
  },
  InvalidPriceParams: {
    what: "The starting price must be greater than zero and the discount rate cannot be zero",
    next: "Set a starting price above zero and a discount rate of at least 1, then try again",
  },
  NotNftOwner: {
    what: "This wallet does not own that NFT",
    next: "Mint a new NFT or pick one you own, then try again",
  },
  NotApproved: {
    what: "The auction factory is not yet approved to move your NFT",
    next: "Approve the NFT when prompted, then create the auction again",
  },
  ZeroAddress: {
    what: "A required contract address is missing",
    next: "Reload the app and try again - if it keeps happening, the deployment may be misconfigured",
  },
  TransferFailed: {
    what: "The transfer could not be completed, so nothing changed",
    next: "Try again - if it keeps failing, check that the wallet has enough Sepolia ETH for the network fee",
  },
  EmptyURI: {
    what: "The metadata link is empty",
    next: "Paste an http, https, or ipfs link to the NFT metadata and try again",
  },
  USER_REJECTED: {
    what: "You rejected the request in your wallet",
    next: "Nothing was sent and nothing changed - press retry when you are ready",
  },
  INSUFFICIENT_FUNDS: {
    what: "The wallet does not have enough Sepolia ETH for the network fee",
    next: "Top up the wallet from a Sepolia faucet, then try again",
  },
  WRONG_CHAIN: {
    what: "The wallet is connected to a different network than Sepolia",
    next: "Switch the wallet to Sepolia in its network picker, then try again",
  },
  RPC_ERROR: {
    what: "The network did not respond, so the app could not finish the transaction",
    next: "Check your internet connection and try again",
  },
  CONTRACT_REVERT: {
    what: "The contract declined this transaction",
    next: "The auction may have changed - refresh the page and try again",
  },
  UNKNOWN: {
    what: "Something went wrong before the transaction completed",
    next: "Try again - if it keeps failing, wait a moment and come back",
  },
} as const satisfies Record<string, PlainMessage>;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

const CONTRACT_ERROR_NAMES = [
  "AlreadySold",
  "AlreadyCancelled",
  "AuctionExpired",
  "SellerCannotBuy",
  "SelfBidding",
  "InsufficientPayment",
  "NotSeller",
  "NotLive",
  "AuctionNotExpired",
  "PriceWouldGoNegative",
  "InvalidDuration",
  "InvalidPriceParams",
  "NotNftOwner",
  "NotApproved",
  "ZeroAddress",
  "TransferFailed",
  "EmptyURI",
] as const;

type ContractErrorName = (typeof CONTRACT_ERROR_NAMES)[number];

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  errors?: unknown;
  data?: unknown;
  errorName?: unknown;
}

function isRecord(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

// Walks the cause chain (viem/wagmi/EIP-1193 wrap errors several layers deep)
// and collects every object node for inspection. Raw values are only ever read
// for matching - never echoed back to the user.
function collectErrorNodes(err: unknown): ErrorLike[] {
  const nodes: ErrorLike[] = [];
  const queue: unknown[] = [err];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!isRecord(current) || seen.has(current)) continue;
    seen.add(current);
    nodes.push(current);
    if (current.cause !== undefined) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
    if (current.data !== undefined) queue.push(current.data);
  }

  return nodes;
}

function isContractErrorName(value: string): value is ContractErrorName {
  return (CONTRACT_ERROR_NAMES as readonly string[]).includes(value);
}

function hasName(node: ErrorLike, ...names: string[]): boolean {
  return typeof node.name === "string" && names.includes(node.name);
}

function messageMatches(node: ErrorLike, pattern: RegExp): boolean {
  return typeof node.message === "string" && pattern.test(node.message);
}

function isUserRejection(node: ErrorLike): boolean {
  if (node.code === 4001) return true;
  if (typeof node.name === "string" && node.name.includes("UserRejected")) {
    return true;
  }
  return messageMatches(
    node,
    /user (rejected|denied)|rejected (the )?request|request rejected/i,
  );
}

function findContractErrorName(node: ErrorLike): ContractErrorName | undefined {
  const data = isRecord(node.data) ? node.data : undefined;
  const decodedName =
    data && typeof data.errorName === "string" ? data.errorName : undefined;
  if (decodedName !== undefined && isContractErrorName(decodedName)) {
    return decodedName;
  }
  if (typeof node.name === "string" && isContractErrorName(node.name)) {
    return node.name;
  }
  if (typeof node.message === "string") {
    for (const name of CONTRACT_ERROR_NAMES) {
      if (node.message.includes(name)) return name;
    }
  }
  return undefined;
}

function toAppError(code: ErrorCode): AppError {
  const message = ERROR_MESSAGES[code];
  return { code, what: message.what, next: message.next };
}

export function mapTxError(err: unknown): AppError {
  const nodes = collectErrorNodes(err);

  if (nodes.some(isUserRejection)) return toAppError("USER_REJECTED");

  for (const node of nodes) {
    const contractError = findContractErrorName(node);
    if (contractError) return toAppError(contractError);
  }

  if (
    nodes.some(
      (node) =>
        hasName(node, "InsufficientFundsError") ||
        messageMatches(node, /insufficient funds/i),
    )
  ) {
    return toAppError("INSUFFICIENT_FUNDS");
  }

  if (
    nodes.some(
      (node) =>
        hasName(node, "ChainMismatchError") ||
        messageMatches(node, /chain mismatch|wrong (network|chain)|target chain/i),
    )
  ) {
    return toAppError("WRONG_CHAIN");
  }

  if (
    nodes.some(
      (node) =>
        hasName(node, "ContractFunctionRevertedError") ||
        messageMatches(node, /execution reverted|reverted with|revert:/i),
    )
  ) {
    return toAppError("CONTRACT_REVERT");
  }

  if (
    nodes.some(
      (node) =>
        hasName(
          node,
          "HttpRequestError",
          "TimeoutError",
          "JsonRpcError",
          "InternalRpcError",
          "TransportNotFoundError",
          "TransactionNotFoundError",
          "TransactionReceiptNotFoundError",
          "WaitForTransactionReceiptTimeoutError",
        ) || messageMatches(node, /failed to fetch|network (request|error)|timed out/i),
    )
  ) {
    return toAppError("RPC_ERROR");
  }

  return toAppError("UNKNOWN");
}
