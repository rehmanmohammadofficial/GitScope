"use client";
import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "./ui";
import { normalizeSetup, normalizeIssues } from "./normalize";

// Builds the four-phase contribution roadmap from the three real responses. Frontend only.
function buildPhases({ repo, arch, setupData, issuesData, repoUrl }) {
  const setup = setupData ? normalizeSetup(setupData) : null;
  const issues = issuesData ? normalizeIssues(issuesData, repoUrl).issues : [];
  const top = issues[0];
  const base = (repoUrl || "").replace(/\/$/, "");
  const name = repo?.name || arch?.repo?.name || "project";
  const branch = top ? `fix/issue-${top.number}` : "my-first-change";
  const mods = (arch?.modules || []).filter((m) => m.kind === "code").slice(0, 3);
  const contributing = (arch?.rootFiles || []).find((f) => /^contributing(\.md)?$/i.test(f.path));
  const nCmds = setup?.steps.filter((s) => s.command).length || 0;

  const phases = [];
  const understand = [];
  if (mods.length) understand.push({ id: "mods", text: `Look through the main folders: ${mods.map((m) => m.path || m.name).join(", ")}`, href: mods[0].folder?.url });
  if (arch?.entryPoints?.[0]) understand.push({ id: "entry", text: `Open the entry point ${arch.entryPoints[0].path} and follow one function`, href: arch.entryPoints[0].url });
  if (contributing) understand.push({ id: "contrib", text: "Read the contributing guide", href: contributing.url });
  if (!understand.length) understand.push({ id: "readme", text: "Read the README on GitHub", href: base });
  phases.push({ id: "understand", title: "Get your bearings", tasks: understand });

  const run = [{ id: "fork", text: "Fork the repository on GitHub", href: base ? `${base}/fork` : undefined }];
  run.push({ id: "clone", text: "Clone your fork", cmd: `git clone https://github.com/YOUR-USERNAME/${name}.git` });
  if (nCmds) run.push({ id: "setup", text: `Follow the setup guide above (${nCmds} commands)`, href: "#setup" });
  if (setup?.runCommand) run.push({ id: "run", text: "Start the project and check it runs", cmd: setup.runCommand });
  phases.push({ id: "run", title: "Run it locally", tasks: run });

  const pick = [];
  if (top) {
    pick.push({ id: "issue", text: `Choose #${top.number}: ${top.title}`, href: top.url });
    pick.push({ id: "claim", text: "Comment on the issue that you'd like to work on it" });
    if (top.files.length) pick.push({ id: "files", text: `Start in ${top.files.slice(0, 2).map((f) => f.path).join(" and ")}`, href: top.files[0].url });
  } else {
    pick.push({ id: "issue", text: "Browse the open issues and pick one labelled for newcomers", href: base ? `${base}/issues` : undefined });
  }
  phases.push({ id: "pick", title: "Pick an issue", tasks: pick });

  const title = top ? `Fix #${top.number}: ${top.title}`.slice(0, 60) : "My first change";
  phases.push({
    id: "pr",
    title: "Open your first pull request",
    tasks: [
      { id: "branch", text: "Create a branch", cmd: `git checkout -b ${branch}` },
      { id: "change", text: "Make the change and run the tests" },
      { id: "commit", text: "Commit it", cmd: `git commit -am "${title.replace(/"/g, "'")}"` },
      { id: "push", text: "Push the branch to your fork", cmd: `git push origin ${branch}` },
      { id: "pr", text: top ? `Open a pull request that says "Closes #${top.number}"` : "Open a pull request and describe what you changed", href: base ? `${base}/compare` : undefined },
    ],
  });
  return phases;
}

export default function PathSection({ repo, arch, setupData, issuesData, repoUrl, ready }) {
  const phases = useMemo(() => buildPhases({ repo, arch, setupData, issuesData, repoUrl }), [repo, arch, setupData, issuesData, repoUrl]);
  const key = `gitscope:path:${repoUrl}`;
  const [done, setDone] = useState({});
  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(key) || "{}")); } catch { setDone({}); }
  }, [key]);
  const toggle = (id) => setDone((d) => {
    const next = { ...d, [id]: !d[id] };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  const all = phases.flatMap((p) => p.tasks.map((t) => `${p.id}:${t.id}`));
  const count = all.filter((id) => done[id]).length;
  const pct = all.length ? count / all.length : 0;
  const C = 2 * Math.PI * 26;

  return (
    <section id="path" className="gs-section">
      <header className="gs-section__head">
        <div>
          <h2>Your path to a first contribution</h2>
          <p className="gs-lead">{ready ? "Built from the map, setup guide and issues above. Tick things off as you go; your progress is saved in this browser." : "This fills in as the sections above finish."}</p>
        </div>
        <div className="gs-ring" aria-label={`${count} of ${all.length} steps done`}>
          <svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" className="gs-ring__bg" /><circle cx="30" cy="30" r="26" className="gs-ring__fg" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} /></svg>
          <b>{count}/{all.length}</b>
        </div>
      </header>
      <ol className="gs-rail">
        {phases.map((p, pi) => {
          const total = p.tasks.length, n = p.tasks.filter((t) => done[`${p.id}:${t.id}`]).length;
          return (
            <li key={p.id} className={n === total ? "is-complete" : ""}>
              <span className="gs-rail__dot">{n === total ? "✓" : pi + 1}</span>
              <h3>{p.title}</h3>
              <ul>
                {p.tasks.map((t) => {
                  const id = `${p.id}:${t.id}`;
                  return (
                    <li key={t.id} className={done[id] ? "is-done" : ""}>
                      <label>
                        <input type="checkbox" checked={!!done[id]} onChange={() => toggle(id)} />
                        <span className="gs-check" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5" /></svg></span>
                        <span className="gs-task">{t.href ? <a href={t.href} target={t.href.startsWith("#") ? undefined : "_blank"} rel="noreferrer" onClick={(e) => e.stopPropagation()}>{t.text}</a> : t.text}</span>
                      </label>
                      {t.cmd && <div className="gs-cmd gs-cmd--slim"><code><span>$</span> {t.cmd}</code><CopyButton text={t.cmd} /></div>}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
