import { useId } from "react";
import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({ label, error, id, className, ...inputProps }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  const classes = [
    "border bg-ink px-3 py-2 font-body text-display placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember disabled:opacity-50",
    error ? "border-ember" : "border-muted",
    className ?? "",
  ]
    .filter((segment) => segment.length > 0)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="font-display text-xs uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      <input
        {...inputProps}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={classes}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-ember">
          {error}
        </p>
      ) : null}
    </div>
  );
}
