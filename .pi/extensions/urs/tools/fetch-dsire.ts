/**
 * urs_fetch_dsire — Fetch state incentive/policy programs from DSIRE API
 * Maps to regulatory_environment and clean_energy_posture dimensions.
 * No API key required. Data is state-level; all utilities in state share signals.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { initDb } from "../data/db";
import { seedUtilities } from "../data/seed";

const DSIRE_BASE = "http://programs.dsireusa.org/api/v1";
const USER_AGENT = "URS-UtilityScoring/1.0 (https://github.com/badlogic/pi-mono; utility-responsiveness-scoring)";

interface DsireProgram {
  ProgramId?: number;
  State?: string;
  CategoryName?: string;
  TypeName?: string;
  Budget?: string;
  StartDate?: string;
  LastUpdate?: string;
  Technologies?: string;
  ProgramName?: string;
  [key: string]: unknown;
}

interface DsireResponse {
  data?: DsireProgram[];
}

export interface FetchDsireParams {
  state?: string;
  utility_id?: string;
  since_date?: string;
}

export interface FetchDsireResult {
  success: boolean;
  state: string;
  programs_fetched: number;
  signals_written: number;
  utilities_updated: number;
  errors: string[];
  details?: Array<{ program_id: number; program_name: string; dimension: string }>;
}

/** Normalize state to 2-letter uppercase */
function normalizeState(s: string): string {
  return s.trim().toUpperCase().slice(0, 2);
}

/** Classify program as regulatory_environment, clean_energy_posture, or both */
function classifyProgram(prog: DsireProgram): ("regulatory_environment" | "clean_energy_posture")[] {
  const dims: ("regulatory_environment" | "clean_energy_posture")[] = [];
  const cat = String(prog.CategoryName ?? "").toLowerCase();
  const typeName = String(prog.TypeName ?? "").toLowerCase();
  const tech = String(prog.Technologies ?? "").toLowerCase();
  const name = String(prog.ProgramName ?? "").toLowerCase();
  const combined = `${cat} ${typeName} ${tech} ${name}`;

  // regulatory_environment: tax incentives, economic development, retail choice
  const regulatoryKeywords = [
    "tax incentive",
    "property tax",
    "sales tax",
    "corporate tax",
    "economic development",
    "industry recruitment",
    "retail choice",
    "deregulat",
    "competitive retail",
  ];
  if (regulatoryKeywords.some((k) => combined.includes(k))) {
    dims.push("regulatory_environment");
  }

  // clean_energy_posture: green tariff, RPS, net metering, renewable, solar, wind
  const cleanKeywords = [
    "green tariff",
    "renewable portfolio",
    "rps",
    "net metering",
    "interconnection",
    "renewable energy",
    "solar",
    "wind",
    "renewable credit",
    "rec",
    "srec",
    "clean energy",
    "carbon",
    "ppa",
    "power purchase",
  ];
  if (cleanKeywords.some((k) => combined.includes(k))) {
    dims.push("clean_energy_posture");
  }

  // Rules/Regulations category often has RPS, net metering, etc.
  if (cat.includes("rules") || cat.includes("regulation") || cat.includes("polic")) {
    if (dims.length === 0) dims.push("clean_energy_posture");
  }

  // Financial Incentive for renewables
  if (cat.includes("financial") && (combined.includes("renewable") || combined.includes("solar") || combined.includes("wind"))) {
    if (!dims.includes("clean_energy_posture")) dims.push("clean_energy_posture");
  }

  return [...new Set(dims)];
}

/** Build signal payload from DSIRE program for a dimension */
function buildSignalPayload(
  prog: DsireProgram,
  dimension: "regulatory_environment" | "clean_energy_posture"
): Record<string, unknown> {
  const base = { dimension };
  const typeName = String(prog.TypeName ?? "");
  const programName = String((prog.ProgramName ?? typeName) || `Program ${prog.ProgramId}`);

  if (dimension === "regulatory_environment") {
    return {
      ...base,
      datacenter_incentive_legislation: true,
      key_quotes: [programName],
    };
  }

  // clean_energy_posture
  const isGreenTariff = /green tariff|renewable.*tariff|rps|portfolio standard/i.test(typeName + programName);
  const isPpa = /net metering|interconnection|ppa|power purchase/i.test(typeName + programName);
  return {
    ...base,
    program_name: programName,
    type: isGreenTariff ? "green_tariff" : isPpa ? "ppa_enabled" : "green_tariff",
    status: "approved",
    restrictions: prog.Budget ? String(prog.Budget) : undefined,
  };
}

