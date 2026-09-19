// An error that carries an HTTP status and a code from API_CONTRACT.md.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Turns any error into the JSON shape the contract defines:
// { "error": { "code": "...", "message": "..." } }
export function errorResponse(err) {
  if (err instanceof ApiError) {
    return Response.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status }
    );
  }
  console.error(err);
  return Response.json(
    {
      error: {
        code: "SERVER_ERROR",
        message: "Something went wrong on the server.",
      },
    },
    { status: 500 }
  );
}
