/**
 * urs_fetch_eia — Fetch EIA Open Data API (retail sales, customers, capacity)
 * Writes structured track_record signals to DB.
 * Requires EIA_API_KEY (free at eia.gov/opendata).
 */

import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { insertStructuredSignals } from "./insert-structured-signals";

const EIA_BASE = "https://api.eia.gov/v2";
const CACHE_DIR = "data/.urs-eia-cache";

export interface FetchEiaParams {
  utility_id: string;
  dataset?: string;
  start?: string;
  end?: string;
  frequency?: string;
}

export interface FetchEiaResult {
  success: boolean;
  utility_id: string;
  signals_written: number;
  errors: string[];
  details?: { source_type: string; document_date: string; records: number };
}

export async function runFetchEia(
  params: FetchEiaParams,
  cwd: string,
  apiKey: string
): Promise<FetchEiaResult> {
  const db = initDb(cwd);
  seedUtilities(db);

  const utility = db.prepare("SELECT utility_id, utility_name FROM utilities WHERE utility_id = ?").get(
    params.utility_id
  ) as { utility_id: string; utility_name: string } | undefined;

  if (!utility) {
    return {
      success: false,
      utility_id: params.utility_id,
      signals_written: 0,
      errors: [`Utility ${params.utility_id} not found in DB`],
    };
  }

  if (!apiKey) {
    return {
      success: false,
      utility_id: params.utility_id,
      signals_written: 0,
      errors: ["EIA_API_KEY required. Register at https://www.eia.gov/opendata/"],
    };
  }

  const dataset = params.dataset ?? "electricity/retail-sales";
  const frequency = params.frequency ?? "annual";
  const endYear = params.end ? params.end.slice(0, 4) : String(new Date().getFullYear() - 1);
  const startYear = params.start ? params.start.slice(0, 4) : endYear;

  const cacheDir = join(cwd, CACHE_DIR);
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

  const url = new URL(`${EIA_BASE}/${dataset}/data/`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("frequency", frequency);
  url.searchParams.set("data[0]", "customers");
  url.searchParams.set("data[1]", "sales");
  url.searchParams.set("data[2]", "revenue");
  url.searchParams.set("facets[utilityid][]", params.utility_id);
  url.searchParams.set("start", `${startYear}-01-01`);
  url.searchParams.set("end", `${endYear}-12-31`);
  url.searchParams.set("length", "5000");

  let data: { response?: { data?: Array<Record<string, unknown>> } };
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      return {
        success: false,
        utility_id: params.utility_id,
        signals_written: 0,
        errors: [`EIA API error ${res.status}: ${text.slice(0, 200)}`],
      };
    }
    data = (await res.json()) as typeof data;
  } catch (e) {
    return {
      success: false,
      utility_id: params.utility_id,
      signals_written: 0,
      errors: [`EIA fetch error: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const rows = data?.response?.data ?? [];
  if (rows.length === 0) {
    return {
      success: false,
      utility_id: params.utility_id,
      signals_written: 0,
      errors: [`No EIA retail-sales data for utility ${params.utility_id}. Utility may not be in EIA API.`],
    };
  }

  const totalCustomers = rows.reduce((s, r) => s + (Number(r.customers) || 0), 0);
  const totalSales = rows.reduce((s, r) => s + (Number(r.sales) || 0), 0);
  const totalRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);

  const largeCustomerCount = totalSales > 1000000 ? Math.min(10, Math.floor(totalSales / 500000)) : 0;
  const hasServed100Mw = totalSales > 100000;

  const payload: Record<string, unknown> = {
    large_customer_count_50mw_plus: largeCustomerCount,
    has_served_100mw_plus: hasServed100Mw,
    key_quotes: [
      `EIA retail-sales ${startYear}-${endYear}: ${totalCustomers.toLocaleString()} customers, ${totalSales.toLocaleString()} MWh`,
    ],
  };

  const cachePath = join(cacheDir, `${params.utility_id}-${endYear}.json`);
  writeFileSync(cachePath, JSON.stringify({ rows: rows.length, totalCustomers, totalSales, totalRevenue }, null, 2), "utf-8");

  const sourceType = "eia_api";
  const count = insertStructuredSignals(
    db,
    params.utility_id,
    sourceType,
    `${endYear}-12-31`,
    `eia-api:${sourceType}`,
    [{ extraction_target: "track_record_signals", dimension: "track_record", payload }],
    "eia-api-structured"
  );

  return {
    success: true,
    utility_id: params.utility_id,
    signals_written: count,
    errors: [],
    details: {
      source_type: "eia_api",
      document_date: `${endYear}-12-31`,
      records: rows.length,
    },
  };
}
