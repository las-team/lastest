import { cn } from '@/lib/utils';

interface BrowserIconProps {
  browser: string;
  className?: string;
}

function ChromiumIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="currentColor" opacity="0.15" />
      <path d="M24 14.4a9.6 9.6 0 0 1 8.314 4.8H13.686A9.6 9.6 0 0 1 24 14.4Z" fill="currentColor" opacity="0.4" />
      <path d="M13.686 19.2 8.844 10.8a22 22 0 0 0-2.4 13.2l4.842-4.8Z" fill="currentColor" opacity="0.3" />
      <path d="M8.844 10.8l4.842 8.4a9.6 9.6 0 0 0-.486 4.8L5.444 24A21.6 21.6 0 0 1 8.844 10.8Z" fill="currentColor" opacity="0.25" />
      <path d="M13.2 24a9.6 9.6 0 0 0 .486 4.8l-8.242 4.8A21.6 21.6 0 0 1 5.444 24h7.756Z" fill="currentColor" opacity="0.25" />
      <path d="M13.686 28.8l-8.242 4.8A21.6 21.6 0 0 0 24 46.4V33.6a9.6 9.6 0 0 1-10.314-4.8Z" fill="currentColor" opacity="0.35" />
      <path d="M24 33.6V46.4a21.6 21.6 0 0 0 18.556-10.8l-8.242-4.8A9.6 9.6 0 0 1 24 33.6Z" fill="currentColor" opacity="0.35" />
      <path d="M34.314 28.8l8.242 4.8A21.6 21.6 0 0 0 45.556 24h-7.756a9.6 9.6 0 0 1-3.486 4.8Z" fill="currentColor" opacity="0.3" />
      <path d="M37.8 24h7.756a21.6 21.6 0 0 0-2.4-13.2l-8.842 8.4a9.6 9.6 0 0 1 3.486 4.8Z" fill="currentColor" opacity="0.3" />
      <path d="M34.314 19.2l8.842-8.4A21.6 21.6 0 0 0 24 1.6v12.8a9.6 9.6 0 0 1 10.314 4.8Z" fill="currentColor" opacity="0.4" />
      <path d="M24 1.6A21.6 21.6 0 0 0 8.844 10.8l4.842 8.4A9.6 9.6 0 0 1 24 14.4V1.6Z" fill="currentColor" opacity="0.4" />
      <circle cx="24" cy="24" r="8" fill="white" />
      <circle cx="24" cy="24" r="6.4" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function FirefoxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="currentColor" opacity="0.15" />
      <path d="M38 16c-1-3-3.5-5.5-5-6.5.8 2 1 3.5.8 5-1.5-3-4-5-7-8-.5-.4-1-.9-1-1.5 0 0-3 2-3.5 7-.5 3.5 1 6 3 8.5-2-1-4.5-1-6 .5 1.5 1 2.5 3 2.5 5.5 0 3 2 5.5 4.5 6.5 4 1.5 8 0 9.5-3 .5-1 .8-2.2.8-3.5 0-3-2-5.5-3.5-7 3 1 5.5 3.5 6 6.5.5-2 .5-5-.3-7.5-.5-2-1.5-3.8-1-5z" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function SafariIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="currentColor" opacity="0.15" />
      <polygon points="24,8 27,24 24,40" fill="currentColor" opacity="0.5" />
      <polygon points="24,8 21,24 24,40" fill="currentColor" opacity="0.25" />
      <polygon points="8,24 24,21 40,24" fill="currentColor" opacity="0.4" />
      <polygon points="8,24 24,27 40,24" fill="currentColor" opacity="0.2" />
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => (
        <line
          key={deg}
          x1="24"
          y1="4"
          x2="24"
          y2="6.5"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.4"
          transform={`rotate(${deg} 24 24)`}
        />
      ))}
      <circle cx="24" cy="24" r="2.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

export function BrowserIcon({ browser, className }: BrowserIconProps) {
  const cls = cn('w-4 h-4', className);

  switch (browser) {
    case 'firefox':
      return <FirefoxIcon className={cls} />;
    case 'webkit':
      return <SafariIcon className={cls} />;
    default:
      return <ChromiumIcon className={cls} />;
  }
}
