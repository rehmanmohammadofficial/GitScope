// lib/architecture.js
// GitScope - architecture map for a public GitHub repository.
//
// Design (same rule as the rest of GitScope: real analysis first, AI only explains):
//   1. CODE reads the real repo tree from the GitHub API and builds the modules
//      from real folders (top-level folders, and one level deeper for
//      monorepo-style folders such as packages/ or a busy src/).
//   2. The AI gets a SMALL prompt (<= 12,000 characters) and only writes labels,
//      short summaries, key-file picks and a few "how the parts connect" edges.
//   3. CODE validates every AI answer: module ids must exist, file paths must
//      exist in the real tree, edges must connect real modules. Anything else
//      is dropped.
//   4. CODE builds the Mermaid diagram itself from the validated data, so the AI
//      can never break the diagram syntax.
//
// Only needs: askAI({ system, prompt, maxTokens }) from ./ai.js.
// Env: GITHUB_TOKEN (optional but strongly recommended), GROQ_API_KEY (via ai.js).

import { askAI } from "./ai.js";

const TTL_MS = 60 * 60 * 1000; // cache results for 1 hour
const MAX_MODULES = 8;
const PROMPT_BUDGET = 12000; // characters, keeps us inside Groq free-plan token limits
const GITHUB_TIMEOUT_MS = 12000;

const cache = new Map(); // "owner/name" -> { at, value }
const inflight = new Map(); // "owner/name" -> Promise (avoids duplicate work when the UI calls twice)

// ---------------------------------------------------------------- errors

function fail(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

// ---------------------------------------------------------------- URL

export function parseRepo(input) {
  const text = String(input ?? "").trim();
  const m =
    text.match(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/i,
    ) || text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (!m) {
    throw fail(400, "INVALID_REPO_URL", "Please enter a valid GitHub repository URL, like https://github.com/owner/name.");
  }
  return { owner: m[1], name: m[2] };
}

// ---------------------------------------------------------------- GitHub

async function gh(path, { raw = false, optional = false } = {}) {
  const headers = {
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "User-Agent": "gitscope",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let res = null;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    try {
      res = await fetch(`https://api.github.com${path}`, {
        headers,
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      });
    } catch {
      res = null; // network error or timeout, try once more
    }
  }

  if (!res) {
    if (optional) return null;
    throw fail(504, "GITHUB_TIMEOUT", "Could not reach GitHub (timed out). Check your internet connection and try again.");
  }
  if (res.ok) return raw ? res.text() : res.json();
  if (optional) return null;

  if (res.status === 404) throw fail(404, "REPO_NOT_FOUND", "Repository not found. It may not exist or it may be private.");
  if (res.status === 409) throw fail(422, "EMPTY_REPO", "This repository is empty, so there is nothing to map yet.");
  if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) {
    throw fail(
      429,
      "GITHUB_RATE_LIMIT",
      process.env.GITHUB_TOKEN
        ? "GitHub rate limit reached. Please wait a few minutes and try again."
        : "GitHub rate limit reached. Add a GITHUB_TOKEN to .env.local to raise the limit, then restart the server.",
    );
  }
  if (res.status === 401) throw fail(502, "GITHUB_TOKEN_INVALID", "GitHub rejected GITHUB_TOKEN. Check the token in .env.local.");
  throw fail(502, "GITHUB_ERROR", `GitHub returned an unexpected error (${res.status}).`);
}

async function loadRepo(owner, name) {
  const meta = await gh(`/repos/${owner}/${name}`);
  const branch = meta.default_branch;
  const [tree, readme] = await Promise.all([
    gh(`/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`),
    gh(`/repos/${owner}/${name}/readme`, { raw: true, optional: true }),
  ]);
  const paths = (tree.tree || []).filter((n) => n.type === "blob").map((n) => n.path);
  return {
    owner: meta.owner?.login || owner,
    name: meta.name || name,
    htmlUrl: meta.html_url || `https://github.com/${owner}/${name}`,
    branch,
    description: meta.description || null,
    truncated: Boolean(tree.truncated),
    paths,
    readme: typeof readme === "string" ? readme : "",
  };
}

