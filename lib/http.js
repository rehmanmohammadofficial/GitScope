import { ApiError } from "./errors.js";

// Reads the JSON body of a request, or throws the contract's INVALID_REQUEST error.
export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "INVALID_REQUEST", "Request body must be JSON.");
  }
}
