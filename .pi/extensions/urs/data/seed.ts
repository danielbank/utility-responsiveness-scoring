/**
 * EIA-861 crosswalk seed data — sample utilities for development
 * In production, this would be populated from EIA-861 data files
 */

import type Database from "better-sqlite3";

const SAMPLE_UTILITIES = [
  // North Carolina / Virginia / South Carolina
  { utility_id: "6452", utility_name: "Duke Energy Carolinas, LLC", state: "NC", ferc_id: "54", hifld_id: "14354" },
  { utility_id: "6453", utility_name: "Duke Energy Progress, LLC", state: "NC", ferc_id: "54", hifld_id: "14355" },
  { utility_id: "13998", utility_name: "Dominion Energy Virginia", state: "VA", ferc_id: "45", hifld_id: "14356" },
  { utility_id: "13999", utility_name: "Dominion Energy South Carolina", state: "SC", ferc_id: "45", hifld_id: "14357" },
  { utility_id: "14328", utility_name: "Dominion Energy North Carolina", state: "NC", ferc_id: "45", hifld_id: "14358" },
  // Arizona
  { utility_id: "803", utility_name: "Arizona Public Service Company", state: "AZ", ferc_id: "148", hifld_id: null },
  { utility_id: "16572", utility_name: "Salt River Project", state: "AZ", ferc_id: null, hifld_id: null },
  { utility_id: "24208", utility_name: "Tucson Electric Power Company", state: "AZ", ferc_id: "366", hifld_id: null },
  { utility_id: "24211", utility_name: "UNS Electric, Inc.", state: "AZ", ferc_id: null, hifld_id: null },
];

export function seedUtilities(database: Database.Database): void {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO utilities (utility_id, utility_name, state, ferc_id, hifld_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const u of SAMPLE_UTILITIES) {
    insert.run(u.utility_id, u.utility_name, u.state, u.ferc_id ?? null, u.hifld_id ?? null);
  }
}
