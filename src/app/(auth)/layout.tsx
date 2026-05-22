import Link from 'next/link';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">{children}</div>
      <Link
        href="/awards"
        className="mt-10 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground hover:text-foreground transition"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Prove your app is not AI slop, earn a Lastest badge
      </Link>
      <nav className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <Link href="/terms" className="hover:text-foreground hover:underline underline-offset-4">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-foreground hover:underline underline-offset-4">
          Privacy
        </Link>
        <Link href="/cookies" className="hover:text-foreground hover:underline underline-offset-4">
          Cookies
        </Link>
      </nav>
    </div>
  );
}
