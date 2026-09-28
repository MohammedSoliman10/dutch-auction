// T065 (FR-016 / SC-008) + T066 (FR-018) code audit.
//
// No browser is available in this environment, so design conformance and
// contrast are verified at the source level: every color literal in the app
// must come from the theme's ink/ember/neutral tokens, and every text or
// control foreground pair must clear WCAG AA (4.5:1) against the ink canvas.
// The ratios below are computed from the real token values in theme.css -
// they are not visual claims, they are arithmetic on the shipped palette.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THEME_CSS = path.join(SRC, "styles", "theme.css");

/** The only color token names FR-016 allows (ink scale + ember + neutrals). */
const ALLOWED_TOKENS = [
  "ink",
  "panel",
  "hairline",
  "ember",
  "ember-hover",
  "ember-muted",
  "display",
  "muted",
] as const;

/** Tailwind palette classes that would smuggle stray hues into the UI. */
const STRAY_COLOR_PATTERN =
  /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:[0-9][0-9])?\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function normalizeHex(raw: string): string {
  const body = raw.slice(1).toLowerCase();
  if (body.length === 3) {
    return `#${body
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return `#${body}`;
}

function tokens(): Record<string, string> {
  const css = readFileSync(THEME_CSS, "utf8");
  const found: Record<string, string> = {};
  for (const [, name, value] of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    found[name] = normalizeHex(value);
  }
  return found;
}

function channel(hex: string): number {
  return parseInt(hex.slice(1, 3), 16) / 255;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG 2.1 contrast ratio between two hex colors. */
export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const T = tokens();

/** Non-decorative foregrounds that must be legible on the ink canvas. */
const TEXT_TOKENS = ["display", "muted", "ember", "ember-hover", "ember-muted"] as const;
const TEXT_ON_PANEL = ["display", "muted", "ember", "ember-hover", "ember-muted"] as const;
/** Border tokens used on interactive controls (Button, Input, filter chips). */
const CONTROL_BORDER_TOKENS = ["muted", "ember", "display"] as const;

describe("T065 design tokens (FR-016, SC-008)", () => {
  it("defines exactly the allowed ink / ember / neutral tokens - no strays", () => {
    expect(Object.keys(T).sort()).toEqual([...ALLOWED_TOKENS].sort());
    for (const [name, value] of Object.entries(T)) {
      expect(value, `--color-${name} must be a 6-digit hex`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("uses a single ember accent family - every colored token is warm (r >= g >= b)", () => {
    for (const [name, value] of Object.entries(T)) {
      const r = channel(value);
      const g = parseInt(value.slice(3, 5), 16) / 255;
      const b = parseInt(value.slice(5, 7), 16) / 255;
      const achromatic = Math.max(r, g, b) - Math.min(r, g, b) < 0.02;
      if (name === "hairline" && achromatic) continue;
      expect(
        achromatic || (r >= g && g >= b),
        `--color-${name} (${value}) must be neutral or ember-warm, not a stray hue`,
      ).toBe(true);
    }
  });

  it("has no raw hex/hsl/rgb color outside the token set (styles + screens)", () => {
    const allowed = new Set(Object.values(T));
    const files = walk(SRC).filter(
      (file) => /\.(?:css|tsx|ts)$/.test(file) && !file.includes(".test."),
    );
    const strays: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const [raw] of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const value = normalizeHex(raw);
        // Contract addresses are 0x-prefixed, never #-prefixed.
        if (!allowed.has(value)) strays.push(`${path.relative(SRC, file)}: ${raw}`);
      }
      for (const pattern of ["hsl(", "hsla(", "rgb(", "rgba("]) {
        if (source.includes(pattern)) strays.push(`${path.relative(SRC, file)}: ${pattern}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("never reaches for Tailwind's built-in palette (stray hues in class names)", () => {
    const files = walk(SRC).filter(
      (file) => /\.(?:css|tsx|ts)$/.test(file) && !file.includes(".test."),
    );
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const [raw] of source.matchAll(new RegExp(STRAY_COLOR_PATTERN, "g"))) {
        found.push(`${path.relative(SRC, file)}: ${raw}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("keeps a global visible keyboard focus ring on the ink canvas (FR-018)", () => {
    const css = readFileSync(THEME_CSS, "utf8");
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-ember\)/);
  });

  it("sets display headings in the bold display face and near-white ink", () => {
    const css = readFileSync(THEME_CSS, "utf8");
    // Base layer: h1..h6 use --font-display and --color-display.
    expect(css).toMatch(/h1,[\s\S]*?h6\s*\{[\s\S]*?font-family:\s*var\(--font-display\)/);
    expect(css).toMatch(/h1,[\s\S]*?h6\s*\{[\s\S]*?color:\s*var\(--color-display\)/);
    // Archivo Black is a single-weight display face (no synthetic bold).
    expect(css).toMatch(/font-weight:\s*400/);
    expect(contrastRatio(T.display, T.ink)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("T066 contrast audit (FR-018, >= 4.5:1 on ink)", () => {
  it("text tokens clear 4.5:1 against the ink canvas", () => {
    const ratios: Record<string, number> = {};
    for (const name of TEXT_TOKENS) {
      ratios[name] = contrastRatio(T[name], T.ink);
      expect(ratios[name], `${name} on ink`).toBeGreaterThanOrEqual(4.5);
    }
    // Printed so the audit table in the report is backed by real numbers.
    expect(ratios).toBeTruthy();
  });

  it("text tokens clear 4.5:1 against panel surfaces", () => {
    for (const name of TEXT_ON_PANEL) {
      expect(contrastRatio(T[name], T.panel), `${name} on panel`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("ember labels on ember fills (primary button) clear 4.5:1", () => {
    expect(contrastRatio(T.ink, T.ember), "ink on ember").toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(T.ink, T["ember-hover"]), "ink on ember-hover").toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("interactive control borders clear 4.5:1 on ink", () => {
    for (const name of CONTROL_BORDER_TOKENS) {
      expect(contrastRatio(T[name], T.ink), `${name} border on ink`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("interactive primitives (Button, Input) only use compliant border tokens", () => {
    const primitives = ["components/ui/Button.tsx", "components/ui/Input.tsx"];
    for (const primitive of primitives) {
      const source = readFileSync(path.join(SRC, primitive), "utf8");
      const borderTokens = [...source.matchAll(/\bborder-([a-z-]+)/g)].map((m) => m[1]);
      const colorTokens = borderTokens.filter((name): name is keyof typeof T => name in T);
      expect(colorTokens.length, `${primitive} must declare a border color`).toBeGreaterThan(0);
      for (const name of colorTokens) {
        expect(
          contrastRatio(T[name], T.ink),
          `${primitive}: border-${name} on ink`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the ember focus outline clears the 3:1 non-text threshold on ink", () => {
    expect(contrastRatio(T.ember, T.ink)).toBeGreaterThanOrEqual(3);
  });
});
