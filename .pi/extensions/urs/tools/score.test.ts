import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

vi.mock("../extraction/rationale", () => ({
  generateRationale: vi.fn().mockResolvedValue("Mock rationale."),
}));

let testDb: Database.Database | null = null;

vi.mock("../data/db", () => ({
  initDb: (_cwd: string) => {
    if (testDb) return testDb;
    testDb = new Database(":memory:");
    const schemaPath = join(__dirname, "..", "data", "schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");
    testDb.exec(schema);
    return testDb;
  },
  closeDb: () => {
    if (testDb) {
      testDb.close();
      testDb = null;
    }
  },
}));

import { runScore, type ScoreParams } from "./score";
import type { ScoreResponse } from "../scoring/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("use_case cache matching", () => {
  beforeEach(() => {
    if (testDb) {
      testDb.close();
      testDb = null;
    }
  });

  it("should return cached score when only use_case is provided on repeat call", async () => {
    const params: ScoreParams = {
      utility_id: "6452",
      use_case: "datacenter",
    };

    const first = await runScore(params, "/tmp/test-urs", "fake-key");
    expect("error" in first).toBe(false);
    const firstResponse = first as ScoreResponse;
    expect(firstResponse.context_applied).toBeDefined();
    expect(firstResponse.context_applied?.use_case).toBe("datacenter");

    const second = await runScore(params, "/tmp/test-urs", "fake-key");
    expect("error" in second).toBe(false);
    const secondResponse = second as ScoreResponse;

    expect(secondResponse.scored_at).toBe(firstResponse.scored_at);
  });

  it("should cache-miss when use_case differs", async () => {
    const params1: ScoreParams = {
      utility_id: "6452",
      use_case: "datacenter",
    };
    const params2: ScoreParams = {
      utility_id: "6452",
      use_case: "manufacturing",
    };

    const first = await runScore(params1, "/tmp/test-urs", "fake-key");
    expect("error" in first).toBe(false);

    await sleep(2);

    const second = await runScore(params2, "/tmp/test-urs", "fake-key");
    expect("error" in second).toBe(false);
    const secondResponse = second as ScoreResponse;

    expect(secondResponse.scored_at).not.toBe((first as ScoreResponse).scored_at);
    expect(secondResponse.context_applied?.use_case).toBe("manufacturing");
  });

  it("should store context_applied with use_case in DB when only use_case is provided", async () => {
    const params: ScoreParams = {
      utility_id: "6452",
      use_case: "datacenter",
    };

    await runScore(params, "/tmp/test-urs", "fake-key");

    const row = testDb!
      .prepare("SELECT context_applied FROM scores WHERE utility_id = ? ORDER BY scored_at DESC LIMIT 1")
      .get("6452") as { context_applied: string | null };

    expect(row.context_applied).not.toBeNull();
    const context = JSON.parse(row.context_applied!);
    expect(context.use_case).toBe("datacenter");
  });

  it("should cache-hit when no context is provided on either call", async () => {
    const params: ScoreParams = { utility_id: "6452" };

    const first = await runScore(params, "/tmp/test-urs", "fake-key");
    expect("error" in first).toBe(false);

    const second = await runScore(params, "/tmp/test-urs", "fake-key");
    expect("error" in second).toBe(false);

    expect((second as ScoreResponse).scored_at).toBe((first as ScoreResponse).scored_at);
  });
});
