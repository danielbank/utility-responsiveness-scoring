/**
 * urs_fetch_legiscan — Fetch state legislation from LegiScan API
 * Feeds regulatory_environment. Caches bill text, optionally ingests for LLM extraction.
 * Requires LEGISCAN_API_KEY (free at legiscan.com, 30k queries/month).
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { runIngest } from "./ingest";

const LEGISCAN_API = "https://api.legiscan.com/";
const CACHE_DIR = "data/.urs-legiscan-cache";

export interface FetchLegiscanParams {
  state: string;
  utility_id?: string;
  query?: string;
  year?: number;
  limit?: number;
  ingest?: boolean;
}

export interface FetchLegiscanResult {
  success: boolean;
  state: string;
  bills_fetched: number;
  bills_ingested?: number;
  errors: string[];
  details?: Array<{ bill_id: string; title: string; status: string; ingested: boolean }>;
}

async function legiscanRequest(apiKey: string, op: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(LEGISCAN_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: apiKey, op, ...params }),
  });
  if (!res.ok) throw new Error(`LegiScan ${res.status}`);
  return res.json();
}

export async function runFetchLegiscan(
  params: FetchLegiscanParams,
  cwd: string,
  apiKey: string
): Promise<FetchLegiscanResult> {
  const db = initDb(cwd);
  seedUtilities(db);

  let state = params.state?.toUpperCase().slice(0, 2);
  if (params.utility_id && !state) {
    const row = db.prepare("SELECT state FROM utilities WHERE utility_id = ?").get(params.utility_id) as
      | { state: string }
      | undefined;
    if (row) state = row.state.toUpperCase().slice(0, 2);
  }

  if (!state || state.length !== 2) {
    return {
      success: false,
      state: params.state ?? "",
      bills_fetched: 0,
      errors: ["Provide state (2-letter) or utility_id to resolve state"],
    };
  }

  if (!apiKey) {
    return {
      success: false,
      state,
      bills_fetched: 0,
      errors: ["LEGISCAN_API_KEY required. Free at https://legiscan.com/legiscan"],
    };
  }

  const query = params.query ?? "datacenter OR data center OR electric utility OR energy incentive";
  const limit = params.limit ?? 5;
  const year = params.year ?? new Date().getFullYear();
  const doIngest = params.ingest !== false;

  const cacheDir = join(cwd, CACHE_DIR, state);
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

  let searchResult: { status?: string; searchresult?: { summary?: { count?: number }; bills?: Array<{ bill_id: string; bill_number: string; title: string; status: string }> } };
  try {
    searchResult = (await legiscanRequest(apiKey, "getSearch", {
      state,
      query,
      year,
    })) as typeof searchResult;
  } catch (e) {
    return {
      success: false,
      state,
      bills_fetched: 0,
      errors: [`LegiScan search failed: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const bills = searchResult?.searchresult?.bills ?? [];
  if (bills.length === 0) {
    return {
      success: true,
      state,
      bills_fetched: 0,
      errors: [],
      details: [],
    };
  }

  const details: Array<{ bill_id: string; title: string; status: string; ingested: boolean }> = [];
  let ingested = 0;

  for (let i = 0; i < Math.min(limit, bills.length); i++) {
    const bill = bills[i];
    let billDetail: { bill?: { texts?: Array<{ doc_id: string }> } };
    try {
      billDetail = (await legiscanRequest(apiKey, "getBill", { id: bill.bill_id })) as typeof billDetail;
    } catch {
      details.push({ bill_id: bill.bill_id, title: bill.title, status: bill.status, ingested: false });
      continue;
    }

    const texts = billDetail?.bill?.texts ?? [];
    let textContent = "";
    if (texts.length > 0) {
      try {
        const textRes = (await legiscanRequest(apiKey, "getBillText", { id: texts[0].doc_id })) as {
          text?: { doc_id: string; text?: string };
        };
        textContent = textRes?.text?.text ?? "";
      } catch {
        textContent = `${bill.title}\n${bill.bill_number}\nStatus: ${bill.status}`;
      }
    } else {
      textContent = `${bill.title}\n${bill.bill_number}\nStatus: ${bill.status}`;
    }

    const safeId = String(bill.bill_id).replace(/\D/g, "");
    const cachePath = join(cacheDir, `${safeId}-${year}.txt`);
    writeFileSync(cachePath, textContent, "utf-8");

    let didIngest = false;
    if (doIngest && textContent.length > 100) {
      const relPath = `${CACHE_DIR}/${state}/${safeId}-${year}.txt`;
      const utilityForState = db
        .prepare("SELECT utility_id FROM utilities WHERE state = ? LIMIT 1")
        .get(state) as { utility_id: string } | undefined;
      const utilityId = params.utility_id ?? utilityForState?.utility_id;
      if (utilityId) {
        const ingestResult = await runIngest(
          {
            file_path: relPath,
            source_type: "legislation",
            utility_id: utilityId,
            document_date: `${year}-01-01`,
          },
          cwd,
          process.env.ANTHROPIC_API_KEY ?? ""
        );
        if (ingestResult.success && (ingestResult.signals_extracted ?? 0) > 0) {
          ingested++;
          didIngest = true;
        }
      }
    }

    details.push({ bill_id: bill.bill_id, title: bill.title.slice(0, 80), status: bill.status, ingested: didIngest });
  }

  return {
    success: true,
    state,
    bills_fetched: details.length,
    bills_ingested: doIngest ? ingested : undefined,
    errors: [],
    details,
  };
}
