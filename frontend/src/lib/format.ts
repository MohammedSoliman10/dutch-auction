// Shared display formatters for on-chain values (wei, unix seconds).

const WEI_PER_ETH = 10n ** 18n;

/** Formats wei as a trimmed ETH decimal string, e.g. 50000000000000000 -> "0.05". */
export function formatEth(wei: bigint, maxDecimals = 6): string {
  const value = wei > 0n ? wei : 0n;
  const whole = value / WEI_PER_ETH;
  const fraction = (value % WEI_PER_ETH)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : whole.toString();
}

export function formatEthWithUnit(wei: bigint): string {
  return `${formatEth(wei)} ETH`;
}

export function formatRate(weiPerSecond: bigint): string {
  return `${formatEth(weiPerSecond)} ETH per second`;
}

/** Human duration from seconds, e.g. 300 -> "5m 0s", 299 -> "4m 59s". */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds >= 3_600) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    return `${hours}h ${minutes}m`;
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
