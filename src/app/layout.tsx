import type { Metadata, Viewport } from "next";
import "@lastest/shared/globals.css";
import { RootLayout } from "@lastest/shared";

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

export default RootLayout;
