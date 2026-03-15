/**
 * urs_score — Score a utility
 */

import type Database from "better-sqlite3";
import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { getDimensionsFromSource, isSourceStale } from "../data/staleness";
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
const DEFAULT_STALENESS_THRESHOLD_DAYS = 180;

export interface ScoreParams {
  utility_id: string;
  mw_requirement?: number;
  target_isd?: string;
  use_case?: string;
  weight_overrides?: Record<string, number>;
  force_refresh?: boolean;
  staleness_threshold_days?: number;
}

function computeDataVintage(
  db: Database.Database,
  utilityId: string
): { oldest_source: string; newest_source: string; staleness_flags: string[] } {
  const sourceRows = db
    .prepare("SELECT source_id, source_type, document_date, dimensions_affected, max_age_days FROM sources WHERE utility_id = ?")
    .all(utilityId) as Array<{
    source_id: string;
    source_type: string;
    document_date: string | null;
    dimensions_affected: string;
    max_age_days: number | null;
  }>;

  if (sourceRows.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return { oldest_source: today, newest_source: today, staleness_flags: [] };
  }

  const dates = sourceRows.map((r) => r.document_date).filter((d): d is string => !!d);
  const oldest_source = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : new Date().toISOString().slice(0, 10);
  const newest_source = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : new Date().toISOString().slice(0, 10);

  const staleDimensions = new Set<string>();
  const now = new Date();
  for (const row of sourceRows) {
    if (isSourceStale({ ...row, dimensions_affected: row.dimensions_affected }, now)) {
      const dims = getDimensionsFromSource(row);
      for (const d of dims) staleDimensions.add(d);
    }
  }

  return {
    oldest_source,
    newest_source,
    staleness_flags: [...staleDimensions],
  };
}

function isCacheValid(
  scoredAt: string,
  stalenessThresholdDays: number
): boolean {
  const scored = new Date(scoredAt).getTime();
  const cutoff = Date.now() - stalenessThresholdDays * 24 * 60 * 60 * 1000;
  return scored >= cutoff;
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

  const stalenessThreshold = params.staleness_threshold_days ?? DEFAULT_STALENESS_THRESHOLD_DAYS;

  if (!params.force_refresh) {
    const cached = db
      .prepare(
        "SELECT score_id, scored_at, model_version, composite_score, composite_confidence, tier, dimension_scores, rationale, context_applied, data_vintage, coverage_warning FROM scores WHERE utility_id = ? ORDER BY scored_at DESC LIMIT 1"
      )
      .get(params.utility_id) as
      | {
          scored_at: string;
          model_version: string;
          composite_score: number;
          composite_confidence: number;
          tier: number;
          dimension_scores: string;
          rationale: string;
          context_applied: string | null;
          data_vintage: string;
          coverage_warning: string | null;
        }
      | undefined;

    if (cached && isCacheValid(cached.scored_at, stalenessThreshold)) {
      let dimScores: DimensionScore[] = [];
      try {
        const arr = JSON.parse(cached.dimension_scores) as Array<{ id: DimensionId; score: number; confidence: number; evidence_summary?: string }>;
        dimScores = arr.map((r) => ({
          id: r.id,
          label: DIMENSION_LABELS[r.id],
          score: r.score,
          confidence: r.confidence,
          weight_applied: 1,
          evidence_summary: r.evidence_summary,
        }));
      } catch {}

      let dataVintage: DataVintage = { oldest_source: "", newest_source: "", staleness_flags: [] };
      try {
        dataVintage = JSON.parse(cached.data_vintage);
      } catch {}

      const response: ScoreResponse = {
        utility_id: utility.utility_id,
        utility_name: utility.utility_name,
        state: utility.state,
        resolution: { method: "eia_direct", confidence: 1, alternatives: [] },
        composite_score: cached.composite_score,
        composite_confidence: cached.composite_confidence,
        tier: cached.tier,
        tier_label: TIER_LABELS[cached.tier] ?? "Unknown",
        dimensions: dimScores,
        rationale: cached.rationale,
        context_applied: cached.context_applied ? JSON.parse(cached.context_applied) : undefined,
        scored_at: cached.scored_at,
        model_version: cached.model_version,
        data_vintage,
        coverage_warning: cached.coverage_warning ?? undefined,
      };
      return response;
    }
  }

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

  const dataVintage = computeDataVintage(db, params.utility_id);

  const dimensions: DimensionScore[] = dimensionResults.map((r) => ({
    id: r.id,
    label: DIMENSION_LABELS[r.id],
    score: r.score,
    confidence: r.confidence,
    weight_applied: weights[r.id] ?? 1,
    evidence_summary: r.evidence_summary,
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
        data_vintage: dataVintage,
      },
      apiKey
    );
  } catch (e) {
    rationale = `Rationale generation failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  const stale = dataVintage.staleness_flags.length > 0;
  if (stale && rationale) {
    rationale = `[Note: Some dimension data is stale: ${dataVintage.staleness_flags.join(", ")}.] ${rationale}`;
  }

  const coverageWarning =
    confidence < 0.3
      ? "Municipal utility — limited public filing data. Multiple dimensions may be scored with low confidence."
      : undefined;

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
    coverage_warning: coverageWarning,
    stale: stale || undefined,
  };

  const scoreId = `score-${params.utility_id}-${Date.now()}`;
  db.prepare(
    `INSERT INTO scores (score_id, utility_id, scored_at, model_version, composite_score, composite_confidence, tier, dimension_scores, rationale, context_applied, data_vintage, coverage_warning)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    JSON.stringify(dataVintage),
    coverageWarning ?? null
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
    regulatory_signals: "regulatory_environment",
    grid_capacity_signals: "grid_headroom",
    track_record_signals: "track_record",
  };
  return map[target] ?? null;
}
