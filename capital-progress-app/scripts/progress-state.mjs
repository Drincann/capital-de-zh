import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROJECT_ROOT = path.resolve(
  process.cwd(),
  "..",
  "outputs",
  "capital-volume1-de-zh-new"
);

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const GENERATION_STALE_AFTER_MS = 7 * 60 * 1000;

export function audioStateFor(
  version,
  unitId,
  adoptedVersionId,
  audioVersions,
  now = Date.now(),
  audioModels = [],
  audioAdoptions = null,
  audioPublications = {}
) {
  const matching = audioVersions
    .filter(
      (audio) =>
        audio.unit_id === unitId &&
        audio.translation_version_id === version.id &&
        audio.translation_sha256 === version.translationSha256
    )
    .sort((left, right) =>
      String(right.updated_at || "").localeCompare(
        String(left.updated_at || "")
      )
    );
  const hasOlderAudio = audioVersions.some(
    (audio) => audio.unit_id === unitId && audio.status === "ready"
  );

  const modelIdFor = (audio) =>
    audio.model_id || audio.model || "seed-audio-1.0";
  const catalog = audioModels.length
    ? audioModels
    : [...new Set(matching.map(modelIdFor))].map((id) => ({
        id,
        label: id === "seed-audio-1.0" ? "现有模型 1.0" : id,
      }));
  if (!catalog.length) {
    catalog.push({ id: "seed-audio-1.0", label: "现有模型 1.0" });
  }
  const modelById = new Map(catalog.map((model) => [model.id, model]));
  const publicationLabels = {
    published: "已上线",
    uploaded: "已上传",
    uploading: "上传中",
    queued: "等待上传",
    failed: "上传失败",
    pending: "待上传",
  };
  const normalizedRecord = (audio) => {
    const lastUpdate = Date.parse(audio?.updated_at || "");
    const interrupted =
      audio?.status === "generating" &&
      Number.isFinite(lastUpdate) &&
      now - lastUpdate > GENERATION_STALE_AFTER_MS;
    const modelId = modelIdFor(audio);
    const storedPublication =
      audioPublications.audio_versions?.[audio.audio_version_id] || {};
    const remoteActive =
      audioPublications.adoptions?.[version.id] === audio.audio_version_id;
    const publicationStatus = remoteActive
      ? "published"
      : ["published", "uploaded"].includes(storedPublication.status)
        ? "uploaded"
        : storedPublication.status || "pending";
    const completedFiles = Number(storedPublication.completed_files || 0);
    const totalFiles = Number(storedPublication.file_count || 0);
    const publicationLabel =
      publicationStatus === "uploading" && totalFiles
        ? `上传中 ${completedFiles}/${totalFiles}`
        : publicationLabels[publicationStatus] || publicationStatus;
    return {
      id: audio.audio_version_id,
      audioVersionId: audio.audio_version_id,
      modelId,
      modelLabel:
        audio.model_label || modelById.get(modelId)?.label || modelId,
      status: interrupted ? "interrupted" : audio.status,
      adopted: false,
      completedChunks: Number(audio.completed_chunks || 0),
      chunkCount: Number(audio.chunk_count || 0),
      sentenceCount: Number(audio.sentence_count || 0),
      durationMs: Number(audio.duration_ms || 0),
      updatedAt: audio.updated_at || "",
      error:
        audio.error ||
        (interrupted
          ? "生成任务长时间没有进展，可以从已有分块继续。"
          : ""),
      publication: {
        status: publicationStatus,
        label: publicationLabel,
        remoteActive,
        canPublish: false,
        completedFiles,
        totalFiles,
        error: storedPublication.error || "",
        publishedAt: storedPublication.published_at || "",
      },
    };
  };
  const versions = matching.map(normalizedRecord);
  const fallbackAdoption = versions.find((audio) => audio.status === "ready")?.id;
  const adoptedAudioVersionId =
    (audioAdoptions ? audioAdoptions[version.id] : fallbackAdoption) || "";
  for (const audio of versions) {
    audio.adopted = audio.id === adoptedAudioVersionId;
    audio.publication.canPublish =
      audio.adopted &&
      audio.status === "ready" &&
      !audio.publication.remoteActive;
  }
  const adoptedAudio = versions.find(
    (audio) => audio.adopted && audio.status === "ready"
  );

  const models = catalog.map((model) => {
    const modelVersions = versions.filter(
      (audio) => audio.modelId === model.id
    );
    const latest = modelVersions[0];
    const ready = modelVersions.find((audio) => audio.status === "ready");
    const current = latest?.status === "generating" ? latest : ready || latest;
    const status = current?.status || "missing";
    return {
      id: model.id,
      label: model.label || model.id,
      description: model.description || "",
      status,
      audioVersionId: current?.id || "",
      canGenerate:
        version.id === adoptedVersionId &&
        !modelVersions.some((audio) =>
          ["ready", "generating"].includes(audio.status)
        ),
      completedChunks: current?.completedChunks || 0,
      chunkCount: current?.chunkCount || 0,
      error: current?.error || "",
    };
  });

  const latest = versions[0];
  const readyCount = versions.filter((audio) => audio.status === "ready").length;
  const status = adoptedAudio
    ? "ready"
    : readyCount
      ? "unadopted"
      : latest?.status || (hasOlderAudio ? "stale" : "missing");
  const labels = {
    ready: "语音已完成",
    unadopted: readyCount > 1 ? `${readyCount} 个语音版本待选择` : "语音待选择",
    generating: "语音生成中",
    interrupted: "语音生成已中断",
    failed: "语音生成失败",
    stale: "译文已更新",
    missing: "暂无语音",
  };
  return {
    status,
    label: labels[status] || status,
    exact: Boolean(matching.length),
    adopted: version.id === adoptedVersionId,
    canGenerate: models.some((model) => model.canGenerate),
    audioVersionId: adoptedAudio?.id || "",
    adoptedAudioVersionId: adoptedAudio?.id || "",
    completedChunks: adoptedAudio?.completedChunks || latest?.completedChunks || 0,
    chunkCount: adoptedAudio?.chunkCount || latest?.chunkCount || 0,
    sentenceCount: adoptedAudio?.sentenceCount || 0,
    durationMs: adoptedAudio?.durationMs || 0,
    updatedAt: adoptedAudio?.updatedAt || latest?.updatedAt || "",
    error: latest?.error || "",
    versions,
    models,
    publication: adoptedAudio?.publication || {
      status: "unavailable",
      label: "暂无可上传语音",
      canPublish: false,
      remoteActive: false,
      error: "",
    },
  };
}

