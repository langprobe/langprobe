import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tracebility — the real debugger for agents",
  description:
    "Self-hosted LLM observability + eval-rigor + agent-replay. The debugger for AI agents.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Boot dark per DESIGN.md (product default). User toggle persists later.
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
