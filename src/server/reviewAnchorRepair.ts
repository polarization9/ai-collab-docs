import type { AnchorRepairResult, AnchorRepairSummary } from "../shared/editTypes.js";
import type {
  AnchorPrecision,
  ReviewAnchor,
  ReviewAnnotation,
  ReviewFile
} from "../shared/reviewTypes.js";
import type { Heading } from "../shared/types.js";
import {
  parseMarkdownBlocks,
  type MarkdownBlock,
  type ParsedMarkdownBlocks
} from "./markdownBlocks.js";

type RepairReviewAnchorsOptions = {
  annotationId?: string;
  preferredSelectedText?: string;
};

type RepairContext = {
  previous: ParsedMarkdownBlocks | null;
  next: ParsedMarkdownBlocks;
  nextMarkdown: string;
  blockMappings: BlockMapping[];
};

type BlockMapping = {
  oldBlockId: string;
  newBlockId: string;
  confidence: number;
  reason: "same-text" | "same-heading-similar-text";
};

type CandidateText = {
  text: string;
  source: "preferred" | "selected" | "original";
};

type AnchorCandidate = {
  block: MarkdownBlock;
  startOffset: number;
  endOffset: number;
  absoluteStart: number;
  absoluteEnd: number;
  selectedText: string;
  source: CandidateText["source"];
  matchKind: "exact" | "normalized" | "context";
  score: number;
  reasons: string[];
};

type SearchIndex = {
  text: string;
  map: number[];
};

const CONTEXT_CHARS = 40;
const ACCEPT_SCORE = 70;
const UNIQUE_ACCEPT_SCORE = 58;
const MIN_LEAD_SCORE = 12;
const SIMILAR_BLOCK_THRESHOLD = 0.72;

export function repairReviewAnchors(
  review: ReviewFile,
  previousMarkdown: string | null,
  nextMarkdown: string,
  options: RepairReviewAnchorsOptions = {}
): { review: ReviewFile; summary: AnchorRepairSummary } {
  const previous = previousMarkdown ? parseMarkdownBlocks(previousMarkdown) : null;
  const next = parseMarkdownBlocks(nextMarkdown);
  const context: RepairContext = {
    previous,
    next,
    nextMarkdown,
    blockMappings: previous ? createBlockMappings(previous.blocks, next.blocks) : []
  };
  const summary = createEmptySummary(review.annotations.length);
  let changed = false;

  for (const annotation of review.annotations) {
    const preferredText =
      annotation.id === options.annotationId ? options.preferredSelectedText : undefined;
    const result = repairAnnotationAnchor(annotation, context, preferredText);
    summary[result] += 1;
    summary.items.push({ annotationId: annotation.id, result });
    changed = changed || result !== "unresolved";
  }

  if (changed) {
    review.updatedAt = new Date().toISOString();
  }

  return { review, summary };
}

function repairAnnotationAnchor(
  annotation: ReviewAnnotation,
  context: RepairContext,
  preferredText?: string
): AnchorRepairResult {
  const anchor = annotation.anchor;
  ensureAnchorDefaults(anchor);

  if (anchor.kind === "document") {
    anchor.anchorPrecision = "heading";
    anchor.lastRepairedAt = new Date().toISOString();
    return "exact";
  }

  const candidates = scoreCandidates(
    findAnchorCandidates(anchor, context, getCandidateTexts(anchor, preferredText)),
    anchor,
    context
  );
  const accepted = selectAcceptedCandidate(candidates);

  if (accepted) {
    updateAnchorFromCandidate(anchor, context, accepted);
    return accepted.matchKind === "exact" && accepted.source !== "original" ? "exact" : "fuzzy";
  }

  const heading = findFallbackHeading(anchor, context.next);
  if (heading) {
    updateAnchorHeading(anchor, heading);
    setRepairMeta(anchor, {
      precision: "heading",
      confidence: 0,
      reason: candidates.length > 0 ? "ambiguous-text-candidates" : "heading-fallback"
    });
    return "headingFallback";
  }

  setRepairMeta(anchor, {
    precision: "unknown",
    confidence: 0,
    reason: "unresolved"
  });
  return "unresolved";
}

