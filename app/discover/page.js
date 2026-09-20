"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { callApi } from "../../components/api";
import PhysicsField from "../../components/PhysicsField";
import Reticle from "../../components/Reticle";
import { Magnetic, ReactiveText } from "../../components/fx";
import "../gitscope.css";
import "./discover.css";
import { logDiscoverSearch } from "../../lib/history";

const LANGUAGES = [
  "JavaScript", "TypeScript", "Python", "Java", "Go", "Rust", "C++", "C#", "C", "PHP", "Ruby", "Swift",
  "Kotlin", "Dart", "Scala", "Shell", "Lua", "Elixir", "Haskell", "R", "HTML", "CSS", "Vue", "Jupyter Notebook",
];

const LABEL_CHIPS = [
  { id: "good first issue", title: "Good first issue", hint: "Made for beginners", color: "#6FE3B5" },
  { id: "help wanted", title: "Help wanted", hint: "Maintainers ask the community for help", color: "#62C8FF" },
  { id: "first-timers-only", title: "First-timers only", hint: "For your very first contribution", color: "#B58CFF" },
  { id: "documentation", title: "Documentation", hint: "Often an easier first contribution", color: "#FFB240" },
];

const STAR_OPTIONS = [
  { v: 0, t: "Any size" },
  { v: 10, t: "10+ stars" },
  { v: 100, t: "100+ stars" },
  { v: 1000, t: "1,000+ stars" },
];

const SORTS = [
  { id: "issues", t: "Most beginner issues" },
  { id: "stars", t: "Most stars" },
  { id: "active", t: "Recently active" },
];

const LANG_DOT = { JavaScript: "#F1E05A", TypeScript: "#3178C6", Python: "#3572A5", Java: "#B07219", Go: "#00ADD8", Rust: "#DEA584", "C++": "#F34B7D", "C#": "#178600", C: "#7A7A7A", PHP: "#4F5D95", Ruby: "#CC342D", Swift: "#F05138", Kotlin: "#A97BFF", Dart: "#00B4AB" };

const fmtNum = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n ?? 0));

// Reading these once as lazy initial state (instead of a useEffect) means a
// link from the History page ("Run it again") pre-fills the filters and
// fires exactly one search, not a default search followed by a second one.
function fromUrl(key) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}
const initLanguage = () => fromUrl("language") ?? "JavaScript";
const initLabels = () => {
  const raw = fromUrl("labels");
  if (!raw) return ["good first issue"];
  const arr = raw.split(",").filter(Boolean);
  return arr.length ? arr : ["good first issue"];
};
const initMinStars = () => {
  const raw = fromUrl("minStars");
  return raw !== null ? Number(raw) : 10;
};

