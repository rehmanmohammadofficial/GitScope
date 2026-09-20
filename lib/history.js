"use client";

// GitScope activity history.
// Self-contained: builds its own Supabase browser client from the same env
// vars the login page uses, so it does not depend on any other lib/ file.
//
// Writing rules:
//   - logRepoAnalysis / logDiscoverSearch NEVER throw and never block the UI.
//     If Supabase is missing, the user is signed out, or the table does not
//     exist yet, they quietly do nothing.
//   - getHistory / deleteEntry / clearHistory DO throw, so the page can show
//     an error with a Retry button.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const TABLE = "history";
const DEDUPE_MS = 60_000; // same thing twice inside a minute is logged once

let client = null;
const recentWrites = new Map();

export function historyReady() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function sb() {
  if (!historyReady()) return null;
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

export async function currentUserId() {
  const c = sb();
  if (!c) return null;
  try {
    const { data } = await c.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

function isDuplicate(key) {
  const now = Date.now();
  const last = recentWrites.get(key);
  if (last && now - last < DEDUPE_MS) return true;
  recentWrites.set(key, now);
  if (recentWrites.size > 50) {
    recentWrites.delete(recentWrites.keys().next().value);
  }
  return false;
}

async function insert(row, dedupeKey) {
  try {
    if (dedupeKey && isDuplicate(dedupeKey)) return null;
    const c = sb();
    if (!c) return null;
    const userId = await currentUserId();
    if (!userId) return null;

    const { data, error } = await c
      .from(TABLE)
      .insert({ ...row, user_id: userId })
      .select()
      .single();

    if (error) {
      console.warn("[history] could not save:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[history] could not save:", err?.message || err);
    return null;
  }
}

/**
 * Call after a repo analysis finishes.
 * All fields optional except owner + name (or fullName).
 */
export function logRepoAnalysis(info = {}) {
  const fullName =
    info.fullName ||
    (info.owner && info.name ? `${info.owner}/${info.name}` : null);
  if (!fullName) return Promise.resolve(null);

  return insert(
    {
      kind: "repo",
      title: fullName,
      subtitle: info.description || null,
      meta: {
        fullName,
        url: info.url || `https://github.com/${fullName}`,
        skillLevel: info.skillLevel || null,
        aiUsed: info.aiUsed !== false,
        moduleCount: info.moduleCount ?? null,
        issueCount: info.issueCount ?? null,
        language: info.language || null,
      },
    },
    `repo:${fullName}:${info.skillLevel || ""}`
  );
}

/**
 * Call when Discover results land.
 */
export function logDiscoverSearch(info = {}) {
  const language = info.language || null;
  const labels = Array.isArray(info.labels) ? info.labels : [];
  const minStars = info.minStars ?? 0;

  return insert(
    {
      kind: "search",
      title: language || "Any language",
      subtitle: labels.length ? labels.join(", ") : null,
      meta: {
        language,
        labels,
        minStars,
        resultCount: info.resultCount ?? null,
      },
    },
    `search:${language || "any"}:${labels.join("|")}:${minStars}`
  );
}

export async function getHistory({ kind = "all", limit = 100 } = {}) {
  if (!historyReady()) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local and restart the dev server."
    );
  }
  const c = sb();
  const userId = await currentUserId();
  if (!userId) {
    const err = new Error("Sign in to see your history.");
    err.code = "NO_SESSION";
    throw err;
  }

  let query = c
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (kind === "repo" || kind === "search") query = query.eq("kind", kind);

  const { data, error } = await query;
  if (error) {
    if (/relation .* does not exist/i.test(error.message)) {
      throw new Error(
        "The history table is missing. Run supabase/history.sql in your Supabase SQL editor."
      );
    }
    throw new Error(error.message);
  }
  return data || [];
}

export async function deleteEntry(id) {
  const c = sb();
  if (!c) throw new Error("Supabase is not configured.");
  const { error } = await c.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function clearHistory() {
  const c = sb();
  if (!c) throw new Error("Supabase is not configured.");
  const userId = await currentUserId();
  if (!userId) throw new Error("Sign in first.");
  const { error } = await c.from(TABLE).delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** Rebuild the /discover query string for a saved search row. */
export function searchHref(meta = {}) {
  const params = new URLSearchParams();
  if (meta.language) params.set("language", meta.language);
  if (Array.isArray(meta.labels) && meta.labels.length) {
    params.set("labels", meta.labels.join(","));
  }
  if (meta.minStars) params.set("minStars", String(meta.minStars));
  const qs = params.toString();
  return qs ? `/discover?${qs}` : "/discover";
}
