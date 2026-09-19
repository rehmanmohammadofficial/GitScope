import { ApiError } from "./errors.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 20000;

// Models are tried in this order. Each Groq model has its own free limits,
// so a second model gives you extra room. Change them with GROQ_MODELS in .env.local
// (comma-separated). Model names can change, so check console.groq.com/docs/models.
const DEFAULT_MODELS = "openai/gpt-oss-120b,openai/gpt-oss-20b";

// Marks an error as "worth trying again with the next model".
function retryable(err) {
  err.retryable = true;
  return err;
}

// Groq errors look like { "error": { "message": "...", "code": "..." } }.
async function readError(res) {
  try {
    const data = await res.json();
    return {
      code: String(data?.error?.code ?? ""),
      message: String(data?.error?.message ?? ""),
    };
  } catch {
    return { code: "", message: "" };
  }
}

// Turns a failed Groq response into an error from API_CONTRACT.md.
function groqError(res, code) {
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after"));
    const when = Number.isFinite(wait) && wait > 0 ? `about ${Math.ceil(wait)} seconds` : "a minute";
    return retryable(new ApiError(429, "RATE_LIMITED", `AI rate limit reached. Try again in ${when}.`));
  }
  if (res.status === 413) {
    return retryable(
      new ApiError(502, "AI_ERROR", "This repo is too large for the AI's free limits. Try a smaller repo.")
    );
  }
  if (res.status >= 500 || res.status === 404 || /decommission|not_found|json_validate/i.test(code)) {
    return retryable(new ApiError(502, "AI_ERROR", "The AI service is busy, or the model is unavailable."));
  }
  return new ApiError(
    502,
    "AI_ERROR",
    "The AI service rejected the request. Check GROQ_API_KEY and GROQ_MODELS in .env.local."
  );
}

async function callGroq(model, system, prompt, maxTokens, useReasoning = true) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new ApiError(
      500,
      "SERVER_ERROR",
      "GROQ_API_KEY is missing. Add it to .env.local and restart the server."
    );
  }

  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_completion_tokens: maxTokens,
    response_format: { type: "json_object" },
  };
  // GPT-OSS models "think" before answering. Low effort keeps answers fast and cheap.
  if (useReasoning && model.startsWith("openai/gpt-oss")) {
    body.reasoning_effort = "low";
  }

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw retryable(new ApiError(502, "AI_ERROR", "The AI service did not respond in time."));
  }

  if (!res.ok) {
    const { code, message } = await readError(res);
    // If a model rejects the "reasoning_effort" setting, try the same model once without it.
    if (res.status === 400 && body.reasoning_effort && /reasoning/i.test(message)) {
      return callGroq(model, system, prompt, maxTokens, false);
    }
    throw groqError(res, code);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw retryable(new ApiError(502, "AI_ERROR", "The AI's answer was cut off."));
  }
  // Some models put their thinking in <think> tags. Remove it.
  const text = (choice?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
  if (!text.trim()) {
    throw retryable(new ApiError(502, "AI_ERROR", "The AI returned an empty answer."));
  }
  return text;
}

// The AI is asked for JSON, but sometimes wraps it in ``` fences. Handle both.
function parseJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw retryable(
      new ApiError(502, "AI_ERROR", "The AI returned an answer that could not be read.")
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw retryable(
      new ApiError(502, "AI_ERROR", "The AI returned an answer in the wrong format.")
    );
  }
  return value;
}

// Sends one prompt to Groq and returns the answer as a JavaScript object.
// If a model is busy, rate limited, or answers badly, it tries the next model in GROQ_MODELS.
export async function askAI({ system, prompt, maxTokens = 2000 }) {
  const models = (process.env.GROQ_MODELS || DEFAULT_MODELS)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  let lastError;
  let rateLimitError = null;
  for (const model of models) {
    try {
      return parseJson(await callGroq(model, system, prompt, maxTokens));
    } catch (err) {
      lastError = err;
      if (err.code === "RATE_LIMITED") rateLimitError = err;
      if (!err.retryable) throw err;
      console.warn(`[GitScope] ${model} failed (${err.message}). Trying the next model, if any.`);
    }
  }
  // If any model hit a rate limit, that is the most useful thing to tell the user.
  throw rateLimitError ?? lastError;
}
