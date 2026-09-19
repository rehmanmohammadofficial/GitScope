import { ApiError, errorResponse } from "../../../lib/errors.js";
import { getRepoContext } from "../../../lib/github.js";

// POST /api/repo
// Request:  { "repoUrl": "https://github.com/owner/repo" }
// Response: { "repo": { ... }, "warnings": [] }
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_REQUEST", "Request body must be JSON.");
    }

    const { repo, warnings } = await getRepoContext(body?.repoUrl);
    return Response.json({ repo, warnings });
  } catch (err) {
    return errorResponse(err);
  }
}
