/**
 * URS Extension — Utility Responsiveness Scoring for pi agent
 * Registers 6 tools: urs_score, urs_lookup, urs_ingest, urs_history, urs_sources, urs_arcgis_sync
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runLookup } from "./tools/lookup";
import { runScore } from "./tools/score";
import { runIngest } from "./tools/ingest";
import { runHistory } from "./tools/history";
import { runSources } from "./tools/sources";
import { runArcGISSync } from "./tools/arcgis-sync";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "urs_score",
    label: "Score Utility",
    description: "Score a utility's responsiveness for datacenter siting. Returns composite score (0-100), tier, dimension breakdown, and rationale.",
    parameters: Type.Object({
      utility_id: Type.String({ description: "EIA Utility ID (5-digit numeric)" }),
      mw_requirement: Type.Optional(Type.Number({ description: "Requested load in MW" })),
      target_isd: Type.Optional(Type.String({ description: "Target in-service date, ISO 8601" })),
      use_case: Type.Optional(
        Type.String({
          description: "hyperscale_campus | colocation | edge | enterprise",
        })
      ),
      weight_overrides: Type.Optional(
        Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 2 }), {
          description: "Per-dimension weight overrides (0-2). Keys: dimension IDs.",
        })
      ),
      force_refresh: Type.Optional(Type.Boolean({ description: "Bypass cache, re-run full pipeline" })),
      staleness_threshold_days: Type.Optional(Type.Number({ description: "Flag scores older than this (default 180)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
      if (!apiKey) {
        return { content: [{ type: "text", text: "ANTHROPIC_API_KEY not set. Cannot generate rationale." }], details: {} };
      }
      const result = await runScore(params as Parameters<typeof runScore>[0], ctx.cwd, apiKey);
      if ("error" in result) {
        return { content: [{ type: "text", text: result.error }], details: {} };
      }
      const summary = `${result.utility_name} (${result.state}): ${result.composite_score}/100 — ${result.tier_label}\n\n${result.rationale}`;
      return {
        content: [{ type: "text", text: summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "urs_lookup",
    label: "Lookup Utility",
    description: "Resolve a utility identifier (EIA ID, name, FERC:ID, HIFLD:ID) to metadata. Returns resolved utility or candidates if ambiguous.",
    parameters: Type.Object({
      query: Type.String({ description: "EIA ID, utility name, or prefixed ID (FERC:54, HIFLD:14354)" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = runLookup(params.query, ctx.cwd);
      if (result.error) {
        return { content: [{ type: "text", text: result.error }], details: {} };
      }
      if (result.resolved) {
        const text = `${result.resolved.utility_name} (${result.resolved.state}) — EIA ID: ${result.resolved.utility_id}`;
        return { content: [{ type: "text", text }], details: result.resolved };
      }
      if (result.candidates) {
        const text = `Multiple matches:\n${result.candidates.map((c) => `- ${c.utility_name} (${c.state}) — ${c.utility_id}`).join("\n")}`;
        return { content: [{ type: "text", text }], details: { candidates: result.candidates } };
      }
      return { content: [{ type: "text", text: "No results" }], details: {} };
    },
  });

  pi.registerTool({
    name: "urs_ingest",
    label: "Ingest Source Document",
    description: "Ingest a source document, run LLM extraction, store structured signals for scoring.",
    parameters: Type.Object({
      file_path: Type.String({ description: "Path to document (relative to cwd or absolute)" }),
      source_type: Type.String({
        description: "tariff_filing | irp | rate_case | earnings_call | news | ferc_form | eia_data",
      }),
      utility_id: Type.String({ description: "EIA Utility ID" }),
      document_date: Type.Optional(Type.String({ description: "Document date, ISO 8601" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
      if (!apiKey) {
        return { content: [{ type: "text", text: "ANTHROPIC_API_KEY not set. Cannot run extraction." }], details: {} };
      }
      const result = await runIngest(params as Parameters<typeof runIngest>[0], ctx.cwd, apiKey);
      if (!result.success) {
        return { content: [{ type: "text", text: result.error ?? "Ingest failed" }], details: {} };
      }
      const text = `Ingested ${params.file_path}. Extracted ${result.signals_extracted ?? 0} signals. Source ID: ${result.source_id}`;
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "urs_history",
    label: "Score History",
    description: "Get historical scores for a utility.",
    parameters: Type.Object({
      utility_id: Type.String({ description: "EIA Utility ID" }),
      since: Type.Optional(Type.String({ description: "ISO 8601 date filter" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = runHistory(params as Parameters<typeof runHistory>[0], ctx.cwd);
      if (result.error) {
        return { content: [{ type: "text", text: result.error }], details: {} };
      }
      if (result.entries.length === 0) {
        return { content: [{ type: "text", text: "No score history found." }], details: {} };
      }
      const text = result.entries
        .map((e) => `${e.scored_at.slice(0, 10)}: ${e.composite_score}/100 (${e.tier_label})`)
        .join("\n");
      return { content: [{ type: "text", text }], details: { entries: result.entries } };
    },
  });

  pi.registerTool({
    name: "urs_sources",
    label: "List Data Sources",
    description: "List data sources used in scoring. Filter by utility, dimension, or stale only.",
    parameters: Type.Object({
      utility_id: Type.Optional(Type.String()),
      dimension: Type.Optional(Type.String()),
      stale_only: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = runSources(params as Parameters<typeof runSources>[0], ctx.cwd);
      if (result.error) {
        return { content: [{ type: "text", text: result.error }], details: {} };
      }
      if (result.sources.length === 0) {
        return { content: [{ type: "text", text: "No sources found." }], details: {} };
      }
      const text = result.sources
        .map((s) => `${s.source_id}: ${s.source_type} (${s.utility_id}) ${s.document_date ?? "n/a"} ${s.stale ? "[STALE]" : ""}`)
        .join("\n");
      return { content: [{ type: "text", text }], details: { sources: result.sources } };
    },
  });

  pi.registerTool({
    name: "urs_arcgis_sync",
    label: "Sync to ArcGIS",
    description: "Push current scores to ArcGIS feature layer for map visualization.",
    parameters: Type.Object({
      utility_ids: Type.Optional(Type.Array(Type.String(), { description: "Specific utilities; omit to sync all" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const arcgisUrl = process.env.ARCGIS_FEATURE_SERVICE_URL ?? "";
      const arcgisKey = process.env.ARCGIS_API_KEY ?? "";
      if (!arcgisUrl || !arcgisKey) {
        return {
          content: [{ type: "text", text: "ARCGIS_FEATURE_SERVICE_URL and ARCGIS_API_KEY required." }],
          details: {},
        };
      }
      const result = await runArcGISSync(
        params as Parameters<typeof runArcGISSync>[0],
        ctx.cwd,
        arcgisUrl,
        arcgisKey
      );
      if (!result.success) {
        return { content: [{ type: "text", text: result.error ?? "Sync failed" }], details: {} };
      }
      return {
        content: [{ type: "text", text: `Synced ${result.synced ?? 0} utilities to ArcGIS.` }],
        details: result,
      };
    },
  });

  pi.registerCommand("urs", {
    description: "Utility Responsiveness Scoring — ask to score, compare, or look up utilities",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "URS: Score utilities with 'Score Duke Energy Carolinas' or 'Compare utilities in Virginia'. Use urs_lookup for lookups.",
        "info"
      );
    },
  });
}
