/**
 * urs_score — Score a utility
 */

import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { scoreAllDimensions } from "../scoring/dimensions";
import { computeComposite } from "../scoring/aggregation";
import {
  getTier,
  TIER_LABELS,
  DIMENSION_LABELS,
  type DimensionId,
  type ScoreResponse,
  type DimensionScore,
  type ScoreContext,
  type DataVintage,
} from "../scoring/types";
import { generateRationale } from "../extraction/rationale";

const MODEL_VERSION = "urs-1.0.0";

export interface ScoreParams {
  utility_id: string;
  mw_requirement?: number;
  target_isd?: string;
  use_case?: string;
  weight_overrides?: Record<string, number>;
  force_refresh?: boolean;
  staleness_threshold_days?: number;
}

export async function runScore(
  params: ScoreParams,
  cwd: string,
  apiKey: string
): Promise<ScoreResponse | { error: string }> {
  const db = initDb(cwd);
  seedUtilities(db);

  const utility = db.prepare("SELECT * FROM utilities WHERE utility_id = ?").get(params.utility_id) as {
    utility_id: string;
    utility_name: string;
    state: string;
  } | undefined;

  if (!utility) {
    return { error: `Utility ${params.utility_id} not found` };
  }

  // Load signals from DB
  const sourceRows = db.prepare("SELECT * FROM sources WHERE utility_id = ?").all(params.utility_id) as Array<{
    source_id: string;
    dimensions_affected: string;
  }>;
  const sourceIds = sourceRows.map((r) => r.source_id);

  const signals: Array<{ dimension: DimensionId; [k: string]: unknown }> = [];
  if (sourceIds.length > 0) {
    const placeholders = sourceIds.map(() => "?").join(",");
    const signalRows = db
      .prepare(`SELECT * FROM signals WHERE source_id IN (${placeholders})`)
      .all(...sourceIds) as Array<{ extraction_target: string; payload: string }>;
    for (const row of signalRows) {
      try {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        const dimension = mapExtractionTargetToDimension(row.extraction_target);
        if (dimension) {
          signals.push({ dimension, ...payload });
        }
      } catch {
        // skip invalid
      }
    }
  }

  const context: ScoreContext = {
    mw_requirement: params.mw_requirement,
    target_isd: params.target_isd,
    use_case: params.use_case,
  };

  const dimensionResults = scoreAllDimensions({
    utility_id: params.utility_id,
    signals,
    context,
  });

  const weights = (params.weight_overrides ?? {}) as Record<DimensionId, number>;
  const { composite, confidence } = computeComposite(dimensionResults, weights);
  const tier = getTier(composite);
  const tierLabel = TIER_LABELS[tier] ?? "Unknown";

  const dimensions: DimensionScore[] = dimensionResults.map((r) => ({
    id: r.id,
    label: DIMENSION_LABELS[r.id],
    score: r.score,
    confidence: r.confidence,
    weight_applied: weights[r.id] ?? 1,
  }));

  let rationale = "";
  try {
    rationale = await generateRationale(
      {
        utility_name: utility.utility_name,
        composite_score: composite,
        tier_label: tierLabel,
        dimensions,
        context,
        data_vintage: {
          oldest_source: new Date().toISOString().slice(0, 10),
          newest_source: new Date().toISOString().slice(0, 10),
          staleness_flags: [],
        },
      },
      apiKey
    );
  } catch (e) {
    rationale = `Rationale generation failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  const dataVintage: DataVintage = {
    oldest_source: new Date().toISOString().slice(0, 10),
    newest_source: new Date().toISOString().slice(0, 10),
    staleness_flags: [],
  };

  const response: ScoreResponse = {
    utility_id: utility.utility_id,
    utility_name: utility.utility_name,
    state: utility.state,
    resolution: { method: "eia_direct", confidence: 1, alternatives: [] },
    composite_score: composite,
    composite_confidence: confidence,
    tier,
    tier_label: tierLabel,
    dimensions,
    rationale,
    context_applied: params.mw_requirement || params.target_isd ? { ...context } : undefined,
    scored_at: new Date().toISOString(),
    model_version: MODEL_VERSION,
    data_vintage: dataVintage,
  };

  // Store in scores table
  const scoreId = `score-${params.utility_id}-${Date.now()}`;
  db.prepare(
    `INSERT INTO scores (score_id, utility_id, scored_at, model_version, composite_score, composite_confidence, tier, dimension_scores, rationale, context_applied, data_vintage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    scoreId,
    params.utility_id,
    response.scored_at,
    MODEL_VERSION,
    composite,
    confidence,
    tier,
    JSON.stringify(dimensionResults),
    rationale,
    JSON.stringify(context),
    JSON.stringify(dataVintage)
  );

  return response;
}

function mapExtractionTargetToDimension(target: string): DimensionId | null {
  const map: Record<string, DimensionId> = {
    large_load_tariff: "large_load_tariff",
    interconnection_timeline: "interconnection_speed",
    irp_load_growth: "irp_alignment",
    leadership_statements: "leadership_posture",
    clean_energy_program: "clean_energy_posture",
  };
  return map[target] ?? null;
}
