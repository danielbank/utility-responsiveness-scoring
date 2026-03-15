/**
 * Utility → SEC EDGAR CIK mapping
 * Maps EIA utility_id to SEC Central Index Key (10-digit) for investor-owned utilities.
 * Only IOUs file with SEC; munis and coops typically have no CIK.
 *
 * Add entries as needed. Source: sec.gov/cgi-bin/browse-edgar
 */

export const UTILITY_TO_CIK: Record<string, string> = {
  // Arizona
  "803": "0000874360", // Arizona Public Service → Pinnacle West (PNW)
  "24208": "0001312105", // Tucson Electric Power → Fortis Inc
  // North Carolina / Duke
  "6452": "0001326160", // Duke Energy Carolinas → Duke Energy
  "6453": "0001326160", // Duke Energy Progress → Duke Energy
  // Virginia / Dominion
  "13998": "0000715958", // Dominion Energy Virginia → Dominion Energy
  "13999": "0000715958", // Dominion Energy South Carolina → Dominion Energy
  "14328": "0000715958", // Dominion Energy North Carolina → Dominion Energy
  // Other major IOUs
  "14354": "0001326160", // Duke Energy Ohio
  "14355": "0001326160", // Duke Energy Kentucky
  "13997": "0000715958", // Dominion Energy Ohio
  "14329": "0000715958", // Dominion Energy West Virginia
  "4904": "0000004904", // AEP (American Electric Power)
  "72909": "0000072909", // Xcel Energy
  "35808": "0000358088", // Entergy
  "87721": "0000877221", // Southern Company
  "1031296": "0001031296", // FirstEnergy
  "1002918": "0001002918", // Sempra (SDG&E)
  "1347559": "0001347559", // Portland General Electric
  "14330": "0000874360", // UNS Electric → UniSource (Pinnacle West subsidiary)
};

/** Resolve EIA utility_id to SEC CIK. Returns null if no mapping. */
export function getCikForUtility(utilityId: string): string | null {
  return UTILITY_TO_CIK[utilityId] ?? null;
}
