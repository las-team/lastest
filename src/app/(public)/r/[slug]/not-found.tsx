import Link from 'next/link';

export default function ShareNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted">
          <span className="text-xl" aria-hidden>
            ·
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">This share isn&apos;t available</h1>
        <p className="text-sm text-muted-foreground">
          The page may have been revoked or removed. If you believe this is a mistake,
          contact the person who shared the link with you.
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground font-medium px-4 py-2 hover:bg-primary/90"
          >
            Visit Lastest
          </Link>
        </div>
      </div>
    </div>
  );
}
