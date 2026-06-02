import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "sonner";
import { UmamiScript } from "./components/analytics/umami-script";
import { CookieNotice } from "./components/layout/cookie-notice-client";
import { DevPerformancePolyfill } from "./components/dev-performance-polyfill";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <DevPerformancePolyfill nonce={nonce} />
        <TooltipProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
        <CookieNotice />
        <UmamiScript nonce={nonce} />
      </body>
    </html>
  );
}