// ---------------------------------------------------------------- tree analysis (pure code)

const IGNORED_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage", "vendor", "__pycache__", "venv",
  "target", "bower_components", "tmp", "temp", "site-packages", "third_party",
]);
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp", ".woff", ".woff2",
  ".ttf", ".eot", ".otf", ".mp4", ".mp3", ".wav", ".pdf", ".zip", ".gz", ".tar",
  ".lock", ".map", ".snap", ".log",
]);
const LOCK_NAMES = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|cargo\.lock|poetry\.lock|go\.sum)$/i;
const CONTAINER_DIRS = new Set(["packages", "apps", "services", "modules", "libs", "projects", "crates", "plugins"]);
const ENTRY_RE = /^(index|main|app|server|mod|__init__|lib|core|cli|init)\.[a-z0-9]+$|^readme(\.[a-z]+)?$/i;
const ROOT_FILE_RE =
  /^(readme(\.[a-z]+)?|contributing(\.[a-z]+)?|license(\.[a-z]+)?|package\.json|requirements\.txt|pyproject\.toml|setup\.py|go\.mod|cargo\.toml|pom\.xml|build\.gradle|gemfile|composer\.json|dockerfile|docker-compose\.[a-z]+|makefile|\.env\.example|\.env\.sample)$/i;

const EXT_LANG = {
  ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript", ".py": "Python", ".go": "Go", ".rs": "Rust",
  ".java": "Java", ".kt": "Kotlin", ".rb": "Ruby", ".php": "PHP", ".cs": "C#",
  ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++", ".swift": "Swift",
  ".vue": "Vue", ".svelte": "Svelte", ".scala": "Scala", ".dart": "Dart", ".sh": "Shell",
};

function extOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i).toLowerCase() : "";
}

function isRelevant(path) {
  const parts = path.split("/");
  const dirs = parts.slice(0, -1);
  if (dirs.some((d) => IGNORED_DIRS.has(d) || d.startsWith("."))) return false;
  const file = parts[parts.length - 1];
  if (LOCK_NAMES.test(file) || /\.min\.(js|css)$/i.test(file)) return false;
  return !SKIP_EXT.has(extOf(file));
}

function kindOf(path) {
  const n = path.split("/").pop().toLowerCase();
  if (/^(test|tests|__tests__|spec|specs|e2e|cypress|__mocks__)$/.test(n)) return "tests";
  if (/^(docs?|documentation|website|wiki)$/.test(n)) return "docs";
  if (/^(examples?|samples?|demos?)$/.test(n)) return "examples";
  if (/^(scripts?|tools?|bin|benchmarks?|ci)$/.test(n)) return "tooling";
  return "code";
}
const KIND_WEIGHT = { code: 1, tooling: 0.5, tests: 0.35, examples: 0.4, docs: 0.3 };

function pickKeyFiles(files, limit) {
  return [...files]
    .sort((a, b) => {
      const ea = ENTRY_RE.test(a.split("/").pop()) ? 0 : 1;
      const eb = ENTRY_RE.test(b.split("/").pop()) ? 0 : 1;
      return ea - eb || a.split("/").length - b.split("/").length || a.localeCompare(b);
    })
    .slice(0, limit);
}

