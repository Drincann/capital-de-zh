import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

async function readAdoptions(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export async function setAdoptedVersion(projectRoot, unitId, versionId) {
  const root = path.resolve(projectRoot);
  const versionsPath = path.join(root, "manifests", "unit-versions.jsonl");
  const adoptionsPath = path.join(root, "manifests", "adoptions.json");
  const versions = parseJsonl(await readFile(versionsPath, "utf8"));
  const selected = versions.find(
    (version) =>
      version.version_id === versionId && version.unit_id === unitId
  );
  if (!selected) {
    const error = new Error("版本与翻译单元不匹配");
    error.code = "INVALID_VERSION";
    throw error;
  }
  if (selected.review_status === "needs_review") {
    const error = new Error("该版本仍有终审问题，暂不能采用");
    error.code = "VERSION_NEEDS_REVIEW";
    throw error;
  }

  const adoptions = await readAdoptions(adoptionsPath);
  adoptions[unitId] = versionId;
  await writeFile(
    adoptionsPath,
    `${JSON.stringify(adoptions, null, 2)}\n`,
    "utf8"
  );
  return { unitId, versionId };
}
