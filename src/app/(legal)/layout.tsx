import Link from 'next/link';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold">
            Lastest
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/terms" className="hover:underline underline-offset-4">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:underline underline-offset-4">
              Privacy Policy
            </Link>
            <Link href="/cookies" className="hover:underline underline-offset-4">
              Cookie Policy
            </Link>
            <Link href="/dpa" className="hover:underline underline-offset-4">
              DPA
            </Link>
          </nav>
        </div>
      </header>
      <main className="container mx-auto max-w-3xl px-6 py-12">
        {children}
      </main>
    </div>
  );
}
