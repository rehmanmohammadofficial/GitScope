// POST /api/discover
// Body: { language?: "Python", labels?: ["good first issue", "help wanted", ...], minStars?: 10, after?: "<cursor>" }
// Returns repos that have OPEN, UNASSIGNED issues with beginner-friendly labels.
// Real GitHub data only (no AI). One GraphQL search returns issues plus their repo details.
// Needs GITHUB_TOKEN in .env.local (GitHub's GraphQL API requires a token).

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const TTL_MS = 10 * 60 * 1000; // cache each query for 10 minutes
const MAX_CACHE = 200;
const ISSUE_UPDATED_DAYS = 45; // only issues touched recently
const REPO_ACTIVE_DAYS = 90;   // repo must have been pushed to recently
const WANT_REPOS = 12;         // keep paging until we have about this many repos
const MAX_PAGES = 3;           // ...but never more than this many GitHub requests per call
const MAX_ISSUES_PER_REPO = 5;

const LABEL_SETS = {
  "good first issue": ["good first issue", "good-first-issue"],
  "help wanted": ["help wanted", "help-wanted"],
  "first-timers-only": ["first-timers-only"],
  documentation: ["documentation"],
};
const STAR_STEPS = [0, 10, 100, 1000];

const cache = new Map();

class DiscoverError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) =>
  Response.json({ error: { code, message }, code, message }, { status });

