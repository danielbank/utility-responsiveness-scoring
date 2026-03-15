/**
 * urs_fetch_legiscan — Search and fetch state energy/datacenter bills from LegiScan
 * Free tier: 30,000 queries/month. API key required (legiscan.com).
 * Covers all 50 states + Congress. Returns structured bill data for regulatory_environment scoring.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { runIngest } from "./ingest";

const RATE_LIMIT_MS = 200;

const DEFAULT_SEARCH_TERMS = [
  "datacenter OR \"data center\"",
  "\"large load\" AND electric",
  "\"energy infrastructure\" AND datacenter",
  "\"utility scale\" AND \"economic development\"",
  "\"hyperscale\" AND energy",
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface LegiScanSearchResult {
  status: string;
  searchresult: Record<
    string,
    | {
        relevance: number;
        state: string;
        bill_number: string;
        bill_id: number;
        change_hash: string;
        url: string;
        text_url: string;
        last_action_date: string;
        last_action: string;
        title: string;
      }
    | { count: number; page: number; range: { page: number; start: number; end: number } }
    | string // "summary" key
  >;
}

interface LegiScanBillDetail {
  status: string;
  bill: {
    bill_id: number;
    bill_number: string;
    bill_type: string;
    body: string;
    current_body: string;
    title: string;
    description: string;
    state: string;
    state_id: number;
    session: { session_id: number; session_title: string; year_start: number; year_end: number };
    status: number;
    status_date: string;
    status_desc?: string;
    url: string;
    state_link: string;
    sponsors: Array<{ name: string; party: string; role: string }>;
    history: Array<{ date: string; action: string; chamber: string }>;
    texts: Array<{ doc_id: number; date: string; type: string; mime: string; url: string; state_link: string }>;
    subjects: Array<{ subject_id: number; subject_name: string }>;
  };
}

interface LegiScanBillText {
  status: string;
  text: {
    doc_id: number;
    bill_id: number;
    date: string;
    type: string;
    mime: string;
    doc: string; // base64 encoded
  };
}

const STATUS_MAP: Record<number, string> = {
  1: "Introduced",
  2: "Engrossed",
  3: "Enrolled",
  4: "Passed",
  5: "Vetoed",
  6: "Failed",
};

export interface FetchLegiScanParams {
  state?: string;
  query?: string;
  keywords?: string[];
  year?: number;
  bill_id?: number;
  relevance_threshold?: number;
  limit?: number;
  ingest?: boolean;
  utility_id?: string;
}

export interface LegiScanBillSummary {
  bill_id: number;
  bill_number: string;
  state: string;
  title: string;
  description: string;
  status: string;
  status_date: string;
  last_action: string;
  last_action_date: string;
  url: string;
  sponsors: string[];
  subjects: string[];
  relevance: number;
  ingested: boolean;
}

export interface FetchLegiScanResult {
  success: boolean;
  bills_found: number;
  bills_fetched: number;
  bills_ingested?: number;
  queries_used: number;
  errors: string[];
  bills: LegiScanBillSummary[];
}

async function legiscanGet(
  apiKey: string,
  op: string,
  params: Record<string, string | number>
): Promise<unknown> {
  const url = new URL(LEGISCAN_BASE);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("op", op);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  await sleep(RATE_LIMIT_MS);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`LegiScan API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (data && typeof data === "object" && "status" in data && data.status === "ERROR") {
    const alert = (data as Record<string, unknown>).alert;
    throw new Error(`LegiScan API error: ${typeof alert === "string" ? alert : JSON.stringify(alert)}`);
  }
  return data;
}

async function searchBills(
  apiKey: string,
  query: string,
  state?: string,
  year?: number,
  page = 1
): Promise<{ bills: Array<{ bill_id: number; state: string; bill_number: string; title: string; relevance: number; last_action: string; last_action_date: string; url: string }>; total: number }> {
  const params: Record<string, string | number> = { query };
  if (state) params.state = state.toUpperCase();
  if (year) params.year = year;
  if (page > 1) params.page = page;

  const data = (await legiscanGet(apiKey, "getSearch", params)) as LegiScanSearchResult;
  const sr = data.searchresult;
  if (!sr) return { bills: [], total: 0 };

  const bills: Array<{ bill_id: number; state: string; bill_number: string; title: string; relevance: number; last_action: string; last_action_date: string; url: string }> = [];
  let total = 0;

  for (const [key, val] of Object.entries(sr)) {
    if (key === "summary" && val && typeof val === "object" && "count" in val) {
      total = (val as { count: number }).count;
      continue;
    }
    if (key === "summary" || typeof val === "string") continue;
    if (val && typeof val === "object" && "bill_id" in val) {
      const b = val as { bill_id: number; state: string; bill_number: string; title: string; relevance: number; last_action: string; last_action_date: string; url: string };
      bills.push({
        bill_id: b.bill_id,
        state: b.state,
        bill_number: b.bill_number,
        title: b.title,
        relevance: b.relevance,
        last_action: b.last_action,
        last_action_date: b.last_action_date,
        url: b.url,
      });
    }
  }

  return { bills, total };
}

async function getBillDetail(apiKey: string, billId: number): Promise<LegiScanBillDetail["bill"] | null> {
  const data = (await legiscanGet(apiKey, "getBill", { id: billId })) as LegiScanBillDetail;
  return data?.bill ?? null;
}

async function getBillText(apiKey: string, docId: number): Promise<string | null> {
  const data = (await legiscanGet(apiKey, "getBillText", { id: docId })) as LegiScanBillText;
  if (!data?.text?.doc) return null;
  const buf = Buffer.from(data.text.doc, "base64");
  if (data.text.mime === "application/pdf") {
    return null; // PDF requires separate handling; skip for now
  }
  return buf.toString("utf-8");
}

export async function runFetchLegiScan(
  params: FetchLegiScanParams,
  cwd: string,
  apiKey: string,
  anthropicKey: string
): Promise<FetchLegiScanResult> {
  const limit = params.limit ?? 10;
  const relevanceThreshold = params.relevance_threshold ?? 50;
  const doIngest = params.ingest !== false && !!anthropicKey;
  let queriesUsed = 0;

  const db = initDb(cwd);
  seedUtilities(db);

  if (params.utility_id) {
    const utility = db.prepare("SELECT utility_id FROM utilities WHERE utility_id = ?").get(params.utility_id);
    if (!utility) {
      return { success: false, bills_found: 0, bills_fetched: 0, queries_used: 0, errors: [`Utility ${params.utility_id} not found in DB`], bills: [] };
    }
  }

  const cacheDir = join(cwd, "data", ".urs-legiscan-cache");
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  const errors: string[] = [];
  const allBillIds = new Set<number>();
  const searchHits: Array<{ bill_id: number; state: string; bill_number: string; title: string; relevance: number; last_action: string; last_action_date: string; url: string }> = [];

  if (params.bill_id) {
    searchHits.push({
      bill_id: params.bill_id,
      state: params.state ?? "",
      bill_number: "",
      title: "",
      relevance: 100,
      last_action: "",
      last_action_date: "",
      url: "",
    });
    allBillIds.add(params.bill_id);
  } else {
    const queries = params.query
      ? [params.query]
      : params.keywords?.length
        ? params.keywords.map((kw) => kw)
        : DEFAULT_SEARCH_TERMS;

    for (const q of queries) {
      if (allBillIds.size >= limit) break;
      try {
        const result = await searchBills(apiKey, q, params.state, params.year);
        queriesUsed++;
        for (const bill of result.bills) {
          if (bill.relevance < relevanceThreshold) continue;
          if (allBillIds.has(bill.bill_id)) continue;
          allBillIds.add(bill.bill_id);
          searchHits.push(bill);
          if (allBillIds.size >= limit) break;
        }
      } catch (e) {
        errors.push(`Search "${q}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (searchHits.length === 0) {
    return {
      success: errors.length === 0,
      bills_found: 0,
      bills_fetched: 0,
      queries_used: queriesUsed,
      errors: errors.length > 0 ? errors : ["No bills found matching search criteria"],
      bills: [],
    };
  }

  const bills: LegiScanBillSummary[] = [];
  let ingested = 0;

  for (const hit of searchHits) {
    let detail: LegiScanBillDetail["bill"] | null = null;
    try {
      detail = await getBillDetail(apiKey, hit.bill_id);
      queriesUsed++;
    } catch (e) {
      errors.push(`getBill ${hit.bill_id}: ${e instanceof Error ? e.message : String(e)}`);
    }

    const summary: LegiScanBillSummary = {
      bill_id: hit.bill_id,
      bill_number: detail?.bill_number ?? hit.bill_number,
      state: detail?.state ?? hit.state,
      title: detail?.title ?? hit.title,
      description: detail?.description ?? "",
      status: detail ? STATUS_MAP[detail.status] ?? `Status ${detail.status}` : "",
      status_date: detail?.status_date ?? "",
      last_action: detail?.history?.length ? detail.history[detail.history.length - 1].action : hit.last_action,
      last_action_date: detail?.status_date ?? hit.last_action_date,
      url: detail?.state_link ?? hit.url,
      sponsors: detail?.sponsors?.map((s) => `${s.name} (${s.party})`) ?? [],
      subjects: detail?.subjects?.map((s) => s.subject_name) ?? [],
      relevance: hit.relevance,
      ingested: false,
    };

    let billText: string | null = null;
    if (detail?.texts?.length) {
      const latestText = detail.texts[detail.texts.length - 1];
      if (latestText.mime !== "application/pdf") {
        try {
          billText = await getBillText(apiKey, latestText.doc_id);
          queriesUsed++;
        } catch (e) {
          errors.push(`getText ${hit.bill_id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    if (!billText && detail) {
      const parts = [
        `Bill: ${detail.bill_number} — ${detail.title}`,
        `State: ${detail.state}`,
        `Status: ${STATUS_MAP[detail.status] ?? detail.status} (${detail.status_date})`,
        `Description: ${detail.description}`,
        "",
        "Sponsors:",
        ...(detail.sponsors?.map((s) => `  - ${s.name} (${s.party}, ${s.role})`) ?? []),
        "",
        "Subjects:",
        ...(detail.subjects?.map((s) => `  - ${s.subject_name}`) ?? []),
        "",
        "History:",
        ...(detail.history?.map((h) => `  ${h.date} [${h.chamber}] ${h.action}`) ?? []),
      ];
      billText = parts.join("\n");
    }

    if (billText && billText.length > 100) {
      const safeNumber = (detail?.bill_number ?? String(hit.bill_id)).replace(/[^a-zA-Z0-9_-]/g, "_");
      const fileName = `${(detail?.state ?? hit.state).toLowerCase()}_${safeNumber}.txt`;
      const localPath = join(cacheDir, fileName);
      writeFileSync(localPath, billText, "utf-8");

      if (doIngest && params.utility_id) {
        const relPath = `data/.urs-legiscan-cache/${fileName}`;
        try {
          const ingestResult = await runIngest(
            {
              file_path: relPath,
              source_type: "legislation",
              utility_id: params.utility_id,
              document_date: detail?.status_date ?? hit.last_action_date,
            },
            cwd,
            anthropicKey
          );
          if (ingestResult.success && (ingestResult.signals_extracted ?? 0) > 0) {
            ingested++;
            summary.ingested = true;
          }
          if (!ingestResult.success && ingestResult.error) {
            errors.push(`ingest ${hit.bill_id}: ${ingestResult.error}`);
          }
        } catch (e) {
          errors.push(`ingest ${hit.bill_id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    bills.push(summary);
  }

  return {
    success: true,
    bills_found: allBillIds.size,
    bills_fetched: bills.length,
    bills_ingested: doIngest ? ingested : undefined,
    queries_used: queriesUsed,
    errors,
    bills,
  };
}
