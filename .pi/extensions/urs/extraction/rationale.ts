/**
 * LLM rationale generation — spec section 4.2
 * Generates human-readable narrative from scorecard
 */

import Anthropic from "@anthropic-ai/sdk";

export interface RationaleInput {
  utility_name: string;
  composite_score: number;
  tier_label: string;
  dimensions: Array<{
    id: string;
    label: string;
    score: number;
    confidence: number;
    evidence_summary?: string;
  }>;
  context?: {
    mw_requirement?: number;
    target_isd?: string;
    use_case?: string;
  };
  data_vintage?: {
    oldest_source: string;
    newest_source: string;
    staleness_flags: string[];
  };
}

export async function generateRationale(
  input: RationaleInput,
  apiKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const dimensionsText = input.dimensions
    .map(
      (d) =>
        `- ${d.label}: ${d.score}/100 (confidence ${d.confidence})${d.evidence_summary ? ` — ${d.evidence_summary}` : ""}`
    )
    .join("\n");

  const prompt = `Generate a 2–4 paragraph narrative explaining why ${input.utility_name} received a score of ${input.composite_score}/100 (${input.tier_label}).

Dimension scores:
${dimensionsText}
${input.context?.mw_requirement ? `\nContext: ${input.context.mw_requirement} MW requested` : ""}
${input.context?.target_isd ? `, target in-service ${input.context.target_isd}` : ""}
${input.data_vintage?.staleness_flags?.length ? `\nStale dimensions: ${input.data_vintage.staleness_flags.join(", ")}` : ""}

Requirements:
1. Reference specific evidence (tariff names, IRP sections, leadership quotes)
2. Call out the dimensions that most influenced the composite
3. Note any dimensions with low confidence and explain why
4. If context (MW, timeline) affected interpretation, explain how
5. Do not state anything not directly supported by the scored evidence. If evidence is thin, say so.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}
