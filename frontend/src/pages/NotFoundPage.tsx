import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <main
      data-testid="NotFoundPage"
      className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-6 py-16"
    >
      <h1 className="text-display-lg">404 — page not found</h1>
      <p className="text-muted">The page you are looking for does not exist.</p>
      <Link
        to="/"
        className="text-display underline underline-offset-4 transition-colors hover:text-ember"
      >
        Return home
      </Link>
    </main>
  );
}