// Builds modules from real folders only. `paths` = relevant file paths.
export function buildModules(paths) {
  const top = new Map(); // top-level dir -> files
  for (const p of paths) {
    const i = p.indexOf("/");
    if (i < 0) continue;
    const dir = p.slice(0, i);
    if (!top.has(dir)) top.set(dir, []);
    top.get(dir).push(p);
  }

  const candidates = [];
  for (const [dir, files] of top) {
    const children = new Map();
    let direct = 0;
    for (const p of files) {
      const rest = p.slice(dir.length + 1);
      const j = rest.indexOf("/");
      if (j < 0) {
        direct++;
        continue;
      }
      const childPath = `${dir}/${rest.slice(0, j)}`;
      if (!children.has(childPath)) children.set(childPath, []);
      children.get(childPath).push(p);
    }
    const expand =
      (CONTAINER_DIRS.has(dir) && children.size >= 1) ||
      (dir === "src" && children.size >= 3 && direct <= 5);
    if (expand) {
      for (const [childPath, childFiles] of children) candidates.push({ path: childPath, files: childFiles });
    } else {
      candidates.push({ path: dir, files });
    }
  }

  const scored = candidates
    .map((c) => ({ ...c, kind: kindOf(c.path), score: c.files.length * KIND_WEIGHT[kindOf(c.path)] }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_MODULES);

  // Show real code first, then tooling/tests/docs/examples.
  scored.sort((a, b) => (a.kind === "code" ? 0 : 1) - (b.kind === "code" ? 0 : 1) || b.files.length - a.files.length);

  return scored.map((c, i) => {
    const exts = new Map();
    for (const f of c.files) exts.set(extOf(f), (exts.get(extOf(f)) || 0) + 1);
    const topExt = [...exts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e || "(no ext)");
    return {
      id: `m${i + 1}`,
      path: c.path,
      name: c.path.split("/").pop(),
      kind: c.kind,
      fileCount: c.files.length,
      fileTypes: topExt,
      sampleFiles: pickKeyFiles(c.files, 6),
    };
  });
}

function languageStats(paths) {
  const counts = new Map();
  let total = 0;
  for (const p of paths) {
    const lang = EXT_LANG[extOf(p)];
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) || 0) + 1);
    total++;
  }
  if (!total) return [];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, n]) => ({ name, percent: Math.round((n / total) * 100) }));
}

// ---------------------------------------------------------------- refs and diagram

function makeRef(repo, path, isDir = false) {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  return { path, url: `${repo.htmlUrl}/${isDir ? "tree" : "blob"}/${encodeURIComponent(repo.branch)}/${enc}` };
}

