// Vitest entry: registers the DOM matchers on vitest's `expect`
// (the package root entry targets Jest globals instead).
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// React Testing Library drains its async wrapper with setTimeout(0) and only
// advances that timer when it detects Jest fake timers (`typeof jest !==
// "undefined"` plus the `setTimeout.clock` marker that vitest also sets).
// Without a `jest` global, every user-event call under `vi.useFakeTimers()`
// would wait on a timer nobody advances, so delegate to vitest's clock here.
(globalThis as { jest?: unknown }).jest = {
  advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  advanceTimersByTimeAsync: (ms: number) => vi.advanceTimersByTimeAsync(ms),
};
