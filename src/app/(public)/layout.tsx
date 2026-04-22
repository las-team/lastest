import type { ReactNode } from 'react';
import { Instrument_Serif } from 'next/font/google';

const instrumentSerif = Instrument_Serif({
  weight: ['400'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${instrumentSerif.variable} min-h-screen bg-background text-foreground`}>
      {children}
    </div>
  );
}
