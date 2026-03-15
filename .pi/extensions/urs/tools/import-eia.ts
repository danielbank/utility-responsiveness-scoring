/**
 * urs_import_eia — Import utilities from EIA-861 into local DB
 * Supports CSV and Excel (.xlsx). EIA-861: https://www.eia.gov/electricity/data/eia861/
 * Covers ~3,300 US utilities. Use file_path for local file or url to fetch CSV.
 */

import { initDb } from "../data/db";
import { importEIA861FromFile, importEIA861FromContent } from "../data/eia-import";

export interface ImportEIAParams {
  file_path?: string;
  url?: string;
}

export interface ImportEIAResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function runImportEIA(params: ImportEIAParams, cwd: string): Promise<ImportEIAResult> {
  const db = initDb(cwd);

  if (params.url) {
    const res = await fetch(params.url);
    if (!res.ok) {
      return { imported: 0, skipped: 0, errors: [`Fetch failed: ${res.status} ${res.statusText}`] };
    }
    const content = await res.text();
    return importEIA861FromContent(db, content);
  }

  if (params.file_path) {
    return importEIA861FromFile(db, params.file_path);
  }

  return { imported: 0, skipped: 0, errors: ["Provide file_path or url"] };
}
