"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callApi } from "./api";
import {
  NODE_W, GAP_X, PAD, H_DIR, H_MOD,
  PAGE, PAGE_STEP, groupItems,
  layoutTree, edgePath, flowPath, sortItems, summarize, fmtSize, describeFolder, describeFile,
} from "./explorerLogic";

const KIND_RGB = { code: "98,200,255", tests: "111,227,181", docs: "255,178,64", examples: "181,140,255", tooling: "245,143,180" };
const KIND_LABEL = { code: "Source code", tests: "Tests", docs: "Documentation", examples: "Examples", tooling: "Tooling" };
const DBL_MS = 220;
const ACCORDION = true; // opening a folder closes its siblings so the map stays short. Set false to allow several open at once.

const openUrl = (url) => { if (url) window.open(url, "_blank", "noopener,noreferrer"); };
const listText = (v) => (Array.isArray(v) ? v.join(", ") : v ? String(v) : "");

function Chevron() {
  return <svg className="cx-chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PlusGlyph() {
  return <svg className="cx-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
function FileGlyph() {
  return <svg className="cx-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 1.5h5l3.5 3.5v9.5H4z M9 1.5V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}

export default function CodeExplorer({ data }) {
  const repo = data.repo || {};
  const repoUrl = repo.url;
  const rootName = [repo.owner, repo.name].filter(Boolean).join("/") || "repository";
  const modules = useMemo(() => data.modules || [], [data.modules]);

  const [expanded, setExpanded] = useState(() => new Set(["root"]));
  const [loaded, setLoaded] = useState({});
  const [selectedId, setSelectedId] = useState("root");
  const [hoverId, setHoverId] = useState(null);
  const [shown, setShown] = useState({}); // how many children each open folder/group shows

  const timers = useRef({});
  const hoverTimer = useRef(null);
  const inflight = useRef(new Set());
  const expandedRef = useRef(expanded);
  const loadedRef = useRef(loaded);
  const revealRef = useRef(null);
  const canvasRef = useRef(null);
  const layRef = useRef(null);
  const alive = useRef(true);
  expandedRef.current = expanded;
  loadedRef.current = loaded;

  useEffect(() => {
    alive.current = true;
    const t = timers.current;
    return () => { alive.current = false; Object.values(t).forEach(clearTimeout); clearTimeout(hoverTimer.current); };
  }, []);

  // A new repository starts from a clean map.
  useEffect(() => {
    setExpanded(new Set(["root"]));
    setLoaded({});
    setSelectedId("root");
    setHoverId(null);
    setShown({});
    inflight.current.clear();
  }, [repoUrl]);

  const loadDir = useCallback(async (path) => {
    if (inflight.current.has(path) || loadedRef.current[path]?.status === "ok") return;
    inflight.current.add(path);
    setLoaded((p) => ({ ...p, [path]: { status: "loading" } }));
    try {
      const res = await callApi("tree", { repoUrl, path }, {});
      if (!alive.current) return;
      const items = sortItems(res?.items || []);
      setLoaded((p) => ({ ...p, [path]: { status: "ok", items, total: res?.total ?? items.length } }));
    } catch {
      if (alive.current) setLoaded((p) => ({ ...p, [path]: { status: "error" } }));
    } finally {
      inflight.current.delete(path);
    }
  }, [repoUrl]);

  /* ----- build the visible tree and lay it out ----- */
  const lay = useMemo(() => {
    const mk = (it) => ({ id: "p:" + it.path, name: it.name, path: it.path, type: it.type, url: it.url, size: it.size, h: H_DIR, kids: [] });
    const mkGroup = (g, parentPath) => ({ id: "g:" + parentPath + ":" + g.key, name: g.name, prefix: g.prefix, files: g.files, path: parentPath, type: "group", h: H_DIR, kids: [] });
    const kidsOf = (n) => {
      if (!expanded.has(n.id)) return [];
      let entries;
      if (n.type === "group") entries = n.files;
      else if (n.type === "dir") {
        const st = loaded[n.path];
        if (!st || st.status !== "ok") return [];
        entries = groupItems(st.items);
      } else return [];
      const limit = shown[n.id] ?? PAGE;
      const out = entries.slice(0, limit).map((e) => {
        const c = e.type === "group" ? mkGroup(e, n.path) : mk(e);
        c.kids = kidsOf(c);
        return c;
      });
      if (entries.length > limit) {
        out.push({ id: "m:" + n.id, type: "more", parentId: n.id, name: `+ ${entries.length - limit} more`, h: H_DIR, kids: [] });
      }
      return out;
    };
    const root = { id: "root", name: rootName, path: "", type: "dir", isRoot: true, url: repoUrl, h: H_DIR, kids: [] };
    if (expanded.has("root")) {
      for (const m of modules) {
        const n = { id: "p:" + m.path, name: m.name || m.path, path: m.path, type: "dir", module: m, url: m.folder?.url, h: H_MOD, kids: [] };
        n.kids = kidsOf(n);
        root.kids.push(n);
      }
      for (const f of (data.rootFiles || []).slice(0, 8)) {
        root.kids.push({ id: "p:" + f.path, name: f.path, path: f.path, type: "file", url: f.url, h: H_DIR, kids: [] });
      }
    }
    return layoutTree(root);
  }, [expanded, loaded, shown, modules, data.rootFiles, rootName, repoUrl]);
  layRef.current = lay;

  const byId = useMemo(() => new Map(lay.nodes.map((n) => [n.id, n])), [lay]);
  const activeId = hoverId ?? selectedId;
  const active = byId.get(activeId) || byId.get("root");

  /* ----- AI-inferred flow: only drawn for the module under the cursor ----- */
  const flows = useMemo(() => {
    const modById = new Map(modules.map((m) => [m.id, m]));
    return (data.flow || [])
      .map((f) => ({ ...f, a: modById.get(f.from), b: modById.get(f.to) }))
      .filter((f) => f.a && f.b);
  }, [data.flow, modules]);
  const activeMod = active?.module;
  const outs = activeMod ? flows.filter((f) => f.a.id === activeMod.id) : [];
  const ins = activeMod ? flows.filter((f) => f.b.id === activeMod.id) : [];
  const related = new Set([...outs.map((f) => "p:" + f.b.path), ...ins.map((f) => "p:" + f.a.path)]);
  const arcs = [...outs, ...ins]
    .map((f) => ({ f, a: byId.get("p:" + f.a.path), b: byId.get("p:" + f.b.path) }))
    .filter((x) => x.a && x.b);

  /* ----- interactions ----- */
  const siblingIds = (id) => {
    const e = layRef.current?.edges.find((x) => x.to.id === id);
    return e ? e.from.kids.filter((k) => k.id !== id).map((k) => k.id) : [];
  };
  const showMore = (n) => setShown((p) => ({ ...p, [n.parentId]: (p[n.parentId] ?? PAGE) + PAGE_STEP }));

  const toggle = (n) => {
    // Already open but its contents failed to load: clicking again retries instead of closing.
    if (!n.isRoot && expandedRef.current.has(n.id) && loadedRef.current[n.path]?.status === "error") { loadDir(n.path); return; }
    const willOpen = !expandedRef.current.has(n.id);
    const sibs = ACCORDION && willOpen ? siblingIds(n.id) : [];
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(n.id)) s.delete(n.id);
      else { s.add(n.id); sibs.forEach((id) => s.delete(id)); }
      return s;
    });
    if (willOpen) { revealRef.current = n.id; if (n.type === "dir" && !n.isRoot) loadDir(n.path); }
  };

  const onNodeClick = (n, e) => {
    if (n.type === "more") { showMore(n); return; }
    setSelectedId(n.id);
    if (n.type === "group") { toggle(n); return; }
    if (n.type === "file") { if (e.detail <= 1) openUrl(n.url); return; }
    if (e.detail >= 2) return; // second click of a double-click: the double-click handler takes over
    timers.current[n.id] = setTimeout(() => { delete timers.current[n.id]; toggle(n); }, DBL_MS);
  };
  const onNodeDouble = (n) => {
    if (n.type !== "dir") return;
    clearTimeout(timers.current[n.id]);
    delete timers.current[n.id];
    openUrl(n.url);
  };
  const onEnter = (n) => {
    if (n.type === "more") return; // keep showing whatever the panel had
    setHoverId(n.id);
    clearTimeout(hoverTimer.current);
    if (n.type === "dir" && !n.isRoot) hoverTimer.current = setTimeout(() => loadDir(n.path), 350);
  };
  const onLeave = () => { setHoverId(null); clearTimeout(hoverTimer.current); };
  const collapseAll = () => { setExpanded(new Set(["root"])); setSelectedId("root"); setShown({}); };

  // Keep a freshly opened folder and its children in view.
  useEffect(() => {
    const id = revealRef.current;
    const el = canvasRef.current;
    const n = id && byId.get(id);
    if (!n || !el) return;
    revealRef.current = null;
    const need = n.x + NODE_W * 2 + GAP_X + PAD - el.clientWidth;
    const top = n.y < el.scrollTop || n.y + n.h > el.scrollTop + el.clientHeight ? Math.max(0, n.y - 80) : el.scrollTop;
    el.scrollTo({ left: Math.max(el.scrollLeft, need), top, behavior: "smooth" });
  }, [lay, byId]);

  return (
    <div className="cx">
      <div className="cx__canvas" ref={canvasRef}>
        <div className="cx__inner" style={{ width: lay.width, height: lay.height }}>
          <svg className="cx-svg" width={lay.width} height={lay.height} aria-hidden="true">
            <defs>
              <marker id="cx-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#b58cff" />
              </marker>
            </defs>
            {lay.edges.map((e) => <path key={e.to.id} className="cx-edge" d={edgePath(e.from, e.to)} />)}
            {arcs.map((x, i) => <path key={i} className="cx-flow" d={flowPath(x.a, x.b)} markerEnd="url(#cx-arrow)" />)}
          </svg>

          {lay.nodes.map((n) => {
            const isDir = n.type === "dir" || n.type === "group";
            const open = isDir && expanded.has(n.id);
            const st = n.type === "dir" ? loaded[n.path] : undefined;
            const cls = [
              "cx-node", isDir ? "cx-node--dir" : "cx-node--file", n.type === "group" ? "cx-node--group" : "", n.type === "more" ? "cx-node--more" : "", n.module ? "cx-node--module" : "", n.isRoot ? "cx-node--root" : "",
              open ? "is-open" : "", n.id === activeId ? "is-active" : "", n.id === selectedId ? "is-selected" : "",
              related.has(n.id) ? "is-related" : "", st?.status === "loading" ? "is-loading" : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={n.id} type="button" className={cls}
                style={{ left: n.x, top: n.y, width: NODE_W, height: n.h, "--k": KIND_RGB[n.module?.kind] || KIND_RGB.code }}
                aria-expanded={isDir ? open : undefined}
                aria-label={n.type === "more" ? `Show more items (${n.name})` : n.type === "group" ? `File group ${n.name}` : isDir ? `Folder ${n.name}` : `File ${n.name}, opens on GitHub`}
                title={n.type === "more" ? `Click to show ${PAGE_STEP} more` : n.type === "group" ? `${n.files.length} files starting with ${n.prefix}` : n.path || n.name}
                onClick={(e) => onNodeClick(n, e)} onDoubleClick={() => onNodeDouble(n)}
                onMouseEnter={() => onEnter(n)} onMouseLeave={onLeave}
                onFocus={() => setHoverId(n.id)} onBlur={onLeave}
              >
                {n.type === "more" ? <PlusGlyph /> : isDir ? <Chevron /> : <FileGlyph />}
                {n.module ? (
                  <span className="cx-node__text"><b>{n.module.label || n.name}</b><small>{n.name}</small></span>
                ) : (
                  <span className="cx-node__text cx-node__text--mono"><b>{n.name}</b></span>
                )}
                {n.module?.fileCount != null && <span className="cx-node__n">{n.module.fileCount}</span>}
                {n.type === "group" && <span className="cx-node__n">{n.files.length}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <aside className="cx__panel" aria-live="polite">
        <Panel node={active} st={loaded[active?.path]} data={data} outs={outs} ins={ins} rootName={rootName} />
      </aside>

      <div className="cx__foot">
        <span><i className="cx-sw cx-sw--real" />Real folder structure</span>
        <span><i className="cx-sw cx-sw--ai" />Flow inferred by AI (hover a module)</span>
        <span className="cx-hint">Click a folder to open it · double-click to open it on GitHub · click a file to view it on GitHub</span>
        <button type="button" className="gs-btn gs-btn--ghost" onClick={collapseAll}>Collapse all</button>
      </div>
    </div>
  );
}

/* ---------- right-hand detail panel ---------- */

function Contents({ st, isModule }) {
  if (!st) return <p className="cx-muted">{isModule ? "Click the folder to load its contents." : "Hover a moment or click to load what is inside."}</p>;
  if (st.status === "loading") return <p className="cx-muted">Loading contents...</p>;
  if (st.status === "error") return <p className="cx-muted">Could not load this folder. Click it to try again.</p>;
  const s = summarize(st.items);
  const shown = st.items.slice(0, 10);
  return (
    <>
      <p className="cx-desc cx-desc--small">{s.folders} folder{s.folders === 1 ? "" : "s"} and {s.files} file{s.files === 1 ? "" : "s"} at this level{s.types.length ? `, mostly ${s.types.join(", ")}` : ""}.</p>
      <ul className="cx-list">
        {shown.map((it) => <li key={it.path} className={it.type === "dir" ? "is-dir" : ""}>{it.name}</li>)}
        {st.total > shown.length && <li className="cx-more">+ {st.total - shown.length} more</li>}
      </ul>
    </>
  );
}

function FlowList({ title, rows, pick }) {
  if (!rows.length) return null;
  return (
    <div className="cx-block">
      <h4>{title}</h4>
      <ul className="cx-list cx-list--flow">
        {rows.map((f, i) => <li key={i}><b>{pick(f).label || pick(f).name}</b>{f.label ? <span> {f.label}</span> : null}</li>)}
      </ul>
    </div>
  );
}

function Panel({ node, st, data, outs, ins, rootName }) {
  if (!node) return null;

  if (node.isRoot) {
    return (
      <div className="cx-panel">
        <p className="cx-kind" style={{ "--k": KIND_RGB.code }}><i />Repository</p>
        <h3>{rootName}</h3>
        {data.repo?.url && <a className="cx-path" href={data.repo.url} target="_blank" rel="noreferrer">Open on GitHub</a>}
        {data.summary && <p className="cx-desc">{data.summary}</p>}
        {data.languages?.length > 0 && (
          <div className="cx-block"><h4>Languages</h4>
            <ul className="cx-tags">{data.languages.slice(0, 6).map((l) => <li key={l.name}>{l.name} {Math.round(l.percent)}%</li>)}</ul>
          </div>
        )}
        {data.entryPoints?.length > 0 && (
          <div className="cx-block"><h4>Where the code starts</h4>
            <ul className="cx-links">{data.entryPoints.slice(0, 4).map((f) => <li key={f.path}><a href={f.url} target="_blank" rel="noreferrer">{f.path}</a></li>)}</ul>
          </div>
        )}
        <p className="cx-muted">Hover any folder or file to see what it is. Click a folder to look inside.</p>
      </div>
    );
  }

  if (node.module) {
    const m = node.module;
    return (
      <div className="cx-panel">
        <p className="cx-kind" style={{ "--k": KIND_RGB[m.kind] || KIND_RGB.code }}><i />{KIND_LABEL[m.kind] || "Module"}</p>
        <h3>{m.label || m.name}</h3>
        <a className="cx-path" href={m.folder?.url} target="_blank" rel="noreferrer">{m.path}</a>
        {m.summary && <p className="cx-desc">{m.summary}</p>}
        <dl className="cx-dl">
          {m.fileCount != null && (<><dt>Files</dt><dd>{m.fileCount}</dd></>)}
          {listText(m.fileTypes) && (<><dt>Types</dt><dd>{listText(m.fileTypes)}</dd></>)}
        </dl>
        <div className="cx-block"><h4>Inside this folder</h4><Contents st={st} isModule /></div>
        <FlowList title="Talks to" rows={outs} pick={(f) => f.b} />
        <FlowList title="Used by" rows={ins} pick={(f) => f.a} />
        {m.keyFiles?.length > 0 && (
          <div className="cx-block"><h4>Key files</h4>
            <ul className="cx-links">{m.keyFiles.map((f) => <li key={f.path}><a href={f.url} target="_blank" rel="noreferrer">{f.path}</a></li>)}</ul>
          </div>
        )}
        <a className="cx-open" href={m.folder?.url} target="_blank" rel="noreferrer">Open folder on GitHub</a>
      </div>
    );
  }

  if (node.type === "group") {
    const names = node.files.slice(0, 10);
    return (
      <div className="cx-panel">
        <p className="cx-kind" style={{ "--k": KIND_RGB.docs }}><i />File group</p>
        <h3>{node.name}</h3>
        <p className="cx-desc">{node.files.length} files in this folder start with <code>{node.prefix}</code>. They are grouped to keep the map short. Click to open the group.</p>
        <div className="cx-block"><h4>Includes</h4>
          <ul className="cx-list">
            {names.map((f) => <li key={f.path}>{f.name}</li>)}
            {node.files.length > names.length && <li className="cx-more">+ {node.files.length - names.length} more</li>}
          </ul>
        </div>
      </div>
    );
  }

  if (node.type === "dir") {
    return (
      <div className="cx-panel">
        <p className="cx-kind" style={{ "--k": KIND_RGB.code }}><i />Folder</p>
        <h3>{node.name}</h3>
        <a className="cx-path" href={node.url} target="_blank" rel="noreferrer">{node.path}</a>
        <p className="cx-desc">{describeFolder(node.name)}</p>
        <p className="cx-muted">Description is based on the folder name.</p>
        <div className="cx-block"><h4>Inside this folder</h4><Contents st={st} /></div>
        <a className="cx-open" href={node.url} target="_blank" rel="noreferrer">Open folder on GitHub</a>
      </div>
    );
  }

  const info = describeFile(node.name);
  return (
    <div className="cx-panel">
      <p className="cx-kind" style={{ "--k": KIND_RGB.docs }}><i />{info.type}</p>
      <h3>{node.name}</h3>
      <a className="cx-path" href={node.url} target="_blank" rel="noreferrer">{node.path}</a>
      <p className="cx-desc">{info.text}</p>
      <p className="cx-muted">Description is based on the file name.</p>
      {node.size ? <dl className="cx-dl"><dt>Size</dt><dd>{fmtSize(node.size)}</dd></dl> : null}
      <a className="cx-open" href={node.url} target="_blank" rel="noreferrer">Open file on GitHub</a>
    </div>
  );
}
