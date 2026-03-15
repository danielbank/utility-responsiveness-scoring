/**
 * urs_lookup — Resolve utility identifier to metadata
 */

import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import type { UtilityMetadata } from "../scoring/types";

export interface LookupResult {
  resolved?: UtilityMetadata;
  candidates?: Array<UtilityMetadata & { confidence: number }>;
  error?: string;
}

export function runLookup(query: string, cwd: string): LookupResult {
  const db = initDb(cwd);
  seedUtilities(db);

  const trimmed = query.trim();

  // FERC:54 or HIFLD:14354
  if (trimmed.startsWith("FERC:")) {
    const fercId = trimmed.slice(5);
    const row = db.prepare("SELECT * FROM utilities WHERE ferc_id = ?").get(fercId) as UtilityMetadata | undefined;
    if (row) return { resolved: row };
    return { error: `No utility found with FERC ID ${fercId}` };
  }

  if (trimmed.startsWith("HIFLD:")) {
    const hifldId = trimmed.slice(6);
    const row = db.prepare("SELECT * FROM utilities WHERE hifld_id = ?").get(hifldId) as UtilityMetadata | undefined;
    if (row) return { resolved: row };
    return { error: `No utility found with HIFLD ID ${hifldId}` };
  }

  // EIA ID (numeric)
  if (/^\d+$/.test(trimmed)) {
    const row = db.prepare("SELECT * FROM utilities WHERE utility_id = ?").get(trimmed) as UtilityMetadata | undefined;
    if (row) return { resolved: row };
    return { error: `No utility found with EIA ID ${trimmed}` };
  }

  // Fuzzy name match
  const pattern = `%${trimmed}%`;
  const rows = db
    .prepare("SELECT * FROM utilities WHERE utility_name LIKE ? OR utility_name LIKE ? ORDER BY utility_name LIMIT 10")
    .all(pattern, `%${trimmed.split(" ")[0]}%`) as UtilityMetadata[];

  if (rows.length === 1) {
    return { resolved: rows[0] };
  }
  if (rows.length > 1) {
    return {
      candidates: rows.map((r) => ({ ...r, confidence: r.utility_name.toLowerCase().includes(trimmed.toLowerCase()) ? 0.9 : 0.6 })),
    };
  }

  return { error: `No utility found matching "${query}"` };
}
