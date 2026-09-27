import type { HTMLAttributes, ReactNode } from "react";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  label?: string;
  children: ReactNode;
}

export function Panel({ label, className, children, ...panelProps }: PanelProps) {
  const classes = ["border border-hairline bg-panel", className ?? ""]
    .filter((segment) => segment.length > 0)
    .join(" ");

  return (
    <section {...panelProps} aria-label={label} className={classes}>
      {label ? (
        <div className="border-b border-hairline px-4 py-2 font-display text-xs uppercase tracking-wide text-muted">
          {label}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
