import { formatEthWithUnit } from "../../lib/format";

export interface PriceTickerProps {
  price: bigint;
}

/**
 * Current auction price (FR-005): the parent re-renders it from the
 * 1-second useCurrentPrice ticker, so the shown value lags < 1 s.
 */
export function PriceTicker({ price }: PriceTickerProps) {
  return (
    <span data-testid="current-price" className="font-display text-display-md text-display">
      {formatEthWithUnit(price)}
    </span>
  );
}
