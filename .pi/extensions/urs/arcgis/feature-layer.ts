/**
 * ArcGIS feature layer write — spec section 5.2
 * Pushes score attributes to ArcGIS REST API applyEdits
 */

export interface ArcGISConfig {
  featureServiceUrl: string;
  apiKey: string;
}

export interface ScoreForArcGIS {
  utility_id: string;
  utility_name: string;
  state: string;
  composite_score: number;
  composite_confidence: number;
  tier: number;
  tier_label: string;
  dim_tariff: number;
  dim_intercon: number;
  dim_irp: number;
  dim_regulatory: number;
  dim_leadership: number;
  dim_headroom: number;
  dim_track: number;
  dim_clean: number;
  rationale: string;
  scored_at: string;
  data_oldest: string;
  data_newest: string;
  stale_flags: string;
  model_version: string;
}

export async function applyEdits(
  config: ArcGISConfig,
  scores: ScoreForArcGIS[]
): Promise<{ success: boolean; error?: string }> {
  if (!config.featureServiceUrl || !config.apiKey) {
    return { success: false, error: "ArcGIS feature service URL and API key required" };
  }

  const adds = scores.map((s) => ({
    attributes: {
      UTILITY_ID: s.utility_id,
      UTILITY_NAME: s.utility_name,
      STATE: s.state,
      URS_COMPOSITE: s.composite_score,
      URS_CONFIDENCE: s.composite_confidence,
      URS_TIER: s.tier,
      URS_TIER_LABEL: s.tier_label,
      DIM_TARIFF: s.dim_tariff,
      DIM_INTERCON: s.dim_intercon,
      DIM_IRP: s.dim_irp,
      DIM_REGULATORY: s.dim_regulatory,
      DIM_LEADERSHIP: s.dim_leadership,
      DIM_HEADROOM: s.dim_headroom,
      DIM_TRACK: s.dim_track,
      DIM_CLEAN: s.dim_clean,
      URS_RATIONALE: s.rationale.slice(0, 4000),
      URS_SCORED_AT: s.scored_at,
      URS_DATA_OLDEST: s.data_oldest,
      URS_DATA_NEWEST: s.data_newest,
      URS_STALE_FLAGS: s.stale_flags,
      URS_MODEL_VER: s.model_version,
    },
  }));

  try {
    const url = `${config.featureServiceUrl}/addFeatures`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        features: adds,
        rollbackOnFailure: true,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: err };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
