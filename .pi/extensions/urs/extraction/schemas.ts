/**
 * Schema validation for LLM extraction outputs — spec section 4.1 guardrails
 */

import type {
  TariffSignal,
  InterconnectionSignal,
  IRPSignal,
  LeadershipSignal,
  CleanEnergySignal,
  RegulatorySignal,
  GridCapacitySignal,
  TrackRecordSignal,
} from "../scoring/types";

const VALID_TONES = ["positive", "neutral", "cautious", "negative"] as const;
const VALID_SENTIMENTS = ["positive", "neutral", "negative"] as const;
const VALID_CLEAN_TYPES = ["green_tariff", "ppa_enabled", "btm_allowed"] as const;
const VALID_CLEAN_STATUS = ["approved", "proposed", "rejected"] as const;

function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

export function validateTariffSignal(payload: unknown): payload is TariffSignal {
  if (!isObject(payload)) return false;
  if (typeof payload.has_large_load_tariff !== "boolean") return false;
  if (payload.tariff_name != null && typeof payload.tariff_name !== "string") return false;
  if (payload.filing_date != null && typeof payload.filing_date !== "string") return false;
  if (payload.terms_summary != null && typeof payload.terms_summary !== "string") return false;
  return true;
}

export function validateInterconnectionSignal(payload: unknown): payload is InterconnectionSignal {
  if (!isObject(payload)) return false;
  if (payload.stated_timeline_months != null && typeof payload.stated_timeline_months !== "number") return false;
  if (payload.fast_track_available != null && typeof payload.fast_track_available !== "boolean") return false;
  if (payload.conditions != null && typeof payload.conditions !== "string") return false;
  return true;
}

export function validateIRPSignal(payload: unknown): payload is IRPSignal {
  if (!isObject(payload)) return false;
  if (payload.acknowledges_datacenter_growth != null && typeof payload.acknowledges_datacenter_growth !== "boolean") return false;
  if (payload.has_dedicated_scenario != null && typeof payload.has_dedicated_scenario !== "boolean") return false;
  if (payload.tone != null && !VALID_TONES.includes(payload.tone as (typeof VALID_TONES)[number])) return false;
  if (payload.key_quotes != null && !Array.isArray(payload.key_quotes)) return false;
  return true;
}

export function validateLeadershipSignal(payload: unknown): payload is LeadershipSignal {
  if (!isObject(payload)) return false;
  if (payload.speaker != null && typeof payload.speaker !== "string") return false;
  if (payload.date != null && typeof payload.date !== "string") return false;
  if (payload.sentiment != null && !VALID_SENTIMENTS.includes(payload.sentiment as (typeof VALID_SENTIMENTS)[number])) return false;
  if (payload.quote != null && typeof payload.quote !== "string") return false;
  if (payload.context != null && typeof payload.context !== "string") return false;
  return true;
}

export function validateCleanEnergySignal(payload: unknown): payload is CleanEnergySignal {
  if (!isObject(payload)) return false;
  if (payload.program_name != null && typeof payload.program_name !== "string") return false;
  if (payload.type != null && !VALID_CLEAN_TYPES.includes(payload.type as (typeof VALID_CLEAN_TYPES)[number])) return false;
  if (payload.status != null && !VALID_CLEAN_STATUS.includes(payload.status as (typeof VALID_CLEAN_STATUS)[number])) return false;
  if (payload.restrictions != null && typeof payload.restrictions !== "string") return false;
  return true;
}

export function validateRegulatorySignal(payload: unknown): payload is RegulatorySignal {
  if (!isObject(payload)) return false;
  if (payload.datacenter_incentive_legislation != null && typeof payload.datacenter_incentive_legislation !== "boolean") return false;
  if (payload.commission_approved_special_contracts != null && typeof payload.commission_approved_special_contracts !== "boolean") return false;
  if (payload.commission_rejected_or_conditioned != null && typeof payload.commission_rejected_or_conditioned !== "boolean") return false;
  if (payload.deregulated_retail_choice != null && typeof payload.deregulated_retail_choice !== "boolean") return false;
  if (payload.key_quotes != null && !Array.isArray(payload.key_quotes)) return false;
  return true;
}

export function validateGridCapacitySignal(payload: unknown): payload is GridCapacitySignal {
  if (!isObject(payload)) return false;
  if (payload.has_hosting_capacity_map != null && typeof payload.has_hosting_capacity_map !== "boolean") return false;
  if (payload.proposed_speculative_transmission != null && typeof payload.proposed_speculative_transmission !== "boolean") return false;
  if (payload.offers_phased_delivery != null && typeof payload.offers_phased_delivery !== "boolean") return false;
  if (payload.cites_capacity_constraints_decline != null && typeof payload.cites_capacity_constraints_decline !== "boolean") return false;
  if (payload.key_quotes != null && !Array.isArray(payload.key_quotes)) return false;
  return true;
}

export function validateTrackRecordSignal(payload: unknown): payload is TrackRecordSignal {
  if (!isObject(payload)) return false;
  if (payload.large_customer_count_50mw_plus != null && typeof payload.large_customer_count_50mw_plus !== "number") return false;
  if (payload.has_served_100mw_plus != null && typeof payload.has_served_100mw_plus !== "boolean") return false;
  if (payload.known_complaints_or_disputes != null && typeof payload.known_complaints_or_disputes !== "boolean") return false;
  if (payload.key_quotes != null && !Array.isArray(payload.key_quotes)) return false;
  return true;
}

const VALIDATORS: Record<string, (p: unknown) => boolean> = {
  large_load_tariff: validateTariffSignal,
  interconnection_timeline: validateInterconnectionSignal,
  irp_load_growth: validateIRPSignal,
  leadership_statements: validateLeadershipSignal,
  clean_energy_program: validateCleanEnergySignal,
  regulatory_signals: validateRegulatorySignal,
  grid_capacity_signals: validateGridCapacitySignal,
  track_record_signals: validateTrackRecordSignal,
};

export function validateExtractionResult(target: string, payload: unknown): { valid: boolean; error?: string } {
  const validator = VALIDATORS[target];
  if (!validator) {
    return { valid: false, error: `Unknown extraction target: ${target}` };
  }
  if (!validator(payload)) {
    return { valid: false, error: `Schema validation failed for ${target}` };
  }
  return { valid: true };
}
