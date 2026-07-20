import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoLens: Find repository gaps and useful contributions.",
  description:
    "Audit a public GitHub repository for evidence-backed gaps, possibly unreferenced files, and actionable contribution opportunities.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