function getCandidateTexts(anchor: ReviewAnchor, preferredText?: string): CandidateText[] {
  const texts: CandidateText[] = [];
  if (preferredText?.trim()) {
    texts.push({ text: preferredText.trim(), source: "preferred" });
  }
  if (anchor.selectedText?.trim()) {
    texts.push({ text: anchor.selectedText.trim(), source: "selected" });
  }
  if (anchor.originalSelectedText?.trim() && anchor.originalSelectedText !== anchor.selectedText) {
    texts.push({ text: anchor.originalSelectedText.trim(), source: "original" });
  }

  const seen = new Set<string>();
  return texts.filter((item) => {
    const key = `${item.source}:${normalizeSearchText(item.text)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function findAnchorCandidates(
  anchor: ReviewAnchor,
  context: RepairContext,
  texts: CandidateText[]
): AnchorCandidate[] {
  const candidates: AnchorCandidate[] = [];
  const scopedBlocks = getHeadingScopedBlocks(context.next.blocks, anchor);
  const allBlocks = context.next.blocks;

  for (const text of texts) {
    candidates.push(...findTextCandidates(scopedBlocks, text));
    candidates.push(...findTextCandidates(allBlocks, text, candidates));
  }

  if (candidates.length === 0 && anchor.kind === "text") {
    candidates.push(...findContextCandidates(context.next.blocks, anchor));
  }

  return dedupeCandidates(candidates);
}

function findTextCandidates(
  blocks: MarkdownBlock[],
  candidateText: CandidateText,
  existing: AnchorCandidate[] = []
): AnchorCandidate[] {
  if (normalizeSearchText(candidateText.text).length < 2) {
    return [];
  }

  const found: AnchorCandidate[] = [];
  const seen = new Set(existing.map(candidateKey));

  for (const block of blocks) {
    for (const match of findMatches(block.text, candidateText.text)) {
      const candidate: AnchorCandidate = {
        block,
        startOffset: match.start,
        endOffset: match.end,
        absoluteStart: block.start + match.start,
        absoluteEnd: block.start + match.end,
        selectedText: candidateText.text,
        source: candidateText.source,
        matchKind: match.kind,
        score: 0,
        reasons: []
      };
      const key = candidateKey(candidate);
      if (!seen.has(key)) {
        found.push(candidate);
        seen.add(key);
      }
    }
  }

  return found;
}

function findContextCandidates(blocks: MarkdownBlock[], anchor: Extract<ReviewAnchor, { kind: "text" }>): AnchorCandidate[] {
  const prefix = anchor.prefix?.trim();
  const suffix = anchor.suffix?.trim();
  if (!prefix && !suffix) {
    return [];
  }

  const candidates: AnchorCandidate[] = [];
  for (const block of blocks) {
    const prefixIndex = prefix ? block.text.indexOf(prefix) : -1;
    const suffixIndex = suffix ? block.text.indexOf(suffix) : -1;
    if (prefixIndex < 0 && suffixIndex < 0) {
      continue;
    }

    const startOffset = prefixIndex >= 0 ? prefixIndex + (prefix?.length ?? 0) : Math.max(0, suffixIndex);
    const endOffset =
      suffixIndex >= 0 && suffixIndex >= startOffset
        ? suffixIndex
        : Math.min(block.text.length, startOffset + anchor.selectedText.length);
    const selectedText = block.text.slice(startOffset, endOffset).trim() || anchor.selectedText;
    candidates.push({
      block,
      startOffset,
      endOffset,
      absoluteStart: block.start + startOffset,
      absoluteEnd: block.start + endOffset,
      selectedText,
      source: "selected",
      matchKind: "context",
      score: 0,
      reasons: []
    });
  }
  return candidates;
}

function scoreCandidates(
  candidates: AnchorCandidate[],
  anchor: ReviewAnchor,
  context: RepairContext
): AnchorCandidate[] {
  const mapping = context.blockMappings.find((item) => item.oldBlockId === getAnchorBlockId(anchor));
  return candidates
    .map((candidate) => {
      let score = 0;
      const reasons: string[] = [];

      const baseScore = getBaseScore(candidate);
      score += baseScore;
      reasons.push(`${candidate.source}-${candidate.matchKind}:${baseScore}`);

      if (anchor.headingId && candidate.block.headingId === anchor.headingId) {
        score += 18;
        reasons.push("heading-id:18");
      } else if (anchor.headingText && candidate.block.headingText === anchor.headingText) {
        score += 14;
        reasons.push("heading-text:14");
      }

      const prefixScore = scoreContext(candidate, context.nextMarkdown, getAnchorPrefix(anchor), "prefix");
      const suffixScore = scoreContext(candidate, context.nextMarkdown, getAnchorSuffix(anchor), "suffix");
      score += prefixScore.value + suffixScore.value;
      reasons.push(...prefixScore.reasons, ...suffixScore.reasons);

      if (anchor.blockFingerprint?.kind && anchor.blockFingerprint.kind === candidate.block.kind) {
        score += 8;
        reasons.push("block-kind:8");
      }

      const anchorBlockIndex = getAnchorBlockIndex(anchor);
      const blockDistance = Math.abs((anchorBlockIndex ?? candidate.block.index) - candidate.block.index);
      if (Number.isFinite(blockDistance)) {
        const value = blockDistance === 0 ? 6 : blockDistance <= 3 ? 4 : blockDistance <= 10 ? 2 : 0;
        if (value > 0) {
          score += value;
          reasons.push(`block-distance:${value}`);
        }
      }

      if (typeof anchor.markdownOffset === "number") {
        const distance = Math.abs(anchor.markdownOffset - candidate.absoluteStart);
        const value = distance <= 10 ? 6 : distance <= 120 ? 4 : distance <= 1000 ? 2 : 0;
        if (value > 0) {
          score += value;
          reasons.push(`markdown-offset:${value}`);
        }
      }

      if (mapping?.newBlockId === candidate.block.id) {
        score += 10;
        reasons.push(`block-mapping:${mapping.reason}`);
      }

      return { ...candidate, score, reasons };
    })
    .sort((left, right) => right.score - left.score);
}

function selectAcceptedCandidate(candidates: AnchorCandidate[]): AnchorCandidate | null {
  const [best, second] = candidates;
  if (!best) {
    return null;
  }

  if (!second && best.score >= UNIQUE_ACCEPT_SCORE) {
    return best;
  }

  if (best.score >= ACCEPT_SCORE && (!second || best.score - second.score >= MIN_LEAD_SCORE)) {
    return best;
  }

  return null;
}

function updateAnchorFromCandidate(
  anchor: ReviewAnchor,
  context: RepairContext,
  candidate: AnchorCandidate
): void {
  updateAnchorHeading(anchor, candidate.block.heading);

  if (anchor.kind === "document" || anchor.kind === "mermaid") {
    setRepairMeta(anchor, {
      precision: "block",
      confidence: candidate.score,
      reason: candidate.reasons.join(", ")
    });
    return;
  }

  anchor.blockId = candidate.block.id;
  anchor.blockIndex = candidate.block.index;
  anchor.selectedText = candidate.selectedText;
  anchor.markdownOffset = candidate.absoluteStart;
  anchor.blockFingerprint = candidate.block.fingerprint;

  if (anchor.kind === "text") {
    anchor.startOffset = candidate.startOffset;
    anchor.endOffset = candidate.endOffset;
    anchor.prefix = context.nextMarkdown.slice(
      Math.max(0, candidate.absoluteStart - CONTEXT_CHARS),
      candidate.absoluteStart
    );
    anchor.suffix = context.nextMarkdown.slice(
      candidate.absoluteEnd,
      candidate.absoluteEnd + CONTEXT_CHARS
    );
  }

  setRepairMeta(anchor, {
    precision: candidate.matchKind === "context" ? "text" : "exact",
    confidence: candidate.score,
    reason: candidate.reasons.join(", ")
  });
}

function setRepairMeta(
  anchor: ReviewAnchor,
  meta: { precision: AnchorPrecision; confidence: number; reason: string }
): void {
  anchor.anchorPrecision = meta.precision;
  anchor.repairConfidence = meta.confidence;
  anchor.repairReason = meta.reason;
  anchor.lastRepairedAt = new Date().toISOString();
  if (anchor.selectedText && !anchor.originalSelectedText) {
    anchor.originalSelectedText = anchor.selectedText;
  }
}

function ensureAnchorDefaults(anchor: ReviewAnchor): void {
  if (anchor.selectedText && !anchor.originalSelectedText) {
    anchor.originalSelectedText = anchor.selectedText;
  }
  if (!anchor.anchorPrecision) {
    anchor.anchorPrecision = anchor.kind === "text" ? "exact" : anchor.kind === "document" ? "heading" : "block";
  }
}

function createBlockMappings(oldBlocks: MarkdownBlock[], newBlocks: MarkdownBlock[]): BlockMapping[] {
  const mappings: BlockMapping[] = [];
  const usedNewBlocks = new Set<string>();

  for (const oldBlock of oldBlocks) {
    const sameText = newBlocks.find(
      (newBlock) =>
        !usedNewBlocks.has(newBlock.id) &&
        oldBlock.normalizedText &&
        newBlock.normalizedText === oldBlock.normalizedText
    );
    if (sameText) {
      mappings.push({
        oldBlockId: oldBlock.id,
        newBlockId: sameText.id,
        confidence: 1,
        reason: "same-text"
      });
      usedNewBlocks.add(sameText.id);
    }
  }

  for (const oldBlock of oldBlocks) {
    if (mappings.some((item) => item.oldBlockId === oldBlock.id)) {
      continue;
    }

    const candidates = newBlocks
      .filter(
        (newBlock) =>
          !usedNewBlocks.has(newBlock.id) &&
          newBlock.kind === oldBlock.kind &&
          (newBlock.headingId === oldBlock.headingId ||
            newBlock.headingText === oldBlock.headingText)
      )
      .map((newBlock) => ({
        block: newBlock,
        similarity: stringSimilarity(oldBlock.normalizedText, newBlock.normalizedText)
      }))
      .filter((item) => item.similarity >= SIMILAR_BLOCK_THRESHOLD)
      .sort((left, right) => right.similarity - left.similarity);

    const best = candidates[0];
    if (best) {
      mappings.push({
        oldBlockId: oldBlock.id,
        newBlockId: best.block.id,
        confidence: best.similarity,
        reason: "same-heading-similar-text"
      });
      usedNewBlocks.add(best.block.id);
    }
  }

  return mappings;
}

function findMatches(text: string, query: string): Array<{ start: number; end: number; kind: "exact" | "normalized" }> {
  const matches: Array<{ start: number; end: number; kind: "exact" | "normalized" }> = [];
  for (const match of findAllIndexes(text, query)) {
    matches.push({ start: match, end: match + query.length, kind: "exact" });
  }

  const textIndex = buildSearchIndex(text);
  const queryIndex = buildSearchIndex(query);
  if (queryIndex.text.length === 0) {
    return matches;
  }

  for (const normalizedStart of findAllIndexes(textIndex.text, queryIndex.text)) {
    const start = textIndex.map[normalizedStart] ?? 0;
    const end = textIndex.map[normalizedStart + queryIndex.text.length - 1] ?? start;
    const duplicate = matches.some((match) => Math.abs(match.start - start) <= 1);
    if (!duplicate) {
      matches.push({ start, end: end + 1, kind: "normalized" });
    }
  }

  return matches;
}

function findAllIndexes(text: string, query: string): number[] {
  if (!query) {
    return [];
  }

  const indexes: number[] = [];
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(query, offset);
    if (index < 0) {
      break;
    }
    indexes.push(index);
    offset = index + Math.max(1, query.length);
  }
  return indexes;
}

function buildSearchIndex(text: string): SearchIndex {
  let normalized = "";
  const map: number[] = [];
  let lastWasSpace = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "]" && next === "(") {
      index += 2;
      while (index < text.length && text[index] !== ")") {
        index += 1;
      }
      continue;
    }

    if (char === "\\" || char === "`" || char === "*" || char === "[" || char === "]") {
      continue;
    }

    if (char === "#" && isHeadingMarker(text, index)) {
      continue;
    }

    if (/\s/.test(char)) {
      if (!lastWasSpace && normalized.length > 0) {
        normalized += " ";
        map.push(index);
        lastWasSpace = true;
      }
      continue;
    }

    normalized += char.toLowerCase();
    map.push(index);
    lastWasSpace = false;
  }

  return {
    text: normalized.trim(),
    map
  };
}

