/**
 * 8 dimension scorers — deterministic heuristics from spec section 2
 * Each dimension scores 0–100 with confidence 0–1
 */

import type { DimensionId } from "./types";
import { DIMENSION_IDS, DIMENSION_LABELS } from "./types";
import type { DimensionResult } from "./aggregation";

export interface SignalData {
  dimension: DimensionId;
  [key: string]: unknown;
}

export interface ScoringInput {
  utility_id: string;
  signals: SignalData[];
  context?: {
    mw_requirement?: number;
    target_isd?: string;
    use_case?: string;
  };
}

/**
 * Score a single dimension based on available signals.
 * When no signals exist, returns low score with low confidence.
 */
function scoreDimension(
  dimension: DimensionId,
  signals: SignalData[],
  _context?: ScoringInput["context"]
): DimensionResult {
  const dimSignals = signals.filter((s) => s.dimension === dimension);

  if (dimSignals.length === 0) {
    return { id: dimension, score: 50, confidence: 0.1 };
  }

  // Placeholder: each dimension has its own heuristic
  // For now, aggregate signals into a simple score
  let score = 50;
  let confidence = 0.3;

  for (const sig of dimSignals) {
    if (sig.score !== undefined && typeof sig.score === "number") {
      score = Math.round((score + sig.score) / 2);
      confidence = Math.min(0.95, confidence + 0.2);
    }
    if (sig.confidence !== undefined && typeof sig.confidence === "number") {
      confidence = Math.max(confidence, sig.confidence);
    }
  }

  if (dimension === "large_load_tariff" && dimSignals.some((s) => (s as { has_large_load_tariff?: boolean }).has_large_load_tariff)) {
    score = Math.min(100, score + 30);
    confidence = Math.min(0.95, confidence + 0.3);
  }

  if (dimension === "interconnection_speed" && dimSignals.some((s) => (s as { stated_timeline_months?: number }).stated_timeline_months !== undefined)) {
    const timeline = (dimSignals.find((s) => (s as { stated_timeline_months?: number }).stated_timeline_months !== undefined) as { stated_timeline_months: number })?.stated_timeline_months ?? 18;
    if (timeline < 6) score = 85;
    else if (timeline < 18) score = 65;
    else score = 35;
    confidence = Math.min(0.95, confidence + 0.3);
  }

  return {
    id: dimension,
    score: Math.max(0, Math.min(100, score)),
    confidence: Math.max(0.1, Math.min(1, confidence)),
  };
}

export function scoreAllDimensions(input: ScoringInput): DimensionResult[] {
  return DIMENSION_IDS.map((id) => scoreDimension(id, input.signals, input.context));
}
