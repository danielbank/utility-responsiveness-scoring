/**
 * 8 dimension scorers — deterministic heuristics from spec section 2
 * Each dimension scores 0–100 with confidence 0–1
 */

import type {
  DimensionId,
  TariffSignal,
  InterconnectionSignal,
  IRPSignal,
  LeadershipSignal,
  CleanEnergySignal,
  RegulatorySignal,
  GridCapacitySignal,
  TrackRecordSignal,
} from "./types";
import { DIMENSION_IDS } from "./types";
import type { DimensionResult } from "./aggregation";

export interface SignalData {
  dimension: DimensionId;
  [key: string]: unknown;
}

export interface ScoringInput {
  utility_id: string;
  signals: SignalData[];
  context?: {
    mw_requirement?: number;
    target_isd?: string;
    use_case?: string;
  };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function clampConfidence(c: number): number {
  return Math.max(0.1, Math.min(1, c));
}

/** large_load_tariff — spec §2.1: tariff flexibility, economic development riders */
function scoreLargeLoadTariff(signals: SignalData[]): DimensionResult {
  const dimSignals = signals.filter((s) => s.dimension === "large_load_tariff");
  if (dimSignals.length === 0) {
    return { id: "large_load_tariff", score: 50, confidence: 0.1 };
  }

  const tariffSignals = dimSignals as (SignalData & TariffSignal)[];
  const hasTariff = tariffSignals.some((s) => s.has_large_load_tariff === true);
  const hasNegotiated = tariffSignals.some((s) => s.terms_summary && String(s.terms_summary).length > 20);

  let score = 50;
  let confidence = 0.3;
  const parts: string[] = [];

  if (hasTariff) {
    score += 35;
    confidence += 0.4;
    const names = tariffSignals.filter((s) => s.tariff_name).map((s) => s.tariff_name);
    if (names.length) parts.push(`Approved tariff(s): ${[...new Set(names)].join(", ")}`);
  }
  if (hasNegotiated) {
    score = Math.min(100, score + 15);
    confidence = Math.min(0.95, confidence + 0.2);
    parts.push("Evidence of negotiated special contracts in rate case filings.");
  }
  if (!hasTariff && !hasNegotiated) {
    parts.push("Only standard C&I rate classes; no evidence of large-load flexibility.");
    score = 25;
  }

  return {
    id: "large_load_tariff",
    score: clampScore(score),
    confidence: clampConfidence(confidence),
    evidence_summary: parts.length ? parts.join(" ") : "Limited data.",
  };
}

/** interconnection_speed — spec §2.2: study completion timelines */
function scoreInterconnectionSpeed(signals: SignalData[]): DimensionResult {
  const dimSignals = signals.filter((s) => s.dimension === "interconnection_speed");
  if (dimSignals.length === 0) {
    return { id: "interconnection_speed", score: 50, confidence: 0.1 };
  }

  const interSignals = dimSignals as (SignalData & InterconnectionSignal)[];
  const withTimeline = interSignals.find((s) => s.stated_timeline_months != null);
  const timeline = withTimeline?.stated_timeline_months ?? 18;
  const fastTrack = interSignals.some((s) => s.fast_track_available === true);

  let score: number;
  if (timeline < 6) score = 85;
  else if (timeline < 18) score = 65;
  else score = 35;

  if (fastTrack) score = Math.min(100, score + 10);

  const parts: string[] = [];
  parts.push(`Median study completion: ~${timeline} months.`);
  if (fastTrack) parts.push("Fast-track or parallel study process available for qualified loads.");

  return {
    id: "interconnection_speed",
    score: clampScore(score),
    confidence: clampConfidence(0.7),
    evidence_summary: parts.join(" "),
  };
}

/** irp_alignment — spec §2.3: IRP acknowledgment of large-load growth */
function scoreIRPAlignment(signals: SignalData[]): DimensionResult {
  const dimSignals = signals.filter((s) => s.dimension === "irp_alignment");
  if (dimSignals.length === 0) {
    return { id: "irp_alignment", score: 50, confidence: 0.1 };
  }

  const irpSignals = dimSignals as (SignalData & IRPSignal)[];
  const hasDedicated = irpSignals.some((s) => s.has_dedicated_scenario === true);
  const acknowledges = irpSignals.some((s) => s.acknowledges_datacenter_growth === true);
  const tone = irpSignals.map((s) => s.tone).filter(Boolean).pop() ?? "neutral";

  let score = 50;
  if (hasDedicated) score = 85;
  else if (acknowledges) score = 65;
  else score = 45;

  if (tone === "positive") score = Math.min(100, score + 10);
  if (tone === "negative" || tone === "cautious") score = Math.max(0, score - 15);

  const parts: string[] = [];
  if (hasDedicated) parts.push("IRP contains explicit load growth scenarios for datacenter/industrial loads.");
  else if (acknowledges) parts.push("IRP mentions large load as a planning variable.");
  else parts.push("IRP silent or frames large load primarily as reliability risk.");
  if (tone) parts.push(`Tone: ${tone}.`);

  return {
    id: "irp_alignment",
    score: clampScore(score),
    confidence: clampConfidence(0.65),
    evidence_summary: parts.join(" "),
  };
}

/** regulatory_environment — spec §2.4: state-level regulatory structure */
function scoreRegulatoryEnvironment(signals: SignalData[]): DimensionResult {
  const dimSignals = signals.filter((s) => s.dimension === "regulatory_environment");
  if (dimSignals.length === 0) {
    return { id: "regulatory_environment", score: 50, confidence: 0.1 };
  }

  const regSignals = dimSignals as (SignalData & RegulatorySignal)[];
  const hasIncentive = regSignals.some((s) => s.datacenter_incentive_legislation === true);
  const approved = regSignals.some((s) => s.commission_approved_special_contracts === true);
  const rejected = regSignals.some((s) => s.commission_rejected_or_conditioned === true);
  const deregulated = regSignals.some((s) => s.deregulated_retail_choice === true);

  let score = deregulated ? 55 : 50; // deregulated base per spec
  if (hasIncentive) score += 25;
  if (approved) score += 15;
  if (rejected) score -= 25;

  const parts: string[] = [];
  if (hasIncentive) parts.push("State has explicit datacenter incentive legislation.");
  if (approved) parts.push("Commission has approved special large-load contracts.");
  if (rejected) parts.push("Commission has rejected or heavily conditioned large-load proposals.");
  if (deregulated) parts.push("Deregulated market with competitive retail choice.");

  return {
    id: "regulatory_environment",
    score: clampScore(score),
    confidence: clampConfidence(0.6),
    evidence_summary: parts.length ? parts.join(" ") : "Limited regulatory data.",
  };
}

/** leadership_posture — spec §2.5: C-suite signals on large-load appetite */
function scoreLeadershipPosture(signals: SignalData[]): DimensionResult {
  const dimSignals = signals.filter((s) => s.dimension === "leadership_posture");
  if (dimSignals.length === 0) {
    return { id: "leadership_posture", score: 50, confidence: 0.1 };
  }

  const leadSignals = dimSignals as (SignalData & LeadershipSignal)[];
  const sentiments = leadSignals.map((s) => s.sentiment).filter((s): s is string => !!s);
  const positive = sentiments.filter((s) => s === "positive").length;
  const negative = sentiments.filter((s) => s === "negative").length;

  let score = 50;
  if (positive > negative) score = 75;
  else if (negative > positive) score = 25;
  else score = 50;

  const parts: string[] = [];
  if (positive) parts.push("CEO/leadership public statements welcoming datacenter development.");
  if (negative) parts.push("Leadership expressed concern about large-load impact on rates.");
  if (!positive && !negative) parts.push("No visible leadership engagement on large-load topic.");

  return {
    id: "leadership_posture",
    score: clampScore(score),
    confidence: clampConfidence(0.5 + Math.min(0.3, leadSignals.length * 0.05)),
    evidence_summary: parts.length ? parts.join(" ") : "Limited leadership signal data.",
  };
}

/** grid_headroom — spec §2.6: posture toward capacity constraints */
function scoreGridHeadroom(signals: SignalData[]): DimensionResult {
  const dimSignals = signals.filter((s) => s.dimension === "grid_headroom");
  if (dimSignals.length === 0) {
    return { id: "grid_headroom", score: 50, confidence: 0.1 };
  }

  const gridSignals = dimSignals as (SignalData & GridCapacitySignal)[];
  const hasHostingMap = gridSignals.some((s) => s.has_hosting_capacity_map === true);
  const proposedTransmission = gridSignals.some((s) => s.proposed_speculative_transmission === true);
  const phasedDelivery = gridSignals.some((s) => s.offers_phased_delivery === true);
  const citesDecline = gridSignals.some((s) => s.cites_capacity_constraints_decline === true);

  let score = 50;
  if (proposedTransmission) score = 85;
  else if (phasedDelivery) score = 80;
  else if (hasHostingMap) score = 65;
  if (citesDecline) score = Math.max(0, score - 30);

  const parts: string[] = [];
  if (proposedTransmission) parts.push("Utility has proposed or built speculative transmission to attract load.");
  if (phasedDelivery) parts.push("Offers phased delivery or interim solutions while upgrades are built.");
  if (hasHostingMap) parts.push("Published hosting capacity maps or large-load availability tools.");
  if (citesDecline) parts.push("Cites capacity constraints and declines to engage.");

  return {
    id: "grid_headroom",
    score: clampScore(score),
    confidence: clampConfidence(0.55),
    evidence_summary: parts.length ? parts.join(" ") : "Limited grid posture data.",
  };
}

/** track_record — spec §2.7: history serving large-load customers */
function scoreTrackRecord(signals: SignalData[]): DimensionResult {
  const dimSignals = signals.filter((s) => s.dimension === "track_record");
  if (dimSignals.length === 0) {
    return { id: "track_record", score: 50, confidence: 0.1 };
  }

  const trackSignals = dimSignals as (SignalData & TrackRecordSignal)[];
  const count50 = Math.max(0, ...trackSignals.map((s) => s.large_customer_count_50mw_plus ?? 0));
  const has100 = trackSignals.some((s) => s.has_served_100mw_plus === true);
  const complaints = trackSignals.some((s) => s.known_complaints_or_disputes === true);

  let score = 50;
  if (has100 || count50 >= 3) score = 85;
  else if (count50 >= 1) score = 65;
  else score = 35;
  if (complaints) score = Math.max(0, score - 20);

  const parts: string[] = [];
  if (count50 > 0) parts.push(`Has served ${count50}+ customers in 50+ MW range.`);
  if (has100) parts.push("Has served at least one 100+ MW customer.");
  if (complaints) parts.push("Known customer complaints or public disputes about large-load service.");
  if (!count50 && !has100) parts.push("No known large-load customers in territory.");

  return {
    id: "track_record",
    score: clampScore(score),
    confidence: clampConfidence(0.6),
    evidence_summary: parts.length ? parts.join(" ") : "Limited track record data.",
  };
}

/** clean_energy_posture — spec §2.8: green tariff, PPA accommodation */
function scoreCleanEnergyPosture(signals: SignalData[]): DimensionResult {
  const dimSignals = signals.filter((s) => s.dimension === "clean_energy_posture");
  if (dimSignals.length === 0) {
    return { id: "clean_energy_posture", score: 50, confidence: 0.1 };
  }

  const cleanSignals = dimSignals as (SignalData & CleanEnergySignal)[];
  const hasGreenTariff = cleanSignals.some((s) => s.type === "green_tariff" && s.status === "approved");
  const ppaEnabled = cleanSignals.some((s) => (s.type === "ppa_enabled" || s.type === "btm_allowed") && s.status === "approved");
  const blocks = cleanSignals.some((s) => s.status === "rejected" || (s.restrictions && String(s.restrictions).toLowerCase().includes("block")));
  const proposed = cleanSignals.some((s) => s.status === "proposed");

  let score = 50;
  if (hasGreenTariff || ppaEnabled) score = 85;
  else if (proposed) score = 55;
  if (blocks && !hasGreenTariff && !ppaEnabled) score = 25;

  const parts: string[] = [];
  if (hasGreenTariff) parts.push("Approved green tariff or renewable direct-access program.");
  if (ppaEnabled) parts.push("Allows sleeved PPAs or behind-the-meter generation.");
  if (blocks && !hasGreenTariff && !ppaEnabled) parts.push("Blocks third-party PPAs with no green tariff alternative.");
  if (proposed && !hasGreenTariff && !ppaEnabled) parts.push("Has announced but not yet implemented clean energy programs.");

  return {
    id: "clean_energy_posture",
    score: clampScore(score),
    confidence: clampConfidence(0.65),
    evidence_summary: parts.length ? parts.join(" ") : "Limited clean energy program data.",
  };
}

const SCORERS: Record<DimensionId, (signals: SignalData[]) => DimensionResult> = {
  large_load_tariff: scoreLargeLoadTariff,
  interconnection_speed: scoreInterconnectionSpeed,
  irp_alignment: scoreIRPAlignment,
  regulatory_environment: scoreRegulatoryEnvironment,
  leadership_posture: scoreLeadershipPosture,
  grid_headroom: scoreGridHeadroom,
  track_record: scoreTrackRecord,
  clean_energy_posture: scoreCleanEnergyPosture,
};

export function scoreAllDimensions(input: ScoringInput): DimensionResult[] {
  return DIMENSION_IDS.map((id) => SCORERS[id](input.signals));
}
