"use client";

/** Last resort: the root layout itself failed. Must render its own <html>/<body>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <div role="alert">
          <h1>The app could not load</h1>
          <p>Please try again. {error.digest ? `Reference: ${error.digest}` : ""}</p>
          <button onClick={reset} style={{ padding: "0.5rem 1rem" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
