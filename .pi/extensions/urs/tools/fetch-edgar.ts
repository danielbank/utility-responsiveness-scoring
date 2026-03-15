/**
 * urs_fetch_edgar — Fetch SEC EDGAR filings and ingest into URS
 * Uses SEC's free data.sec.gov API. No API key required.
 * Rate limit: 10 requests/second. User-Agent header required.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getCikForUtility } from "../data/edgar-cik-map";
import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { runIngest } from "./ingest";

const SEC_USER_AGENT = "URS-UtilityScoring/1.0 (https://github.com/badlogic/pi-mono; utility-responsiveness-scoring)";
const RATE_LIMIT_MS = 150; // ~6 req/sec, under SEC's 10/sec limit

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface SecSubmissions {
  filings?: {
    recent?: {
      form?: string[];
      accessionNumber?: string[];
      primaryDocument?: string[];
      filingDate?: string[];
    };
  };
  cik?: string;
}

export interface FetchEdgarParams {
  utility_id: string;
  cik?: string;
  form_types?: string[];
  limit?: number;
  ingest?: boolean;
}

export interface FetchEdgarResult {
  success: boolean;
  utility_id: string;
  cik?: string;
  filings_fetched: number;
  filings_ingested?: number;
  errors: string[];
  details?: Array<{ form: string; filing_date: string; accession: string; ingested: boolean }>;
}

export async function runFetchEdgar(
  params: FetchEdgarParams,
  cwd: string,
  apiKey: string
): Promise<FetchEdgarResult> {
  const formTypes = params.form_types ?? ["10-K", "10-Q"];
  const limit = params.limit ?? 5;
  const doIngest = params.ingest !== false;

  const db = initDb(cwd);
  seedUtilities(db);

  const utility = db.prepare("SELECT utility_id, utility_name FROM utilities WHERE utility_id = ?").get(params.utility_id) as
    | { utility_id: string; utility_name: string }
    | undefined;
  if (!utility) {
    return {
      success: false,
      utility_id: params.utility_id,
      filings_fetched: 0,
      errors: [`Utility ${params.utility_id} not found in DB`],
    };
  }

  let cik = params.cik ?? getCikForUtility(params.utility_id);
  if (!cik) {
    return {
      success: false,
      utility_id: params.utility_id,
      filings_fetched: 0,
      errors: [
        `No SEC CIK mapping for utility ${params.utility_id} (${utility.utility_name}). ` +
          "Only investor-owned utilities file with SEC. Add mapping in data/edgar-cik-map.ts if this is an IOU.",
      ],
    };
  }
  cik = String(cik).replace(/^0+/, "") || "0";
  cik = cik.padStart(10, "0");

  const errors: string[] = [];
  const cacheDir = join(cwd, "data", ".urs-edgar-cache", params.utility_id);
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  let submissions: SecSubmissions;

  try {
    await sleep(RATE_LIMIT_MS);
    const res = await fetch(submissionsUrl, {
      headers: { "User-Agent": SEC_USER_AGENT },
    });
    if (!res.ok) {
      return {
        success: false,
        utility_id: params.utility_id,
        cik,
        filings_fetched: 0,
        errors: [`SEC submissions fetch failed: ${res.status} ${res.statusText}`],
      };
    }
    submissions = (await res.json()) as SecSubmissions;
  } catch (e) {
    return {
      success: false,
      utility_id: params.utility_id,
      cik,
      filings_fetched: 0,
      errors: [`SEC fetch error: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const recent = submissions.filings?.recent;
  if (!recent?.form || !recent?.accessionNumber || !recent?.primaryDocument || !recent?.filingDate) {
    return {
      success: false,
      utility_id: params.utility_id,
      cik,
      filings_fetched: 0,
      errors: ["SEC response missing expected filing arrays"],
    };
  }

  const cikNum = cik.replace(/^0+/, "") || cik;
  const indices: number[] = [];
  for (let i = 0; i < recent.form.length && indices.length < limit; i++) {
    if (formTypes.includes(recent.form[i])) {
      indices.push(i);
    }
  }

  const details: Array<{ form: string; filing_date: string; accession: string; ingested: boolean }> = [];
  let ingested = 0;

  for (const i of indices) {
    const form = recent.form[i];
    const accession = recent.accessionNumber[i];
    const primaryDoc = recent.primaryDocument[i];
    const filingDate = recent.filingDate[i];

    const accessionPath = accession.replace(/-/g, "");
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession}/${primaryDoc}`;

    let text: string;
    try {
      await sleep(RATE_LIMIT_MS);
      const docRes = await fetch(docUrl, { headers: { "User-Agent": SEC_USER_AGENT } });
      if (!docRes.ok) {
        errors.push(`${form} ${filingDate}: fetch failed ${docRes.status}`);
        details.push({ form, filing_date: filingDate, accession, ingested: false });
        continue;
      }
      text = await docRes.text();
    } catch (e) {
      errors.push(`${form} ${filingDate}: ${e instanceof Error ? e.message : String(e)}`);
      details.push({ form, filing_date: filingDate, accession, ingested: false });
      continue;
    }

    const cleanText = primaryDoc.toLowerCase().endsWith(".htm") || primaryDoc.toLowerCase().endsWith(".html")
      ? stripHtml(text)
      : text;

    if (cleanText.length < 500) {
      errors.push(`${form} ${filingDate}: document too short after processing`);
      details.push({ form, filing_date: filingDate, accession, ingested: false });
      continue;
    }

    const localPath = join(cacheDir, `${accessionPath}-${primaryDoc}`);
    writeFileSync(localPath, cleanText, "utf-8");

    let didIngest = false;
    if (doIngest && apiKey) {
      const relPath = `data/.urs-edgar-cache/${params.utility_id}/${accessionPath}-${primaryDoc}`;
      const ingestResult = await runIngest(
        {
          file_path: relPath,
          source_type: form,
          utility_id: params.utility_id,
          document_date: filingDate,
        },
        cwd,
        apiKey
      );
      if (ingestResult.success && (ingestResult.signals_extracted ?? 0) > 0) {
        ingested++;
        didIngest = true;
      }
      if (!ingestResult.success && ingestResult.error) {
        errors.push(`${form} ${filingDate}: ingest failed - ${ingestResult.error}`);
      }
    }

    details.push({ form, filing_date: filingDate, accession, ingested: didIngest });
  }

  return {
    success: errors.length === 0 || details.length > 0,
    utility_id: params.utility_id,
    cik,
    filings_fetched: details.length,
    filings_ingested: doIngest ? ingested : undefined,
    errors: errors.length > 0 ? errors : [],
    details,
  };
}
