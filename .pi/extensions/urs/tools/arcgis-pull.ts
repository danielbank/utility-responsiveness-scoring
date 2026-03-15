/**
 * urs_arcgis_pull — Pull utility/scores from ArcGIS feature layer on demand
 * Optionally persist pulled utilities to local DB for lookups and scoring.
 */

import { queryFeatures } from "../arcgis/query";
import { initDb } from "../data/db";

export interface ArcGISPullParams {
  where?: string;
  state?: string;
  utility_id?: string;
  limit?: number;
  persist?: boolean;
}

export interface PulledUtility {
  utility_id: string;
  utility_name: string;
  state: string;
  composite_score?: number;
  composite_confidence?: number;
  tier?: number;
  tier_label?: string;
  rationale?: string;
  scored_at?: string;
  [key: string]: unknown;
}

export async function runArcGISPull(
  params: ArcGISPullParams,
  arcgisUrl: string,
  arcgisKey: string,
  persistCwd?: string
): Promise<{ utilities: PulledUtility[]; persisted?: number; error?: string }> {
  if (!arcgisUrl || !arcgisKey) {
    return { utilities: [], error: "ARCGIS_FEATURE_SERVICE_URL and ARCGIS_API_KEY required" };
  }

  let where = params.where ?? "1=1";
  if (params.state) {
    const stateClause = `UPPER(STATE) = '${params.state.toUpperCase().replace(/'/g, "''")}'`;
    where = where === "1=1" ? stateClause : `(${where}) AND ${stateClause}`;
  }
  if (params.utility_id) {
    const idClause = `UTILITY_ID = '${params.utility_id.replace(/'/g, "''")}'`;
    where = where === "1=1" ? idClause : `(${where}) AND ${idClause}`;
  }

  const result = await queryFeatures(
    { featureServiceUrl: arcgisUrl, apiKey: arcgisKey },
    {
      where,
      outFields: "*",
      returnGeometry: false,
      resultRecordCount: params.limit ?? 100,
    }
  );

  if (result.error) {
    return { utilities: [], error: result.error };
  }

  const utilities: PulledUtility[] = result.features.map((f) => {
    const a = f.attributes ?? {};
    return {
      utility_id: String(a.UTILITY_ID ?? a.utility_id ?? ""),
      utility_name: String(a.UTILITY_NAME ?? a.utility_name ?? ""),
      state: String(a.STATE ?? a.state ?? ""),
      composite_score: a.URS_COMPOSITE != null ? Number(a.URS_COMPOSITE) : undefined,
      composite_confidence: a.URS_CONFIDENCE != null ? Number(a.URS_CONFIDENCE) : undefined,
      tier: a.URS_TIER != null ? Number(a.URS_TIER) : undefined,
      tier_label: a.URS_TIER_LABEL != null ? String(a.URS_TIER_LABEL) : undefined,
      rationale: a.URS_RATIONALE != null ? String(a.URS_RATIONALE) : undefined,
      scored_at: a.URS_SCORED_AT != null ? String(a.URS_SCORED_AT) : undefined,
      ...a,
    };
  });

  let persisted = 0;
  if (persistCwd && utilities.length > 0) {
    const db = initDb(persistCwd);
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO utilities (utility_id, utility_name, state, ferc_id, hifld_id, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    for (const u of utilities) {
      if (u.utility_id && u.utility_name && u.state) {
        upsert.run(u.utility_id, u.utility_name, u.state, null, null);
        persisted++;
      }
    }
  }

  return { utilities, persisted: persisted > 0 ? persisted : undefined };
}