function scoreContext(
  candidate: AnchorCandidate,
  markdown: string,
  contextText: string | undefined,
  kind: "prefix" | "suffix"
): { value: number; reasons: string[] } {
  const normalizedContext = normalizeSearchText(contextText ?? "");
  if (normalizedContext.length < 4) {
    return { value: 0, reasons: [] };
  }

  const start =
    kind === "prefix"
      ? Math.max(0, candidate.absoluteStart - Math.max(contextText?.length ?? 0, CONTEXT_CHARS))
      : candidate.absoluteEnd;
  const end =
    kind === "prefix"
      ? candidate.absoluteStart
      : Math.min(markdown.length, candidate.absoluteEnd + Math.max(contextText?.length ?? 0, CONTEXT_CHARS));
  const windowText = normalizeSearchText(markdown.slice(start, end));
  const similarity = stringSimilarity(normalizedContext, windowText);

  if (similarity >= 0.86 || windowText.includes(normalizedContext)) {
    return { value: 16, reasons: [`${kind}:16`] };
  }
  if (similarity >= 0.66) {
    return { value: 8, reasons: [`${kind}:8`] };
  }
  return { value: 0, reasons: [] };
}

function getBaseScore(candidate: AnchorCandidate): number {
  if (candidate.source === "preferred") {
    return candidate.matchKind === "exact" ? 58 : candidate.matchKind === "normalized" ? 48 : 36;
  }
  if (candidate.source === "selected") {
    return candidate.matchKind === "exact" ? 45 : candidate.matchKind === "normalized" ? 36 : 24;
  }
  return candidate.matchKind === "exact" ? 34 : candidate.matchKind === "normalized" ? 28 : 18;
}

