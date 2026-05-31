import { Inter, JetBrains_Mono } from "next/font/google";
import "@lastest/shared/globals.css";
//import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        {/* <TooltipProvider> */}
        {children}
        <Toaster richColors position="bottom-right" />
        {/* </TooltipProvider> */}
      </body>
    </html>
  );
}
