/**
 * URS scoring types — dimension IDs, tier mapping, score structures
 */

export const DIMENSION_IDS = [
  "large_load_tariff",
  "interconnection_speed",
  "irp_alignment",
  "regulatory_environment",
  "leadership_posture",
  "grid_headroom",
  "track_record",
  "clean_energy_posture",
] as const;

export type DimensionId = (typeof DIMENSION_IDS)[number];

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  large_load_tariff: "Large-Load Tariff Flexibility",
  interconnection_speed: "Interconnection Study Speed",
  irp_alignment: "IRP Alignment with Large Load Growth",
  regulatory_environment: "Regulatory and Political Environment",
  leadership_posture: "Utility Leadership Posture",
  grid_headroom: "Grid Capacity and Headroom Posture",
  track_record: "Track Record with Prior Large-Load Customers",
  clean_energy_posture: "Sustainability and Clean Energy Accommodation",
};

export const TIER_LABELS: Record<number, string> = {
  1: "Highly responsive",
  2: "Moderately responsive",
  3: "Mixed signals",
  4: "Likely slow",
  5: "Structurally unresponsive",
};

export function getTier(compositeScore: number): number {
  if (compositeScore >= 80) return 1;
  if (compositeScore >= 60) return 2;
  if (compositeScore >= 40) return 3;
  if (compositeScore >= 20) return 4;
  return 5;
}

export interface DimensionScore {
  id: DimensionId;
  label: string;
  score: number;
  confidence: number;
  weight_applied: number;
  evidence_summary?: string;
  sources?: SourceCitation[];
  data_freshness?: string;
  stale?: boolean;
}

export interface SourceCitation {
  type: string;
  title: string;
  date: string;
  url?: string;
}

export interface ScoreContext {
  mw_requirement?: number;
  target_isd?: string;
  interconnection_voltage_kv?: number;
  use_case?: string;
  phasing_willing?: boolean;
}

export interface DataVintage {
  oldest_source: string;
  newest_source: string;
  staleness_flags: string[];
}

export interface ScoreResponse {
  utility_id: string;
  utility_name: string;
  state: string;
  resolution: {
    method: string;
    confidence: number;
    alternatives: Array<{ utility_id: string; utility_name: string; state: string }>;
  };
  composite_score: number;
  composite_confidence: number;
  tier: number;
  tier_label: string;
  dimensions: DimensionScore[];
  rationale: string;
  context_applied?: ScoreContext & { notes?: string };
  scored_at: string;
  model_version: string;
  data_vintage: DataVintage;
  coverage_warning?: string;
  stale?: boolean;
}

export interface UtilityMetadata {
  utility_id: string;
  utility_name: string;
  state: string;
  ferc_id?: string;
  hifld_id?: string;
  holding_company?: string;
}
