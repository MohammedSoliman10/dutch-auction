import { ConnectButton } from "@rainbow-me/rainbowkit";
import { NavLink } from "react-router-dom";

const navLinks: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: "/", label: "Home", end: true },
  { to: "/my", label: "My Auctions" },
  { to: "/mint", label: "Mint" },
  { to: "/create", label: "Create" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-ink/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
        <NavLink
          to="/"
          className="font-display text-xl tracking-wide text-display transition-opacity hover:opacity-80"
        >
          DUTCH AUCTION
        </NavLink>
        <nav aria-label="Primary" className="flex items-center gap-6">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                [
                  "font-body text-sm uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember",
                  isActive ? "text-display underline underline-offset-8" : "text-muted hover:text-display",
                ].join(" ")
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <ConnectButton />
      </div>
    </header>
  );
}
