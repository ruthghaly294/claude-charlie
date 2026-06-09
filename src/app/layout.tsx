import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DECODE — Intelligence OS",
  description: "Discover → Curate → Observe → Decide → Execute → Feedback",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <nav className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-5 px-6 py-3 text-sm">
            <span className="font-semibold tracking-tight">DECODE</span>
            <a href="/" className="text-neutral-400 hover:text-white">
              Intelligence
            </a>
            <a href="/property" className="text-neutral-400 hover:text-white">
              Property
            </a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
