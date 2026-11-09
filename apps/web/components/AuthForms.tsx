"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { apiStrict } from "@/lib/api";
import { login, register, setSession } from "@/lib/session";
import { btn, Icon, inputCls } from "./ui";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto bg-surface-card rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md">
      <div className="flex items-center gap-space-xs text-primary"><Icon name="storefront" className="text-secondary text-[28px]" /><span className="font-headline-lg text-headline-lg">Oja Market</span></div>
      <h1 className="font-headline-md text-headline-md text-text-primary">{title}</h1>
      {children}
    </div>
  );
}

function LoginInner() {
  const router = useRouter(); const params = useSearchParams();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const u = await login(email, password);
      router.push(params.get("next") ?? (u.role === "ADMIN" ? "/admin" : u.role === "VENDOR" ? "/seller" : "/orders"));
    } catch (err) { setError(err instanceof Error ? err.message : "Sign in failed"); setBusy(false); }
  }
  return (
    <Card title="Sign in">
      <form onSubmit={submit} className="flex flex-col gap-space-md">
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Email<input className={inputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Password<input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p role="alert" className="text-status-danger font-label-md text-label-md">{error}</p>}
        <button className={btn.primary} disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
      <p className="font-body-sm text-body-sm text-text-secondary">New here? <Link href="/register" className="text-secondary font-semibold">Create an account</Link></p>
    </Card>
  );
}
export const LoginForm = () => <Suspense><LoginInner /></Suspense>;

function RegisterInner() {
  const router = useRouter(); const params = useSearchParams();
  const asVendor = params.get("vendor") === "1";
  const [f, setF] = useState({ name: "", email: "", password: "", store: "" });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await register(f.name, f.email, f.password);
      if (asVendor) {
        const { getToken } = await import("@/lib/session");
        const r = await apiStrict<{ accessToken: string }>("/vendors/apply", { method: "POST", token: getToken(), body: JSON.stringify({ storeName: f.store }) });
        setSession(r.accessToken);
        router.push("/seller/onboarding");
      } else router.push("/");
    } catch (err) { setError(err instanceof Error ? err.message : "Registration failed"); setBusy(false); }
  }
  return (
    <Card title={asVendor ? "Open your store" : "Create your account"}>
      <form onSubmit={submit} className="flex flex-col gap-space-md">
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Full name<input className={inputCls} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        {asVendor && <label className="flex flex-col gap-1 font-label-sm text-label-sm">Store name<input className={inputCls} value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })} minLength={2} required /></label>}
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Email<input className={inputCls} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Password (8+ characters)<input className={inputCls} type="password" autoComplete="new-password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
        {error && <p role="alert" className="text-status-danger font-label-md text-label-md">{error}</p>}
        <button className={btn.primary} disabled={busy}>{busy ? "Creating..." : asVendor ? "Apply as vendor" : "Create account"}</button>
      </form>
      <p className="font-body-sm text-body-sm text-text-secondary">Already registered? <Link href="/login" className="text-secondary font-semibold">Sign in</Link></p>
    </Card>
  );
}
export const RegisterForm = () => <Suspense><RegisterInner /></Suspense>;
