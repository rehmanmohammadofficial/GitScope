import { errorResponse } from "../../../lib/errors.js";
import { readJsonBody } from "../../../lib/http.js";
import { generateSetup } from "../../../lib/setup.js";

// Lets a deployed version (for example on Vercel) wait longer for the AI.
export const maxDuration = 60;

// POST /api/setup
// Request:  { "repoUrl": "https://github.com/owner/repo" }
// Response: { prerequisites, steps, envVariables, troubleshooting, runCommand, confidence }
export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const result = await generateSetup(body?.repoUrl);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
