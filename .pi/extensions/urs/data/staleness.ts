/**
 * Staleness model — spec section 7
 * MAX_AGE_DAYS by source type
 */

export const MAX_AGE_DAYS: Record<string, number> = {
  tariff_filing: 365,
  irp: 730,
  rate_case: 365,
  earnings_call: 180,
  news: 90,
  ferc_form: 365,
  eia_data: 365,
  dsire: 365,
};

export interface SourceRow {
  source_id: string;
  source_type: string;
  document_date: string | null;
  dimensions_affected: string;
  max_age_days: number | null;
}

/** Dimension IDs that a source affects (from dimensions_affected JSON) */
export function getDimensionsFromSource(row: SourceRow): string[] {
  try {
    const dims = JSON.parse(row.dimensions_affected);
    return Array.isArray(dims) ? dims : [];
  } catch {
    return [];
  }
}

/** Check if a source is stale based on document_date and max_age */
export function isSourceStale(row: SourceRow, now: Date = new Date()): boolean {
  const docDate = row.document_date ? new Date(row.document_date) : null;
  if (!docDate) return false;
  const maxAge = row.max_age_days ?? MAX_AGE_DAYS[row.source_type] ?? 365;
  const ageDays = (now.getTime() - docDate.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > maxAge;
}
