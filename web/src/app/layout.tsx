import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "langprobe — the real debugger for agents",
  description:
    "Self-hosted LLM observability + eval-rigor + agent-replay. The debugger for AI agents.",
};

// Type system (DESIGN.md v4 / "Design System.dc.html"): Plus Jakarta Sans is the
// primary face for everything humans read; Geist Mono is reserved for machine
// values (ids, model names, durations, costs, config). Plus Jakarta Sans is a
// variable font, so we take its full weight range and expose it as --font-jakarta;
// globals.css consumes --font-jakarta / --font-geist-mono via --f-sans / --f-mono.
// Light is the only theme until dark is deliberately authored.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jakarta.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
