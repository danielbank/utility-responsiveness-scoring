/**
 * Tests for urs_fetch_legiscan and urs_fetch_puc_dockets tools
 * Tests module structure, parameter handling, error paths, and PUC system registry.
 * API-dependent tests are skipped when keys are not available.
 */

import { runFetchLegiScan, type FetchLegiScanParams, type FetchLegiScanResult } from "../.pi/extensions/urs/tools/fetch-legiscan";
import { runFetchPUCDockets, type FetchPUCDocketsParams, type FetchPUCDocketsResult } from "../.pi/extensions/urs/tools/fetch-puc-dockets";
import { initDb } from "../.pi/extensions/urs/data/db";
import { seedUtilities } from "../.pi/extensions/urs/data/seed";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_CWD = join(process.cwd(), "test", ".test-regulatory-tools-tmp");

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

function skip(msg: string): void {
  skipped++;
  console.log(`  ⏭️  ${msg}`);
}

function setup(): void {
  if (existsSync(TEST_CWD)) {
    rmSync(TEST_CWD, { recursive: true, force: true });
  }
  mkdirSync(join(TEST_CWD, "data"), { recursive: true });
  const db = initDb(TEST_CWD);
  seedUtilities(db);
}

function teardown(): void {
  if (existsSync(TEST_CWD)) {
    rmSync(TEST_CWD, { recursive: true, force: true });
  }
}

async function testLegiScanNoApiKey(): Promise<void> {
  console.log("\n--- LegiScan: no API key ---");
  const result = await runFetchLegiScan(
    { state: "AZ" },
    TEST_CWD,
    "", // empty API key
    ""
  );
  assert(!result.success || result.bills_fetched === 0, "Returns no bills without API key");
  assert(result.errors.length > 0 || result.bills_found === 0, "Reports errors or zero results");
}

async function testLegiScanBadUtility(): Promise<void> {
  console.log("\n--- LegiScan: non-existent utility ---");
  const result = await runFetchLegiScan(
    { state: "AZ", utility_id: "99999", ingest: true },
    TEST_CWD,
    "test-key",
    "test-anthropic-key"
  );
  assert(!result.success, "Fails for non-existent utility");
  assert(result.errors.some((e) => e.includes("99999")), "Error mentions the utility ID");
}

async function testLegiScanResultShape(): Promise<void> {
  console.log("\n--- LegiScan: result shape ---");
  const result: FetchLegiScanResult = {
    success: true,
    bills_found: 0,
    bills_fetched: 0,
    queries_used: 0,
    errors: [],
    bills: [],
  };
  assert(typeof result.success === "boolean", "success is boolean");
  assert(typeof result.bills_found === "number", "bills_found is number");
  assert(typeof result.bills_fetched === "number", "bills_fetched is number");
  assert(typeof result.queries_used === "number", "queries_used is number");
  assert(Array.isArray(result.errors), "errors is array");
  assert(Array.isArray(result.bills), "bills is array");
}

async function testPUCListSystems(): Promise<void> {
  console.log("\n--- PUC: list systems ---");
  const result = await runFetchPUCDockets(
    { state: "AZ", list_systems: true },
    TEST_CWD,
    ""
  );
  assert(result.success, "list_systems succeeds");
  assert(!!result.all_systems && result.all_systems.length > 0, "Returns PUC system list");

  const az = result.all_systems?.find((s) => s.state === "AZ");
  assert(!!az, "Includes AZ system");
  assert(az?.has_scraper === true, "AZ has scraper");
  assert(az?.name.includes("Arizona"), "AZ system name correct");

  const nc = result.all_systems?.find((s) => s.state === "NC");
  assert(!!nc, "Includes NC system");
  assert(nc?.has_scraper === true, "NC has scraper");

  const tx = result.all_systems?.find((s) => s.state === "TX");
  assert(!!tx, "Includes TX system");
  assert(tx?.has_scraper === true, "TX has scraper");

  const va = result.all_systems?.find((s) => s.state === "VA");
  assert(!!va, "Includes VA system");
  assert(va?.has_scraper === false, "VA has no scraper (manual fetch)");
}

