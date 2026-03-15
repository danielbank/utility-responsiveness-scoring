/**
 * Shared utility for inserting structured signals into sources and signals tables.
 * Used by urs_fetch_eia and urs_fetch_pudl.
 */

import { randomUUID } from "node:crypto";
import { initDb } from "../data/db";

const MAX_AGE_DAYS = 365;

export interface SignalInput {
  extraction_target: string;
  dimension: string;
  payload: Record<string, unknown>;
}

export function insertStructuredSignals(
  db: ReturnType<typeof initDb>,
  utilityId: string,
  sourceType: string,
  documentDate: string,
  filePath: string,
  signals: SignalInput[],
  modelVersion: string
): number {
  const dimensionsAffected = [...new Set(signals.map((s) => s.dimension))];
  if (dimensionsAffected.length === 0) return 0;

  const sourceId = `src-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO sources (source_id, utility_id, source_type, document_date, file_path, dimensions_affected, max_age_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sourceId,
    utilityId,
    sourceType,
    documentDate,
    filePath,
    JSON.stringify(dimensionsAffected),
    MAX_AGE_DAYS
  );

  let count = 0;
  for (const s of signals) {
    const signalId = `sig-${randomUUID().slice(0, 8)}`;
    const payload = { dimension: s.dimension, ...s.payload };
    db.prepare(
      `INSERT INTO signals (signal_id, source_id, extraction_target, payload, model_version, extraction_confidence)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(signalId, sourceId, s.extraction_target, JSON.stringify(payload), modelVersion, 0.9);
    count++;
  }
  return count;
}
