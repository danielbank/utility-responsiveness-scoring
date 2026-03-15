/**
 * EIA-861 import — populates utilities table from EIA annual data
 * Supports CSV and Excel (.xlsx). EIA-861: eia.gov/electricity/data/eia861
 * Covers ~3,300 US utilities. Target ~200 IOUs for datacenter siting.
 */

import type Database from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

export interface EIA861Row {
  utility_id: string;
  utility_name: string;
  state: string;
  entity_type?: string;
  ferc_id?: string;
  hifld_id?: string;
}

/** Common EIA-861 column name variations */
const COLUMN_ALIASES: Record<string, string[]> = {
  utility_id: ["Utility_Number", "Utility Number", "utility_id", "UtilityId"],
  utility_name: ["Utility_Name", "Utility Name", "utility_name", "UtilityName"],
  state: ["State", "state", "STATE"],
  entity_type: ["Entity_Type", "Entity Type", "entity_type"],
  ferc_id: ["FERC_ID", "FERC Id", "ferc_id"],
  hifld_id: ["HIFLD_ID", "HIFLD Id", "hifld_id"],
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (current) result.push(current.trim());
  return result;
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const i = headers.findIndex((h) => h.trim().toLowerCase() === alias.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function buildColumnMap(headers: string[]): Record<keyof EIA861Row, number> {
  const map: Partial<Record<keyof EIA861Row, number>> = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const i = findColumnIndex(headers, aliases);
    if (i >= 0) map[key as keyof EIA861Row] = i;
  }
  return map as Record<keyof EIA861Row, number>;
}

export function parseEIA861CSV(content: string): EIA861Row[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const colMap = buildColumnMap(headers);

  if (colMap.utility_id === undefined || colMap.utility_name === undefined || colMap.state === undefined) {
    throw new Error("CSV must have utility_id, utility_name, and state columns (or aliases)");
  }

  const rows: EIA861Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < Math.max(colMap.utility_id, colMap.utility_name, colMap.state) + 1) continue;

    const utility_id = String(values[colMap.utility_id] ?? "").trim();
    const utility_name = String(values[colMap.utility_name] ?? "").trim();
    const state = String(values[colMap.state] ?? "").trim();

    if (!utility_id || !utility_name || !state) continue;

    const row: EIA861Row = { utility_id, utility_name, state };
    if (colMap.entity_type !== undefined && values[colMap.entity_type]) {
      row.entity_type = String(values[colMap.entity_type]).trim();
    }
    if (colMap.ferc_id !== undefined && values[colMap.ferc_id]) {
      row.ferc_id = String(values[colMap.ferc_id]).trim();
    }
    if (colMap.hifld_id !== undefined && values[colMap.hifld_id]) {
      row.hifld_id = String(values[colMap.hifld_id]).trim();
    }
    rows.push(row);
  }
  return rows;
}

/** Parse EIA-861 from Excel sheet rows (array of arrays). Finds header row (EIA files may have a title row first). */
function parseEIA861FromRows(rows: unknown[][]): EIA861Row[] {
  if (rows.length < 2) return [];

  const toString = (v: unknown): string => (v == null ? "" : String(v).trim());

  // Find header row (EIA-861 Excel often has "Utility Characteristics" title on row 0, headers on row 1)
  let headerRowIndex = -1;
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const headers = rows[r].map(toString);
    const colMap = buildColumnMap(headers);
    if (colMap.utility_id !== undefined && colMap.utility_name !== undefined && colMap.state !== undefined) {
      headerRowIndex = r;
      break;
    }
  }
  if (headerRowIndex < 0) {
    throw new Error("Excel must have utility_id, utility_name, and state columns (or aliases like Utility_Number, Utility_Name, State)");
  }

  const headers = rows[headerRowIndex].map(toString);
  const colMap = buildColumnMap(headers);
  const result: EIA861Row[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const raw = rows[i];
    const values = raw.map(toString);

    if (values.length < Math.max(colMap.utility_id, colMap.utility_name, colMap.state) + 1) continue;

    const utility_id = values[colMap.utility_id] ?? "";
    const utility_name = values[colMap.utility_name] ?? "";
    const state = values[colMap.state] ?? "";

    if (!utility_id || !utility_name || !state) continue;

    const row: EIA861Row = { utility_id, utility_name, state };
    if (colMap.entity_type !== undefined && values[colMap.entity_type]) {
      row.entity_type = values[colMap.entity_type];
    }
    if (colMap.ferc_id !== undefined && values[colMap.ferc_id]) {
      row.ferc_id = values[colMap.ferc_id];
    }
    if (colMap.hifld_id !== undefined && values[colMap.hifld_id]) {
      row.hifld_id = values[colMap.hifld_id];
    }
    result.push(row);
  }
  return result;
}

function insertEIA861Rows(
  db: Database.Database,
  rows: EIA861Row[]
): { imported: number; skipped: number; errors: string[] } {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO utilities (utility_id, utility_name, state, ferc_id, hifld_id, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.utility_id)) {
      skipped++;
      continue;
    }
    seen.add(row.utility_id);
    try {
      insert.run(row.utility_id, row.utility_name, row.state, row.ferc_id ?? null, row.hifld_id ?? null);
      imported++;
    } catch (e) {
      errors.push(`Row ${row.utility_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { imported, skipped, errors };
}

export function importEIA861FromContent(
  db: Database.Database,
  content: string
): { imported: number; skipped: number; errors: string[] } {
  let rows: EIA861Row[];
  try {
    rows = parseEIA861CSV(content);
  } catch (e) {
    return { imported: 0, skipped: 0, errors: [e instanceof Error ? e.message : String(e)] };
  }
  return insertEIA861Rows(db, rows);
}

export function importEIA861FromFile(
  db: Database.Database,
  filePath: string
): { imported: number; skipped: number; errors: string[] } {
  const resolved = filePath.startsWith("/") ? filePath : join(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    return { imported: 0, skipped: 0, errors: [`File not found: ${filePath}`] };
  }

  const isXlsx = /\.xlsx$/i.test(filePath);

  if (isXlsx) {
    try {
      const workbook = XLSX.readFile(resolved);
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return { imported: 0, skipped: 0, errors: ["Excel file has no sheets"] };
      }
      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const parsed = parseEIA861FromRows(rows);
      return insertEIA861Rows(db, parsed);
    } catch (e) {
      return { imported: 0, skipped: 0, errors: [`Could not parse Excel: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  try {
    const content = readFileSync(resolved, "utf-8");
    return importEIA861FromContent(db, content);
  } catch (e) {
    return { imported: 0, skipped: 0, errors: [`Could not read file: ${e instanceof Error ? e.message : String(e)}`] };
  }
}
