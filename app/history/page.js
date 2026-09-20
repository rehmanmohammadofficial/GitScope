"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import PhysicsField from "../../components/PhysicsField";
import Reticle from "../../components/Reticle";

import {
  getHistory,
  deleteEntry,
  clearHistory,
  historyReady,
  searchHref,
} from "../../lib/history";

import "../gitscope.css";
import "./history.css";

// If PhysicsField or Reticle ever error on this page, set this to false.
const FX = true;

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "repo", label: "Repos" },
  { id: "search", label: "Searches" },
];

/* ---------- time helpers ---------- */

function relative(iso) {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function dayKey(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function groupByDay(rows) {
  const out = [];
  let current = null;
  for (const row of rows) {
    const key = dayKey(row.created_at);
    if (!current || current.key !== key) {
      current = { key, rows: [] };
      out.push(current);
    }
    current.rows.push(row);
  }
  return out;
}

/* ---------- rows ---------- */

function Chip({ children, tone }) {
  return <span className={`hs-chip${tone ? ` hs-chip-${tone}` : ""}`}>{children}</span>;
}

function RepoRow({ row, onRerun, onDelete }) {
  const m = row.meta || {};
  return (
    <li className="hs-row">
      <span className="hs-mark hs-mark-repo" aria-hidden="true" />
      <div className="hs-body">
        <div className="hs-head">
          <a
            className="hs-title"
            href={m.url || `https://github.com/${row.title}`}
            target="_blank"
            rel="noreferrer"
          >
            {row.title}
          </a>
          <time className="hs-time" dateTime={row.created_at} title={new Date(row.created_at).toLocaleString()}>
            {relative(row.created_at)}
          </time>
        </div>
        {row.subtitle ? <p className="hs-sub">{row.subtitle}</p> : null}
        <div className="hs-chips">
          <Chip>analyzed</Chip>
          {m.skillLevel ? <Chip>{m.skillLevel}</Chip> : null}
          {m.language ? <Chip>{m.language}</Chip> : null}
          {typeof m.moduleCount === "number" ? (
            <Chip>{m.moduleCount} modules</Chip>
          ) : null}
          {typeof m.issueCount === "number" ? (
            <Chip>{m.issueCount} issues</Chip>
          ) : null}
          {m.aiUsed === false ? <Chip tone="warn">structure only</Chip> : null}
        </div>
      </div>
      <div className="hs-actions">
        <button className="hs-btn" onClick={() => onRerun(row.title)}>
          Analyze again
        </button>
        <button className="hs-remove" onClick={() => onDelete(row.id)} title="Remove from history">
          Remove
        </button>
      </div>
    </li>
  );
}

function SearchRow({ row, onRerun, onDelete }) {
  const m = row.meta || {};
  const labels = Array.isArray(m.labels) ? m.labels : [];
  return (
    <li className="hs-row">
      <span className="hs-mark hs-mark-search" aria-hidden="true" />
      <div className="hs-body">
        <div className="hs-head">
          <span className="hs-title hs-title-plain">{row.title}</span>
          <time className="hs-time" dateTime={row.created_at} title={new Date(row.created_at).toLocaleString()}>
            {relative(row.created_at)}
          </time>
        </div>
        <div className="hs-chips">
          <Chip>searched</Chip>
          {labels.map((l) => (
            <Chip key={l}>{l}</Chip>
          ))}
          {m.minStars ? <Chip>{m.minStars}+ stars</Chip> : null}
          {typeof m.resultCount === "number" ? (
            <Chip tone="quiet">{m.resultCount} found</Chip>
          ) : null}
        </div>
      </div>
      <div className="hs-actions">
        <button className="hs-btn" onClick={() => onRerun(searchHref(m))}>
          Run it again
        </button>
        <button className="hs-remove" onClick={() => onDelete(row.id)} title="Remove from history">
          Remove
        </button>
      </div>
    </li>
  );
}

/* ---------- page ---------- */

export default function HistoryPage() {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error | signedOut
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async (kind) => {
    setStatus("loading");
    setError("");
    try {
      const data = await getHistory({ kind });
      setRows(data);
      setStatus("ready");
    } catch (e) {
      if (e?.code === "NO_SESSION") {
        setStatus("signedOut");
        return;
      }
      setError(e?.message || "Could not load your history.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const handleDelete = async (id) => {
    const before = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      await deleteEntry(id);
    } catch (e) {
      setRows(before);
      setError(e?.message || "Could not remove that entry.");
    }
  };

  const handleClear = async () => {
    const before = rows;
    setRows([]);
    setConfirming(false);
    try {
      await clearHistory();
    } catch (e) {
      setRows(before);
      setError(e?.message || "Could not clear your history.");
    }
  };

  const groups = groupByDay(rows);

  return (
    <div className="gs-root">
      {FX ? (
        <>
          <PhysicsField />
          <Reticle />
        </>
      ) : null}

      <div className="hs-page">
        <header className="hs-nav">
          <Link className="hs-brand" href="/">
            GitScope
          </Link>
          <nav className="hs-links">
            <Link href="/">Analyze</Link>
            <Link href="/discover">Discover</Link>
            <span className="hs-here">History</span>
          </nav>
        </header>

        <div className="hs-top">
          <h1 className="hs-h1">Where you&apos;ve been</h1>
          <p className="hs-lede">
            Every repo you analyzed and every search you ran, kept on your account.
          </p>
        </div>

        <div className="hs-bar">
          <div className="hs-filters" role="tablist" aria-label="Filter history">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                className={`hs-filter${filter === f.id ? " hs-filter-on" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {rows.length > 0 && status === "ready" ? (
            confirming ? (
              <div className="hs-confirm">
                <span>Delete all {rows.length}?</span>
                <button className="hs-danger" onClick={handleClear}>
                  Delete
                </button>
                <button className="hs-remove" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button className="hs-remove" onClick={() => setConfirming(true)}>
                Clear history
              </button>
            )
          ) : null}
        </div>

        {!historyReady() ? (
          <div className="hs-note">
            Supabase is not connected. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code>, then
            restart the dev server.
          </div>
        ) : null}

        {status === "loading" ? (
          <ul className="hs-list">
            {[0, 1, 2].map((i) => (
              <li key={i} className="hs-row hs-skeleton" aria-hidden="true">
                <span className="hs-mark" />
                <div className="hs-body">
                  <div className="hs-bone hs-bone-lg" />
                  <div className="hs-bone hs-bone-sm" />
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {status === "signedOut" ? (
          <div className="hs-empty">
            <h2>Sign in to keep your history</h2>
            <p>Your activity is saved to your account, so it follows you between devices.</p>
            <Link className="hs-btn hs-btn-lead" href="/login">
              Sign in
            </Link>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="hs-empty hs-empty-error">
            <h2>That didn&apos;t load</h2>
            <p>{error}</p>
            <button className="hs-btn hs-btn-lead" onClick={() => load(filter)}>
              Try again
            </button>
          </div>
        ) : null}

        {status === "ready" && rows.length === 0 ? (
          <div className="hs-empty">
            <h2>Nothing here yet</h2>
            <p>Analyze a repository or browse Discover, and it will show up here.</p>
            <div className="hs-empty-actions">
              <Link className="hs-btn hs-btn-lead" href="/">
                Analyze a repo
              </Link>
              <Link className="hs-btn" href="/discover">
                Browse Discover
              </Link>
            </div>
          </div>
        ) : null}

        {status === "ready" && rows.length > 0
          ? groups.map((group) => (
              <section className="hs-group" key={group.key}>
                <h2 className="hs-day">{group.key}</h2>
                <ul className="hs-list">
                  {group.rows.map((row) =>
                    row.kind === "search" ? (
                      <SearchRow
                        key={row.id}
                        row={row}
                        onRerun={(href) => router.push(href)}
                        onDelete={handleDelete}
                      />
                    ) : (
                      <RepoRow
                        key={row.id}
                        row={row}
                        onRerun={(fullName) =>
                          router.push(`/?repo=${encodeURIComponent(fullName)}`)
                        }
                        onDelete={handleDelete}
                      />
                    )
                  )}
                </ul>
              </section>
            ))
          : null}

        {error && status === "ready" ? <div className="hs-note">{error}</div> : null}
      </div>
    </div>
  );
}
