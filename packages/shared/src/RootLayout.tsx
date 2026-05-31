import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import "@lastest/shared/globals.css";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "sonner";
import { UmamiScript } from "./components/analytics/umami-script";
import { CookieNotice } from "./components/layout/cookie-notice-client";

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
        {process.env.NODE_ENV !== "production" && (
          // Swallow react-dom@19.2.x dev-only bug: logComponentErrored calls
          // performance.measure() without the endTime>startTime guard its siblings have,
          // and async-server-component error paths (e.g. Next's redirect()) can produce
          // negative durations. Drop only that specific DOMException.
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{
              __html: `(()=>{const o=performance.measure.bind(performance);performance.measure=function(){try{return o.apply(performance,arguments)}catch(e){if(e&&typeof e.message==='string'&&e.message.indexOf('negative time stamp')!==-1)return;throw e}};})();`,
            }}
          />
        )}
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
