/**
 * Composite score aggregation — weighted average with confidence weighting
 * Spec section 3
 */

import type { DimensionId } from "./types";
import { DIMENSION_IDS } from "./types";

export interface DimensionResult {
  id: DimensionId;
  score: number;
  confidence: number;
  evidence_summary?: string;
}

export function computeComposite(
  dimensionResults: DimensionResult[],
  weights: Record<DimensionId, number> = {}
): { composite: number; confidence: number } {
  let weightedSum = 0;
  let weightConfidenceSum = 0;
  let weightSum = 0;

  for (const id of DIMENSION_IDS) {
    const w = weights[id] ?? 1.0;
    const result = dimensionResults.find((r) => r.id === id);
    if (!result) continue;

    const { score, confidence } = result;
    weightedSum += w * score * confidence;
    weightConfidenceSum += w * confidence;
    weightSum += w;
  }

  const composite = weightConfidenceSum > 0 ? weightedSum / weightConfidenceSum : 0;
  const confidence = weightSum > 0 ? weightConfidenceSum / weightSum : 0;

  return {
    composite: Math.round(composite),
    confidence: Math.round(confidence * 100) / 100,
  };
}