function timeAgo(iso) {
  if (!iso) return "";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function mergeRepos(prev, next) {
  const map = new Map(prev.map((r) => [r.fullName, { ...r, issues: [...r.issues] }]));
  for (const r of next) {
    const cur = map.get(r.fullName);
    if (!cur) { map.set(r.fullName, r); continue; }
    const seen = new Set(cur.issues.map((i) => i.url));
    for (const i of r.issues) if (!seen.has(i.url)) cur.issues.push(i);
    cur.matchCount += r.matchCount;
  }
  return [...map.values()];
}

function RepoCard({ r }) {
  const [all, setAll] = useState(false);
  const shown = all ? r.issues : r.issues.slice(0, 3);
  const hidden = r.issues.length - shown.length;
  return (
    <article className="dc-card">
      <header className="dc-card__head">
        <a className="dc-name" href={r.url} target="_blank" rel="noreferrer" title="Open on GitHub">
          <span>{r.owner}/</span><b>{r.name}</b>
        </a>
        <span className="dc-count" title="Open, unassigned issues with your labels, updated in the last 45 days">
          {r.matchCount} open {r.matchCount === 1 ? "issue" : "issues"}
        </span>
      </header>

      <p className="dc-desc">{r.description || "No description provided."}</p>

      <ul className="dc-meta">
        <li>★ {fmtNum(r.stars)}</li>
        {r.language && <li><i style={{ background: LANG_DOT[r.language] || "#9AA3D6" }} />{r.language}</li>}
        <li>Pushed {timeAgo(r.pushedAt)}</li>
        {r.license && <li>{r.license}</li>}
        {r.hasContributing && <li className="dc-pill">Contributing guide</li>}
      </ul>

      <ul className="dc-issues">
        {shown.map((i) => (
          <li key={i.url}>
            <a href={i.url} target="_blank" rel="noreferrer">
              <span className="dc-issue__t">{i.title}</span>
              <span className="dc-issue__m">
                #{i.number} · {i.comments === 0 ? "no comments yet" : `${i.comments} comment${i.comments === 1 ? "" : "s"}`} · updated {timeAgo(i.updatedAt)}
              </span>
            </a>
            <span className="dc-labels">{i.labels.slice(0, 3).map((l) => <em key={l}>{l}</em>)}</span>
          </li>
        ))}
      </ul>

      <footer className="dc-card__foot">
        {hidden > 0 ? <button type="button" className="dc-link" onClick={() => setAll(true)}>Show {hidden} more issue{hidden === 1 ? "" : "s"}</button> : <span />}
        <Magnetic><Link className="dc-btn" href={`/?repo=${encodeURIComponent(r.fullName)}`}>Analyze with GitScope →</Link></Magnetic>
      </footer>
    </article>
  );
}

export default function DiscoverPage() {
  const [language, setLanguage] = useState(initLanguage);
  const [labels, setLabels] = useState(initLabels);
  const [minStars, setMinStars] = useState(initMinStars);
  const [sort, setSort] = useState("issues");

  const [repos, setRepos] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [burst, setBurst] = useState(0);
  const reqId = useRef(0);
  const labelKey = labels.join("|");

  const search = useCallback(async () => {
    const id = ++reqId.current;
    setStatus("loading");
    setError("");
    setMoreError("");
    try {
      const res = await callApi("discover", { language, labels: labelKey.split("|"), minStars }, {});
      if (id !== reqId.current) return;
      setRepos(res?.repos || []);
      setHasMore(Boolean(res?.hasMore));
      setCursor(res?.cursor || null);
      setStatus("ok");
      setBurst((b) => b + 1);
      logDiscoverSearch({ language, labels: labelKey.split("|"), minStars, resultCount: res?.repos?.length });
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e?.message || "Could not load repositories.");
      setStatus("error");
    }
  }, [language, labelKey, minStars]);

  useEffect(() => { search(); }, [search]);

  const clearedUrl = useRef(false);
  useEffect(() => {
    if (clearedUrl.current) return;
    clearedUrl.current = true;
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const id = reqId.current;
    setLoadingMore(true);
    setMoreError("");
    try {
      const res = await callApi("discover", { language, labels: labelKey.split("|"), minStars, after: cursor }, {});
      if (id !== reqId.current) return;
      setRepos((prev) => mergeRepos(prev, res?.repos || []));
      setHasMore(Boolean(res?.hasMore));
      setCursor(res?.cursor || null);
    } catch (e) {
      if (id === reqId.current) setMoreError(e?.message || "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleLabel = (id) => {
    setLabels((cur) => {
      if (cur.includes(id)) return cur.length > 1 ? cur.filter((x) => x !== id) : cur; // keep at least one
      return [...cur, id];
    });
  };

  const sorted = useMemo(() => {
    const a = [...repos];
    if (sort === "stars") a.sort((x, y) => y.stars - x.stars);
    else if (sort === "active") a.sort((x, y) => Date.parse(y.pushedAt || 0) - Date.parse(x.pushedAt || 0));
    else a.sort((x, y) => y.matchCount - x.matchCount || y.stars - x.stars);
    return a;
  }, [repos, sort]);

  const chosenLabels = LABEL_CHIPS.filter((c) => labels.includes(c.id)).map((c) => c.title.toLowerCase());

  const scanning = status === "loading" || loadingMore;

  return (
    <div className="gs-root">
      <PhysicsField scanning={scanning} calm={status === "ok"} burstKey={burst} />
      <Reticle />
      <div className="gs-grid" aria-hidden="true" />
    <main className="dc">
      <header className="dc-top">
        <Link href="/" className="dc-brand">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          GitScope
        </Link>
        <span className="dc-top__tag">Discover</span>
        <Link href="/history" className="dc-brand" style={{ marginLeft: "auto" }}>History</Link>
      </header>

      <section className="gs-hero gs-hero--compact">
        <ReactiveText className="gs-title" compact lines={["Find projects that want contributors."]} />
        <div className="gs-hero__sub">
          <p>Pick a language and what you are looking for. GitScope searches GitHub for repos with open, unassigned issues that maintainers marked for newcomers.</p>
        </div>
      </section>

      <section className="dc-controls" aria-label="Filters">
        <label className="dc-field">
          <span>Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Any language</option>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>

        <div className="dc-field dc-field--grow">
          <span>Looking for</span>
          <div className="dc-chips" role="group" aria-label="Issue labels">
            {LABEL_CHIPS.map((c) => (
              <button key={c.id} type="button" title={c.hint} aria-pressed={labels.includes(c.id)} className={`dc-chip ${labels.includes(c.id) ? "is-on" : ""}`} style={{ "--c": c.color }} onClick={() => toggleLabel(c.id)}>
                <i />{c.title}
              </button>
            ))}
          </div>
        </div>

        <label className="dc-field">
          <span>Repo size</span>
          <select value={minStars} onChange={(e) => setMinStars(Number(e.target.value))}>
            {STAR_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
          </select>
        </label>
      </section>

      <section className="dc-bar">
        <p className="dc-summary" aria-live="polite">
          {status === "ok" ? `${sorted.length} repo${sorted.length === 1 ? "" : "s"}${language ? ` in ${language}` : ""} with ${chosenLabels.join(" or ")} issues` : status === "loading" ? "Searching GitHub..." : ""}
        </p>
        <div className="dc-seg" role="tablist" aria-label="Sort">
          {SORTS.map((s) => <button key={s.id} type="button" role="tab" aria-selected={sort === s.id} className={sort === s.id ? "is-on" : ""} onClick={() => setSort(s.id)}>{s.t}</button>)}
        </div>
      </section>

      {status === "loading" && (
        <div className="dc-grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="dc-card dc-card--skel"><i /><i /><i /><i /></div>)}
        </div>
      )}

      {status === "error" && (
        <div className="dc-state">
          <p>{error}</p>
          <button type="button" className="dc-btn" onClick={search}>Try again</button>
        </div>
      )}

      {status === "ok" && sorted.length === 0 && (
        <div className="dc-state">
          <p>No repos matched. Try another language, add more labels, or lower the repo size filter.</p>
        </div>
      )}

      {status === "ok" && sorted.length > 0 && (
        <>
          <div className="dc-grid">{sorted.map((r) => <RepoCard key={r.fullName} r={r} />)}</div>
          <div className="dc-more">
            {moreError && <p className="dc-err">{moreError}</p>}
            {hasMore && <button type="button" className="dc-btn dc-btn--ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading..." : "Load more repos"}</button>}
          </div>
        </>
      )}

      <p className="dc-foot">Live data from GitHub. Only open, unassigned issues updated in the last 45 days, in repos pushed to in the last 90 days, are shown. Archived repos and forks are left out.</p>
    </main>
    </div>
  );
}
