import { NextResponse } from "next/server";
import { generateArchitecture } from "../../../lib/architecture.js";

export async function POST(request) {
  try {
    const body = await request.json();

    const repoUrl = body?.repoUrl;

    if (
      typeof repoUrl !== "string" ||
      !repoUrl.trim()
    ) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "repoUrl is required.",
          },
        },
        { status: 400 }
      );
    }

    const result =
      await generateArchitecture(
        repoUrl
      );

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "[GitScope] /api/architecture error:",
      error
    );

    return NextResponse.json(
      {
        error: {
          code:
            error?.code ??
            "SERVER_ERROR",
          message:
            error?.message ??
            "Something went wrong while analyzing the repository.",
        },
      },
      {
        status:
          Number.isInteger(error?.status)
            ? error.status
            : 500,
      }
    );
  }
}