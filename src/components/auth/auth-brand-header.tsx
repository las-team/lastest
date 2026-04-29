import Link from 'next/link';

export function AuthBrandHeader({
  title,
  description,
}: {
  title: string;
  description: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center space-y-4 text-center">
      <Link href="/" aria-label="Lastest home" className="inline-flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icon-light.svg"
          alt=""
          width={40}
          height={40}
          className="block dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icon-dark.svg"
          alt=""
          width={40}
          height={40}
          className="hidden dark:block"
        />
        <span className="text-xl font-semibold tracking-tight">Lastest</span>
      </Link>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
