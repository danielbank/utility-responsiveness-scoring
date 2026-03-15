/**
 * Utility → SEC EDGAR CIK mapping
 * Maps EIA utility_id to SEC Central Index Key (10-digit) for investor-owned utilities.
 * Only IOUs file with SEC; munis and coops typically have no CIK.
 *
 * Add entries as needed. Source: sec.gov/cgi-bin/browse-edgar
 */

export const UTILITY_TO_CIK: Record<string, string> = {
  // Arizona
  "803": "0000764622", // Arizona Public Service → Pinnacle West Capital Corp (PNW)
  "24208": "0000100122", // Tucson Electric Power Co
  // North Carolina / Duke
  "6452": "0001326160", // Duke Energy Carolinas → Duke Energy Corp
  "6453": "0001326160", // Duke Energy Progress → Duke Energy Corp
  // Virginia / Dominion
  "13998": "0000715957", // Dominion Energy Virginia → Dominion Energy Inc
  "13999": "0000715957", // Dominion Energy South Carolina → Dominion Energy Inc
  "14328": "0000715957", // Dominion Energy North Carolina → Dominion Energy Inc
  // Other major IOUs
  "14354": "0001326160", // Duke Energy Ohio → Duke Energy Corp
  "14355": "0001326160", // Duke Energy Kentucky → Duke Energy Corp
  "13997": "0000715957", // Dominion Energy Ohio → Dominion Energy Inc
  "14329": "0000715957", // Dominion Energy West Virginia → Dominion Energy Inc
  "4904": "0000004904", // AEP (American Electric Power Co Inc)
  "72909": "0000072903", // Xcel Energy Inc
  "35808": "0000065984", // Entergy Corp
  "87721": "0000092122", // Southern Co
  "1031296": "0001031296", // FirstEnergy Corp
  "1002918": "0001032208", // Sempra (SDG&E parent)
  "1347559": "0000784977", // Portland General Electric Co
  "14330": "0000764622", // UNS Electric → Pinnacle West Capital Corp (parent)
};

/** Resolve EIA utility_id to SEC CIK. Returns null if no mapping. */
export function getCikForUtility(utilityId: string): string | null {
  return UTILITY_TO_CIK[utilityId] ?? null;
}
