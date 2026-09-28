import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  children: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-ember text-ink hover:bg-ember-hover",
  secondary: "border border-muted bg-transparent text-display hover:border-muted hover:bg-panel",
  danger: "border border-ember bg-transparent text-ember hover:bg-ember hover:text-ink",
};

const baseClasses =
  "inline-flex items-center justify-center gap-2 px-5 py-2.5 font-display text-sm uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...buttonProps
}: ButtonProps) {
  const classes = [baseClasses, variantClasses[variant], className ?? ""]
    .filter((segment) => segment.length > 0)
    .join(" ");

  return (
    <button
      {...buttonProps}
      type={type}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
    >
      {children}
      {loading ? (
        <span aria-hidden="true" className="animate-pulse">
          ...
        </span>
      ) : null}
    </button>
  );
}
