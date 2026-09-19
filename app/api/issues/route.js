import { errorResponse } from "../../../lib/errors.js";
import { readJsonBody } from "../../../lib/http.js";
import { generateIssues } from "../../../lib/issues.js";

export const maxDuration = 60;

// POST /api/issues
//
// Request:
// {
//   "repoUrl": "https://github.com/owner/repo",
//   "skillLevel": "beginner"
// }
export async function POST(request) {
  try {
    const body = await readJsonBody(request);

    const result = await generateIssues(
      body?.repoUrl,
      body?.skillLevel ?? "beginner"
    );

    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}