function mLabel(text) {
  return String(text ?? "")
    .replace(/["`<>[\]{}()|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

// The diagram is generated by code from validated data (never by the AI).
// Solid arrows = real folder structure. Dotted arrows = AI-inferred relations.
export function toMermaid(repoName, modules, flow) {
  const lines = ["graph TD", `  R["${mLabel(repoName) || "repo"}"]`];
  for (const m of modules) {
    const title = mLabel(m.label || m.name) || m.id;
    lines.push(`  ${m.id}["${title}<br/>${mLabel(m.path)}"]`);
    lines.push(`  R --> ${m.id}`);
  }
  for (const e of flow) {
    const label = mLabel(e.label);
    lines.push(label ? `  ${e.from} -.->|"${label}"| ${e.to}` : `  ${e.from} -.-> ${e.to}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- AI prompt

const SYSTEM = [
  "You explain how a software repository is organised to a beginner.",
  "Use ONLY the data given. Never invent folders, files or features.",
  "If the data does not show what something does, say so briefly instead of guessing.",
  "Reply with JSON only, in exactly this shape:",
  '{"summary":"1-2 plain sentences about the whole repo",',
  '"modules":[{"id":"m1","label":"2-4 word name","summary":"max 25 words, plain English","keyFiles":["exact path from the list"]}],',
  '"flow":[{"from":"m1","to":"m2","label":"1-3 words"}],',
  '"entryPoints":["exact path from the lists"]}',
  "Rules: include every module id once; keyFiles max 3 per module and copied exactly from that module's file list;",
  "flow max 6 edges and only when the names or README clearly suggest the parts work together, otherwise use [];",
  "entryPoints: max 3 main source files that start the app or export the library; never tests, examples, docs or README files.",
].join("\n");

function cleanReadme(text, maxChars) {
  return String(text || "")
    .split("\n")
    .filter((l) => !/^\s*(\[!\[|!\[|<img|<p align|<a href|<div|<\/)/i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

function buildPrompt(info, { readmeChars, samples }) {
  const parts = [
    `Repository: ${info.owner}/${info.name}`,
    `Description: ${info.description || "(none)"}`,
    `Main languages: ${info.languages.map((l) => `${l.name} ${l.percent}%`).join(", ") || "unknown"}`,
    `Root files: ${info.rootFiles.slice(0, 12).join(", ") || "(none)"}`,
    "",
    "Modules (id | folder | number of files | kind | main file types):",
  ];
  for (const m of info.modules) {
    parts.push(`${m.id} | ${m.path} | ${m.fileCount} | ${m.kind} | ${m.fileTypes.join(" ")}`);
    parts.push(`  files: ${m.sampleFiles.slice(0, samples).join(", ")}`);
  }
  if (!info.modules.length) parts.push("(no folders, all files are in the root)");
  const readme = cleanReadme(info.readme, readmeChars);
  parts.push("", "README start:", readme || "(no README)");
  return parts.join("\n");
}

function fitPrompt(info) {
  for (const opt of [
    { readmeChars: 1500, samples: 6 },
    { readmeChars: 800, samples: 4 },
    { readmeChars: 300, samples: 3 },
  ]) {
    const p = buildPrompt(info, opt);
    if (p.length <= PROMPT_BUDGET) return p;
  }
  return buildPrompt(info, { readmeChars: 0, samples: 2 }).slice(0, PROMPT_BUDGET);
}

// ---------------------------------------------------------------- AI answer validation

function str(v, max) {
  return typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;
}

function resolvePath(value, pathMap) {
  const raw = typeof value === "string" ? value : value && typeof value === "object" ? value.path : null;
  if (typeof raw !== "string") return null;
  return pathMap.get(raw.trim().replace(/^\.?\//, "").toLowerCase()) || null;
}

const NON_SOURCE_EXT = new Set([".md", ".txt", ".rst", ".json", ".yml", ".yaml", ".toml"]);

// An entry point must be a source file at the repo root or inside a "code" module
// (never tests, examples, docs or tooling).
function isEntryCandidate(path, modules) {
  if (NON_SOURCE_EXT.has(extOf(path))) return false;
  if (!path.includes("/")) return true;
  const mod = modules.find((m) => path.startsWith(`${m.path}/`));
  return Boolean(mod) && mod.kind === "code";
}

export function cleanAI(raw, modules, pathMap) {
  const out = { summary: null, byId: {}, flow: [], entryPoints: [], dropped: 0 };
  if (!raw || typeof raw !== "object") return out;

  out.summary = str(raw.summary, 300);
  const byId = new Map(modules.map((m) => [m.id, m]));
  const idOf = (v) => {
    if (typeof v !== "string") return null;
    if (byId.has(v)) return v;
    const hit = modules.find((m) => m.path.toLowerCase() === v.toLowerCase());
    return hit ? hit.id : null;
  };

  for (const item of Array.isArray(raw.modules) ? raw.modules : []) {
    const id = idOf(item?.id);
    if (!id) {
      out.dropped++;
      continue;
    }
    const mod = byId.get(id);
    const keyFiles = [];
    for (const f of Array.isArray(item.keyFiles) ? item.keyFiles : []) {
      const real = resolvePath(f, pathMap);
      if (real && real.startsWith(`${mod.path}/`) && !keyFiles.includes(real)) keyFiles.push(real);
      else out.dropped++;
    }
    out.byId[id] = { label: str(item.label, 40), summary: str(item.summary, 220), keyFiles: keyFiles.slice(0, 3) };
  }

  const seen = new Set();
  for (const e of Array.isArray(raw.flow) ? raw.flow : []) {
    const from = idOf(e?.from);
    const to = idOf(e?.to);
    const key = `${from}>${to}`;
    if (!from || !to || from === to || seen.has(key)) {
      out.dropped++;
      continue;
    }
    seen.add(key);
    out.flow.push({ from, to, label: str(e.label, 30) || "", basis: "ai-inferred" });
    if (out.flow.length >= 6) break;
  }

  for (const f of Array.isArray(raw.entryPoints) ? raw.entryPoints : []) {
    const real = resolvePath(f, pathMap);
    if (!real) out.dropped++; // does not exist in the repo
    else if (isEntryCandidate(real, modules) && !out.entryPoints.includes(real)) out.entryPoints.push(real);
    if (out.entryPoints.length >= 3) break;
  }
  return out;
}

// ---------------------------------------------------------------- main

async function build(owner, name) {
  const repo = await loadRepo(owner, name);
  const warnings = [];

  const relevant = repo.paths.filter(isRelevant);
  const pathMap = new Map(repo.paths.map((p) => [p.toLowerCase(), p]));
  const modules = buildModules(relevant);
  const languages = languageStats(relevant);
  const rootFiles = repo.paths.filter((p) => !p.includes("/") && ROOT_FILE_RE.test(p));

  if (repo.truncated) warnings.push("This repository is very large. GitHub cut the file list short, so the map may be incomplete.");
  if (!modules.length) warnings.push("This repository has no code folders, so there is nothing to split into modules.");

  let ai = { summary: null, byId: {}, flow: [], entryPoints: [], dropped: 0 };
  let aiUsed = false;
  try {
    const raw = await askAI({
      system: SYSTEM,
      prompt: fitPrompt({ ...repo, languages, rootFiles, modules }),
      maxTokens: 1200,
    });
    ai = cleanAI(raw, modules, pathMap);
    aiUsed = true;
    if (ai.dropped > 0) warnings.push(`${ai.dropped} unverified item(s) from the AI were removed because they do not exist in the repository.`);
  } catch {
    warnings.push("The AI explanation is unavailable right now, so this shows the real folder structure only. Try again in a minute.");
  }

  if (!ai.entryPoints.length) {
    // Real files only: root-level source files first, then files directly inside a code folder.
    const rootSource = repo.paths.filter((p) => !p.includes("/") && ENTRY_RE.test(p) && isEntryCandidate(p, modules));
    const inCode = modules
      .filter((m) => m.kind === "code")
      .flatMap((m) =>
        m.sampleFiles
          .filter((p) => p.split("/").length === m.path.split("/").length + 1 && ENTRY_RE.test(p.split("/").pop()) && isEntryCandidate(p, modules))
          .slice(0, 1),
      );
    ai.entryPoints = [...new Set([...rootSource, ...inCode])].slice(0, 3);
  }

  const outModules = modules.map((m) => {
    const a = ai.byId[m.id] || {};
    const keyFiles = (a.keyFiles && a.keyFiles.length ? a.keyFiles : m.sampleFiles.slice(0, 3)).map((p) => makeRef(repo, p));
    return {
      id: m.id,
      name: m.name,
      path: m.path,
      kind: m.kind,
      fileCount: m.fileCount,
      fileTypes: m.fileTypes,
      label: a.label || m.name,
      summary: a.summary || null,
      folder: makeRef(repo, m.path, true),
      keyFiles,
    };
  });

  const result = {
    repo: {
      owner: repo.owner,
      name: repo.name,
      url: repo.htmlUrl,
      defaultBranch: repo.branch,
      description: repo.description,
    },
    summary: ai.summary,
    languages,
    modules: outModules,
    rootFiles: rootFiles.slice(0, 10).map((p) => makeRef(repo, p)),
    entryPoints: ai.entryPoints.map((p) => makeRef(repo, p)),
    flow: ai.flow,
    diagram: toMermaid(`${repo.owner}/${repo.name}`, outModules, ai.flow),
    aiUsed,
    warnings,
    generatedAt: new Date().toISOString(),
  };
  return { result, cacheable: aiUsed };
}

export async function generateArchitecture(repoUrl) {
  const { owner, name } = parseRepo(repoUrl);
  const key = `${owner}/${name}`.toLowerCase();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const job = build(owner, name)
    .then(({ result, cacheable }) => {
      if (cacheable) cache.set(key, { at: Date.now(), value: result });
      return result;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
