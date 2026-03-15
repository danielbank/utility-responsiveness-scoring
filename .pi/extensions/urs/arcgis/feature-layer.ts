/**
 * ArcGIS feature layer write — spec section 5.2
 * Uses applyEdits for upsert: query existing by UTILITY_ID, update or add
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

function toAttributes(s: ScoreForArcGIS): Record<string, unknown> {
  return {
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
  };
}

/** Query existing features by UTILITY_ID, return map of utility_id -> objectId */
async function queryExistingObjectIds(
  baseUrl: string,
  utilityIds: string[],
  token: string
): Promise<Map<string, number>> {
  if (utilityIds.length === 0) return new Map();

  const where = utilityIds.map((id) => `UTILITY_ID = '${id.replace(/'/g, "''")}'`).join(" OR ");
  const url = new URL(`${baseUrl}/query`);
  url.searchParams.set("where", where);
  url.searchParams.set("returnIdsOnly", "true");
  url.searchParams.set("f", "json");
  url.searchParams.set("token", token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Query failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { objectIds?: number[]; error?: { message: string } };
  if (data.error) {
    throw new Error(data.error.message);
  }

  if (!data.objectIds || data.objectIds.length === 0) {
    return new Map();
  }

  const url2 = new URL(`${baseUrl}/query`);
  url2.searchParams.set("objectIds", data.objectIds.join(","));
  url2.searchParams.set("outFields", "UTILITY_ID,OBJECTID");
  url2.searchParams.set("f", "json");
  url2.searchParams.set("token", token);

  const res2 = await fetch(url2.toString());
  if (!res2.ok) {
    throw new Error(`Query details failed: ${res2.status}`);
  }

  const data2 = (await res2.json()) as {
    features?: Array<{ attributes: { UTILITY_ID: string; OBJECTID: number } }>;
    error?: { message: string };
  };
  if (data2.error) {
    throw new Error(data2.error.message);
  }

  const map = new Map<string, number>();
  for (const f of data2.features ?? []) {
    const uid = f.attributes?.UTILITY_ID;
    const oid = f.attributes?.OBJECTID;
    if (uid != null && oid != null) map.set(String(uid), oid);
  }
  return map;
}

export async function applyEdits(
  config: ArcGISConfig,
  scores: ScoreForArcGIS[]
): Promise<{ success: boolean; error?: string }> {
  if (!config.featureServiceUrl || !config.apiKey) {
    return { success: false, error: "ArcGIS feature service URL and API key required" };
  }

  const baseUrl = config.featureServiceUrl.replace(/\/?$/, "");
  const token = config.apiKey;

  try {
    const utilityIds = scores.map((s) => s.utility_id);
    const objectIdMap = await queryExistingObjectIds(baseUrl, utilityIds, token);

    const adds: Array<{ attributes: Record<string, unknown> }> = [];
    const updates: Array<{ attributes: Record<string, unknown> & { OBJECTID: number } }> = [];

    for (const s of scores) {
      const attrs = toAttributes(s);
      const oid = objectIdMap.get(s.utility_id);
      if (oid != null) {
        updates.push({ attributes: { ...attrs, OBJECTID: oid } });
      } else {
        adds.push({ attributes: attrs });
      }
    }

    const applyUrl = new URL(`${baseUrl}/applyEdits`);
    applyUrl.searchParams.set("f", "json");
    applyUrl.searchParams.set("token", token);

    const res = await fetch(applyUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        f: "json",
        token,
        rollbackOnFailure: "true",
        adds: adds.length ? JSON.stringify(adds) : "[]",
        updates: updates.length ? JSON.stringify(updates) : "[]",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: err };
    }

    const result = (await res.json()) as {
      addResults?: Array<{ success?: boolean; error?: { description: string } }>;
      updateResults?: Array<{ success?: boolean; error?: { description: string } }>;
      error?: { message: string };
    };

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    const addErrors = (result.addResults ?? []).filter((r) => !r.success && r.error);
    const updateErrors = (result.updateResults ?? []).filter((r) => !r.success && r.error);
    const allErrors = [...addErrors, ...updateErrors];
    if (allErrors.length > 0) {
      return {
        success: false,
        error: allErrors.map((e) => e.error?.description ?? "Unknown error").join("; "),
      };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
