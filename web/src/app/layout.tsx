import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "langprobe — the real debugger for agents",
  description:
    "Self-hosted LLM observability + eval-rigor + agent-replay. The debugger for AI agents.",
};

// Geist exposes CSS variables via .variable (--font-geist-sans / --font-geist-mono).
// globals.css consumes them as --f-sans / --f-mono. Mock-as-truth (DESIGN.md v2):
// light is the only theme until dark is deliberately authored.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
