import { NextResponse } from "next/server";

// POST /api/tree   body: { repoUrl, path }   (path "" = repo root)
// Returns the direct children of ONE folder, straight from the GitHub API.
// Self-contained on purpose (does not import lib/github.js or lib/errors.js).

const TTL_MS = 60 * 60 * 1000;
const MAX_ITEMS = 300;
const cache = new Map();

function fail(status, code, message) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function parseRepo(url) {
  const m = String(url || "").match(
    /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#]|$)/i
  );
  return m ? { owner: m[1], repo: m[2] } : null;
}

function cleanPath(p) {
  const s = String(p || "").replace(/^\/+|\/+$/g, "");
  if (s.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  return s;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "BAD_BODY", "Send JSON like { repoUrl, path }.");
  }

  const parsed = parseRepo(body?.repoUrl);
  if (!parsed) return fail(400, "INVALID_REPO_URL", "That is not a GitHub repository link.");
  const path = cleanPath(body?.path);
  if (path === null) return fail(400, "INVALID_PATH", "That path is not allowed.");

  const { owner, repo } = parsed;
  const key = `${owner}/${repo}:${path}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return NextResponse.json(hit.data);

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "gitscope",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const suffix = path ? "/" + path.split("/").map(encodeURIComponent).join("/") : "";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents${suffix}`;

  let res;
  try {
    res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch {
    return fail(504, "GITHUB_TIMEOUT", "GitHub did not answer in time. Try again.");
  }

  if (res.status === 404) return fail(404, "PATH_NOT_FOUND", "That folder was not found.");
  if (res.status === 401) return fail(502, "GITHUB_TOKEN_INVALID", "The GitHub token was rejected.");
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0")
    return fail(429, "GITHUB_RATE_LIMIT", "GitHub rate limit reached. Add a GITHUB_TOKEN or wait.");
  if (!res.ok) return fail(502, "GITHUB_ERROR", "GitHub returned an error.");

  const json = await res.json();
  if (!Array.isArray(json)) return fail(400, "NOT_A_FOLDER", "That path is a file, not a folder.");

  const items = json.slice(0, MAX_ITEMS).map((it) => ({
    name: it.name,
    path: it.path,
    type: it.type === "dir" ? "dir" : "file",
    size: it.size ?? 0,
    url:
      it.html_url ||
      `https://github.com/${owner}/${repo}/${it.type === "dir" ? "tree" : "blob"}/HEAD/${it.path}`,
  }));

  const data = { path, items, total: json.length };
  if (cache.size > 500) cache.clear();
  cache.set(key, { t: Date.now(), data });
  return NextResponse.json(data);
}