export async function runFetchDsire(params: FetchDsireParams, cwd: string): Promise<FetchDsireResult> {
  const db = initDb(cwd);
  seedUtilities(db);

  let state: string;
  if (params.state) {
    state = normalizeState(params.state);
  } else if (params.utility_id) {
    const row = db.prepare("SELECT state FROM utilities WHERE utility_id = ?").get(params.utility_id) as
      | { state: string }
      | undefined;
    if (!row) {
      return {
        success: false,
        state: "",
        programs_fetched: 0,
        signals_written: 0,
        utilities_updated: 0,
        errors: [`Utility ${params.utility_id} not found in DB`],
      };
    }
    state = normalizeState(row.state);
  } else {
    return {
      success: false,
      state: "",
      programs_fetched: 0,
      signals_written: 0,
      utilities_updated: 0,
      errors: ["Either state or utility_id is required"],
    };
  }

  if (state.length !== 2) {
    return {
      success: false,
      state,
      programs_fetched: 0,
      signals_written: 0,
      utilities_updated: 0,
      errors: ["Invalid state; use 2-letter code (e.g. AZ, NC)"],
    };
  }

  const errors: string[] = [];
  let programs: DsireProgram[] = [];

  try {
    let url: string;
    if (params.since_date) {
      const from = params.since_date.replace(/-/g, "").slice(0, 8);
      const to = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      url = `${DSIRE_BASE}/getprogramsbydate/${from}/${to}/json`;
    } else {
      url = `${DSIRE_BASE}/getprograms/json`;
    }

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      return {
        success: false,
        state,
        programs_fetched: 0,
        signals_written: 0,
        utilities_updated: 0,
        errors: [`DSIRE API fetch failed: ${res.status} ${res.statusText}`],
      };
    }

    const body = (await res.json()) as DsireResponse;
    programs = body.data ?? [];
  } catch (e) {
    return {
      success: false,
      state,
      programs_fetched: 0,
      signals_written: 0,
      utilities_updated: 0,
      errors: [`DSIRE fetch error: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const statePrograms = programs.filter((p) => normalizeState(String(p.State ?? "")) === state);
  const cacheDir = join(cwd, "data", ".urs-dsire-cache", state);
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  writeFileSync(join(cacheDir, "programs.json"), JSON.stringify(statePrograms, null, 2), "utf-8");

  const utilities = db.prepare("SELECT utility_id FROM utilities WHERE UPPER(TRIM(state)) = ?").all(state) as Array<{
    utility_id: string;
  }>;

  if (utilities.length === 0) {
    return {
      success: true,
      state,
      programs_fetched: statePrograms.length,
      signals_written: 0,
      utilities_updated: 0,
      errors: [...errors, `No utilities in DB for state ${state}. Import utilities first (urs_import_eia).`],
      details: [],
    };
  }

  const dimensionsAffected = JSON.stringify(["regulatory_environment", "clean_energy_posture"]);
  const docDate = new Date().toISOString().slice(0, 10);
  const details: Array<{ program_id: number; program_name: string; dimension: string }> = [];
  let signalsWritten = 0;

  const deleteSignals = db.prepare("DELETE FROM signals WHERE source_id = ?");
  const deleteSource = db.prepare("DELETE FROM sources WHERE source_id = ?");
  const insertSource = db.prepare(
    `INSERT INTO sources (source_id, utility_id, source_type, document_date, file_path, dimensions_affected, max_age_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSignal = db.prepare(
    `INSERT INTO signals (signal_id, source_id, extraction_target, payload, model_version, extraction_confidence)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const { utility_id } of utilities) {
    const sourceId = `dsire-${state}-${utility_id}`;
    deleteSignals.run(sourceId);
    deleteSource.run(sourceId);
    insertSource.run(
      sourceId,
      utility_id,
      "dsire",
      docDate,
      `data/.urs-dsire-cache/${state}/programs.json`,
      dimensionsAffected,
      365
    );

    for (const prog of statePrograms) {
      const dims = classifyProgram(prog);
      if (dims.length === 0) continue;

      for (const dim of dims) {
        const signalId = `sig-${randomUUID().slice(0, 8)}`;
        const payload = buildSignalPayload(prog, dim);
        const extractionTarget = dim === "regulatory_environment" ? "regulatory_signals" : "clean_energy_program";

        insertSignal.run(
          signalId,
          sourceId,
          extractionTarget,
          JSON.stringify(payload),
          "dsire-api-v1",
          0.9
        );
        signalsWritten++;
        details.push({
          program_id: prog.ProgramId ?? 0,
          program_name: String(prog.ProgramName ?? prog.TypeName ?? "Unknown"),
          dimension: dim,
        });
      }
    }
  }

  return {
    success: true,
    state,
    programs_fetched: statePrograms.length,
    signals_written: signalsWritten,
    utilities_updated: utilities.length,
    errors: errors.length > 0 ? errors : [],
    details: details.length > 0 ? details : undefined,
  };
}
