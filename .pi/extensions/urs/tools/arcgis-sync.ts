/**
 * urs_arcgis_sync — Push scores to ArcGIS feature layer
 */

import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { applyEdits, type ScoreForArcGIS } from "../arcgis/feature-layer";

export interface ArcGISSyncParams {
  utility_ids?: string[];
}

export async function runArcGISSync(
  params: ArcGISSyncParams,
  cwd: string,
  arcgisUrl: string,
  arcgisKey: string
): Promise<{ success: boolean; synced?: number; error?: string }> {
  const db = initDb(cwd);
  seedUtilities(db);

  let utilityIds = params.utility_ids;
  if (!utilityIds || utilityIds.length === 0) {
    const rows = db.prepare("SELECT DISTINCT utility_id FROM scores").all() as Array<{ utility_id: string }>;
    utilityIds = rows.map((r) => r.utility_id);
  }

  if (utilityIds.length === 0) {
    return { success: false, error: "No scores to sync. Score utilities first." };
  }

  const scores: ScoreForArcGIS[] = [];

  for (const uid of utilityIds) {
    const latest = db
      .prepare(
        "SELECT s.*, u.utility_name, u.state FROM scores s JOIN utilities u ON s.utility_id = u.utility_id WHERE s.utility_id = ? ORDER BY s.scored_at DESC LIMIT 1"
      )
      .get(uid) as
      | {
          utility_id: string;
          utility_name: string;
          state: string;
          composite_score: number;
          composite_confidence: number;
          tier: number;
          dimension_scores: string;
          rationale: string;
          scored_at: string;
          data_vintage: string;
          model_version: string;
        }
      | undefined;

    if (!latest) continue;

    let dimScores: Record<string, number> = {};
    try {
      const arr = JSON.parse(latest.dimension_scores) as Array<{ id: string; score: number }>;
      for (const d of arr) dimScores[d.id] = d.score;
    } catch {}

    let dataVintage = { oldest_source: "", newest_source: "", staleness_flags: [] as string[] };
    try {
      dataVintage = JSON.parse(latest.data_vintage);
    } catch {}

    const tierLabels: Record<number, string> = {
      1: "Highly responsive",
      2: "Moderately responsive",
      3: "Mixed signals",
      4: "Likely slow",
      5: "Structurally unresponsive",
    };

    scores.push({
      utility_id: latest.utility_id,
      utility_name: latest.utility_name,
      state: latest.state,
      composite_score: latest.composite_score,
      composite_confidence: latest.composite_confidence,
      tier: latest.tier,
      tier_label: tierLabels[latest.tier] ?? "Unknown",
      dim_tariff: dimScores.large_load_tariff ?? 0,
      dim_intercon: dimScores.interconnection_speed ?? 0,
      dim_irp: dimScores.irp_alignment ?? 0,
      dim_regulatory: dimScores.regulatory_environment ?? 0,
      dim_leadership: dimScores.leadership_posture ?? 0,
      dim_headroom: dimScores.grid_headroom ?? 0,
      dim_track: dimScores.track_record ?? 0,
      dim_clean: dimScores.clean_energy_posture ?? 0,
      rationale: latest.rationale,
      scored_at: latest.scored_at.slice(0, 10),
      data_oldest: dataVintage.oldest_source,
      data_newest: dataVintage.newest_source,
      stale_flags: (dataVintage.staleness_flags ?? []).join(","),
      model_version: latest.model_version,
    });
  }

  const result = await applyEdits(
    { featureServiceUrl: arcgisUrl, apiKey: arcgisKey },
    scores
  );

  if (result.success) {
    return { success: true, synced: scores.length };
  }
  return { success: false, error: result.error };
}
