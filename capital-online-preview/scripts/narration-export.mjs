const sentencePattern = /[^。！？!?]+(?:[。！？!?]+[”’」』》）)]*)|[^。！？!?]+$/g;

function normalizeSpeechText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function spokenMath(value) {
  return value
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$2分之$1")
    .replace(/(\d+)\s*\/\s*(\d+)/g, "$2分之$1")
    .replace(/\\times/g, "乘以")
    .replace(/\\%/g, "百分号")
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/[{}]/g, "")
    .trim();
}

function splitLongSentence(value, maximumCharacters = 220) {
  const text = normalizeSpeechText(value);
  if (text.length <= maximumCharacters) return [text];

  const pieces = [];
  let rest = text;
  while (rest.length > maximumCharacters) {
    const window = rest.slice(0, maximumCharacters + 1);
    const candidates = ["；", ";", "：", ":", "，", ","];
    let cut = -1;
    for (const punctuation of candidates) {
      cut = Math.max(cut, window.lastIndexOf(punctuation));
    }
    if (cut < Math.floor(maximumCharacters * 0.55)) {
      cut = maximumCharacters;
    } else {
      cut += 1;
    }
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function splitNarrationSentences(value) {
  const normalized = normalizeSpeechText(value);
  if (!normalized) return [];
  return (normalized.match(sentencePattern) || [normalized]).flatMap((item) =>
    splitLongSentence(item),
  );
}

function inlineSpeechText(token) {
  if (!token.children?.length) return "";
  const pieces = [];
  for (const child of token.children) {
    if (child.type === "text" || child.type === "code_inline") {
      pieces.push(child.content);
    } else if (child.type === "math_inline") {
      pieces.push(spokenMath(child.content));
    } else if (child.type === "softbreak" || child.type === "hardbreak") {
      pieces.push(" ");
    } else if (child.type === "image") {
      pieces.push(child.content || "");
    }
  }
  return normalizeSpeechText(pieces.join(""));
}

export function extractNarrationSentences(markdown, renderer, unitId) {
  const tokens = renderer.parse(markdown, {});
  const sentences = [];
  let paragraphIndex = -1;
  let inParagraph = false;
  let inFootnotes = false;

  for (const token of tokens) {
    if (token.type === "footnote_block_open") inFootnotes = true;
    if (inFootnotes) continue;
    if (token.type === "paragraph_open") {
      inParagraph = true;
      paragraphIndex += 1;
      continue;
    }
    if (token.type === "paragraph_close") {
      inParagraph = false;
      continue;
    }
    if (token.type !== "inline" || !inParagraph) continue;
    for (const text of splitNarrationSentences(inlineSpeechText(token))) {
      const sequence = sentences.length + 1;
      sentences.push({
        id: `${unitId}-n${String(sequence).padStart(4, "0")}`,
        index: sequence - 1,
        paragraphIndex,
        text,
      });
    }
  }

  return sentences;
}