async function testPUCBadUtility(): Promise<void> {
  console.log("\n--- PUC: non-existent utility ---");
  const result = await runFetchPUCDockets(
    { state: "AZ", docket_number: "E-00000A-25-0069", utility_id: "99999", ingest: true },
    TEST_CWD,
    "test-key"
  );
  assert(!result.success, "Fails for non-existent utility");
  assert(result.errors.some((e) => e.includes("99999")), "Error mentions the utility ID");
}

async function testPUCUnsupportedState(): Promise<void> {
  console.log("\n--- PUC: unsupported state (no scraper) ---");
  const result = await runFetchPUCDockets(
    { state: "VA", search_query: "datacenter" },
    TEST_CWD,
    ""
  );
  assert(!result.success, "Fails for state without scraper");
  assert(result.errors.some((e) => e.includes("manual fetch") || e.includes("url")), "Suggests manual fetch");
  assert(!!result.system_info, "Returns system info for the state");
}

async function testPUCUnknownState(): Promise<void> {
  console.log("\n--- PUC: unknown state ---");
  const result = await runFetchPUCDockets(
    { state: "XX", search_query: "datacenter" },
    TEST_CWD,
    ""
  );
  assert(!result.success, "Fails for unknown state");
  assert(result.errors.some((e) => e.includes("list_systems")), "Suggests list_systems");
}

async function testPUCUrlNoUtility(): Promise<void> {
  console.log("\n--- PUC: URL fetch without utility_id ---");
  const result = await runFetchPUCDockets(
    { state: "AZ", url: "https://example.com/docket.html" },
    TEST_CWD,
    ""
  );
  assert(!result.success, "Fails without utility_id for URL fetch");
  assert(result.errors.some((e) => e.includes("utility_id")), "Error mentions utility_id");
}

async function testPUCResultShape(): Promise<void> {
  console.log("\n--- PUC: result shape ---");
  const result: FetchPUCDocketsResult = {
    success: true,
    state: "AZ",
    dockets_found: 0,
    errors: [],
    dockets: [],
  };
  assert(typeof result.success === "boolean", "success is boolean");
  assert(typeof result.state === "string", "state is string");
  assert(typeof result.dockets_found === "number", "dockets_found is number");
  assert(Array.isArray(result.errors), "errors is array");
  assert(Array.isArray(result.dockets), "dockets is array");
}

async function testLegiScanWithRealApi(): Promise<void> {
  console.log("\n--- LegiScan: real API (if key available) ---");
  const key = process.env.LEGISCAN_API_KEY ?? "";
  if (!key) {
    skip("LEGISCAN_API_KEY not set — skipping live API test");
    return;
  }
  const result = await runFetchLegiScan(
    { state: "AZ", query: "datacenter", limit: 3, ingest: false },
    TEST_CWD,
    key,
    ""
  );
  assert(result.success, "Search succeeds");
  assert(result.queries_used > 0, "Used API queries");
  console.log(`  Found ${result.bills_found} bills, fetched ${result.bills_fetched}`);
  if (result.bills.length > 0) {
    const b = result.bills[0];
    assert(typeof b.bill_id === "number", "Bill has bill_id");
    assert(typeof b.bill_number === "string", "Bill has bill_number");
    assert(typeof b.state === "string", "Bill has state");
    assert(typeof b.title === "string", "Bill has title");
    console.log(`  First bill: ${b.state} ${b.bill_number} — ${b.title.slice(0, 80)}`);
  }
}

async function main(): Promise<void> {
  console.log("=== Regulatory Data Tools Tests ===");
  setup();

  try {
    await testLegiScanResultShape();
    await testLegiScanNoApiKey();
    await testLegiScanBadUtility();
    await testPUCResultShape();
    await testPUCListSystems();
    await testPUCBadUtility();
    await testPUCUnsupportedState();
    await testPUCUnknownState();
    await testPUCUrlNoUtility();
    await testLegiScanWithRealApi();
  } finally {
    teardown();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
