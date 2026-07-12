import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { QueryProvider } from "@/components/providers/query-provider";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Agent Session Monitor",
  description: "Local Codex and Claude Code agent session monitor",
};

/**
 * The Astryx `ThemeProvider` is intentionally NOT mounted here. Its mode is driven by persisted
 * settings, whose single owner (`DashboardApp`) lives under this layout — so the provider is
 * mounted there, where it can be fed the stored theme. QueryProvider stays global because the
 * snapshot query has no such per-page ownership.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}>
      <body className={instrumentSans.className}>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
