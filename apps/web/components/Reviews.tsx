"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, apiStrict } from "@/lib/api";
import { getToken } from "@/lib/session";
import type { Review } from "@/lib/types";
import { useAuth } from "@/lib/useAuth";
import { SignInPrompt } from "./RoleGuard";
import { btn, Icon, inputCls, StarRating } from "./ui";

/** Review list (public) and, for signed-in customers, a form. The API decides who may review (delivered order, one review per product). */
export function Reviews({ productId, path }: { productId: string; path: string }) {
  const { user } = useAuth();
  const [list, setList] = useState<Review[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api<Review[]>(`/products/${productId}/reviews?limit=20`, []);
    setList(r.data); setFailed(!r.live);
  }, [productId]);
  useEffect(() => { void load(); }, [load]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      await apiStrict(`/products/${productId}/reviews`, { method: "POST", token: getToken(), body: JSON.stringify({ rating, body: body.trim() }) });
      setDone(true); setBody(""); void load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not post your review"); }
    setBusy(false);
  }
  return (
    <div className="flex flex-col gap-space-md">
      {list === null && <p role="status" className="text-text-secondary">Loading reviews...</p>}
      {failed && <p role="alert" className="text-status-danger font-body-sm">Reviews could not be loaded right now.</p>}
      {list && !failed && list.length === 0 && <p className="font-body-sm text-body-sm text-text-secondary">No reviews yet.</p>}
      <ul className="flex flex-col gap-space-sm">
        {(list ?? []).map((r) => (
          <li key={r.id} className="bg-surface-container-low rounded-lg p-space-sm flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-space-sm"><StarRating value={r.rating} /><span className="font-label-sm text-label-sm text-text-primary">{r.authorName}</span><span className="font-caption text-caption text-text-secondary">{new Date(r.createdAt).toLocaleDateString()}</span></div>
            {r.title && <p className="font-label-md text-label-md">{r.title}</p>}
            {r.body && <p className="font-body-sm text-body-sm text-text-primary whitespace-pre-line">{r.body}</p>}
          </li>
        ))}
      </ul>
      <div className="border-t border-border-subtle pt-space-md">
        <h3 className="font-title-sm text-title-sm mb-space-xs">Write a review</h3>
        {!user ? <SignInPrompt next={path} text="Sign in to review this product. Only buyers with a delivered order can." /> : done ? (
          <p role="status" className="text-status-success font-label-md">Thanks, your review was posted.</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-space-sm max-w-lg">
            <p className="font-caption text-caption text-text-secondary">Only verified buyers with a delivered order can review this product.</p>
            <div role="radiogroup" aria-label="Rating" className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRating(n)}>
                  <Icon name="star" className={`text-[28px] ${n <= rating ? "text-status-warning" : "text-surface-container-highest"}`} />
                </button>
              ))}
            </div>
            <textarea className={inputCls} rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did you think? (optional)" aria-label="Review text" />
            {err && <p role="alert" className="text-status-danger font-label-md">{err}</p>}
            <button className={`${btn.primary} self-start`} disabled={busy}>{busy ? "Posting..." : "Post review"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
