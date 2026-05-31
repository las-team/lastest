import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import "@lastest/shared/globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { UmamiScript } from "@/components/analytics/umami-script";
import { CookieNotice } from "@/components/layout/cookie-notice-client";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  ),
  title: "Lastest - Visual Regression Testing",
  description: "AI-powered visual regression testing tool",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icon-light.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "Lastest - Visual Regression Testing",
    description: "AI-powered visual regression testing tool",
    images: [
      { url: "/og-image.png", width: 1200, height: 630, alt: "Lastest" },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lastest - Visual Regression Testing",
    description: "AI-powered visual regression testing tool",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
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
