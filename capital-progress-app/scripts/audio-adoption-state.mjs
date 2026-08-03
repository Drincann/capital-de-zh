import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function readAudioAdoptions(projectRoot) {
  return readJson(path.join(projectRoot, "audio", "adoptions.json"), {});
}

export async function setAdoptedAudioVersion(
  projectRoot,
  unitId,
  translationVersionId,
  audioVersionId,
) {
  const root = path.resolve(projectRoot);
  const translationAdoptions = await readJson(
    path.join(root, "manifests", "adoptions.json"),
    {},
  );
  if (translationAdoptions[unitId] !== translationVersionId) {
    const error = new Error("只能为当前采用的译文选择语音");
    error.code = "TRANSLATION_NOT_ADOPTED";
    throw error;
  }

  const index = await readJson(path.join(root, "audio", "index.json"), {
    audio_versions: [],
  });
  const selected = (index.audio_versions || []).find(
    (audio) =>
      audio.audio_version_id === audioVersionId &&
      audio.unit_id === unitId &&
      audio.translation_version_id === translationVersionId &&
      audio.status === "ready",
  );
  if (!selected) {
    const error = new Error("语音版本不存在、尚未完成或与译文不匹配");
    error.code = "INVALID_AUDIO_VERSION";
    throw error;
  }

  const adoptionsPath = path.join(root, "audio", "adoptions.json");
  const adoptions = await readJson(adoptionsPath, {});
  adoptions[translationVersionId] = audioVersionId;
  await writeJsonAtomic(adoptionsPath, adoptions);
  return { unitId, translationVersionId, audioVersionId };
}
