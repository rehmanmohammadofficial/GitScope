import {
  fileRef,
  getOpenIssueCount,
  getOpenIssues,
  getRepoContext,
} from "./github.js";
import { askAI } from "./ai.js";

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

const LEVELS = new Set([
  "beginner",
  "intermediate",
  "advanced",
]);

const isText = (value) =>
  typeof value === "string" && value.trim() !== "";

const clip = (value, max) =>
  isText(value) ? value.trim().slice(0, max) : "";

const SYSTEM = `You are GitScope, an open-source contribution assistant.

You are given REAL GitHub issues and the REAL file tree of a repository.

Your job is to estimate which issues are suitable for the requested skill level.

IMPORTANT:
- Never invent an issue.
- Never invent a file path.
- Only use issues provided in the prompt.
- Only use file paths provided in the prompt.
- If you cannot identify likely files, return an empty list.
- Difficulty is an estimate based only on the supplied information.
- Do not claim certainty.
- Return JSON only.`;

/*
 * Find a small set of REAL repository files that are likely
 * related to an issue.
 *
 * This is done before sending the issue to the AI so that the AI
 * does not have to search through thousands of repository files.
 */
function getCandidateFiles(issue, files) {
  const text = `${issue.title} ${issue.body} ${issue.labels.join(" ")}`.toLowerCase();

  const scored = files.map((file) => {
    const path = file.path.toLowerCase();
    let score = 0;

    // Dependency/package issues
    if (
      /(dependenc|package|npm|yarn|pnpm|version|vulnerab|cve|security)/i.test(
        text
      )
    ) {
      if (path === "package.json") {
        score += 20;
      }

      if (
        path === "package-lock.json" ||
        path === "yarn.lock" ||
        path === "pnpm-lock.yaml"
      ) {
        score += 18;
      }
    }

    // Documentation issues
    if (
      /(doc|documentation|readme|typo|wording)/i.test(text)
    ) {
      if (path === "readme.md") {
        score += 20;
      }

      if (path.includes("docs/")) {
        score += 15;
      }

      if (path.endsWith(".md")) {
        score += 10;
      }
    }

    // Test issues
    if (
      /(test|testing|spec|coverage)/i.test(text)
    ) {
      if (
        path.includes("test") ||
        path.includes("spec")
      ) {
        score += 15;
      }
    }

    // Configuration issues
    if (
      /(config|configuration|environment|env|eslint|prettier|typescript)/i.test(
        text
      )
    ) {
      if (
        path.includes("config") ||
        path === ".env.example" ||
        path.includes("eslint") ||
        path.includes("prettier") ||
        path.includes("tsconfig")
      ) {
        score += 15;
      }
    }

    // General source-code issues
    if (
      /(bug|fix|error|crash|feature|function|middleware|route|api|ui|component)/i.test(
        text
      )
    ) {
      if (
        /\.(js|jsx|ts|tsx)$/.test(path) &&
        !path.includes("node_modules/")
      ) {
        score += 5;
      }
    }

    // Never suggest generated/dependency directories.
    if (
      path.includes("node_modules/") ||
      path.includes(".next/") ||
      path.includes("dist/") ||
      path.includes("build/")
    ) {
      score -= 100;
    }

    return {
      path: file.path,
      score,
    };
  });

  return scored
    .filter((file) => file.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((file) => file.path);
}

function buildPrompt(repo, skillLevel, issues, files) {
  const issueText = issues
    .map((issue) => {
      const candidates = getCandidateFiles(issue, files);

      return `=== ISSUE #${issue.number} ===
Title: ${issue.title}
Labels: ${issue.labels.join(", ") || "none"}
Comments: ${issue.comments}
URL: ${issue.url}

Body:
${clip(issue.body, 900)}

CANDIDATE FILES:
${
  candidates.length
    ? candidates.join("\n")
    : "No obvious candidate files found."
}`;
    })
    .join("\n\n");

  return `Repository: ${repo.fullName}
Description: ${repo.description ?? "none"}
Main language: ${repo.language ?? "unknown"}

Requested skill level: ${skillLevel}

REAL OPEN ISSUES:
${issueText}

You are ranking real GitHub issues for a contributor.

Return EXACTLY this JSON:

{
  "issues": [
    {
      "number": 123,
      "difficulty": "beginner",
      "reason": "Short explanation.",
      "likelyFiles": [
        "package.json"
      ]
    }
  ]
}

Rules:
- Only use issue numbers provided above.
- Only use candidate file paths provided under that issue.
- NEVER invent a file path.
- If no candidate file is reasonably related, return [].
- difficulty must be beginner, intermediate, or advanced.
- Return at most 8 issues.
- Keep reasons under 200 characters.
- Return JSON only.`;
}

function validateAI(ai, issues, repo, files, skillLevel) {
  const issueMap = new Map(
    issues.map((issue) => [issue.number, issue])
  );

  // Final safety check:
  // Only files that actually exist in the repository can survive.
  const fileMap = new Map(
    files.map((file) => [
      file.path.toLowerCase(),
      file.path,
    ])
  );

  const output = [];

  for (const item of Array.isArray(ai?.issues)
    ? ai.issues
    : []) {
    const number = Number(item?.number);

    if (!issueMap.has(number)) continue;

    const original = issueMap.get(number);

    const difficulty = LEVELS.has(item?.difficulty)
      ? item.difficulty
      : "intermediate";

    const likelyFiles = [
      ...new Set(
        (Array.isArray(item?.likelyFiles)
          ? item.likelyFiles
          : []
        )
          .filter(isText)
          .map((path) =>
            fileMap.get(path.trim().toLowerCase())
          )
          .filter(Boolean)
      ),
    ].slice(0, 5);

    output.push({
      number,
      title: original.title,
      url: original.url,
      labels: original.labels,
      difficulty,
      reason:
        clip(item?.reason, 200) ||
        "The issue appears relevant to this skill level.",
      likelyFiles: likelyFiles.map((path) =>
        fileRef(repo, path)
      ),
    });

    if (output.length >= 8) break;
  }

  // Put issues matching the requested level first.
  output.sort((a, b) => {
    const aMatch =
      a.difficulty === skillLevel ? 0 : 1;

    const bMatch =
      b.difficulty === skillLevel ? 0 : 1;

    if (aMatch !== bMatch) {
      return aMatch - bMatch;
    }

    const order = {
      beginner: 0,
      intermediate: 1,
      advanced: 2,
    };

    return (
      order[a.difficulty] -
      order[b.difficulty]
    );
  });

  return output;
}

export async function generateIssues(
  repoUrl,
  skillLevel = "beginner"
) {
  const level = String(skillLevel).toLowerCase();

  if (!LEVELS.has(level)) {
    throw new Error(
      "skillLevel must be beginner, intermediate, or advanced."
    );
  }

  const { repo, files } =
    await getRepoContext(repoUrl);

  // Skill level is deliberately part of the cache key.
  const cacheKey =
    `${repo.fullName.toLowerCase()}:${level}`;

  const cached = cache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.time < CACHE_MS
  ) {
    return cached.value;
  }

  const [issues, totalOpen] =
    await Promise.all([
      getOpenIssues(repo, 30),
      getOpenIssueCount(repo),
    ]);

  if (issues.length === 0) {
    const value = {
      skillLevel: level,
      totalOpen,
      issues: [],
    };

    cache.set(cacheKey, {
      time: Date.now(),
      value,
    });

    return value;
  }

  const ai = await askAI({
    system: SYSTEM,
    prompt: buildPrompt(
      repo,
      level,
      issues,
      files
    ),
    maxTokens: 1800,
  });

  const ranked = validateAI(
    ai,
    issues,
    repo,
    files,
    level
  );

  const value = {
    skillLevel: level,
    totalOpen,
    issues: ranked,
  };

  cache.set(cacheKey, {
    time: Date.now(),
    value,
  });

  return value;
}