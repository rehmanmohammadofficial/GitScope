// The UI reads /api/repo, /api/setup and /api/issues through these tolerant helpers,
// so a renamed or missing field never crashes the page. /api/architecture has a fixed shape (see CONTINUATION.md).

export const pick = (o, keys, fallback) => {
  if (!o || typeof o !== "object") return fallback;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return fallback;
};

export const toArray = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]);

export const toText = (v) => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return pick(v, ["text", "name", "title", "label", "message", "description", "path", "value"]) ? toText(pick(v, ["text", "name", "title", "label", "message", "description", "path", "value"])) : JSON.stringify(v);
  return String(v);
};

const COMMAND_START = /^(\$ )?(git|npm|npx|yarn|pnpm|bun|cd|cp|mv|mkdir|pip|pip3|python|python3|poetry|conda|docker|docker-compose|cargo|go|make|node|deno|composer|php|bundle|gem|rails|mvn|gradle|\.\/|source|export|set|copy)\b/i;
export const looksLikeCommand = (s) => typeof s === "string" && COMMAND_START.test(s.trim());

export function normalizeRepo(data) {
  const base = (data && (data.repo || data.data || data)) || {};
  const r = { ...base, ...(base.stats || {}), ...(base.meta || {}) };
  const owner = toText(pick(r, ["owner"]) && typeof r.owner === "object" ? r.owner.login || r.owner.name : pick(r, ["owner", "ownerLogin"]));
  const name = toText(pick(r, ["name", "repo", "repoName"]));
  return {
    owner,
    name,
    fullName: toText(pick(r, ["fullName", "full_name", "slug"])) || [owner, name].filter(Boolean).join("/"),
    description: toText(pick(r, ["description", "about"])),
    url: toText(pick(r, ["url", "htmlUrl", "html_url", "repoUrl"])),
    stars: pick(r, ["stars", "stargazers", "stargazers_count", "stargazersCount"]),
    forks: pick(r, ["forks", "forks_count", "forksCount"]),
    openIssues: pick(r, ["openIssues", "open_issues", "open_issues_count", "openIssuesCount"]),
    language: toText(pick(r, ["language", "primaryLanguage"])),
    defaultBranch: toText(pick(r, ["defaultBranch", "default_branch"])),
    license: toText(pick(r, ["license", "licenseName"])),
    topics: toArray(pick(r, ["topics"])).map(toText).filter(Boolean).slice(0, 6),
  };
}

function normalizeConfidence(c) {
  if (c === undefined || c === null) return null;
  if (typeof c === "object") {
    const score = pick(c, ["score", "value", "percent"]);
    return { ...normalizeConfidence(score ?? pick(c, ["level", "label"])), reasons: toArray(pick(c, ["reasons", "notes", "why"])).map(toText) };
  }
  if (typeof c === "number") {
    const pct = c <= 1 ? Math.round(c * 100) : Math.round(c);
    return { pct, label: pct >= 75 ? "High" : pct >= 45 ? "Medium" : "Low", reasons: [] };
  }
  const s = String(c).toLowerCase();
  const pct = s.startsWith("h") ? 90 : s.startsWith("m") ? 60 : s.startsWith("l") ? 30 : 50;
  return { pct, label: s.charAt(0).toUpperCase() + s.slice(1), reasons: [] };
}

function normalizeStep(s, i) {
  if (typeof s === "string") return looksLikeCommand(s) ? { title: "", command: s.replace(/^\$ /, ""), detail: "" } : { title: s, command: "", detail: "" };
  const command = toText(pick(s, ["command", "cmd", "run", "code", "script"]));
  const title = toText(pick(s, ["title", "name", "label", "step", "summary"]));
  const detail = toText(pick(s, ["description", "details", "detail", "explanation", "why", "note", "notes"]));
  return { title: title === command ? "" : title, command, detail };
}

