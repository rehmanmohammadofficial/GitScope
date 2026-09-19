"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import "./gitscope.css";
import PhysicsField from "../components/PhysicsField";
import Reticle from "../components/Reticle";
import { Magnetic, ReactiveText } from "../components/fx";
import { callApi, normalizeRepoInput } from "../components/api";
import { normalizeRepo } from "../components/normalize";
import MapSection from "../components/MapSection";
import SetupSection from "../components/SetupSection";
import IssuesSection from "../components/IssuesSection";
import PathSection from "../components/PathSection";

const SKILLS = [
  { value: "beginner", label: "New to open source" },
  { value: "intermediate", label: "Some experience" },
  { value: "advanced", label: "Experienced" },
];
const EXAMPLES = ["expressjs/express", "excalidraw/excalidraw", "louislam/uptime-kuma"];
const IDLE = { status: "idle", data: null, error: null, note: null };
const INITIAL = { repo: IDLE, arch: IDLE, setup: IDLE, issues: IDLE };
const NAV = [["map", "Code map"], ["setup", "Setup"], ["issues", "Issues"], ["path", "Your path"]];

function Wordmark() {
  return (
    <div className="gs-wordmark">
      <svg viewBox="-12 -12 24 24" width="22" height="22" aria-hidden="true"><circle r="7" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M0-12v5M0 7v5M-12 0h5M7 0h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle r="1.8" fill="#FFB240" /></svg>
      GitScope
    </div>
  );
}

function SkillPicker({ value, onChange, disabled }) {
  const idx = Math.max(0, SKILLS.findIndex((s) => s.value === value));
  return (
    <div className="gs-skill">
      <span id="gs-skill-label">Your experience</span>
      <div className={`gs-seg ${disabled ? "is-disabled" : ""}`} role="radiogroup" aria-labelledby="gs-skill-label" style={{ "--n": SKILLS.length, "--i": idx }}>
        <i className="gs-seg__thumb" />
        {SKILLS.map((s) => (
          <button key={s.value} type="button" role="radio" aria-checked={value === s.value} disabled={disabled} className={value === s.value ? "is-on" : ""} onClick={() => onChange(s.value)}>{s.label}</button>
        ))}
      </div>
    </div>
  );
}

function StatusPills({ steps }) {
  const items = [["repo", "Repo"], ["arch", "Map"], ["setup", "Setup"], ["issues", "Issues"]];
  return (
    <ul className="gs-pills" aria-label="Analysis progress">
      {items.map(([k, label]) => <li key={k} className={`is-${steps[k].status}`}><i />{label}</li>)}
    </ul>
  );
}

