/// <reference types="vite/client" />

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReaderApp } from "@/app/ReaderApp";
import releaseManifest from "@/generated/release-manifest.json";
import "@/app/globals.css";

function staticReleaseValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => staticReleaseValue(item)) as T;
  }
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "audioManifestPath") continue;
    if (key === "contentPath" && typeof item === "string") {
      result[key] = `${import.meta.env.BASE_URL}${item.replace(/^\//, "")}`;
      continue;
    }
    result[key] = staticReleaseValue(item);
  }
  return result as T;
}

const staticRelease = staticReleaseValue(releaseManifest);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReaderApp
      release={staticRelease}
      viewer={{
        signedIn: false,
        isOwner: false,
        displayName: "",
        signInHref: "#",
        signOutHref: "#",
      }}
      features={{ analytics: false, audio: false, notes: false }}
    />
  </StrictMode>,
);
