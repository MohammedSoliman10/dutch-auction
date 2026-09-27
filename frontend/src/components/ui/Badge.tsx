import type { ReactNode } from "react";

export type BadgeStatus = "live" | "sold" | "expired" | "cancelled";
export type BadgeVariant = BadgeStatus | "default";

export interface BadgeProps {
  status?: BadgeVariant;
  children?: ReactNode;
  className?: string;
}

// Ember is reserved for LIVE status (FR-016); ended states use neutral treatments.
const statusClasses: Record<BadgeVariant, string> = {
  live: "border-ember text-ember",
  sold: "border-hairline bg-panel text-display",
  expired: "border-hairline text-muted",
  cancelled: "border-dashed border-hairline text-muted",
  default: "border-hairline text-muted",
};

const baseClasses =
  "inline-flex items-center border px-2 py-0.5 font-display text-[0.65rem] uppercase tracking-widest";

export function Badge({ status = "default", children, className }: BadgeProps) {
  const label =
    children ?? (status === "default" ? "DEFAULT" : status.toUpperCase());
  const classes = [baseClasses, statusClasses[status], className ?? ""]
    .filter((segment) => segment.length > 0)
    .join(" ");

  return <span className={classes}>{label}</span>;
}
