/**
 * urs_fetch_puc_dockets — Fetch state Public Utility Commission docket filings
 *
 * No unified API exists across states. This tool supports:
 * 1. Per-state scrapers for states with queryable web systems (AZ, NC, TX)
 * 2. Manual URL fetch + ingest for any state
 * 3. Listing known PUC systems and their capabilities
 *
 * Dimensions affected: all (large_load_tariff, interconnection_speed, irp_alignment,
 * regulatory_environment, leadership_posture, grid_headroom, track_record, clean_energy_posture)
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { runIngest } from "./ingest";

const RATE_LIMIT_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PUCSystemInfo {
  state: string;
  name: string;
  url: string;
  search_url: string;
  has_scraper: boolean;
  notes: string;
}

const PUC_SYSTEMS: PUCSystemInfo[] = [
  {
    state: "AZ",
    name: "Arizona Corporation Commission (ACC) eDocket",
    url: "https://edocket.azcc.gov/",
    search_url: "https://edocket.azcc.gov/search/docket-search",
    has_scraper: true,
    notes: "Supports docket number and respondent search. Key datacenter docket: E-00000A-25-0069.",
  },
  {
    state: "NC",
    name: "North Carolina Utilities Commission (NCUC)",
    url: "https://www.ncuc.gov/",
    search_url: "https://starw1.ncuc.gov/NCUC/page/Dockets/portal.aspx",
    has_scraper: true,
    notes: "Supports docket search with wildcards (* and ?). Covers Duke Energy rate cases.",
  },
  {
    state: "TX",
    name: "Public Utility Commission of Texas (PUCT) Interchange",
    url: "https://interchange.puc.texas.gov/",
    search_url: "https://interchange.puc.texas.gov/search/dockets/",
    has_scraper: true,
    notes: "Supports control number, case style, and utility name search. ~18k electric dockets.",
  },
  {
    state: "VA",
    name: "Virginia State Corporation Commission (SCC)",
    url: "https://www.scc.virginia.gov/",
    search_url: "https://www.scc.virginia.gov/pages/Case-Information",
    has_scraper: false,
    notes: "Case information system. Dominion Energy rate cases and IRP filings. Manual fetch recommended.",
  },
  {
    state: "SC",
    name: "South Carolina Public Service Commission (SCPSC)",
    url: "https://www.psc.sc.gov/",
    search_url: "https://www.psc.sc.gov/docket-search",
    has_scraper: false,
    notes: "Docket search system. Manual fetch recommended.",
  },
  {
    state: "GA",
    name: "Georgia Public Service Commission (GPSC)",
    url: "https://psc.ga.gov/",
    search_url: "https://psc.ga.gov/search/",
    has_scraper: false,
    notes: "Covers Georgia Power / Southern Company. Manual fetch recommended.",
  },
  {
    state: "OH",
    name: "Public Utilities Commission of Ohio (PUCO)",
    url: "https://www.puco.ohio.gov/",
    search_url: "https://dis.puc.state.oh.us/CaseRecord.aspx",
    has_scraper: false,
    notes: "DIS case record system. AEP Ohio, FirstEnergy rate cases. Manual fetch recommended.",
  },
  {
    state: "IN",
    name: "Indiana Utility Regulatory Commission (IURC)",
    url: "https://www.in.gov/iurc/",
    search_url: "https://iurc.portal.in.gov/legal-case-search/",
    has_scraper: false,
    notes: "Portal-based case search. Manual fetch recommended.",
  },
];

export interface FetchPUCDocketsParams {
  state: string;
  docket_number?: string;
  search_query?: string;
  url?: string;
  utility_id?: string;
  source_type?: string;
  document_date?: string;
  ingest?: boolean;
  limit?: number;
  list_systems?: boolean;
}

export interface PUCDocketEntry {
  docket_number: string;
  title: string;
  state: string;
  status: string;
  filed_date: string;
  url: string;
  parties: string[];
  ingested: boolean;
}

export interface FetchPUCDocketsResult {
  success: boolean;
  state: string;
  system_info?: PUCSystemInfo;
  dockets_found: number;
  dockets_ingested?: number;
  errors: string[];
  dockets: PUCDocketEntry[];
  all_systems?: PUCSystemInfo[];
}

async function scrapeAZDockets(
  searchQuery: string | undefined,
  docketNumber: string | undefined,
  limit: number
): Promise<{ dockets: PUCDocketEntry[]; errors: string[] }> {
  const dockets: PUCDocketEntry[] = [];
  const errors: string[] = [];

  if (docketNumber) {
    try {
      await sleep(RATE_LIMIT_MS);
      const url = `https://edocket.azcc.gov/search/docket-search?DocketNumber=${encodeURIComponent(docketNumber)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "URS-UtilityScoring/1.0 (utility-responsiveness-scoring)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (res.ok) {
        const html = await res.text();
        const text = stripHtml(html);
        if (text.length > 200) {
          dockets.push({
            docket_number: docketNumber,
            title: extractTitle(text, docketNumber),
            state: "AZ",
            status: extractField(text, "Status") ?? "Unknown",
            filed_date: extractField(text, "Filed") ?? "",
            url,
            parties: extractParties(text),
            ingested: false,
          });
        }
      } else {
        errors.push(`AZ eDocket fetch failed: ${res.status}`);
      }
    } catch (e) {
      errors.push(`AZ eDocket error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (searchQuery && dockets.length < limit) {
    try {
      await sleep(RATE_LIMIT_MS);
      const url = `https://edocket.azcc.gov/search/docket-search?SearchText=${encodeURIComponent(searchQuery)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "URS-UtilityScoring/1.0 (utility-responsiveness-scoring)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (res.ok) {
        const html = await res.text();
        const text = stripHtml(html);
        if (text.length > 200) {
          const docketMatches = text.match(/[A-Z]-\d{5}[A-Z]-\d{2}-\d{4}/g) ?? [];
          const seen = new Set(dockets.map((d) => d.docket_number));
          for (const dn of docketMatches.slice(0, limit - dockets.length)) {
            if (seen.has(dn)) continue;
            seen.add(dn);
            dockets.push({
              docket_number: dn,
              title: "",
              state: "AZ",
              status: "Found in search",
              filed_date: "",
              url: `https://edocket.azcc.gov/search/docket-search?DocketNumber=${encodeURIComponent(dn)}`,
              parties: [],
              ingested: false,
            });
          }
        }
      }
    } catch (e) {
      errors.push(`AZ eDocket search error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { dockets, errors };
}

async function scrapeNCDockets(
  searchQuery: string | undefined,
  docketNumber: string | undefined,
  limit: number
): Promise<{ dockets: PUCDocketEntry[]; errors: string[] }> {
  const dockets: PUCDocketEntry[] = [];
  const errors: string[] = [];

  const query = docketNumber ?? searchQuery;
  if (!query) {
    errors.push("NC docket search requires docket_number or search_query");
    return { dockets, errors };
  }

  try {
    await sleep(RATE_LIMIT_MS);
    const searchUrl = `https://starw1.ncuc.gov/NCUC/page/Dockets/portal.aspx?DocketNumber=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "URS-UtilityScoring/1.0 (utility-responsiveness-scoring)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (res.ok) {
      const html = await res.text();
      const text = stripHtml(html);
      const docketDetailIds = [...html.matchAll(/DocketDetails\.aspx\?[^"']*DocketId=([a-f0-9-]+)/gi)].map(
        (m) => m[1]
      );
      const seenIds = new Set<string>();
      const baseDetailUrl = "https://starw1.ncuc.gov/NCUC/page/docket-docs/PSC/DocketDetails.aspx";

      if (docketNumber) {
        const detailUrl =
          docketDetailIds.length > 0
            ? `${baseDetailUrl}?DocketId=${docketDetailIds[0]}`
            : searchUrl;
        dockets.push({
          docket_number: docketNumber,
          title: extractTitle(text, docketNumber),
          state: "NC",
          status: "See NCUC portal",
          filed_date: "",
          url: detailUrl,
          parties: [],
          ingested: false,
        });
      } else {
        for (const id of docketDetailIds.slice(0, limit)) {
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          dockets.push({
            docket_number: id,
            title: "",
            state: "NC",
            status: "Found in search",
            filed_date: "",
            url: `${baseDetailUrl}?DocketId=${id}`,
            parties: [],
            ingested: false,
          });
        }
      }
    } else {
      errors.push(`NCUC fetch failed: ${res.status}`);
    }
  } catch (e) {
    errors.push(`NCUC error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { dockets, errors };
}

async function scrapeTXDockets(
  searchQuery: string | undefined,
  docketNumber: string | undefined,
  limit: number
): Promise<{ dockets: PUCDocketEntry[]; errors: string[] }> {
  const dockets: PUCDocketEntry[] = [];
  const errors: string[] = [];

  if (docketNumber) {
    try {
      await sleep(RATE_LIMIT_MS);
      const url = `https://interchange.puc.texas.gov/search/dockets/?ControlNumber=${encodeURIComponent(docketNumber)}&UtilityType=E`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "URS-UtilityScoring/1.0 (utility-responsiveness-scoring)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (res.ok) {
        const html = await res.text();
        const text = stripHtml(html);
        if (text.length > 200) {
          dockets.push({
            docket_number: docketNumber,
            title: extractTitle(text, docketNumber),
            state: "TX",
            status: extractField(text, "Status") ?? "See PUCT Interchange",
            filed_date: "",
            url,
            parties: extractParties(text),
            ingested: false,
          });
        }
      } else {
        errors.push(`PUCT Interchange fetch failed: ${res.status}`);
      }
    } catch (e) {
      errors.push(`PUCT Interchange error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (searchQuery && dockets.length < limit) {
    try {
      await sleep(RATE_LIMIT_MS);
      const url = `https://interchange.puc.texas.gov/search/dockets/?CaseStyle=${encodeURIComponent(searchQuery)}&UtilityType=E&ItemMatch=Equal`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "URS-UtilityScoring/1.0 (utility-responsiveness-scoring)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (res.ok) {
        const html = await res.text();
        const controlMatches = [...html.matchAll(/ControlNumber=(\d{5})/g)].map((m) => m[1]);
        const seen = new Set(dockets.map((d) => d.docket_number));
        for (const cn of controlMatches.slice(0, limit - dockets.length)) {
          if (seen.has(cn)) continue;
          seen.add(cn);
          dockets.push({
            docket_number: cn,
            title: "",
            state: "TX",
            status: "Found in search",
            filed_date: "",
            url: `https://interchange.puc.texas.gov/search/dockets/?ControlNumber=${cn}&UtilityType=E`,
            parties: [],
            ingested: false,
          });
        }
      }
    } catch (e) {
      errors.push(`PUCT search error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { dockets, errors };
}

function extractTitle(text: string, docketNumber: string): string {
  const idx = text.indexOf(docketNumber);
  if (idx === -1) return "";
  const after = text.slice(idx + docketNumber.length, idx + docketNumber.length + 300).trim();
  const sentence = after.match(/^[^.!?\n]{10,200}/);
  return sentence?.[0]?.trim() ?? "";
}

function extractField(text: string, field: string): string | null {
  const re = new RegExp(`${field}[:\\s]+([^\\n]{3,100})`, "i");
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

function extractParties(text: string): string[] {
  const parties: string[] = [];
  const patterns = [
    /(?:Applicant|Respondent|Petitioner|Complainant|Company)[:\s]+([^\n]{3,100})/gi,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const party = m[1].trim();
      if (party && !parties.includes(party)) parties.push(party);
    }
  }
  return parties;
}

async function fetchAndIngestUrl(
  url: string,
  state: string,
  docketNumber: string,
  utilityId: string,
  sourceType: string,
  documentDate: string | undefined,
  cwd: string,
  anthropicKey: string
): Promise<{ success: boolean; error?: string }> {
  const cacheDir = join(cwd, "data", ".urs-puc-cache", state.toLowerCase());
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  let text: string;
  try {
    await sleep(RATE_LIMIT_MS);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "URS-UtilityScoring/1.0 (utility-responsiveness-scoring)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
    });
    if (!res.ok) {
      return { success: false, error: `Fetch failed: ${res.status} ${res.statusText}` };
    }
    const raw = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    text = contentType.includes("html") ? stripHtml(raw) : raw;
  } catch (e) {
    return { success: false, error: `Fetch error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (text.length < 200) {
    return { success: false, error: "Document too short after processing" };
  }

  const safeDocket = docketNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${state.toLowerCase()}_${safeDocket}.txt`;
  const localPath = join(cacheDir, fileName);
  writeFileSync(localPath, text, "utf-8");

  const relPath = `data/.urs-puc-cache/${state.toLowerCase()}/${fileName}`;
  const ingestResult = await runIngest(
    {
      file_path: relPath,
      source_type: sourceType,
      utility_id: utilityId,
      document_date: documentDate,
    },
    cwd,
    anthropicKey
  );

  if (!ingestResult.success) {
    return { success: false, error: ingestResult.error };
  }
  return { success: true };
}

export async function runFetchPUCDockets(
  params: FetchPUCDocketsParams,
  cwd: string,
  anthropicKey: string
): Promise<FetchPUCDocketsResult> {
  const state = params.state.toUpperCase();
  const limit = params.limit ?? 10;
  const doIngest = params.ingest !== false && !!anthropicKey;

  if (params.list_systems) {
    return {
      success: true,
      state: "ALL",
      dockets_found: 0,
      errors: [],
      dockets: [],
      all_systems: PUC_SYSTEMS,
    };
  }

  const db = initDb(cwd);
  seedUtilities(db);

  if (params.utility_id) {
    const utility = db.prepare("SELECT utility_id FROM utilities WHERE utility_id = ?").get(params.utility_id);
    if (!utility) {
      return { success: false, state, dockets_found: 0, errors: [`Utility ${params.utility_id} not found in DB`], dockets: [] };
    }
  }

  const systemInfo = PUC_SYSTEMS.find((s) => s.state === state);

  if (params.url) {
    const docketNumber = params.docket_number ?? "manual";
    const sourceType = params.source_type ?? "rate_case";

    if (!params.utility_id) {
      return { success: false, state, system_info: systemInfo, dockets_found: 0, errors: ["utility_id required for URL fetch + ingest"], dockets: [] };
    }
    if (!anthropicKey) {
      return { success: false, state, system_info: systemInfo, dockets_found: 0, errors: ["ANTHROPIC_API_KEY required for ingest"], dockets: [] };
    }

    const result = await fetchAndIngestUrl(
      params.url,
      state,
      docketNumber,
      params.utility_id,
      sourceType,
      params.document_date,
      cwd,
      anthropicKey
    );

    const entry: PUCDocketEntry = {
      docket_number: docketNumber,
      title: `Manual fetch: ${params.url}`,
      state,
      status: result.success ? "Ingested" : "Fetch failed",
      filed_date: params.document_date ?? "",
      url: params.url,
      parties: [],
      ingested: result.success,
    };

    return {
      success: result.success,
      state,
      system_info: systemInfo,
      dockets_found: 1,
      dockets_ingested: result.success ? 1 : 0,
      errors: result.error ? [result.error] : [],
      dockets: [entry],
    };
  }

  const errors: string[] = [];
  let scraperResult: { dockets: PUCDocketEntry[]; errors: string[] } | null = null;

  if (systemInfo?.has_scraper) {
    switch (state) {
      case "AZ":
        scraperResult = await scrapeAZDockets(params.search_query, params.docket_number, limit);
        break;
      case "NC":
        scraperResult = await scrapeNCDockets(params.search_query, params.docket_number, limit);
        break;
      case "TX":
        scraperResult = await scrapeTXDockets(params.search_query, params.docket_number, limit);
        break;
    }
  }

  if (!scraperResult) {
    const msg = systemInfo
      ? `${systemInfo.name} does not have automated scraping. Use the 'url' parameter to manually fetch a specific docket document, or download the file and use urs_ingest directly.`
      : `No PUC system registered for ${state}. Use the 'url' parameter to fetch a document URL, or download the file and use urs_ingest. Run with list_systems=true to see known PUC systems.`;
    return {
      success: false,
      state,
      system_info: systemInfo,
      dockets_found: 0,
      errors: [msg],
      dockets: [],
    };
  }

  errors.push(...scraperResult.errors);

  let ingested = 0;
  if (doIngest && params.utility_id && scraperResult.dockets.length > 0) {
    for (const docket of scraperResult.dockets) {
      if (!docket.url) continue;
      try {
        const result = await fetchAndIngestUrl(
          docket.url,
          state,
          docket.docket_number,
          params.utility_id,
          params.source_type ?? "rate_case",
          docket.filed_date || params.document_date,
          cwd,
          anthropicKey
        );
        if (result.success) {
          docket.ingested = true;
          ingested++;
        }
        if (result.error) {
          errors.push(`${docket.docket_number}: ${result.error}`);
        }
      } catch (e) {
        errors.push(`${docket.docket_number}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return {
    success: scraperResult.dockets.length > 0 || errors.length === 0,
    state,
    system_info: systemInfo,
    dockets_found: scraperResult.dockets.length,
    dockets_ingested: doIngest ? ingested : undefined,
    errors,
    dockets: scraperResult.dockets,
  };
}