export function collapseIdenticalVersions(versions) {
  const distinct = new Map();
  versions.forEach((version) => {
    const normalized = version.preview.replace(/\r\n/g, "\n").trim();
    const key = normalized || `missing:${version.id}`;
    const existing = distinct.get(key);
    if (!existing || (!existing.adopted && version.adopted)) {
      distinct.set(key, version);
    }
  });
  return [...distinct.values()].sort((a, b) => b.number - a.number);
}

async function optionalText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function optionalMtime(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

function projectFile(root, file) {
  if (!file) return "";
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function timeValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function unitState(status) {
  if (["assembled", "user_approved", "released"].includes(status)) {
    return { id: "completed", label: "已完成", progress: 100 };
  }
  if (
    [
      "in_progress",
      "drafted",
      "meaning_reviewed",
      "readability_reviewed",
    ].includes(status)
  ) {
    const progress = {
      in_progress: 30,
      drafted: 58,
      meaning_reviewed: 76,
      readability_reviewed: 90,
    }[status];
    return { id: "in_progress", label: "进行中", progress };
  }
  if (["source_locked", "chunked"].includes(status)) {
    return {
      id: "source_ready",
      label: status === "chunked" ? "已拆分" : "原文已准备",
      progress: status === "chunked" ? 20 : 10,
    };
  }
  return { id: "planned", label: "未开始", progress: 0 };
}

function taskState(status) {
  return {
    pending: { label: "未开始", progress: 0 },
    in_progress: { label: "初译中", progress: 20 },
    drafted: { label: "初译完成", progress: 50 },
    meaning_reviewed: { label: "意义校对完成", progress: 72 },
    readability_reviewed: { label: "可读性校对完成", progress: 90 },
    approved: { label: "完成", progress: 100 },
    superseded: { label: "已替换", progress: 0 },
  }[status] || { label: status, progress: 0 };
}

function chineseNumber(value) {
  const numbers = [
    "",
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
    "十",
  ];
  if (value <= 10) return numbers[value];
  if (value < 20) return `十${numbers[value - 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${numbers[tens]}十${numbers[ones]}`;
}

export async function createProgressState(projectRoot = DEFAULT_PROJECT_ROOT) {
  const root = path.resolve(projectRoot);
  const projectPath = path.join(root, "project.json");
  const outlinePath = path.join(root, "manifests", "outline.json");
  const workUnitsPath = path.join(root, "manifests", "work-units.jsonl");
  const chaptersPath = path.join(root, "manifests", "chapters.jsonl");
  const tasksPath = path.join(root, "manifests", "tasks.jsonl");
  const unitVersionsPath = path.join(
    root,
    "manifests",
    "unit-versions.jsonl"
  );
  const adoptionsPath = path.join(root, "manifests", "adoptions.json");
  const releasesPath = path.join(root, "manifests", "releases.jsonl");
  const eventsPath = path.join(root, "progress", "events.jsonl");
  const audioIndexPath = path.join(root, "audio", "index.json");
  const audioModelsPath = path.join(root, "audio", "models.json");
  const audioAdoptionsPath = path.join(root, "audio", "adoptions.json");
  const audioPublicationsPath = path.join(root, "audio", "publications.json");

  const [
    projectText,
    outlineText,
    workUnitsText,
    chaptersText,
    tasksText,
    unitVersionsText,
    adoptionsText,
    releasesText,
    eventsText,
    audioIndexText,
    audioModelsText,
    audioAdoptionsText,
    audioPublicationsText,
  ] = await Promise.all([
    readFile(projectPath, "utf8"),
    readFile(outlinePath, "utf8"),
    readFile(workUnitsPath, "utf8"),
    readFile(chaptersPath, "utf8"),
    readFile(tasksPath, "utf8"),
    optionalText(unitVersionsPath),
    optionalText(adoptionsPath),
    optionalText(releasesPath),
    readFile(eventsPath, "utf8"),
    optionalText(audioIndexPath),
    optionalText(audioModelsPath),
    optionalText(audioAdoptionsPath),
    optionalText(audioPublicationsPath),
  ]);

  const project = JSON.parse(projectText);
  const outline = JSON.parse(outlineText);
  const workUnits = parseJsonl(workUnitsText);
  const controllerChapters = parseJsonl(chaptersText);
  const allTasks = parseJsonl(tasksText);
  const unitVersions = parseJsonl(unitVersionsText);
  const adoptions = adoptionsText.trim() ? JSON.parse(adoptionsText) : {};
  const releases = parseJsonl(releasesText);
  const events = parseJsonl(eventsText);
  const audioIndex = audioIndexText.trim()
    ? JSON.parse(audioIndexText)
    : { audio_versions: [], jobs: [] };
  const audioVersions = audioIndex.audio_versions || [];
  const audioModelsCatalog = audioModelsText.trim()
    ? JSON.parse(audioModelsText)
    : { models: [] };
  const audioModels = audioModelsCatalog.models || [];
  const audioAdoptions = audioAdoptionsText.trim()
    ? JSON.parse(audioAdoptionsText)
    : {};
  const audioPublications = audioPublicationsText.trim()
    ? JSON.parse(audioPublicationsText)
    : { audio_versions: {}, adoptions: {} };
  const controllerById = new Map(
    controllerChapters.map((chapter) => [chapter.chapter_id, chapter])
  );

  const activeUnits = await Promise.all(
    workUnits.map(async (definition) => {
      const controller = controllerById.get(definition.controller_chapter_id);
      let status = unitState(controller?.status);
      const tasks = allTasks.filter(
        (task) =>
          task.chapter_id === definition.controller_chapter_id &&
          task.status !== "superseded"
      );
      if (
        ["source_locked", "chunked"].includes(controller?.status) &&
        tasks.some((task) => !["pending", "superseded"].includes(task.status))
      ) {
        const taskProgress = tasks.map(
          (task) => taskState(task.status).progress
        );
        status = {
          id: "in_progress",
          label: "进行中",
          progress: Math.round(
            taskProgress.reduce((sum, value) => sum + value, 0) /
              taskProgress.length
          ),
        };
      }
      const outputPath = controller?.output_path || definition.output_path;
      const fallbackPreview = outputPath
        ? await optionalText(projectFile(root, outputPath))
        : "";
      const recordedVersions = unitVersions
        .filter((version) => version.unit_id === definition.unit_id)
        .sort((a, b) => Number(b.number) - Number(a.number));
      const adoptedVersionId = adoptions[definition.unit_id] || "";
      const hasNeedsReviewVersion = recordedVersions.some(
        (version) => version.review_status === "needs_review"
      );
      if (controller?.status === "assembled" && !adoptedVersionId) {
        status = hasNeedsReviewVersion
          ? { id: "needs_review", label: "待复核", progress: 95 }
          : { id: "in_progress", label: "审核中", progress: 94 };
      }
      const versionPreviews = await Promise.all(
        recordedVersions.map(async (version) => {
          const artifact = await optionalText(
            projectFile(root, version.artifact_path)
          );
          const base = {
            id: version.version_id,
            number: Number(version.number),
            label: `第 ${Number(version.number)} 版`,
            status:
              adoptions[definition.unit_id] === version.version_id
                ? "已采用"
                : "可选",
            adopted: adoptions[definition.unit_id] === version.version_id,
            updatedAt: version.created_at || "",
            taskCount: (version.source_task_revisions || []).length,
            summary: version.summary || "",
            reviewStatus: version.review_status || "",
            reviewNote: version.review_note || "",
            preview: artifact.trim(),
            translationSha256: artifact ? sha256(artifact) : "",
          };
          return {
            ...base,
            audio: audioStateFor(
              base,
              definition.unit_id,
              adoptedVersionId,
              audioVersions,
              Date.now(),
              audioModels,
              audioAdoptions,
              audioPublications
            ),
          };
        })
      );
      const versions = collapseIdenticalVersions(versionPreviews);
      const current =
        versions.find((version) => version.id === adoptedVersionId) ||
        versions[0];
      const taskSummaries = await Promise.all(
        tasks.map(async (task) => {
          const state = taskState(task.status);
          return {
            id: task.task_id,
            status: task.status,
            statusLabel: state.label,
            progress: state.progress,
            revision: Number(task.revision || 1),
            preview: (
              await optionalText(projectFile(root, task.artifact_path))
            ).trim(),
          };
        })
      );
      const approvedTasks = taskSummaries.filter(
        (task) => task.status === "approved"
      ).length;

      return {
        ...definition,
        status: status.id,
        statusLabel: status.label,
        progress: status.progress,
        versionCount: versions.length,
        currentVersion: current?.number || 0,
        currentVersionId: current?.id || "",
        adoptedVersionId,
        updatedAt: controller?.last_updated || "",
        preview: current?.preview || fallbackPreview.trim(),
        taskCount: taskSummaries.length,
        approvedTaskCount: approvedTasks,
        tasks: taskSummaries,
        versions: versions.map((version) => ({
          ...version,
          taskCount:
            version.taskCount ||
            taskSummaries.filter(
              (task) => task.revision === version.number
            ).length,
        })),
        audio: current?.audio || {
          status: "missing",
          label: "暂无语音",
          exact: false,
          adopted: false,
          canGenerate: false,
        },
      };
    })
  );
  const unitsById = new Map(activeUnits.map((unit) => [unit.unit_id, unit]));
  const frontMatter = (outline.front_matter || []).map((definition) => {
    const active = unitsById.get(definition.unit_id) || {
      unit_id: definition.unit_id,
      chapter_id: definition.unit_id,
      number: definition.number,
      title_zh: definition.title_zh,
      status: "planned",
      statusLabel: "未开始",
      progress: 0,
      versionCount: 0,
      currentVersion: 0,
      preview: "",
      taskCount: 0,
      approvedTaskCount: 0,
      tasks: [],
      versions: [],
    };
    return {
      id: definition.unit_id,
      number: definition.number,
      title: definition.title_zh,
      author: definition.author_zh || "",
      frontMatter: true,
      status: active.status,
      statusLabel: active.statusLabel,
      versionCount: active.versionCount,
      completedSections: active.status === "completed" ? 1 : 0,
      totalSections: 1,
      progress: active.progress,
      sections: [active],
    };
  });

  const parts = outline.parts.map((part) => ({
    id: part.part_id,
    number: part.number,
    title: part.title_zh,
    chapters: part.chapters.map((definition) => {
      const definedSections = definition.sections || [];
      const activeForChapter = activeUnits.filter(
        (unit) => unit.chapter_id === definition.chapter_id
      );
      const sections = definedSections.length
        ? definedSections.map((section) => {
            const active = unitsById.get(section.section_id);
            return (
              active || {
                unit_id: section.section_id,
                chapter_id: definition.chapter_id,
                number: section.number,
                title_zh: section.title_zh,
                status: "planned",
                statusLabel: "未开始",
                progress: 0,
                versionCount: 0,
                currentVersion: 0,
                preview: "",
                taskCount: 0,
                approvedTaskCount: 0,
                tasks: [],
                versions: [],
              }
            );
          })
        : activeForChapter;

      const completedSections = activeForChapter.filter(
        (unit) => unit.status === "completed"
      ).length;
      const hasActiveWork = activeForChapter.some(
        (unit) =>
          unit.status === "in_progress" ||
          unit.status === "needs_review" ||
          unit.status === "completed"
      );
      const hasPreparedSource = activeForChapter.some(
        (unit) => unit.status === "source_ready"
      );
      const totalSections = Number(definition.section_count || 1);
      let status = "planned";
      let statusLabel = "未开始";
      if (
        completedSections > 0 &&
        completedSections >= totalSections
      ) {
        status = "completed";
        statusLabel = "已完成";
      } else if (hasActiveWork) {
        status = "in_progress";
        statusLabel = "进行中";
      } else if (hasPreparedSource) {
        status = "source_ready";
        statusLabel = "原文已准备";
      }
      const versionCount = Math.max(
        0,
        ...activeForChapter.map((unit) => unit.versionCount)
      );

      return {
        id: definition.chapter_id,
        number: definition.number,
        numberLabel: `第${chineseNumber(definition.number)}章`,
        title: definition.title_zh,
        status,
        statusLabel,
        versionCount,
        completedSections,
        totalSections,
        progress: Math.round((completedSections / totalSections) * 100),
        sections,
      };
    }),
  }));

  const chapters = parts.flatMap((part) =>
    part.chapters.map((chapter) => ({
      ...chapter,
      partId: part.id,
      partNumber: part.number,
      partTitle: part.title,
    }))
  );
  const completedUnits = activeUnits.filter(
    (unit) => unit.status === "completed"
  ).length;
  const versionCount = activeUnits.reduce(
    (sum, unit) => sum + unit.versionCount,
    0
  );
  const trackedPaths = [
    projectPath,
    outlinePath,
    workUnitsPath,
    chaptersPath,
    tasksPath,
    releasesPath,
    unitVersionsPath,
    adoptionsPath,
    eventsPath,
    audioIndexPath,
    audioModelsPath,
    audioAdoptionsPath,
    audioPublicationsPath,
    ...activeUnits
      .map((unit) => unit.output_path)
      .filter(Boolean)
      .map((file) => projectFile(root, file)),
    ...unitVersions.map((version) =>
      projectFile(root, version.artifact_path)
    ),
  ];
  const mtimes = await Promise.all(trackedPaths.map(optionalMtime));
  const latest =
    Math.max(
      timeValue(project.last_updated),
      ...controllerChapters.map((chapter) =>
        timeValue(chapter.last_updated)
      ),
      ...events.map((event) => timeValue(event.time)),
      ...mtimes
    ) || Date.now();

  return {
    projectTitle: project.title,
    outlineVersion: outline.outline_version,
    updatedAt: new Date(latest).toISOString(),
    defaultChapterId: "ch01",
    book: {
      title: outline.title_zh,
      partCount: parts.length,
      chapterCount: chapters.length,
      completedChapterCount: chapters.filter(
        (chapter) => chapter.status === "completed"
      ).length,
      activeChapterCount: chapters.filter(
        (chapter) => chapter.status === "in_progress"
      ).length,
      preparedChapterCount: chapters.filter(
        (chapter) => chapter.status === "source_ready"
      ).length,
      completedUnitCount: completedUnits,
      versionCount,
      readyAudioCount: audioVersions.filter((item) => item.status === "ready")
        .length,
      generatingAudioCount: audioVersions.filter(
        (item) => item.status === "generating"
      ).length,
      frontMatterCount: frontMatter.length,
    },
    frontMatter,
    parts,
    recentEvents: events.slice(-12).reverse(),
  };
}