function getHeadingScopedBlocks(blocks: MarkdownBlock[], anchor: ReviewAnchor): MarkdownBlock[] {
  if (!anchor.headingId && !anchor.headingText) {
    return [];
  }
  return blocks.filter(
    (block) =>
      (anchor.headingId && block.headingId === anchor.headingId) ||
      (anchor.headingText && block.headingText === anchor.headingText)
  );
}

function updateAnchorHeading(anchor: ReviewAnchor, heading: Heading | null): void {
  anchor.headingId = heading?.id ?? null;
  anchor.headingText = heading?.text ?? null;
}

function findFallbackHeading(anchor: ReviewAnchor, parsed: ParsedMarkdownBlocks): Heading | null {
  if (anchor.headingId) {
    const byId = parsed.headings.find((heading) => heading.id === anchor.headingId);
    if (byId) {
      return byId;
    }
  }

  if (anchor.headingText) {
    const byText = parsed.headings.find((heading) => heading.text === anchor.headingText);
    if (byText) {
      return byText;
    }
  }

  return null;
}

function getAnchorBlockId(anchor: ReviewAnchor): string | undefined {
  return "blockId" in anchor ? anchor.blockId : undefined;
}

function getAnchorBlockIndex(anchor: ReviewAnchor): number | undefined {
  return "blockIndex" in anchor ? anchor.blockIndex : undefined;
}

