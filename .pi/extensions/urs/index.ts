/**
 * URS Extension — Utility Responsiveness Scoring for pi agent
 * Registers 12 tools: urs_score, urs_lookup, urs_ingest, urs_history, urs_sources,
 * urs_fetch_edgar, urs_fetch_pudl, urs_fetch_eia, urs_fetch_legiscan, urs_fetch_hifld,
 * urs_fetch_puc_dockets, urs_import_eia, urs_arcgis_sync, urs_arcgis_pull
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runLookup } from "./tools/lookup";
import { runScore } from "./tools/score";
import { runIngest } from "./tools/ingest";
import { runHistory } from "./tools/history";
import { runSources } from "./tools/sources";
import { runFetchEdgar } from "./tools/fetch-edgar";
import { runFetchPudl } from "./tools/fetch-pudl";
import { runFetchEia } from "./tools/fetch-eia-api";
import { runFetchLegiScan } from "./tools/fetch-legiscan";
import { runFetchHifld } from "./tools/fetch-hifld";
import { runFetchPUCDockets } from "./tools/fetch-puc-dockets";
import { runArcGISSync } from "./tools/arcgis-sync";
import { runArcGISPull } from "./tools/arcgis-pull";
import { runImportEIA } from "./tools/import-eia";

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
    description: "Resolve a utility identifier (EIA ID, name, FERC:ID, HIFLD:ID) to metadata. Uses local DB first; falls back to ArcGIS when configured and local has no match.",
    parameters: Type.Object({
      query: Type.String({ description: "EIA ID, utility name, or prefixed ID (FERC:54, HIFLD:14354)" }),
      use_arcgis: Type.Optional(Type.Boolean({ description: "If true, try ArcGIS when local lookup fails (default: true when ArcGIS configured)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let result = runLookup(params.query, ctx.cwd);

      // ArcGIS fallback when local has no match
      if (result.error) {
        const arcgisUrl = process.env.ARCGIS_FEATURE_SERVICE_URL ?? "";
        const arcgisKey = process.env.ARCGIS_API_KEY ?? "";
        const useArcGIS = params.use_arcgis !== false && arcgisUrl && arcgisKey;

        if (useArcGIS) {
          const trimmed = params.query.trim();
          let pullParams: { utility_id?: string; where?: string } = {};
          if (/^\d+$/.test(trimmed)) {
            pullParams.utility_id = trimmed;
          } else if (trimmed.length >= 2) {
            const escaped = trimmed.replace(/'/g, "''");
            pullParams.where = `UPPER(UTILITY_NAME) LIKE '%${escaped.toUpperCase()}%'`;
          }
          const pullResult = await runArcGISPull(
            { ...pullParams, limit: 10 },
            arcgisUrl,
            arcgisKey
          );
          if (pullResult.utilities.length === 1) {
            const u = pullResult.utilities[0];
            result = {
              resolved: {
                utility_id: u.utility_id,
                utility_name: u.utility_name,
                state: u.state,
                ferc_id: null,
                hifld_id: null,
              },
            };
          } else if (pullResult.utilities.length > 1) {
            result = {
              candidates: pullResult.utilities.map((u) => ({
                utility_id: u.utility_id,
                utility_name: u.utility_name,
                state: u.state,
                ferc_id: null,
                hifld_id: null,
                confidence: 0.8,
              })),
            };
          }
        }
      }

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
      let text = `Ingested ${params.file_path}. Extracted ${result.signals_extracted ?? 0} signals. Source ID: ${result.source_id}`;
      if (result.validation_errors) {
        text += ` (${result.validation_errors} extraction(s) failed schema validation — flagged for review)`;
      }
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
    name: "urs_fetch_edgar",
    label: "Fetch SEC EDGAR Filings",
    description:
      "Fetch 10-K and 10-Q filings from SEC EDGAR for an investor-owned utility, optionally ingest for scoring. Uses SEC's free API. Requires utility→CIK mapping (see .pi/extensions/urs/data/edgar-cik-map.ts).",
    parameters: Type.Object({
      utility_id: Type.String({ description: "EIA Utility ID" }),
      cik: Type.Optional(Type.String({ description: "SEC CIK (override mapping; 10-digit or numeric)" })),
      form_types: Type.Optional(
        Type.Array(Type.String(), { description: "Form types to fetch (default: 10-K, 10-Q)" })
      ),
      limit: Type.Optional(Type.Number({ description: "Max filings to fetch per form type (default 5)" })),
      ingest: Type.Optional(Type.Boolean({ description: "If true, run LLM extraction and store signals (default true)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
      if (!apiKey && params.ingest !== false) {
        return {
          content: [{ type: "text", text: "ANTHROPIC_API_KEY not set. Set ingest: false to fetch only (no extraction)." }],
          details: {},
        };
      }
      const result = await runFetchEdgar(
        params as Parameters<typeof runFetchEdgar>[0],
        ctx.cwd,
        apiKey
      );
      if (!result.success && result.filings_fetched === 0) {
        return { content: [{ type: "text", text: result.errors.join("\n") }], details: result };
      }
      let text = `Fetched ${result.filings_fetched} SEC filing(s) for utility ${result.utility_id}`;
      if (result.cik) text += ` (CIK ${result.cik})`;
      text += ".";
      if (result.filings_ingested != null) {
        text += ` Ingested ${result.filings_ingested} with signals extracted.`;
      }
      if (result.errors.length > 0) {
        text += `\n\nWarnings: ${result.errors.join("; ")}`;
      }
      if (result.details?.length) {
        text += `\n\n${result.details.map((d) => `${d.form} ${d.filing_date} ${d.ingested ? "✓" : ""}`).join("\n")}`;
      }
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "urs_fetch_pudl",
    label: "Fetch PUDL FERC Form 1",
    description:
      "Fetch FERC Form 1 data via PUDL (Catalyst Cooperative) for track_record. Uses ferc_id from utilities. Downloads ferc1_dbf.sqlite from Zenodo on first run (~271MB). Pass pudl_sqlite_path for local file.",
    parameters: Type.Object({
      utility_id: Type.String({ description: "EIA Utility ID" }),
      year: Type.Optional(Type.Number({ description: "Report year (default: previous year)" })),
      pudl_sqlite_path: Type.Optional(Type.String({ description: "Path to local ferc1_dbf.sqlite (skip Zenodo download)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await runFetchPudl(params as Parameters<typeof runFetchPudl>[0], ctx.cwd);
      if (!result.success && result.signals_written === 0) {
        return { content: [{ type: "text", text: result.errors.join("\n") }], details: result };
      }
      let text = `Fetched PUDL FERC Form 1 for utility ${result.utility_id}`;
      if (result.ferc_id) text += ` (FERC ${result.ferc_id})`;
      text += `. Wrote ${result.signals_written} signal(s).`;
      if (result.errors.length > 0) text += `\n\nWarnings: ${result.errors.join("; ")}`;
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "urs_fetch_eia",
    label: "Fetch EIA Open Data API",
    description:
      "Fetch retail sales, customers, revenue from EIA Open Data API for track_record. Requires EIA_API_KEY (free at eia.gov/opendata).",
    parameters: Type.Object({
      utility_id: Type.String({ description: "EIA Utility ID" }),
      dataset: Type.Optional(Type.String({ description: "EIA dataset (default: electricity/retail-sales)" })),
      start: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD" })),
      end: Type.Optional(Type.String({ description: "End date YYYY-MM-DD" })),
      frequency: Type.Optional(Type.String({ description: "annual | monthly (default: annual)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const apiKey = process.env.EIA_API_KEY ?? "";
      const result = await runFetchEia(params as Parameters<typeof runFetchEia>[0], ctx.cwd, apiKey);
      if (!result.success) {
        return { content: [{ type: "text", text: result.errors.join("\n") }], details: result };
      }
      let text = `Fetched EIA data for utility ${result.utility_id}. Wrote ${result.signals_written} signal(s).`;
      if (result.details?.records) text += ` (${result.details.records} records)`;
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "urs_fetch_legiscan",
    label: "Fetch LegiScan Bills",
    description:
      "Search state legislature bills related to energy, datacenters, and utilities via LegiScan API. Free tier: 30k queries/month. Requires LEGISCAN_API_KEY. Feeds regulatory_environment dimension.",
    parameters: Type.Object({
      state: Type.Optional(Type.String({ description: "State abbreviation (e.g. AZ, NC, VA). Omit to search all states." })),
      query: Type.Optional(Type.String({ description: "Custom search query. If omitted, uses default datacenter/energy terms." })),
      keywords: Type.Optional(
        Type.Array(Type.String(), { description: "Multiple search keywords (each run as separate query)" })
      ),
      year: Type.Optional(Type.Number({ description: "Filter by legislative year (e.g. 2025)" })),
      bill_id: Type.Optional(Type.Number({ description: "Fetch a specific bill by LegiScan bill_id" })),
      relevance_threshold: Type.Optional(Type.Number({ description: "Min relevance score 0-100 (default 50)" })),
      limit: Type.Optional(Type.Number({ description: "Max bills to fetch (default 10)" })),
      utility_id: Type.Optional(Type.String({ description: "EIA Utility ID — required for ingest" })),
      ingest: Type.Optional(Type.Boolean({ description: "If true + utility_id set, run LLM extraction and store signals (default true)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const legiscanKey = process.env.LEGISCAN_API_KEY ?? "";
      if (!legiscanKey) {
        return {
          content: [{ type: "text", text: "LEGISCAN_API_KEY not set. Get a free key at legiscan.com/legiscan." }],
          details: {},
        };
      }
      const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
      if (!anthropicKey && params.ingest !== false && params.utility_id) {
        return {
          content: [{ type: "text", text: "ANTHROPIC_API_KEY not set. Set ingest: false to fetch without extraction." }],
          details: {},
        };
      }
      const result = await runFetchLegiScan(
        params as Parameters<typeof runFetchLegiScan>[0],
        ctx.cwd,
        legiscanKey,
        anthropicKey
      );
      if (!result.success && result.bills_fetched === 0) {
        return { content: [{ type: "text", text: result.errors.join("\n") }], details: result };
      }
      let text = `Found ${result.bills_found} bill(s), fetched ${result.bills_fetched}`;
      if (params.state) text += ` in ${params.state.toUpperCase()}`;
      text += `. Used ${result.queries_used} API queries.`;
      if (result.bills_ingested != null) {
        text += ` Ingested ${result.bills_ingested} for scoring.`;
      }
      if (result.bills.length > 0) {
        text += "\n\n" + result.bills.map((b) =>
          `${b.state} ${b.bill_number}: ${b.title.slice(0, 120)}${b.title.length > 120 ? "…" : ""} [${b.status}]${b.ingested ? " ✓ingested" : ""}`
        ).join("\n");
      }
      if (result.errors.length > 0) {
        text += `\n\nWarnings: ${result.errors.join("; ")}`;
      }
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "urs_fetch_hifld",
    label: "Fetch HIFLD Territory Metadata",
    description:
      "Fetch utility territory metadata from HIFLD ArcGIS REST. Enriches utilities table with names, addresses, types. No API key required.",
    parameters: Type.Object({
      state: Type.Optional(Type.String({ description: "Filter by state (e.g. AZ)" })),
      utility_name: Type.Optional(Type.String({ description: "Filter by name (partial match)" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 100)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await runFetchHifld(params as Parameters<typeof runFetchHifld>[0], ctx.cwd);
      if (!result.success) {
        return { content: [{ type: "text", text: result.errors.join("\n") }], details: result };
      }
      let text = `Fetched ${result.utilities_fetched} utilities from HIFLD, upserted ${result.utilities_upserted}.`;
      if (result.details?.length) {
        text += `\n\n${result.details.slice(0, 10).map((d) => `${d.name} (${d.state})`).join("\n")}`;
        if (result.details.length > 10) text += `\n... and ${result.details.length - 10} more`;
      }
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "urs_fetch_puc_dockets",
    label: "Fetch State PUC Dockets",
    description:
      "Fetch state Public Utility Commission docket filings. Supports AZ (ACC eDocket), NC (NCUC), TX (PUCT Interchange) scrapers. For other states, use url param for manual fetch + ingest. Affects all scoring dimensions.",
    parameters: Type.Object({
      state: Type.String({ description: "State abbreviation (e.g. AZ, NC, TX, VA)" }),
      docket_number: Type.Optional(Type.String({ description: "Specific docket/case number to look up" })),
      search_query: Type.Optional(Type.String({ description: "Search term (e.g. 'datacenter', 'large load', 'rate case')" })),
      url: Type.Optional(Type.String({ description: "Direct URL to a docket document for manual fetch + ingest" })),
      utility_id: Type.Optional(Type.String({ description: "EIA Utility ID — required for ingest" })),
      source_type: Type.Optional(Type.String({ description: "Source type for ingest: rate_case | irp | tariff_filing | interconnection (default: rate_case)" })),
      document_date: Type.Optional(Type.String({ description: "Document date, ISO 8601" })),
      ingest: Type.Optional(Type.Boolean({ description: "If true + utility_id set, run LLM extraction (default true)" })),
      limit: Type.Optional(Type.Number({ description: "Max dockets to fetch (default 10)" })),
      list_systems: Type.Optional(Type.Boolean({ description: "If true, list all known PUC systems and their capabilities" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
      if (!anthropicKey && params.ingest !== false && params.utility_id) {
        return {
          content: [{ type: "text", text: "ANTHROPIC_API_KEY not set. Set ingest: false to fetch without extraction, or omit utility_id." }],
          details: {},
        };
      }
      const result = await runFetchPUCDockets(
        params as Parameters<typeof runFetchPUCDockets>[0],
        ctx.cwd,
        anthropicKey
      );

      if (result.all_systems) {
        const text = "Known State PUC Systems:\n\n" +
          result.all_systems.map((s) =>
            `${s.state} — ${s.name}\n  URL: ${s.url}\n  Scraper: ${s.has_scraper ? "Yes" : "No (manual fetch)"}\n  ${s.notes}`
          ).join("\n\n");
        return { content: [{ type: "text", text }], details: result };
      }

      if (!result.success && result.dockets_found === 0) {
        let text = result.errors.join("\n");
        if (result.system_info) {
          text += `\n\nSystem: ${result.system_info.name}\nURL: ${result.system_info.url}\nSearch: ${result.system_info.search_url}`;
        }
        return { content: [{ type: "text", text }], details: result };
      }

      let text = `${result.state}: Found ${result.dockets_found} docket(s)`;
      if (result.system_info) text += ` via ${result.system_info.name}`;
      text += ".";
      if (result.dockets_ingested != null) {
        text += ` Ingested ${result.dockets_ingested} for scoring.`;
      }
      if (result.dockets.length > 0) {
        text += "\n\n" + result.dockets.map((d) =>
          `${d.docket_number}: ${d.title.slice(0, 120)}${d.title.length > 120 ? "…" : ""} [${d.status}]${d.ingested ? " ✓ingested" : ""}`
        ).join("\n");
      }
      if (result.errors.length > 0) {
        text += `\n\nWarnings: ${result.errors.join("; ")}`;
      }
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "urs_import_eia",
    label: "Import EIA-861 Utilities",
    description: "Import utilities from EIA-861 into the local DB. Use file_path for a local CSV or Excel (.xlsx), or url to fetch CSV. EIA-861: eia.gov/electricity/data/eia861/ — ~3,300 US utilities.",
    parameters: Type.Object({
      file_path: Type.Optional(Type.String({ description: "Path to EIA-861 CSV or Excel .xlsx (relative to cwd or absolute)" })),
      url: Type.Optional(Type.String({ description: "URL of EIA-861 CSV to fetch" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await runImportEIA(params as Parameters<typeof runImportEIA>[0], ctx.cwd);
      if (result.errors.length > 0 && result.imported === 0) {
        return {
          content: [{ type: "text", text: result.errors.join("\n") }],
          details: result,
        };
      }
      let text = `Imported ${result.imported} utilities`;
      if (result.skipped > 0) text += `, skipped ${result.skipped} duplicates`;
      if (result.errors.length > 0) text += `. ${result.errors.length} row error(s): ${result.errors.slice(0, 3).join("; ")}`;
      text += ".";
      return { content: [{ type: "text", text }], details: result };
    },
  });

  pi.registerTool({
    name: "urs_arcgis_pull",
    label: "Pull from ArcGIS",
    description: "Pull utility data and scores from ArcGIS feature layer. Use persist: true to save pulled utilities into the local DB for lookups and scoring.",
    parameters: Type.Object({
      state: Type.Optional(Type.String({ description: "Filter by state (e.g. VA, NC, AZ)" })),
      utility_id: Type.Optional(Type.String({ description: "Filter by EIA utility ID" })),
      where: Type.Optional(Type.String({ description: "ArcGIS SQL where clause (e.g. URS_COMPOSITE >= 60)" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 100)" })),
      persist: Type.Optional(Type.Boolean({ description: "If true, save pulled utilities into local DB for future lookups/scoring" })),
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
      const result = await runArcGISPull(
        params as Parameters<typeof runArcGISPull>[0],
        arcgisUrl,
        arcgisKey,
        params.persist ? ctx.cwd : undefined
      );
      if (result.error) {
        return { content: [{ type: "text", text: result.error }], details: {} };
      }
      if (result.utilities.length === 0) {
        return { content: [{ type: "text", text: "No utilities found in ArcGIS." }], details: {} };
      }
      const lines = result.utilities.map(
        (u) =>
          `${u.utility_name} (${u.state}) — ${u.utility_id}` +
          (u.composite_score != null ? ` — ${u.composite_score}/100` : "")
      );
      let text = `Pulled ${result.utilities.length} utilities:\n${lines.join("\n")}`;
      if (result.persisted != null) {
        text += `\n\nSaved ${result.persisted} to local DB for lookups and scoring.`;
      }
      return {
        content: [{ type: "text", text }],
        details: { utilities: result.utilities, persisted: result.persisted },
      };
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
