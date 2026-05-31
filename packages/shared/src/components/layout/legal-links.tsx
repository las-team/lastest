import Link from "next/link";
import { cn } from "../../lib/utils";

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/dpa", label: "DPA" },
] as const;

export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav
      className={cn(
        "flex items-center gap-4 text-xs text-muted-foreground",
        className,
      )}
    >
      {LEGAL_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="hover:text-foreground hover:underline underline-offset-4"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
