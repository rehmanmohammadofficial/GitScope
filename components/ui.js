"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copy", className = "" }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  };
  return (
    <button type="button" className={`gs-copy ${done ? "is-done" : ""} ${className}`} onClick={copy} aria-label={`${label}: ${text}`}>
      {done ? "Copied" : label}
    </button>
  );
}

export function Skeleton({ lines = 3, tall = false }) {
  return (
    <div className={`gs-skel ${tall ? "gs-skel--tall" : ""}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => <span key={i} style={{ width: `${92 - i * 13}%` }} />)}
    </div>
  );
}

export function ErrorNote({ error, onRetry, title = "This section didn't load" }) {
  return (
    <div className="gs-error" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{error?.message || "Something went wrong."}</p>
      </div>
      {onRetry && <button type="button" className="gs-btn gs-btn--ghost" onClick={onRetry}>Retry</button>}
    </div>
  );
}

// Only shown by `npm run dev`, so you can copy a response into a bug report. Hidden in production builds.
export function RawJson({ data }) {
  if (!data || process.env.NODE_ENV === "production") return null;
  return (
    <details className="gs-raw">
      <summary>Raw response</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}

// Wraps one result section: title, loading / error states, and content.
export function Section({ id, title, lead, step, onRetry, children, raw, aside }) {
  const { status, error, note } = step;
  return (
    <section id={id} className="gs-section" aria-busy={status === "loading"}>
      <header className="gs-section__head">
        <div>
          <h2>{title}</h2>
          {lead && <p className="gs-lead">{lead}</p>}
        </div>
        {aside}
      </header>
      {status === "idle" && <p className="gs-muted gs-queued">Waiting for the previous step to finish…</p>}
      {status === "loading" && (
        <div className="gs-loading">
          <div className="gs-scanbar"><i /></div>
          <p>{note || "Reading the repository…"}</p>
          <Skeleton lines={4} tall />
        </div>
      )}
      {status === "error" && <ErrorNote error={error} onRetry={onRetry} />}
      {status === "ok" && <div className="gs-in">{children}</div>}
      {status === "ok" && <RawJson data={raw} />}
    </section>
  );
}
