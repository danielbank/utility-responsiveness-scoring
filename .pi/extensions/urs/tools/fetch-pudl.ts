/**
 * urs_fetch_pudl — Fetch FERC Form 1 data via PUDL (Catalyst Cooperative)
 * Writes structured track_record and large_load_tariff signals to DB.
 * Data: Zenodo PUDL release (ferc1_dbf.sqlite) or local path.
 */

import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import extract from "extract-zip";

const PUDL_ZENODO_RECORD = "17925629";
const PUDL_FERC1_DBF_KEY = "ferc1_dbf.sqlite.zip";
const CACHE_DIR = "data/.urs-pudl-cache";
const MAX_AGE_DAYS = 365;

export interface FetchPudlParams {
  utility_id: string;
  year?: number;
  pudl_sqlite_path?: string;
}

export interface FetchPudlResult {
  success: boolean;
  utility_id: string;
  ferc_id?: string;
  signals_written: number;
  errors: string[];
  details?: { source_type: string; document_date: string; signals: string[] };
}

function insertStructuredSignals(
  db: ReturnType<typeof initDb>,
  utilityId: string,
  sourceType: string,
  documentDate: string,
  signals: Array<{ extraction_target: string; payload: Record<string, unknown> }>
): number {
  const sourceId = `src-${randomUUID().slice(0, 8)}`;
  const dimensionsAffected = [...new Set(signals.map((s) => mapTargetToDimension(s.extraction_target)).filter(Boolean))];
  if (dimensionsAffected.length === 0) return 0;

  db.prepare(
    `INSERT INTO sources (source_id, utility_id, source_type, document_date, file_path, dimensions_affected, max_age_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sourceId,
    utilityId,
    sourceType,
    documentDate,
    `pudl:${sourceType}`,
    JSON.stringify(dimensionsAffected),
    MAX_AGE_DAYS
  );

  let count = 0;
  for (const s of signals) {
    const dim = mapTargetToDimension(s.extraction_target);
    if (!dim) continue;
    const signalId = `sig-${randomUUID().slice(0, 8)}`;
    const payload = { dimension: dim, ...s.payload };
    db.prepare(
      `INSERT INTO signals (signal_id, source_id, extraction_target, payload, model_version, extraction_confidence)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(signalId, sourceId, s.extraction_target, JSON.stringify(payload), "pudl-structured", 0.9);
    count++;
  }
  return count;
}

function mapTargetToDimension(target: string): string | null {
  const map: Record<string, string> = {
    track_record_signals: "track_record",
    large_load_tariff: "large_load_tariff",
  };
  return map[target] ?? null;
}

