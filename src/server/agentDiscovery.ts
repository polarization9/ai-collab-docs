import type {
  AgentDocumentLink,
  AgentSessionReference
} from "../shared/agentTypes.js";
import {
  applyDiscoveredAgentTarget,
  isDeliverableAgentTarget,
  loadAgentDocumentLink
} from "./agentLink.js";
import { findClaudeCodeDiscoveryCandidates } from "./claudeCodeDiscoveryCandidates.js";
import { findCodexDiscoveryCandidates } from "./codexDiscoveryCandidates.js";
import { findWorkBuddyDiscoveryCandidates } from "./workBuddyDiscoveryCandidates.js";
import type { AgentDiscoveryCandidate } from "./agentDiscoveryTypes.js";

type RankedAgentDiscoveryCandidate = {
  candidate: AgentDiscoveryCandidate;
  tier: number;
  score: number;
  updatedAtMs: number;
};

export type AgentDiscoveryResult =
  | {
      status: "skipped-existing-target" | "none" | "ambiguous";
      candidates: AgentDiscoveryCandidate[];
      link?: AgentDocumentLink | null;
    }
  | {
      status: "applied";
      candidate: AgentDiscoveryCandidate;
      candidates: AgentDiscoveryCandidate[];
      link: AgentDocumentLink;
    };

export async function discoverAgentSourceForDocument(
  markdownPath: string
): Promise<AgentDiscoveryResult> {
  const existing = await loadAgentDocumentLink(markdownPath);
  if (existing?.target && isDeliverableAgentTarget(existing.target)) {
    return {
      status: "skipped-existing-target",
      candidates: [],
      link: existing
    };
  }

  const candidates = await collectDiscoveryCandidates(markdownPath);
  if (candidates.length === 0) {
    return { status: "none", candidates, link: existing };
  }

  const winner = chooseAutoBindCandidate(candidates);
  if (!winner) {
    return { status: "ambiguous", candidates, link: existing };
  }

  const now = new Date().toISOString();
  const target = candidateToSession(winner, now);
  const source = winner.role === "source" ? target : undefined;
  const link = await applyDiscoveredAgentTarget(markdownPath, { source, target });
  return {
    status: "applied",
    candidate: winner,
    candidates,
    link
  };
}

async function collectDiscoveryCandidates(
  markdownPath: string
): Promise<AgentDiscoveryCandidate[]> {
  const [workBuddyCandidates, claudeCodeCandidates, codexCandidates] = await Promise.all([
    findWorkBuddyDiscoveryCandidates(markdownPath),
    findClaudeCodeDiscoveryCandidates(markdownPath),
    findCodexDiscoveryCandidates(markdownPath)
  ]);
  return [...workBuddyCandidates, ...claudeCodeCandidates, ...codexCandidates].filter((candidate) =>
    Boolean(candidate.sessionId)
  );
}

function chooseAutoBindCandidate(
  candidates: AgentDiscoveryCandidate[]
): AgentDiscoveryCandidate | null {
  const ranked = candidates.map(rankCandidate).sort(compareRankedCandidates);
  const best = ranked[0];
  if (!best || best.tier < 2) {
    return null;
  }

  const second = ranked[1];
  if (!second) {
    return best.candidate;
  }

  if (best.tier > second.tier) {
    return best.candidate;
  }

  if (best.score - second.score >= getSameTierScoreGap(best.tier)) {
    return best.candidate;
  }

  return null;
}

function getSameTierScoreGap(tier: number): number {
  if (tier >= 3) {
    return 60;
  }
  if (tier === 2) {
    return 60;
  }
  return Number.POSITIVE_INFINITY;
}

function rankCandidate(candidate: AgentDiscoveryCandidate): RankedAgentDiscoveryCandidate {
  const tier = getEvidenceTier(candidate);
  const score =
    tier * 1000 +
    candidate.evidence.explicitBindCount * 80 +
    candidate.evidence.margentOperationCount * 24 +
    candidate.evidence.documentEditSignalCount * 12 +
    Math.min(candidate.evidence.pathMentionCount, 20);
  return {
    candidate,
    tier,
    score,
    updatedAtMs: Date.parse(candidate.updatedAt) || 0
  };
}

function getEvidenceTier(candidate: AgentDiscoveryCandidate): number {
  if (candidate.evidence.explicitBindCount > 0) {
    return 4;
  }
  if (candidate.evidence.margentOperationCount > 0) {
    return 3;
  }
  if (candidate.evidence.documentEditSignalCount > 0) {
    return 2;
  }
  if (candidate.evidence.pathMentionCount > 0) {
    return 1;
  }
  return 0;
}

function compareRankedCandidates(
  left: RankedAgentDiscoveryCandidate,
  right: RankedAgentDiscoveryCandidate
): number {
  if (left.tier !== right.tier) {
    return right.tier - left.tier;
  }
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  return right.updatedAtMs - left.updatedAtMs;
}

function candidateToSession(
  candidate: AgentDiscoveryCandidate,
  configuredAt: string
): AgentSessionReference {
  return {
    provider: candidate.provider,
    role: candidate.role,
    sessionId: candidate.sessionId,
    cwd: candidate.cwd,
    displayName: candidate.displayName,
    configuredAt,
    configuredBy: "agent",
    configuredVia: "local-discovery"
  };
}
