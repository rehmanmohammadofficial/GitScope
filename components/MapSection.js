"use client";
import { useEffect, useMemo, useState } from "react";
import ArchGraph, { KIND_RGB } from "./ArchGraph";
import CodeExplorer from "./CodeExplorer";
import { Section } from "./ui";

const LANG_COLORS = ["#62C8FF", "#B58CFF", "#FFB240", "#6FE3B5", "#F58FB4", "#9AA3D9"];
const KIND_LABEL = { code: "Source code", tests: "Tests", docs: "Docs", examples: "Examples", tooling: "Tooling" };

function LanguageBar({ languages }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  const langs = (languages || []).filter((l) => l && l.percent > 0).slice(0, 6);
  if (!langs.length) return null;
  return (
    <div className="gs-langs">
      <div className="gs-langs__bar" role="img" aria-label={langs.map((l) => `${l.name} ${l.percent}%`).join(", ")}>
        {langs.map((l, i) => <i key={l.name} style={{ width: on ? `${l.percent}%` : "0%", background: LANG_COLORS[i % LANG_COLORS.length], transitionDelay: `${i * 90}ms` }} />)}
      </div>
      <ul>{langs.map((l, i) => <li key={l.name}><b style={{ background: LANG_COLORS[i % LANG_COLORS.length] }} />{l.name} <span>{l.percent}%</span></li>)}</ul>
    </div>
  );
}

export default function MapSection({ step, repo, onRetry }) {
  const data = step.data;
  const modules = useMemo(() => (data?.modules || []), [data]);
  const flow = useMemo(() => (data?.flow || []), [data]);
  const [view, setView] = useState("graph");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!modules.length) { setSelected(null); return; }
    setSelected((cur) => (modules.some((m) => m.id === cur) ? cur : (modules.find((m) => m.kind === "code") || modules[0]).id));
  }, [modules]);

  const mod = modules.find((m) => m.id === selected);
  const degraded = data && data.aiUsed === false;

  return (
    <Section
      id="map"
      title="Code map"
      lead={data?.summary || "How the project is organised, and which folders matter first."}
      step={step}
      onRetry={onRetry}
      raw={data}
      aside={data && <div className="gs-seg gs-seg--small" role="tablist" aria-label="Map view">
        {["graph", "diagram"].map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? "is-on" : ""} onClick={() => setView(v)}>{v === "graph" ? "Live map" : "Diagram"}</button>)}
      </div>}
    >
      {data && (
        <>
          <LanguageBar languages={data.languages} />
          {degraded && (
            <div className="gs-note">
              <span>Folder structure only. The AI labels didn&apos;t load, so names and flow arrows are missing.</span>
              <button className="gs-btn gs-btn--ghost" onClick={onRetry}>Retry with AI</button>
            </div>
          )}
          {(data.warnings || []).map((w, i) => <div className="gs-note" key={i}><span>{w}</span></div>)}

          {view === "graph" ? (
            <>
              <div className="gs-frame">
                <i className="gs-corner gs-corner--tl" /><i className="gs-corner gs-corner--tr" /><i className="gs-corner gs-corner--bl" /><i className="gs-corner gs-corner--br" />
                <div className="gs-frame__stage">
                  <ArchGraph repoName={repo?.name || data.repo?.name} modules={modules} flow={flow} selectedId={selected} onSelect={setSelected} />
                  <ul className="gs-legend">
                    <li><i className="gs-legend__solid" />Real folder structure</li>
                    <li><i className="gs-legend__dash" />Flow inferred by AI</li>
                    <li><span>Bubble size is file count. Drag bubbles, click one to inspect it.</span></li>
                  </ul>
                </div>
                <aside className="gs-detail" aria-live="polite">
                  {mod ? (
                    <>
                      <span className="gs-kind" style={{ "--k": KIND_RGB[mod.kind] || KIND_RGB.tooling }}>{KIND_LABEL[mod.kind] || mod.kind}</span>
                      <h3>{mod.label || mod.name}</h3>
                      <a className="gs-path" href={mod.folder?.url} target="_blank" rel="noreferrer">{mod.folder?.path || mod.path}</a>
                      <p>{mod.summary || "No AI summary for this folder."}</p>
                      <dl>
                        <div><dt>Files</dt><dd>{mod.fileCount}</dd></div>
                        <div><dt>Types</dt><dd>{(mod.fileTypes || []).join(", ") || "-"}</dd></div>
                      </dl>
                      {mod.keyFiles?.length > 0 && (
                        <>
                          <h4>Key files</h4>
                          <ul className="gs-files">{mod.keyFiles.map((f) => <li key={f.path}><a href={f.url} target="_blank" rel="noreferrer">{f.path}</a></li>)}</ul>
                        </>
                      )}
                    </>
                  ) : <p className="gs-muted">Pick a module to see what it does.</p>}
                </aside>
              </div>

              <div className="gs-modlist" role="group" aria-label="Modules">
                {modules.map((m) => (
                  <button key={m.id} className={`gs-chip ${m.id === selected ? "is-on" : ""}`} style={{ "--k": KIND_RGB[m.kind] || KIND_RGB.tooling }} onClick={() => setSelected(m.id)}>
                    <i />{m.name}<span>{m.fileCount}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <CodeExplorer data={data} />
          )}

          {(data.entryPoints?.length > 0 || data.rootFiles?.length > 0) && (
            <div className="gs-cols">
              {data.entryPoints?.length > 0 && (
                <div>
                  <h4>Start reading here</h4>
                  <ul className="gs-files">{data.entryPoints.map((f) => <li key={f.path}><a href={f.url} target="_blank" rel="noreferrer">{f.path}</a></li>)}</ul>
                </div>
              )}
              {data.rootFiles?.length > 0 && (
                <div>
                  <h4>Files at the root</h4>
                  <ul className="gs-files gs-files--inline">{data.rootFiles.slice(0, 12).map((f) => <li key={f.path}><a href={f.url} target="_blank" rel="noreferrer">{f.path}</a></li>)}</ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}