function Nav({ steps }) {
  const [active, setActive] = useState("map");
  const listRef = useRef(null);
  const [bar, setBar] = useState({ x: 0, w: 0 });
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      let cur = NAV[0][0];
      for (const [id] of NAV) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.4) cur = id;
      }
      setActive(cur);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", onScroll); };
  }, [steps.arch.status, steps.setup.status, steps.issues.status]);
  useEffect(() => {
    const a = listRef.current?.querySelector(`[data-id="${active}"]`);
    if (a) setBar({ x: a.offsetLeft, w: a.offsetWidth });
  }, [active]);
  return (
    <nav className="gs-nav" aria-label="Sections">
      <Wordmark />
      <div className="gs-nav__links" ref={listRef}>
        {NAV.map(([id, label]) => <a key={id} data-id={id} href={`#${id}`} className={active === id ? "is-on" : ""}>{label}</a>)}
        <i className="gs-nav__bar" style={{ transform: `translateX(${bar.x}px)`, width: bar.w }} />
      </div>
      <StatusPills steps={steps} />
    </nav>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [skill, setSkill] = useState("beginner");
  const [steps, setSteps] = useState(INITIAL);
  const [phase, setPhase] = useState("idle"); // idle | running | done | failed
  const [activeUrl, setActiveUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [burst, setBurst] = useState(0);
  const runId = useRef(0);
  const ctl = useRef(null);
  const skillRef = useRef(skill);
  const resultsRef = useRef(null);
  const lastErr = useRef(null);
  useEffect(() => { skillRef.current = skill; }, [skill]);

  const patch = useCallback((key, p) => setSteps((s) => ({ ...s, [key]: { ...s[key], ...p } })), []);

  const runStep = useCallback(async (key, endpoint, body, id, signal) => {
    patch(key, { status: "loading", error: null, note: null });
    try {
      const data = await callApi(endpoint, body, { signal, onWait: (note) => patch(key, { note }) });
      if (runId.current !== id) return null;
      patch(key, { status: "ok", data, note: null });
      return data;
    } catch (e) {
      if (e.name === "AbortError" || runId.current !== id) return null;
      lastErr.current = e;
      patch(key, { status: "error", error: e, note: null });
      return null;
    }
  }, [patch]);

  const analyze = useCallback(async (raw, level) => {
    const repoUrl = normalizeRepoInput(raw);
    if (!repoUrl) { setFormError("Paste a GitHub link such as github.com/expressjs/express, or type owner/repo."); return; }
    setFormError("");
    ctl.current?.abort();
    const controller = new AbortController();
    ctl.current = controller;
    const id = ++runId.current;
    setActiveUrl(repoUrl);
    setInput(repoUrl.replace(/^https?:\/\//, ""));
    setSteps(INITIAL);
    setPhase("running");

    const repo = await runStep("repo", "repo", { repoUrl }, id, controller.signal);
    if (runId.current !== id) return;
    if (!repo) {
      setFormError(lastErr.current?.message || "Could not read that repository.");
      setSteps(INITIAL);
      setPhase("failed");
      return;
    }
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    await runStep("arch", "architecture", { repoUrl }, id, controller.signal);
    await runStep("setup", "setup", { repoUrl }, id, controller.signal);
    await runStep("issues", "issues", { repoUrl, skillLevel: level }, id, controller.signal);
    if (runId.current === id) { setPhase("done"); setBurst((b) => b + 1); }
  }, [runStep]);

  const retry = (key) => () => {
    const id = runId.current;
    const c = ctl.current || new AbortController();
    if (key === "arch") runStep("arch", "architecture", { repoUrl: activeUrl }, id, c.signal);
    if (key === "setup") runStep("setup", "setup", { repoUrl: activeUrl }, id, c.signal);
    if (key === "issues") runStep("issues", "issues", { repoUrl: activeUrl, skillLevel: skillRef.current }, id, c.signal);
  };

  const changeSkill = (v) => {
    setSkill(v);
    skillRef.current = v;
    if (phase === "done" && activeUrl) {
      const c = ctl.current || new AbortController();
      runStep("issues", "issues", { repoUrl: activeUrl, skillLevel: v }, runId.current, c.signal);
    }
  };

  const onSubmit = (e) => { e.preventDefault(); analyze(input, skill); };
  const started = phase === "running" || phase === "done";
  const scanning = Object.values(steps).some((s) => s.status === "loading");
  const repoInfo = steps.repo.data ? normalizeRepo(steps.repo.data) : null;
  const ready = steps.arch.status === "ok" && steps.setup.status === "ok" && steps.issues.status === "ok";
  const busyIssues = steps.issues.status === "loading";

  return (
    <div className="gs-root">
      <PhysicsField scanning={scanning} calm={started} burstKey={burst} />
      <Reticle />
      <div className="gs-grid" aria-hidden="true" />

      {started ? <Nav steps={steps} /> : (
        <header className="gs-top"><Wordmark /></header>
      )}

      <main>
        <section className={`gs-hero ${started ? "gs-hero--compact" : ""}`}>
          <ReactiveText className="gs-title" lines={["From an unfamiliar repo", "to your first pull request."]} />
          <div className="gs-hero__sub">
            <p>Paste a GitHub link. GitScope reads the real folders, configs and issues, then shows you what to open, what to run and what to fix first.</p>
          </div>

          <form className="gs-form" onSubmit={onSubmit} noValidate>
            <div className={`gs-input ${formError ? "has-error" : ""}`}>
              <svg viewBox="-12 -12 24 24" width="22" height="22" aria-hidden="true"><circle r="7" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M0-12v5M0 7v5M-12 0h5M7 0h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              <input
                type="text" inputMode="url" autoComplete="off" spellCheck="false"
                aria-label="GitHub repository link" aria-invalid={!!formError} aria-describedby={formError ? "gs-form-error" : undefined}
                placeholder="github.com/owner/repo" value={input}
                onChange={(e) => { setInput(e.target.value); if (formError) setFormError(""); }}
              />
              <Magnetic>
                <button className="gs-btn gs-btn--primary" type="submit" disabled={scanning}>{scanning ? "Scanning…" : started ? "Scan again" : "Scan repository"}</button>
              </Magnetic>
            </div>
            {formError && <p id="gs-form-error" className="gs-form__error" role="alert">{formError}</p>}
            <div className="gs-form__row">
              <SkillPicker value={skill} onChange={changeSkill} disabled={busyIssues} />
              <div className="gs-try">
                <span>Try</span>
                {EXAMPLES.map((ex) => <button type="button" key={ex} onClick={() => { setInput(ex); analyze(ex, skill); }}>{ex}</button>)}
              </div>
            </div>
          </form>
        </section>

        {started && (
          <div className="gs-results" ref={resultsRef}>
            {repoInfo && (
              <section className="gs-repo">
                <div>
                  <a href={repoInfo.url || activeUrl} target="_blank" rel="noreferrer" className="gs-repo__name">{repoInfo.fullName}</a>
                  {repoInfo.description && <p>{repoInfo.description}</p>}
                </div>
                <ul className="gs-stats">
                  {repoInfo.stars != null && <li><b>{Number(repoInfo.stars).toLocaleString()}</b> stars</li>}
                  {repoInfo.forks != null && <li><b>{Number(repoInfo.forks).toLocaleString()}</b> forks</li>}
                  {repoInfo.openIssues != null && <li><b>{Number(repoInfo.openIssues).toLocaleString()}</b> open issues</li>}
                  {repoInfo.language && <li><b>{repoInfo.language}</b></li>}
                  {repoInfo.license && <li>{repoInfo.license}</li>}
                </ul>
              </section>
            )}
            <MapSection step={steps.arch} repo={repoInfo} onRetry={retry("arch")} />
            <SetupSection step={steps.setup} onRetry={retry("setup")} />
            <IssuesSection step={steps.issues} onRetry={retry("issues")} repoUrl={activeUrl} skill={skill} />
            <PathSection repo={repoInfo} arch={steps.arch.data} setupData={steps.setup.data} issuesData={steps.issues.data} repoUrl={activeUrl} ready={ready} />
          </div>
        )}
      </main>

      <footer className="gs-foot">
        <p>Files, folders and issues come straight from the GitHub API. The AI only explains them, and every issue number and file path it suggests is checked before you see it.</p>
      </footer>
    </div>
  );
}
