export default function ShareNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <div className="max-w-md text-center space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted">
          <span className="text-xl" aria-hidden>
            ·
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          This share isn&apos;t available
        </h1>
        <p className="text-sm text-muted-foreground">
          The report may have been revoked or removed — but the tests behind it
          are easy to recreate. Record a flow once and Lastest re-runs it on
          every deploy, free.
        </p>
        <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
          <a
            href="/register"
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground font-medium px-4 py-2 hover:bg-primary/90"
          >
            Test your own product — free
          </a>
          <a
            href="https://lastest.cloud/demos"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md border font-medium px-4 py-2 hover:bg-muted"
          >
            Browse live demos
          </a>
        </div>
      </div>
    </div>
  );
}
