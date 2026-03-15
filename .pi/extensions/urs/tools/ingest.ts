/**
 * urs_ingest — Ingest source document and run LLM extraction
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { extractFromDocument } from "../extraction/extractor";

const EXTRACTION_TO_DIMENSION: Record<string, string> = {
  large_load_tariff: "large_load_tariff",
  interconnection_timeline: "interconnection_speed",
  irp_load_growth: "irp_alignment",
  leadership_statements: "leadership_posture",
  clean_energy_program: "clean_energy_posture",
  regulatory_signals: "regulatory_environment",
  grid_capacity_signals: "grid_headroom",
  track_record_signals: "track_record",
};

export interface IngestParams {
  file_path: string;
  source_type: string;
  utility_id: string;
  document_date?: string;
}

export async function runIngest(
  params: IngestParams,
  cwd: string,
  apiKey: string
): Promise<{ success: boolean; source_id?: string; signals_extracted?: number; validation_errors?: number; error?: string }> {
  const db = initDb(cwd);
  seedUtilities(db);

  const resolvedPath = params.file_path.startsWith("/") ? params.file_path : join(cwd, params.file_path);
  if (!existsSync(resolvedPath)) {
    return { success: false, error: `File not found: ${params.file_path}` };
  }

  let text: string;
  try {
    const buf = readFileSync(resolvedPath);
    text = buf.toString("utf-8");
  } catch (e) {
    return { success: false, error: `Could not read file: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (text.length < 50) {
    return { success: false, error: "Document too short for extraction" };
  }

  const utility = db.prepare("SELECT utility_id FROM utilities WHERE utility_id = ?").get(params.utility_id);
  if (!utility) {
    return { success: false, error: `Utility ${params.utility_id} not found` };
  }

  const sourceId = `src-${randomUUID().slice(0, 8)}`;
  const dimensionsAffected = Object.values(EXTRACTION_TO_DIMENSION);
  const docDate = params.document_date ?? new Date().toISOString().slice(0, 10);

  db.prepare(
    `INSERT INTO sources (source_id, utility_id, source_type, document_date, file_path, dimensions_affected, max_age_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceId, params.utility_id, params.source_type, docDate, params.file_path, JSON.stringify(dimensionsAffected), 365);

  const { results, validation_errors } = await extractFromDocument(text, params.source_type, params.utility_id, apiKey);
  let count = 0;

  for (const r of results) {
    const dim = EXTRACTION_TO_DIMENSION[r.target];
    if (!dim) continue;

    const signalId = `sig-${randomUUID().slice(0, 8)}`;
    const payload = { dimension: dim, ...r.payload };
    db.prepare(
      `INSERT INTO signals (signal_id, source_id, extraction_target, payload, model_version, extraction_confidence)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(signalId, sourceId, r.target, JSON.stringify(payload), "claude-sonnet-4-20250514", r.extraction_confidence ?? 0.8);
    count++;
  }

  return {
    success: true,
    source_id: sourceId,
    signals_extracted: count,
    validation_errors: validation_errors.length > 0 ? validation_errors.length : undefined,
  };
}
