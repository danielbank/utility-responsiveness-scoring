/**
 * LLM structured extraction — spec section 4.1
 * Extracts signals from source documents via Claude API
 */

import Anthropic from "@anthropic-ai/sdk";

const EXTRACTION_TARGETS = [
  "large_load_tariff",
  "interconnection_timeline",
  "irp_load_growth",
  "leadership_statements",
  "clean_energy_program",
] as const;

export type ExtractionTarget = (typeof EXTRACTION_TARGETS)[number];

export interface ExtractionResult {
  target: ExtractionTarget;
  payload: Record<string, unknown>;
  extraction_confidence?: number;
}

export async function extractFromDocument(
  text: string,
  sourceType: string,
  utilityId: string,
  apiKey: string
): Promise<ExtractionResult[]> {
  const client = new Anthropic({ apiKey });

  const prompt = `You are extracting structured data from a utility regulatory/planning document for the Utility Responsiveness Scoring system.

Utility ID: ${utilityId}
Source type: ${sourceType}

Extract any of the following that appear in the document. Return valid JSON only.

1. large_load_tariff: { has_large_load_tariff: bool, tariff_name?: str, filing_date?: date, terms_summary?: str }
2. interconnection_timeline: { stated_timeline_months?: number, fast_track_available?: bool, conditions?: str }
3. irp_load_growth: { acknowledges_datacenter_growth?: bool, has_dedicated_scenario?: bool, tone?: "positive"|"neutral"|"cautious"|"negative", key_quotes?: str[] }
4. leadership_statements: { speaker?: str, date?: date, sentiment?: "positive"|"neutral"|"negative", quote?: str, context?: str }
5. clean_energy_program: { program_name?: str, type?: "green_tariff"|"ppa_enabled"|"btm_allowed", status?: "approved"|"proposed"|"rejected", restrictions?: str }

Document text (first 8000 chars):
---
${text.slice(0, 8000)}
---

Return a JSON array of objects. Each object must have "target" (one of the 5 names above) and "payload" (the extracted fields). Only include targets for which you found relevant content.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return [];
  }

  try {
    const parsed = JSON.parse(textBlock.text) as ExtractionResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
