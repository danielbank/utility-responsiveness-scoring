/**
 * urs_fetch_hifld — Fetch utility territory metadata from HIFLD ArcGIS REST
 * Enriches utilities table with names, addresses, types. No API key required.
 */

import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";

const HIFLD_FEATURE_URL =
  "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/ArcGIS/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0/query";

export interface FetchHifldParams {
  state?: string;
  utility_name?: string;
  limit?: number;
}

export interface FetchHifldResult {
  success: boolean;
  utilities_fetched: number;
  utilities_upserted: number;
  errors: string[];
  details?: Array<{ name: string; state: string; type?: string }>;
}

export async function runFetchHifld(params: FetchHifldParams, cwd: string): Promise<FetchHifldResult> {
  const db = initDb(cwd);
  seedUtilities(db);

  const limit = params.limit ?? 100;

  const url = new URL(HIFLD_FEATURE_URL);
  url.searchParams.set("f", "json");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("resultRecordCount", String(limit));

  const whereParts: string[] = ["1=1"];
  if (params.state) {
    const state = params.state.toUpperCase().slice(0, 2);
    whereParts.push(`STATE = '${state.replace(/'/g, "''")}'`);
  }
  if (params.utility_name) {
    const name = params.utility_name.replace(/'/g, "''");
    whereParts.push(`UPPER(NAME) LIKE '%${name.toUpperCase()}%'`);
  }
  url.searchParams.set("where", whereParts.join(" AND "));

  let data: { features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message: string } };
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return {
        success: false,
        utilities_fetched: 0,
        utilities_upserted: 0,
        errors: [`HIFLD fetch failed: ${res.status} ${res.statusText}`],
      };
    }
    data = (await res.json()) as typeof data;
  } catch (e) {
    return {
      success: false,
      utilities_fetched: 0,
      utilities_upserted: 0,
      errors: [`HIFLD fetch error: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  if (data.error) {
    return {
      success: false,
      utilities_fetched: 0,
      utilities_upserted: 0,
      errors: [data.error.message],
    };
  }

  const features = data.features ?? [];
  const details: Array<{ name: string; state: string; type?: string }> = [];
  let upserted = 0;

  const upsert = db.prepare(`
    INSERT INTO utilities (utility_id, utility_name, state, ferc_id, hifld_id, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(utility_id) DO UPDATE SET
      utility_name = excluded.utility_name,
      hifld_id = excluded.hifld_id,
      updated_at = excluded.updated_at
  `);

  for (const f of features) {
    const attrs = f.attributes ?? {};
    const name = String(attrs.NAME ?? attrs.name ?? "").trim();
    const state = String(attrs.STATE ?? attrs.state ?? "").trim().slice(0, 2);
    const hifldId = attrs.OBJECTID ?? attrs.id ?? attrs.HIFLD_ID;
    const type = (attrs.NAICS_DESC ?? attrs.type ?? attrs.TYPE) as string | undefined;

    if (!name || !state) continue;

    details.push({ name: name.slice(0, 60), state, type: type?.slice(0, 40) });

    const utilityId = hifldId != null ? `hifld-${hifldId}` : `hifld-${name.slice(0, 20).replace(/\W/g, "")}-${state}`;
    try {
      upsert.run(utilityId, name, state, null, hifldId != null ? String(hifldId) : null);
      upserted++;
    } catch {
      // skip on conflict or constraint
    }
  }

  return {
    success: true,
    utilities_fetched: features.length,
    utilities_upserted: upserted,
    errors: [],
    details,
  };
}
