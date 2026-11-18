"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { apiStrict } from "@/lib/api";
import { getUser, login, register, setSession } from "@/lib/session";
import { btn, Icon, inputCls } from "./ui";

function PwInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <input {...props} className={`${inputCls} pr-10`} type={show ? "text" : "password"} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 px-3 flex items-center text-text-secondary hover:text-text-primary">
        <Icon name={show ? "visibility_off" : "visibility"} className="text-[20px]" />
      </button>
    </span>
  );
}

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
      const next = params.get("next"); // only same-site paths: a "//host" or "https://" value would be an open redirect
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : u.role === "ADMIN" ? "/admin" : u.role === "VENDOR" ? "/seller" : u.role === "AGENT" ? "/agent" : "/orders");
    } catch (err) { setError(err instanceof Error ? err.message : "Sign in failed"); setBusy(false); }
  }
  return (
    <Card title="Sign in">
      <form onSubmit={submit} className="flex flex-col gap-space-md">
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Email<input className={inputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Password<PwInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <Link href="/forgot-password" className="self-end font-label-sm text-label-sm text-secondary">Forgot password?</Link>
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
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { setSignedIn(!!getUser()); }, []);
  const existing = asVendor && signedIn; // signed-in customer opening a store: only the store name is needed
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (!existing) await register(f.name, f.email, f.password);
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
        {!existing && <label className="flex flex-col gap-1 font-label-sm text-label-sm">Full name<input className={inputCls} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>}
        {asVendor && <label className="flex flex-col gap-1 font-label-sm text-label-sm">Store name<input className={inputCls} value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })} minLength={2} required /></label>}
        {!existing && <><label className="flex flex-col gap-1 font-label-sm text-label-sm">Email<input className={inputCls} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
        <label className="flex flex-col gap-1 font-label-sm text-label-sm">Password (8+ characters)<PwInput autoComplete="new-password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label></>}
        {error && <p role="alert" className="text-status-danger font-label-md text-label-md">{error}</p>}
        <button className={btn.primary} disabled={busy}>{busy ? "Creating..." : asVendor ? "Apply as vendor" : "Create account"}</button>
      </form>
      <p className="font-body-sm text-body-sm text-text-secondary">Already registered? <Link href="/login" className="text-secondary font-semibold">Sign in</Link></p>
    </Card>
  );
}
export const RegisterForm = () => <Suspense><RegisterInner /></Suspense>;

function ForgotInner() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await apiStrict("/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }); setSent(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not send the email"); }
    setBusy(false);
  }
  return (
    <Card title="Forgot your password?">
      {sent ? <p role="status" className="font-body-sm text-body-sm text-text-primary">If an account exists for {email}, we have sent a link to reset the password. It may take a few minutes to arrive.</p> : (
        <form onSubmit={submit} className="flex flex-col gap-space-md">
          <p className="font-body-sm text-body-sm text-text-secondary">Enter your email and we will send you a reset link.</p>
          <label className="flex flex-col gap-1 font-label-sm text-label-sm">Email<input className={inputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          {error && <p role="alert" className="text-status-danger font-label-md text-label-md">{error}</p>}
          <button className={btn.primary} disabled={busy}>{busy ? "Sending..." : "Send reset link"}</button>
        </form>
      )}
      <p className="font-body-sm text-body-sm text-text-secondary"><Link href="/login" className="text-secondary font-semibold">Back to sign in</Link></p>
    </Card>
  );
}
export const ForgotForm = () => <Suspense><ForgotInner /></Suspense>;

function ResetInner() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState(""); const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (password !== again) { setError("The two passwords do not match."); return; }
    setBusy(true);
    try { await apiStrict("/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }); setDone(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not reset the password"); }
    setBusy(false);
  }
  if (!token) return <Card title="Reset link problem"><p role="alert" className="text-status-danger">This reset link is missing its token. Request a new one.</p><Link href="/forgot-password" className={btn.primary}>Request a new link</Link></Card>;
  return (
    <Card title="Choose a new password">
      {done ? <><p role="status" className="text-status-success font-label-md">Your password was changed.</p><Link href="/login" className={btn.primary}>Sign in</Link></> : (
        <form onSubmit={submit} className="flex flex-col gap-space-md">
          <label className="flex flex-col gap-1 font-label-sm text-label-sm">New password (8+ characters)<PwInput autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <label className="flex flex-col gap-1 font-label-sm text-label-sm">Repeat new password<PwInput autoComplete="new-password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
          {error && <p role="alert" className="text-status-danger font-label-md text-label-md">{error} {/expired|invalid/i.test(error) && <Link href="/forgot-password" className="underline">Request a new link</Link>}</p>}
          <button className={btn.primary} disabled={busy}>{busy ? "Saving..." : "Change password"}</button>
        </form>
      )}
    </Card>
  );
}
export const ResetForm = () => <Suspense><ResetInner /></Suspense>;