export function normalizeSetup(data) {
  const s = (data && (data.setup || data.plan || data.data || data)) || {};
  const steps = toArray(pick(s, ["steps", "plan", "instructions", "commands"])).map(normalizeStep).filter((x) => x.title || x.command);
  const reqRaw = pick(s, ["prerequisites", "requirements", "prereqs", "tools"]);
  const requirements = toArray(reqRaw).map((r) => (typeof r === "object" && r ? [toText(r.name || r.tool), toText(r.version)].filter(Boolean).join(" ") : toText(r))).filter(Boolean);
  const runtime = pick(s, ["nodeVersion", "runtime", "runtimeVersion"]);
  if (runtime && !requirements.length) requirements.push(typeof runtime === "object" ? toText(runtime) : `Node ${runtime}`.replace(/^Node Node/, "Node"));

  let envRaw = pick(s, ["envVariables", "envVars", "env", "environmentVariables", "environment"], []);
  if (envRaw && !Array.isArray(envRaw) && typeof envRaw === "object") envRaw = Object.entries(envRaw).map(([name, v]) => (typeof v === "object" ? { name, ...v } : { name, description: v }));
  const env = toArray(envRaw).map((e) =>
    typeof e === "string"
      ? { name: e, description: "", required: null, example: "" }
      : { name: toText(pick(e, ["name", "key", "variable"])), description: toText(pick(e, ["description", "purpose", "details"])), required: pick(e, ["required"], null), example: toText(pick(e, ["example", "default", "value"])) }
  ).filter((e) => e.name);

  let run = pick(s, ["runCommand", "run", "startCommand", "devCommand", "start"]);
  if (run && typeof run === "object") run = pick(run, ["command", "cmd"]);
  const troubleshooting = toArray(pick(s, ["troubleshooting", "problems", "faq", "commonIssues"])).map((t) => {
    if (typeof t === "string") return { problem: t, fix: "", source: "" };
    const src = pick(t, ["source", "sourceUrl", "url", "file", "sourcePath"]);
    return {
      problem: toText(pick(t, ["problem", "issue", "symptom", "title", "question", "error"])),
      fix: toText(pick(t, ["fix", "solution", "answer", "resolution", "detail", "description"])),
      source: src && typeof src === "object" ? toText(pick(src, ["url", "path"])) : toText(src),
    };
  }).filter((t) => t.problem);

  return {
    steps,
    requirements,
    env,
    runCommand: run ? toText(run) : "",
    confidence: normalizeConfidence(pick(s, ["confidence"])),
    troubleshooting,
    warnings: toArray(pick(s, ["warnings"])).map(toText),
  };
}

export function normalizeIssues(data, repoUrl = "") {
  const d = data || {};
  const list = toArray(pick(d, ["issues", "results", "items", "recommended", "suggestions"])).filter((x) => x && typeof x === "object");
  const issues = list.map((it) => {
    const number = pick(it, ["number", "issueNumber", "id"]);
    const url = toText(pick(it, ["url", "htmlUrl", "html_url", "link"])) || (number && repoUrl ? `${repoUrl.replace(/\/$/, "")}/issues/${number}` : "");
    return {
      number,
      title: toText(pick(it, ["title", "name"])),
      url,
      labels: toArray(pick(it, ["labels"])).map((l) => toText(l)).filter(Boolean).slice(0, 5),
      difficulty: toText(pick(it, ["difficulty", "level", "skillLevel", "skillFit", "fit"])).toLowerCase(),
      reason: toText(pick(it, ["reason", "why", "summary", "explanation", "rationale", "approach", "aiSummary"])),
      files: toArray(pick(it, ["likelyFiles", "files", "filesToChange", "relatedFiles"])).map((f) => (typeof f === "string" ? { path: f, url: "" } : { path: toText(pick(f, ["path", "name"])), url: toText(pick(f, ["url", "htmlUrl"])) })).filter((f) => f.path),
      comments: pick(it, ["comments", "commentCount", "comments_count"]),
      time: toText(pick(it, ["estimatedTime", "timeEstimate", "effort"])),
    };
  }).filter((i) => i.title);
  return { issues, totalOpen: pick(d, ["totalOpen", "totalOpenIssues", "openCount", "total"]), note: toText(pick(d, ["note", "message"])) };
}
