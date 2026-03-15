/**
 * Shared extraction-target-to-dimension mapping used by ingest and score tools.
 */

import type { DimensionId } from "../scoring/types";

export const EXTRACTION_TO_DIMENSION: Record<string, DimensionId> = {
  large_load_tariff: "large_load_tariff",
  interconnection_timeline: "interconnection_speed",
  irp_load_growth: "irp_alignment",
  leadership_statements: "leadership_posture",
  clean_energy_program: "clean_energy_posture",
  regulatory_signals: "regulatory_environment",
  grid_capacity_signals: "grid_headroom",
  track_record_signals: "track_record",
};
