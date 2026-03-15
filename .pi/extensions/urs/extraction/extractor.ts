/**
 * LLM structured extraction — spec section 4.1
 * Extracts signals from source documents via Claude API
 */

import Anthropic from "@anthropic-ai/sdk";
import { validateExtractionResult } from "./schemas";

const EXTRACTION_TARGETS = [
  "large_load_tariff",
  "interconnection_timeline",
  "irp_load_growth",
  "leadership_statements",
  "clean_energy_program",
  "regulatory_signals",
  "grid_capacity_signals",
  "track_record_signals",
] as const;

export type ExtractionTarget = (typeof EXTRACTION_TARGETS)[number];

export interface ExtractionResult {
  target: ExtractionTarget;
  payload: Record<string, unknown>;
  extraction_confidence?: number;
}

export interface ExtractionOutput {
  results: ExtractionResult[];
  validation_errors: Array<{ target: string; error: string; payload: unknown }>;
}

const EXTRACTION_PROMPT_TARGETS = `
1. large_load_tariff: { has_large_load_tariff: bool, tariff_name?: str, filing_date?: date, terms_summary?: str }
2. interconnection_timeline: { stated_timeline_months?: number, fast_track_available?: bool, conditions?: str }
3. irp_load_growth: { acknowledges_datacenter_growth?: bool, has_dedicated_scenario?: bool, tone?: "positive"|"neutral"|"cautious"|"negative", key_quotes?: str[] }
4. leadership_statements: { speaker?: str, date?: date, sentiment?: "positive"|"neutral"|"negative", quote?: str, context?: str }
5. clean_energy_program: { program_name?: str, type?: "green_tariff"|"ppa_enabled"|"btm_allowed", status?: "approved"|"proposed"|"rejected", restrictions?: str }
6. regulatory_signals: { datacenter_incentive_legislation?: bool, commission_approved_special_contracts?: bool, commission_rejected_or_conditioned?: bool, deregulated_retail_choice?: bool, key_quotes?: str[] }
7. grid_capacity_signals: { has_hosting_capacity_map?: bool, proposed_speculative_transmission?: bool, offers_phased_delivery?: bool, cites_capacity_constraints_decline?: bool, key_quotes?: str[] }
8. track_record_signals: { large_customer_count_50mw_plus?: number, has_served_100mw_plus?: bool, known_complaints_or_disputes?: bool, key_quotes?: str[] }
`;

export async function extractFromDocument(
  text: string,
  sourceType: string,
  utilityId: string,
  apiKey: string
): Promise<ExtractionOutput> {
  const client = new Anthropic({ apiKey });

  const prompt = `You are extracting structured data from a utility regulatory/planning document for the Utility Responsiveness Scoring system.

Utility ID: ${utilityId}
Source type: ${sourceType}

Extract any of the following that appear in the document. Return valid JSON only.

${EXTRACTION_PROMPT_TARGETS}

Document text (first 8000 chars):
---
${text.slice(0, 8000)}
---

Return a JSON array of objects. Each object must have "target" (one of the 8 names above) and "payload" (the extracted fields). Only include targets for which you found relevant content.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { results: [], validation_errors: [] };
  }

  let parsed: ExtractionResult[] = [];
  try {
    const raw = JSON.parse(textBlock.text);
    parsed = Array.isArray(raw) ? raw : [];
  } catch {
    return {
      results: [],
      validation_errors: [{ target: "parse", error: "Failed to parse JSON response", payload: textBlock.text.slice(0, 200) }],
    };
  }

  const results: ExtractionResult[] = [];
  const validation_errors: ExtractionOutput["validation_errors"] = [];

  for (const item of parsed) {
    if (!item || typeof item.target !== "string" || !item.payload) {
      validation_errors.push({ target: String(item?.target ?? "unknown"), error: "Missing target or payload", payload: item });
      continue;
    }

    const { valid, error } = validateExtractionResult(item.target, item.payload);
    if (!valid) {
      validation_errors.push({ target: item.target, error: error ?? "Validation failed", payload: item.payload });
      continue;
    }

    results.push({
      target: item.target as ExtractionTarget,
      payload: item.payload as Record<string, unknown>,
      extraction_confidence: typeof item.extraction_confidence === "number" ? item.extraction_confidence : undefined,
    });
  }

  return { results, validation_errors };
}
