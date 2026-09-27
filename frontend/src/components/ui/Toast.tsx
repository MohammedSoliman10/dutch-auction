import { useCallback, useState } from "react";

export type ToastTone = "neutral" | "success" | "error";

export interface ToastState {
  message: string;
  tone: ToastTone;
}

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  onDismiss?: () => void;
}

const toneClasses: Record<ToastTone, string> = {
  neutral: "border-hairline",
  success: "border-ember",
  error: "border-ember",
};

/**
 * Screen-reader announcements require the live region to exist before content
 * arrives, so mount <Toast> unconditionally and pass an empty message when idle.
 */
export function Toast({ message, tone = "neutral", onDismiss }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-tone={tone}
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      {message.length > 0 ? (
        <div
          className={`pointer-events-auto flex max-w-lg items-start gap-4 border bg-panel px-4 py-3 ${toneClasses[tone]}`}
        >
          <p className="text-sm text-display">{message}</p>
          {onDismiss ? (
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={onDismiss}
              className="font-display text-xs uppercase text-muted transition-colors hover:text-display focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
            >
              Close
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const show = useCallback(
    (message: string, tone: ToastTone = "neutral") => setToast({ message, tone }),
    [],
  );
  const dismiss = useCallback(() => setToast(null), []);

  return { toast, show, dismiss };
}
