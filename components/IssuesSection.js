"use client";
import { useMemo } from "react";
import { Section } from "./ui";
import { Tilt } from "./fx";
import { normalizeIssues } from "./normalize";

const LEVEL = { beginner: "New to open source", intermediate: "Some experience", advanced: "Experienced" };

export default function IssuesSection({ step, onRetry, repoUrl, skill }) {
  const list = useMemo(() => (step.data ? normalizeIssues(step.data, repoUrl) : null), [step.data, repoUrl]);
  return (
    <Section
      id="issues"
      title="Issues you can start on"
      lead={list ? `${list.issues.length} picked${list.totalOpen ? ` from ${list.totalOpen} open` : ""} for "${LEVEL[skill] || skill}". Every issue number and file path was checked against GitHub.` : "Beginner-friendly issues, ranked for your experience."}
      step={step}
      onRetry={onRetry}
      raw={step.data}
    >
      {list && list.issues.length === 0 && (
        <div className="gs-empty">
          <p>No open issues fit this experience level right now.</p>
          <p className="gs-muted">Try another level above, or look at recent pull requests to see where the project is moving.</p>
        </div>
      )}
      {list && list.issues.length > 0 && (
        <ol className="gs-issues">
          {list.issues.map((it, i) => (
            <li key={`${it.number}-${i}`}>
              <Tilt className="gs-issue" max={4}>
                <div className="gs-issue__top">
                  {it.number != null && <a className="gs-issue__num" href={it.url} target="_blank" rel="noreferrer">#{it.number}</a>}
                  {it.difficulty && <span className={`gs-level gs-level--${it.difficulty.replace(/[^a-z]/g, "")}`}>{it.difficulty}</span>}
                  {it.time && <span className="gs-issue__time">{it.time}</span>}
                </div>
                <h3><a href={it.url} target="_blank" rel="noreferrer">{it.title}</a></h3>
                {it.reason && <p>{it.reason}</p>}
                {it.files.length > 0 && (
                  <div className="gs-issue__files">
                    <span>Likely files</span>
                    <ul>{it.files.map((f) => <li key={f.path}>{f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.path}</a> : <code>{f.path}</code>}</li>)}</ul>
                  </div>
                )}
                {it.labels.length > 0 && <ul className="gs-tags gs-tags--quiet">{it.labels.map((l) => <li key={l}>{l}</li>)}</ul>}
              </Tilt>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
