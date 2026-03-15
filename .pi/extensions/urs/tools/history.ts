/**
 * urs_history — Score history for a utility
 */

import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";

export interface HistoryParams {
  utility_id: string;
  since?: string;
}

export interface HistoryEntry {
  scored_at: string;
  composite_score: number;
  composite_confidence: number;
  tier: number;
  tier_label: string;
  model_version: string;
}

export function runHistory(params: HistoryParams, cwd: string): { entries: HistoryEntry[]; error?: string } {
  const db = initDb(cwd);
  seedUtilities(db);

  const utility = db.prepare("SELECT * FROM utilities WHERE utility_id = ?").get(params.utility_id);
  if (!utility) {
    return { entries: [], error: `Utility ${params.utility_id} not found` };
  }

  const TIER_LABELS: Record<number, string> = {
    1: "Highly responsive",
    2: "Moderately responsive",
    3: "Mixed signals",
    4: "Likely slow",
    5: "Structurally unresponsive",
  };

  let query = "SELECT scored_at, composite_score, composite_confidence, tier, model_version FROM scores WHERE utility_id = ? ORDER BY scored_at DESC LIMIT 50";
  const args: (string | number)[] = [params.utility_id];

  if (params.since) {
    query = "SELECT scored_at, composite_score, composite_confidence, tier, model_version FROM scores WHERE utility_id = ? AND scored_at >= ? ORDER BY scored_at DESC LIMIT 50";
    args.push(params.since);
  }

  const rows = db.prepare(query).all(...args) as Array<{
    scored_at: string;
    composite_score: number;
    composite_confidence: number;
    tier: number;
    model_version: string;
  }>;

  const entries: HistoryEntry[] = rows.map((r) => ({
    scored_at: r.scored_at,
    composite_score: r.composite_score,
    composite_confidence: r.composite_confidence,
    tier: r.tier,
    tier_label: TIER_LABELS[r.tier] ?? "Unknown",
    model_version: r.model_version,
  }));

  return { entries };
}
