/**
 * urs_sources — List data sources with freshness status
 */

import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";
import { getDimensionsFromSource, isSourceStale, type SourceRow } from "../data/staleness";

export interface SourcesParams {
  utility_id?: string;
  dimension?: string;
  stale_only?: boolean;
}

export interface SourceEntry {
  source_id: string;
  utility_id: string;
  source_type: string;
  document_date: string | null;
  retrieval_date: string | null;
  file_path: string | null;
  dimensions_affected: string[];
  stale: boolean;
}

export function runSources(params: SourcesParams, cwd: string): { sources: SourceEntry[]; error?: string } {
  const db = initDb(cwd);
  seedUtilities(db);

  let query = "SELECT * FROM sources WHERE 1=1";
  const args: (string | number)[] = [];

  if (params.utility_id) {
    query += " AND utility_id = ?";
    args.push(params.utility_id);
  }

  if (params.dimension) {
    query += " AND dimensions_affected LIKE ?";
    args.push(`%${params.dimension}%`);
  }

  query += " ORDER BY document_date DESC LIMIT 100";

  const rows = db.prepare(query).all(...args) as Array<{
    source_id: string;
    utility_id: string;
    source_type: string;
    document_date: string | null;
    retrieval_date: string | null;
    file_path: string | null;
    dimensions_affected: string;
    max_age_days: number | null;
  }>;

  const now = new Date();

  const sources: SourceEntry[] = rows
    .map((r) => {
      const dims = getDimensionsFromSource(r as SourceRow);
      const stale = isSourceStale(r as SourceRow, now);

      return {
        source_id: r.source_id,
        utility_id: r.utility_id,
        source_type: r.source_type,
        document_date: r.document_date,
        retrieval_date: r.retrieval_date,
        file_path: r.file_path,
        dimensions_affected: dims,
        stale,
      };
    })
    .filter((s) => !params.stale_only || s.stale);

  return { sources };
}
