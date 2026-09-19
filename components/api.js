// Small fetch helper used by the UI.
// - Calls POST /api/<endpoint> (falls back to GET ?query if the route answers 405).
// - Turns any failure into an ApiFail with a plain-language message.
// - Retries rate-limit / timeout style failures a couple of times (Groq free plan is 8K tokens/min).

export class ApiFail extends Error {
  constructor(message, { status = 0, code = null, raw = null } = {}) {
    super(message);
    this.name = "ApiFail";
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

const FRIENDLY = {
  INVALID_REPO_URL: "That doesn't look like a GitHub repository link. Try github.com/owner/repo.",
  REPO_NOT_FOUND: "GitHub can't find that repository. It may be private, or the name may be misspelled.",
  EMPTY_REPO: "This repository has no files yet, so there is nothing to map.",
  GITHUB_RATE_LIMIT: "GitHub's rate limit was reached. Add a GITHUB_TOKEN to .env.local and restart, or wait a few minutes.",
  GITHUB_TOKEN_INVALID: "The GITHUB_TOKEN in .env.local was rejected. Create a new token and restart the server.",
  GITHUB_TIMEOUT: "GitHub took too long to answer. Try again in a moment.",
  GITHUB_ERROR: "GitHub returned an error. Try again in a moment.",
};

const NO_RETRY = new Set(["INVALID_REPO_URL", "REPO_NOT_FOUND", "EMPTY_REPO", "GITHUB_RATE_LIMIT", "GITHUB_TOKEN_INVALID"]);
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

function readError(data, status) {
  const err = data && data.error;
  const code = (err && typeof err === "object" && err.code) || (data && data.code) || null;
  const message =
    (err && typeof err === "object" && err.message) ||
    (typeof err === "string" && err) ||
    (data && data.message) ||
    null;
  const friendly = code && FRIENDLY[code];
  return new ApiFail(friendly || message || `The request failed (status ${status}).`, { status, code, raw: data });
}

export async function callApi(endpoint, body, { signal, onWait, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal };
      let res = await fetch(`/api/${endpoint}`, init);
      if (res.status === 405) {
        const qs = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]));
        res = await fetch(`/api/${endpoint}?${qs}`, { signal });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw readError(data, res.status);
      return data;
    } catch (e) {
      if (e.name === "AbortError") throw e;
      const fail = e instanceof ApiFail ? e : new ApiFail("Could not reach the GitScope server. Is `npm.cmd run dev` still running?", { raw: String(e) });
      const retryable = !NO_RETRY.has(fail.code) && (fail.status === 0 || fail.status === 429 || fail.status === 502 || fail.status === 503 || fail.status === 504);
      if (!retryable || attempt >= retries) throw fail;
      const wait = 3500 * (attempt + 1);
      onWait?.(`The AI service is busy. Retrying in ${Math.round(wait / 1000)}s…`);
      await sleep(wait, signal);
    }
  }
}

// "expressjs/express" -> https://github.com/expressjs/express
export function normalizeRepoInput(input) {
  const v = String(input || "").trim();
  if (!v) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(v)) return `https://github.com/${v}`;
  if (/^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(v)) return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return null;
}
