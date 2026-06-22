"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Intelligence" },
  { href: "/property", label: "Property" },
  { href: "/seo", label: "SEO" },
  { href: "/trend", label: "Trends" },
  { href: "/review", label: "Review" },
  { href: "/settings/prompts", label: "Prompts" },
  { href: "/settings/notebooklm", label: "NotebookLM" },
];

/** Top nav with active-route highlighting (so you always know where you are). */
export default function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-5 px-4 py-3 text-sm">
        <span className="font-semibold tracking-tight">DECODE</span>
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            aria-current={isActive(l.href) ? "page" : undefined}
            className={
              isActive(l.href)
                ? "font-medium text-white"
                : "text-neutral-400 hover:text-white"
            }
          >
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
