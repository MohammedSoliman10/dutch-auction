#!/bin/sh
#
# Seeds one live demo auction on Sepolia so User Story 1 is testable without
# the User Story 2 UI (T044): mint an NFT, approve the factory, create a
# short Dutch auction, then print the auction address and explorer link.
#
# Usage:  scripts/seed-demo.sh
# Env:    METADATA_URI=<uri>   optional metadata override for the minted NFT
# Needs:  cast (foundry), node, deployments/sepolia.json, and a repo-root
#         .env providing RPC_URL plus DEPLOYER_KEY (a funded Sepolia key).
# The script only reads .env - it never modifies repo state.
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)
DEPLOYMENTS_FILE="$REPO_ROOT/deployments/sepolia.json"

CONFIRMATIONS=2
DURATION=300 # short demo window (seconds)
STARTING_PRICE_WEI=50000000000000000 # 0.05 ETH
# Floor division: the factory reverts with PriceWouldGoNegative unless
# discountRate * duration <= startingPrice, so 5e16 / 300 floors to
# 166666666666666 wei/s and the price decays to a negligible remainder at
# expiry instead of below zero.
DISCOUNT_RATE_WEI=$((STARTING_PRICE_WEI / DURATION))
METADATA_URI=${METADATA_URI:-ipfs://bafydemo-seed/1.json}
EXPLORER=https://sepolia.etherscan.io

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

# Print one field of a JSON file; fails when the field is absent.
json_field() {
  node -e '
    const fs = require("fs");
    const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = doc[process.argv[2]];
    if (value === undefined || value === null || value === "") process.exit(1);
    process.stdout.write(String(value));
  ' "$1" "$2"
}

# Print the minted token id from a mint receipt (Transfer topics[3]).
token_id_from() {
  node -e '
    const fs = require("fs");
    const receipt = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const wanted = process.argv[2].toLowerCase();
    const log = (receipt.logs || []).find(
      (entry) => String((entry.topics || [])[0]).toLowerCase() === wanted,
    );
    if (!log || log.topics.length < 4) process.exit(1);
    process.stdout.write(BigInt(log.topics[3]).toString(10));
  ' "$1" "$2"
}

# Print the deployed auction from an AuctionCreated receipt (topics[1]).
auction_from() {
  node -e '
    const fs = require("fs");
    const receipt = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const wanted = process.argv[2].toLowerCase();
    const factory = process.argv[3].toLowerCase();
    const log = (receipt.logs || []).find(
      (entry) =>
        String((entry.topics || [])[0]).toLowerCase() === wanted &&
        String(entry.address).toLowerCase() === factory,
    );
    if (!log || log.topics.length < 2) process.exit(1);
    process.stdout.write("0x" + String(log.topics[1]).toLowerCase().slice(-40));
  ' "$1" "$2" "$3"
}

# send_and_wait <receipt-file> <label> <to> <signature> [args...]
# Sends one transaction, waits for its receipt, and dies on a revert.
send_and_wait() {
  receipt_file=$1
  label=$2
  shift 2
  tx=$(cast send --async --rpc-url "$RPC_URL" --private-key "$DEPLOYER_KEY" "$@") ||
    die "$label: transaction submission failed"
  cast receipt "$tx" --confirmations "$CONFIRMATIONS" --rpc-url "$RPC_URL" --json \
    >"$receipt_file" || die "$label: no receipt for transaction $tx"
  status=$(json_field "$receipt_file" status) ||
    die "$label: receipt carries no status (transaction $tx)"
  case "$status" in
    success | 0x1 | 1) ;;
    *) die "$label: transaction reverted with status $status (transaction $tx)" ;;
  esac
  printf '  %s tx: %s\n' "$label" "$tx"
}

command -v cast >/dev/null 2>&1 || die "cast (foundry) not found on PATH"
command -v node >/dev/null 2>&1 || die "node not found on PATH"
[ -f "$REPO_ROOT/.env" ] || die "missing $REPO_ROOT/.env (expected RPC_URL and DEPLOYER_KEY)"
[ -f "$DEPLOYMENTS_FILE" ] ||
  die "missing $DEPLOYMENTS_FILE - deploy the contracts first (forge script script/Deploy.s.sol --broadcast)"

# shellcheck disable=SC1090,SC1091
. "$REPO_ROOT/.env"
: "${RPC_URL:?RPC_URL is not set in .env}"
: "${DEPLOYER_KEY:?DEPLOYER_KEY is not set in .env}"

nft_address=$(json_field "$DEPLOYMENTS_FILE" nft) ||
  die "nft address missing from deployments/sepolia.json"
factory_address=$(json_field "$DEPLOYMENTS_FILE" factory) ||
  die "factory address missing from deployments/sepolia.json"
deployed_chain=$(json_field "$DEPLOYMENTS_FILE" chainId) ||
  die "chainId missing from deployments/sepolia.json"

rpc_chain=$(cast chain-id --rpc-url "$RPC_URL") || die "cannot reach RPC_URL"
[ "$rpc_chain" = "$deployed_chain" ] ||
  die "RPC_URL serves chain $rpc_chain but deployments/sepolia.json targets $deployed_chain"

deployer=$(cast wallet address --private-key "$DEPLOYER_KEY")
balance_wei=$(cast balance "$deployer") || die "cannot read the deployer balance"
[ "$balance_wei" != "0" ] ||
  die "deployer $deployer holds no Sepolia ETH - fund it from a faucet first"

transfer_topic=$(cast sig-event "Transfer(address,address,uint256)")
created_topic=$(cast sig-event \
  "AuctionCreated(address,address,address,uint256,uint256,uint256,uint256,uint256,uint256)")

printf 'Seeding a demo auction on Sepolia (chain %s)\n' "$rpc_chain"
printf '  seller:  %s\n' "$deployer"
printf '  nft:     %s\n' "$nft_address"
printf '  factory: %s\n' "$factory_address"
printf '  price:   0.05 ETH falling by %s wei/s over %s s\n' "$DISCOUNT_RATE_WEI" "$DURATION"

printf '1/3 minting the NFT (metadata %s)\n' "$METADATA_URI"
send_and_wait "$TMP_DIR/mint.json" "mint" "$nft_address" \
  "mintNFT(string)" "$METADATA_URI"
token_id=$(token_id_from "$TMP_DIR/mint.json" "$transfer_topic") ||
  die "mint receipt has no Transfer log for $nft_address"
printf '  minted token #%s\n' "$token_id"

printf '2/3 approving the factory to escrow token #%s\n' "$token_id"
send_and_wait "$TMP_DIR/approve.json" "approve" "$nft_address" \
  "approve(address,uint256)" "$factory_address" "$token_id"

printf '3/3 creating the auction\n'
send_and_wait "$TMP_DIR/create.json" "createAuction" "$factory_address" \
  "createAuction(address,uint256,uint256,uint256,uint256)" \
  "$nft_address" "$token_id" "$STARTING_PRICE_WEI" "$DISCOUNT_RATE_WEI" "$DURATION"
auction=$(auction_from "$TMP_DIR/create.json" "$created_topic" "$factory_address") ||
  die "createAuction receipt has no AuctionCreated event"

printf '\nDemo auction is live for %s seconds\n' "$DURATION"
printf '  token:    #%s\n' "$token_id"
printf '  auction:  %s\n' "$auction"
printf '  explorer: %s/address/%s\n' "$EXPLORER" "$auction"
printf '  frontend: /auction/%s\n' "$auction"
