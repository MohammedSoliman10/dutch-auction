import { formatDuration } from "../../lib/format";

export interface CountdownProps {
  expiresAt: bigint;
  now: number;
}

/** Time remaining until expiresAt, driven by the same 1-second ticker. */
export function Countdown({ expiresAt, now }: CountdownProps) {
  const remaining = Math.max(0, Number(expiresAt) - now);
  return (
    <span data-testid="time-remaining" className="font-display text-display-sm text-display">
      {formatDuration(remaining)}
    </span>
  );
}
