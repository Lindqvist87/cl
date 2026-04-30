import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function requireAdminJobToken(request: Request) {
  const configuredToken = process.env.ADMIN_JOB_TOKEN;

  if (!configuredToken) {
    return NextResponse.json(
      { error: "ADMIN_JOB_TOKEN is not configured." },
      { status: 503 }
    );
  }

  const requestToken = adminJobTokenFromRequest(request);

  if (!requestToken || !safeTokenEquals(requestToken, configuredToken)) {
    return NextResponse.json(
      { error: "Unauthorized." },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Bearer realm="admin-jobs"'
        }
      }
    );
  }

  return null;
}

export function adminJobTokenFromRequest(request: Request) {
  const headerToken = request.headers.get("x-admin-job-token");
  if (headerToken) {
    return headerToken.trim();
  }

  const authorization = request.headers.get("authorization");
  const [scheme, ...parts] = authorization?.split(/\s+/) ?? [];
  if (scheme?.toLowerCase() === "bearer" && parts.length > 0) {
    return parts.join(" ").trim();
  }

  return null;
}

function safeTokenEquals(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