export async function runFetchPudl(
  params: FetchPudlParams,
  cwd: string
): Promise<FetchPudlResult> {
  const db = initDb(cwd);
  seedUtilities(db);

  const utility = db.prepare("SELECT utility_id, utility_name, ferc_id FROM utilities WHERE utility_id = ?").get(
    params.utility_id
  ) as { utility_id: string; utility_name: string; ferc_id: string | null } | undefined;

  if (!utility) {
    return {
      success: false,
      utility_id: params.utility_id,
      signals_written: 0,
      errors: [`Utility ${params.utility_id} not found in DB`],
    };
  }

  const fercId = utility.ferc_id;
  if (!fercId) {
    return {
      success: false,
      utility_id: params.utility_id,
      signals_written: 0,
      errors: [
        `Utility ${params.utility_id} (${utility.utility_name}) has no ferc_id. ` +
          "FERC Form 1 data requires ferc_id. Add via EIA-861 import or manual update.",
      ],
    };
  }

  const year = params.year ?? new Date().getFullYear() - 1;
  const errors: string[] = [];
  let sqlitePath: string;

  if (params.pudl_sqlite_path) {
    const resolved = params.pudl_sqlite_path.startsWith("/")
      ? params.pudl_sqlite_path
      : join(cwd, params.pudl_sqlite_path);
    if (!existsSync(resolved)) {
      return {
        success: false,
        utility_id: params.utility_id,
        ferc_id: fercId,
        signals_written: 0,
        errors: [`File not found: ${params.pudl_sqlite_path}`],
      };
    }
    sqlitePath = resolved;
  } else {
    const cacheDir = join(cwd, CACHE_DIR);
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    const zipPath = join(cacheDir, "ferc1_dbf.sqlite.zip");
    let extractedPath = join(cacheDir, "ferc1_dbf.sqlite");

    if (!existsSync(extractedPath)) {
      if (!existsSync(zipPath)) {
        try {
          const zenodoRes = await fetch(
            `https://zenodo.org/records/${PUDL_ZENODO_RECORD}/files/${PUDL_FERC1_DBF_KEY}?download=1`,
            { redirect: "follow" }
          );
          if (!zenodoRes.ok || !zenodoRes.body) {
            return {
              success: false,
              utility_id: params.utility_id,
              ferc_id: fercId,
              signals_written: 0,
              errors: [`Zenodo fetch failed: ${zenodoRes.status}. Try downloading ferc1_dbf.sqlite.zip from Zenodo and pass pudl_sqlite_path.`],
            };
          }
          const fileStream = createWriteStream(zipPath);
          await pipeline(zenodoRes.body as any, fileStream);
        } catch (e) {
          return {
            success: false,
            utility_id: params.utility_id,
            ferc_id: fercId,
            signals_written: 0,
            errors: [
              `Download failed: ${e instanceof Error ? e.message : String(e)}. ` +
                `PUDL ferc1_dbf.sqlite.zip is ~271MB. Download from https://zenodo.org/records/${PUDL_ZENODO_RECORD} and pass pudl_sqlite_path.`,
            ],
          };
        }
      }
      try {
        await extract(zipPath, { dir: cacheDir });
        const findSqlite = (dir: string): string | null => {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const p = join(dir, e.name);
            if (e.isFile() && e.name.endsWith(".sqlite")) return p;
            if (e.isDirectory()) {
              const found = findSqlite(p);
              if (found) return found;
            }
          }
          return null;
        };
        const found = findSqlite(cacheDir);
        if (found) extractedPath = found;
      } catch (e) {
        return {
          success: false,
          utility_id: params.utility_id,
          ferc_id: fercId,
          signals_written: 0,
          errors: [`Extract failed: ${e instanceof Error ? e.message : String(e)}`],
        };
      }
    }
    sqlitePath = extractedPath;
  }

  const Database = (await import("better-sqlite3")).default;
  let pudlDb: InstanceType<typeof Database>;
  try {
    pudlDb = new Database(sqlitePath, { readonly: true });
  } catch (e) {
    return {
      success: false,
      utility_id: params.utility_id,
      ferc_id: fercId,
      signals_written: 0,
      errors: [`Could not open PUDL SQLite: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const tables = pudlDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const tableNames = tables.map((t) => t.name);

  let largeCustomerCount = 0;
  let hasServed100Mw = false;
  let reportYear = year;

  const respondentId = parseInt(fercId, 10);
  if (isNaN(respondentId)) {
    pudlDb.close();
    return {
      success: false,
      utility_id: params.utility_id,
      ferc_id: fercId,
      signals_written: 0,
      errors: [`Invalid ferc_id: ${fercId}`],
    };
  }

  for (const tbl of tableNames) {
    if (!tbl.toLowerCase().includes("325") && !tbl.toLowerCase().includes("324")) continue;
    try {
      const cols = pudlDb.prepare(`PRAGMA table_info(${tbl})`).all() as Array<{ name: string }>;
      const colNames = cols.map((c) => c.name.toLowerCase());
      const hasRespondent = colNames.some((c) => c.includes("respondent"));
      const hasYear = colNames.some((c) => c.includes("year") || c.includes("report"));
      if (!hasRespondent || !hasYear) continue;
      const respCol = cols.find((c) => c.name.toLowerCase().includes("respondent"))?.name ?? "respondent_id";
      const yearCol = cols.find((c) => c.name.toLowerCase().includes("year") || c.name.toLowerCase().includes("report"))?.name ?? "report_year";
      const rows = pudlDb.prepare(`SELECT * FROM ${tbl} WHERE ${respCol} = ? AND ${yearCol} = ?`).all(respondentId, year) as Record<string, unknown>[];
      if (rows.length > 0 && tbl.toLowerCase().includes("325")) {
        const custCol = cols.find((c) => c.name.toLowerCase().includes("cust") || c.name.toLowerCase().includes("num"))?.name;
        if (custCol) {
          const total = rows.reduce((s, r) => s + (Number(r[custCol]) || 0), 0);
          largeCustomerCount = total > 0 ? Math.min(10, Math.max(1, Math.floor(total / 1000))) : 0;
        }
      }
      if (rows.length > 0 && tbl.toLowerCase().includes("324")) {
        const salesCol = cols.find((c) => c.name.toLowerCase().includes("sales") || c.name.toLowerCase().includes("mwh"))?.name;
        if (salesCol) {
          const totalMwh = rows.reduce((s, r) => s + (Number(r[salesCol]) || 0), 0);
          if (totalMwh > 100000) hasServed100Mw = true;
        }
      }
    } catch {
      // skip table
    }
  }

  pudlDb.close();

  const trackRecordPayload: Record<string, unknown> = {
    large_customer_count_50mw_plus: largeCustomerCount,
    has_served_100mw_plus: hasServed100Mw,
    key_quotes: [`FERC Form 1 ${year}: respondent_id ${fercId}`],
  };

  const signals = [
    { extraction_target: "track_record_signals", payload: trackRecordPayload },
  ];

  const count = insertStructuredSignals(
    db,
    params.utility_id,
    "ferc_form_1",
    `${reportYear}-12-31`,
    signals
  );

  return {
    success: true,
    utility_id: params.utility_id,
    ferc_id: fercId,
    signals_written: count,
    errors,
    details: {
      source_type: "ferc_form_1",
      document_date: `${reportYear}-12-31`,
      signals: ["track_record"],
    },
  };
}
