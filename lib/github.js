import { ApiError } from "./errors.js";

const GITHUB_API = "https://api.github.com";
const REPO_URL_REGEX = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/;
const CACHE_MS = 60 * 60 * 1000;
const LARGE_REPO_FILES = 3000;

const GITHUB_TIMEOUT_MS = 20000;
const GITHUB_RETRIES = 2;

const cache = new Map();

// "https://github.com/acme/task-tracker/" -> { owner: "acme", name: "task-tracker" }
export function parseRepoUrl(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new ApiError(400, "INVALID_REQUEST", "repoUrl is required.");
  }

  const cleaned = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const match = cleaned.match(REPO_URL_REGEX);

  if (!match) {
    throw new ApiError(
      400,
      "INVALID_URL",
      "Please paste a valid GitHub repo link, like https://github.com/owner/repo"
    );
  }

  return {
    owner: match[1],
    name: match[2],
  };
}

// One place that talks to GitHub.
// Uses GITHUB_TOKEN from .env.local if set.
async function githubFetch(path, extraHeaders = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "GitScope",
    ...extraHeaders,
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= GITHUB_RETRIES; attempt++) {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      controller.abort();
    }, GITHUB_TIMEOUT_MS);

    try {
      const response = await fetch(`${GITHUB_API}${path}`, {
        headers,
        cache: "no-store",
        signal: controller.signal,
      });

      clearTimeout(timer);

      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      if (attempt < GITHUB_RETRIES) {
        // Small backoff before retrying.
        await new Promise((resolve) =>
          setTimeout(resolve, 700 * (attempt + 1))
        );
      }
    }
  }

  throw lastError;
}

// Turns a failed GitHub response into an error from the contract.
function throwGithubError(res) {
  if (res.status === 404) {
    throw new ApiError(
      404,
      "REPO_NOT_FOUND",
      "Repo not found or it is private."
    );
  }

  const rateLimited =
    res.status === 429 ||
    (res.status === 403 &&
      res.headers.get("x-ratelimit-remaining") === "0");

  if (rateLimited) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "GitHub rate limit reached. Try again in a minute."
    );
  }

  if (res.status === 401) {
    throw new ApiError(
      500,
      "SERVER_ERROR",
      "GitHub rejected the token. Check GITHUB_TOKEN in .env.local."
    );
  }

  throw new ApiError(
    500,
    "SERVER_ERROR",
    `GitHub returned an error (${res.status}).`
  );
}

// A link to a real file in the repo.
export function fileRef(repo, path) {
  const encoded = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return {
    path,
    url: `${repo.url}/blob/${repo.defaultBranch}/${encoded}`,
  };
}

// Fetches repo info + the full file list once, then caches it.
export async function getRepoContext(repoUrl) {
  const { owner, name } = parseRepoUrl(repoUrl);
  const key = `${owner}/${name}`.toLowerCase();

  const hit = cache.get(key);

  if (hit && Date.now() - hit.time < CACHE_MS) {
    return hit.value;
  }

  const repoRes = await githubFetch(`/repos/${owner}/${name}`);

  if (!repoRes.ok) {
    throwGithubError(repoRes);
  }

  const data = await repoRes.json();

  const branch = data.default_branch;

  let files = [];
  let truncated = false;

  const treeRes = await githubFetch(
    `/repos/${owner}/${name}/git/trees/${branch}?recursive=1`
  );

  if (treeRes.status === 409) {
    // Empty repository.
  } else if (!treeRes.ok) {
    throwGithubError(treeRes);
  } else {
    const tree = await treeRes.json();

    truncated = Boolean(tree.truncated);

    files = tree.tree
      .filter((item) => item.type === "blob")
      .map((item) => ({
        path: item.path,
        size: item.size ?? 0,
      }));
  }

  const warnings = [];

  if (truncated || files.length > LARGE_REPO_FILES) {
    warnings.push(
      "Large repo: analysis uses top-level folders and key files only."
    );
  }

  if (files.length === 0) {
    warnings.push("This repo has no files yet.");
  }

  const value = {
    repo: {
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      url: data.html_url,
      description: data.description ?? null,
      language: data.language ?? null,
      stars: data.stargazers_count,
      defaultBranch: branch,
      fileCount: files.length,
    },

    warnings,

    files,
  };

  cache.set(key, {
    time: Date.now(),
    value,
  });

  return value;
}

// Reads one file's text from GitHub.
// Long files are cut at maxChars so the AI prompt stays small.

// Fetches real open issues for the issue finder.
// GitHub's /issues endpoint also returns pull requests, so PRs are removed here.
export async function getOpenIssues(repo, perPage = 30) {
  const res = await githubFetch(
    `/repos/${repo.owner}/${repo.name}/issues?state=open&per_page=${perPage}&page=1`
  );

  if (!res.ok) {
    throwGithubError(res);
  }

  const data = await res.json();

  return data
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? "",
      url: issue.html_url,
      labels: Array.isArray(issue.labels)
        ? issue.labels
            .map((label) => label?.name)
            .filter(Boolean)
            .slice(0, 8)
        : [],
      comments: issue.comments ?? 0,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    }));
}

// Gets the real total number of open issues.
// This is NOT generated by the AI.
export async function getOpenIssueCount(repo) {
  const query = encodeURIComponent(
    `repo:${repo.owner}/${repo.name} state:open type:issue`
  );

  const res = await githubFetch(`/search/issues?q=${query}&per_page=1`);

  if (!res.ok) {
    throwGithubError(res);
  }

  const data = await res.json();

  return Number.isFinite(data.total_count)
    ? data.total_count
    : 0;
}

export async function getFileContent(
  repo,
  path,
  maxChars = 6000
) {
  const encoded = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const res = await githubFetch(
    `/repos/${repo.owner}/${repo.name}/contents/${encoded}?ref=${encodeURIComponent(
      repo.defaultBranch
    )}`,
    {
      Accept: "application/vnd.github.raw+json",
    }
  );

  if (res.status === 404) {
    return null;
  }

  // 403 that is not a rate limit usually means the file is too large.
  if (
    res.status === 403 &&
    res.headers.get("x-ratelimit-remaining") !== "0"
  ) {
    return null;
  }

  if (!res.ok) {
    throwGithubError(res);
  }

  const text = await res.text();

  if (text.length > maxChars) {
    return (
      text.slice(0, maxChars) +
      "\n[file cut off here]"
    );
  }

  return text;
}