function getAnchorPrefix(anchor: ReviewAnchor): string | undefined {
  return anchor.kind === "text" ? anchor.prefix : undefined;
}

function getAnchorSuffix(anchor: ReviewAnchor): string | undefined {
  return anchor.kind === "text" ? anchor.suffix : undefined;
}

function candidateKey(candidate: AnchorCandidate): string {
  return `${candidate.block.id}:${candidate.startOffset}:${candidate.endOffset}:${candidate.selectedText}`;
}

function dedupeCandidates(candidates: AnchorCandidate[]): AnchorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeSearchText(text: string): string {
  return buildSearchIndex(text).text.replace(/\s+/g, " ").trim();
}

function stringSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }

  const leftGrams = getBigrams(left);
  const rightGrams = getBigrams(right);
  if (leftGrams.size === 0 || rightGrams.size === 0) {
    return left === right ? 1 : 0;
  }

  let overlap = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftGrams.size + rightGrams.size);
}

function getBigrams(text: string): Set<string> {
  const normalized = text.replace(/\s+/g, "");
  if (normalized.length <= 1) {
    return new Set(normalized ? [normalized] : []);
  }

  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function isHeadingMarker(text: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && text[cursor] !== "\n") {
    if (text[cursor] !== " ") {
      return false;
    }
    cursor -= 1;
  }
  return true;
}

function createEmptySummary(total: number): AnchorRepairSummary {
  return {
    total,
    exact: 0,
    fuzzy: 0,
    headingFallback: 0,
    unresolved: 0,
    items: []
  };
}
