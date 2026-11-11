"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Footer } from "./Shell";
import { Masthead } from "./Masthead";
import { Icon } from "./ui";

export function DashboardLayout({ title, nav, children }: { title: string; nav: [string, string, string][]; children: ReactNode }) {
  const path = usePathname();
  return (
    <>
      <Masthead />
      <div className="max-w-[1400px] mx-auto px-margin md:px-margin-desktop py-space-lg grid grid-cols-1 md:grid-cols-[220px_1fr] gap-space-lg min-h-[70vh]">
        <nav aria-label={title} className="bg-surface-card rounded-xl shadow-sm p-space-sm flex md:flex-col gap-space-xs overflow-x-auto h-fit min-w-0">
          <p className="hidden md:block px-space-sm py-space-xs font-label-sm text-label-sm text-text-secondary uppercase">{title}</p>
          {nav.map(([href, label, icon]) => (
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined}
              className={`flex items-center gap-space-xs px-space-sm py-2 rounded-lg whitespace-nowrap font-label-md text-label-md ${path === href ? "bg-secondary/10 text-secondary" : "text-text-primary hover:bg-surface-container-low"}`}>
              <Icon name={icon} className="text-[20px]" />{label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0">{children}</main>
      </div>
      <Footer />
    </>
  );
}
