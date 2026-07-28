import {
  AnalyticsRequestError,
  trackPageView,
  visitorCookie,
} from "@/lib/analytics";

export async function POST(request: Request) {
  try {
    const result = await trackPageView(request);
    const response = Response.json(
      { ok: true },
      {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
    if (result.isNewCookie) {
      response.headers.append("set-cookie", visitorCookie(result.visitorId));
    }
    return response;
  } catch (error) {
    const knownError = error instanceof AnalyticsRequestError ? error : null;
    const status = knownError?.status || 500;
    return Response.json(
      {
        error:
          status === 500
            ? "Analytics is unavailable."
            : knownError?.message || "Analytics request failed.",
      },
      {
        status,
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
}
