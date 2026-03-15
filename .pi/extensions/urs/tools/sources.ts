/**
 * urs_sources — List data sources with freshness status
 */

import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";

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
  const MAX_AGE_DAYS: Record<string, number> = {
    tariff_filing: 365,
    irp: 730,
    rate_case: 365,
    earnings_call: 180,
    news: 90,
    ferc_form: 365,
    eia_data: 365,
  };

  const sources: SourceEntry[] = rows
    .map((r) => {
      let dims: string[] = [];
      try {
        dims = JSON.parse(r.dimensions_affected);
      } catch {
        dims = [];
      }
      const docDate = r.document_date ? new Date(r.document_date) : null;
      const maxAge = r.max_age_days ?? MAX_AGE_DAYS[r.source_type] ?? 365;
      const ageDays = docDate ? (now.getTime() - docDate.getTime()) / (1000 * 60 * 60 * 24) : 0;
      const stale = ageDays > maxAge;

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
