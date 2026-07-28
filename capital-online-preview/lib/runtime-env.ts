import { env } from "cloudflare:workers";

type RuntimeEnvironment = {
  ANALYTICS_ID_SECRET?: string;
  ANALYTICS_OWNER_EMAIL?: string;
};

function runtimeEnvironment(): RuntimeEnvironment {
  return env as unknown as RuntimeEnvironment;
}

export function analyticsSecret(hostname = ""): string {
  const configured = runtimeEnvironment().ANALYTICS_ID_SECRET?.trim();
  if (configured) return configured;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "capital-online-preview-local-development";
  }
  throw new Error("Analytics identifier secret is not configured.");
}

export function analyticsOwnerEmail(): string {
  return runtimeEnvironment().ANALYTICS_OWNER_EMAIL?.trim().toLowerCase() || "";
}
