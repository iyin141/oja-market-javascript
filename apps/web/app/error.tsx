"use client";
import { useEffect } from "react";

/** Route-level error boundary: a render or data error shows this instead of a blank page; "Try again" re-renders the segment. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md py-16 px-4 text-center">
      <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
      <p className="mb-6 opacity-80">The page hit an unexpected error. Your data is safe. Try again, and if it keeps happening, reload the page.</p>
      {error.digest && <p className="mb-4 text-xs opacity-60">Reference: {error.digest}</p>}
      <div className="flex justify-center gap-3">
        <button onClick={reset} className="rounded-lg bg-blue-600 px-4 py-2 text-white">Try again</button>
        <a href="/" className="rounded-lg border px-4 py-2">Go home</a>
      </div>
    </div>
  );
}