const QUERY = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue {
        number
        title
        url
        updatedAt
        comments { totalCount }
        labels(first: 8) { nodes { name } }
        repository {
          nameWithOwner
          name
          owner { login }
          description
          url
          stargazerCount
          pushedAt
          isArchived
          isFork
          primaryLanguage { name }
          licenseInfo { spdxId }
          issues(states: OPEN) { totalCount }
          repositoryTopics(first: 5) { nodes { topic { name } } }
        }
      }
    }
  }
}`;

async function gql(token, query, variables) {
  let res;
  try {
    res = await fetch(GITHUB_GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "gitscope",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new DiscoverError(504, "GITHUB_TIMEOUT", "GitHub took too long to answer. Try again.");
    }
    throw new DiscoverError(502, "GITHUB_ERROR", "Could not reach GitHub. Check your internet connection.");
  }
  if (res.status === 401) throw new DiscoverError(502, "GITHUB_TOKEN_INVALID", "GITHUB_TOKEN was rejected by GitHub. Create a new token and update .env.local.");
  if (res.status === 403 || res.status === 429) throw new DiscoverError(429, "GITHUB_RATE_LIMIT", "GitHub rate limit reached. Wait a minute and try again.");
  if (!res.ok) throw new DiscoverError(502, "GITHUB_ERROR", `GitHub returned an error (${res.status}).`);
  const json = await res.json();
  if (json.errors?.length && !json.data) {
    const first = json.errors[0];
    if (first.type === "RATE_LIMITED" || /rate limit/i.test(first.message || "")) {
      throw new DiscoverError(429, "GITHUB_RATE_LIMIT", "GitHub rate limit reached. Wait a minute and try again.");
    }
    throw new DiscoverError(502, "GITHUB_ERROR", first.message || "GitHub could not run this search.");
  }
  return json.data;
}

function cleanInput(body) {
  const language = typeof body.language === "string" ? body.language.trim() : "";
  if (language && !/^[A-Za-z0-9+#.\- ]{1,30}$/.test(language)) {
    throw new DiscoverError(400, "INVALID_LANGUAGE", "That language name is not valid.");
  }
  let labels = Array.isArray(body.labels) ? body.labels.filter((l) => Object.hasOwn(LABEL_SETS, l)) : [];
  if (!labels.length) labels = ["good first issue"];
  labels = [...new Set(labels)].sort();
  const minStars = STAR_STEPS.includes(Number(body.minStars)) ? Number(body.minStars) : 10;
  const after = typeof body.after === "string" && /^[A-Za-z0-9+/=_-]{1,300}$/.test(body.after) ? body.after : null;
  return { language, labels, minStars, after };
}

function buildQuery({ language, labels }) {
  const names = labels.flatMap((l) => LABEL_SETS[l]).map((n) => `"${n}"`).join(",");
  const since = new Date(Date.now() - ISSUE_UPDATED_DAYS * 864e5).toISOString().slice(0, 10);
  const parts = ["is:issue", "is:open", "no:assignee", `label:${names}`, `updated:>=${since}`, "sort:updated-desc"];
  if (language) parts.push(`language:"${language}"`);
  return parts.join(" ");
}

async function collect(token, { q, after, minStars, language }) {
  const byRepo = new Map();
  const activeSince = Date.now() - REPO_ACTIVE_DAYS * 864e5;
  let cursor = after;
  let hasMore = true;
  let pages = 0;

  while (pages < MAX_PAGES && hasMore && byRepo.size < WANT_REPOS) {
    const data = await gql(token, QUERY, { q, after: cursor });
    pages += 1;
    const s = data?.search;
    if (!s) break;

    for (const n of s.nodes || []) {
      const repo = n?.repository;
      if (!n || !repo) continue;
      if (repo.isArchived || repo.isFork) continue;
      if ((repo.stargazerCount ?? 0) < minStars) continue;
      if (repo.pushedAt && Date.parse(repo.pushedAt) < activeSince) continue;
      const lang = repo.primaryLanguage?.name || null;
      if (language && (lang || "").toLowerCase() !== language.toLowerCase()) continue;

      const key = repo.nameWithOwner.toLowerCase();
      let r = byRepo.get(key);
      if (!r) {
        r = {
          fullName: repo.nameWithOwner,
          owner: repo.owner?.login || repo.nameWithOwner.split("/")[0],
          name: repo.name,
          url: repo.url,
          description: repo.description || "",
          stars: repo.stargazerCount ?? 0,
          language: lang,
          license: repo.licenseInfo?.spdxId && repo.licenseInfo.spdxId !== "NOASSERTION" ? repo.licenseInfo.spdxId : null,
          topics: (repo.repositoryTopics?.nodes || []).map((t) => t.topic?.name).filter(Boolean),
          pushedAt: repo.pushedAt || null,
          openIssues: repo.issues?.totalCount ?? null,
          hasContributing: null,
          matchCount: 0,
          issues: [],
        };
        byRepo.set(key, r);
      }
      r.matchCount += 1;
      if (r.issues.length < MAX_ISSUES_PER_REPO) {
        r.issues.push({
          number: n.number,
          title: n.title,
          url: n.url,
          labels: (n.labels?.nodes || []).map((l) => l.name),
          comments: n.comments?.totalCount ?? 0,
          updatedAt: n.updatedAt,
        });
      }
    }
    hasMore = Boolean(s.pageInfo?.hasNextPage);
    cursor = s.pageInfo?.endCursor || null;
  }
  return { repos: [...byRepo.values()], hasMore: hasMore && Boolean(cursor), cursor };
}

// Optional extra signal: does the repo have a CONTRIBUTING guide? One small batched query; failures are ignored.
async function addContributing(token, repos) {
  const list = repos.slice(0, 20).filter((r) => /^[\w.-]+$/.test(r.owner) && /^[\w.-]+$/.test(r.name));
  if (!list.length) return;
  const body = list
    .map((r, i) => `r${i}: repository(owner: "${r.owner}", name: "${r.name}") { a: object(expression: "HEAD:CONTRIBUTING.md") { __typename } b: object(expression: "HEAD:.github/CONTRIBUTING.md") { __typename } }`)
    .join("\n");
  try {
    const data = await gql(token, `query { ${body} }`, {});
    list.forEach((r, i) => {
      const x = data?.[`r${i}`];
      r.hasContributing = x ? Boolean(x.a || x.b) : null;
    });
  } catch {
    /* optional signal, leave as null */
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, "INVALID_BODY", "Send a JSON body.");
  }

  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new DiscoverError(500, "GITHUB_TOKEN_MISSING", "Add GITHUB_TOKEN to .env.local and restart the dev server. GitHub's search API needs it.");
    }
    const input = cleanInput(body || {});
    const cacheKey = JSON.stringify(input);
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) return Response.json(hit.value);

    const { repos, hasMore, cursor } = await collect(token, { q: buildQuery(input), ...input });
    repos.sort((a, b) => b.matchCount - a.matchCount || b.stars - a.stars);
    await addContributing(token, repos);

    const value = {
      repos,
      hasMore,
      cursor,
      language: input.language || null,
      labels: input.labels,
      minStars: input.minStars,
      generatedAt: new Date().toISOString(),
    };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { at: Date.now(), value });
    return Response.json(value);
  } catch (e) {
    if (e instanceof DiscoverError) return fail(e.status, e.code, e.message);
    console.error("discover failed", e);
    return fail(500, "DISCOVER_FAILED", "Something went wrong while searching GitHub.");
  }
}
