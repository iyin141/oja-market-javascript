"use client";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Centered animated modal (fade + blurred backdrop, panel slides up), modelled on the CrowdFund edit modal.
 * Replaces window.alert / confirm / prompt. Styles live in modal.css (shared class names, per-app tokens).
 * Escape and backdrop click close it; focus moves into the panel and is restored on close; page scroll is locked.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** red banner at the top of the body, e.g. an API error */
  error?: string;
  size?: "sm" | "md" | "lg";
  /** disable Escape / backdrop close while a request is running */
  busy?: boolean;
}

const EXIT_MS = 200;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, subtitle, children, footer, error, size = "md", busy = false }: ModalProps) {
  const [mounted, setMounted] = useState(false); // portal target exists (client only)
  const [render, setRender] = useState(open); // stay in the DOM during the exit animation
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) { setRender(true); setClosing(false); return; }
    if (!render) return;
    setClosing(true);
    const t = setTimeout(() => { setRender(false); setClosing(false); }, EXIT_MS);
    return () => clearTimeout(t);
  }, [open, render]);

  // focus management + scroll lock while visible
  useEffect(() => {
    if (!render || !open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus],input,textarea,select") ?? panel.current;
    first?.focus();
    return () => { document.body.style.overflow = prev; opener.current?.focus?.(); };
  }, [render, open]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !busy) { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !panel.current) return;
    const els = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [busy, onClose]);

  if (!mounted || !render) return null;
  return createPortal(
    <div className={`modal-root${closing ? " is-closing" : ""}`} onKeyDown={onKey}>
      <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }} aria-hidden="true" />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal-panel modal-${size}`}>
        <div className="modal-header">
          <div>
            <h2 id={titleId} className="modal-title">{title}</h2>
            {subtitle && <p className="modal-sub">{subtitle}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">
          {error && <div role="alert" className="modal-error">{error}</div>}
          {children}
        </div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Replacement for window.confirm. */
export function ConfirmModal({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "primary", busy, error, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm" busy={busy} error={error}
      footer={<>
        <button type="button" className="modal-btn modal-btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button type="button" data-autofocus className={`modal-btn ${tone === "danger" ? "modal-btn-danger" : "modal-btn-primary"}`} onClick={onConfirm} disabled={busy}>{busy ? "Working..." : confirmLabel}</button>
      </>}>
      <div className="modal-text">{message}</div>
    </Modal>
  );
}

export interface FormModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  submitLabel?: string;
  busy?: boolean;
  error?: string;
  children: ReactNode;
  onSubmit: () => void;
  onClose: () => void;
}

/** Replacement for window.prompt: a labelled form. Fields are plain children using the .modal-field / .modal-input classes. */
export function FormModal({ open, title, subtitle, submitLabel = "Save", busy, error, children, onSubmit, onClose }: FormModalProps) {
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(); };
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} busy={busy} error={error}
      footer={<>
        <button type="button" className="modal-btn modal-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form="modal-form" className="modal-btn modal-btn-primary" disabled={busy}>{busy ? "Working..." : submitLabel}</button>
      </>}>
      <form id="modal-form" onSubmit={submit} className="modal-form">{children}</form>
    </Modal>
  );
}

/** Labelled field wrapper for FormModal. */
export function ModalField({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="modal-field">
      <span className="modal-label">{label}</span>
      {children}
      {hint && !error && <span className="modal-hint">{hint}</span>}
      {error && <span className="modal-field-error">{error}</span>}
    </label>
  );
}
