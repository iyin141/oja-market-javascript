"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import type { Me } from "@/lib/session";
import { useAuth } from "@/lib/useAuth";
import { Shell } from "./Shell";
import { btn, Icon } from "./ui";

type Role = Me["role"];

/** Signed-out message with a sign-in link that returns to `next`. */
export function SignInPrompt({ next, text = "Sign in to see this page." }: { next: string; text?: string }) {
  return (
    <div className="max-w-md mx-auto bg-surface-card rounded-xl shadow-sm p-space-lg flex flex-col items-center gap-space-sm text-center">
      <Icon name="lock" className="text-[40px] text-secondary" />
      <p className="font-body-md text-body-md text-text-primary">{text}</p>
      <Link href={`/login?next=${encodeURIComponent(next)}`} className={btn.primary}>Sign in</Link>
    </div>
  );
}

/**
 * Gate for role-only areas (/seller, /admin, /agent). Signed out -> redirect to /login?next=<path>.
 * Wrong role -> a clear "not allowed" screen. The API still enforces roles on every call; this only avoids showing an empty or fake area.
 */
export function RoleGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { user, ready } = useAuth();
  useEffect(() => { if (ready && !user) router.replace(`/login?next=${encodeURIComponent(path)}`); }, [ready, user, path, router]);
  if (!ready || !user) return <Shell><p role="status" className="text-text-secondary">{ready ? "Redirecting to sign in..." : "Loading..."}</p></Shell>;
  if (!roles.includes(user.role)) {
    return (
      <Shell wide={false}>
        <div role="alert" className="bg-surface-card rounded-xl shadow-sm p-space-lg text-center flex flex-col items-center gap-space-sm">
          <Icon name="block" className="text-[40px] text-status-danger" />
          <h1 className="font-headline-md text-headline-md">You are not allowed here</h1>
          <p className="font-body-sm text-body-sm text-text-secondary">This area is for {roles.map((r) => r.toLowerCase()).join(" / ")} accounts. You are signed in as a {user.role.toLowerCase()}.</p>
          <Link href="/" className={btn.primary}>Back to the shop</Link>
        </div>
      </Shell>
    );
  }
  return <>{children}</>;
}
