export function Footer() {
  return (
    <footer className="border-t border-hairline bg-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <span className="border border-hairline px-2 py-1 font-display text-[0.65rem] uppercase tracking-widest text-muted">
          SEPOLIA TESTNET
        </span>
        <p className="text-sm text-muted">Test assets have no value</p>
      </div>
    </footer>
  );
}
