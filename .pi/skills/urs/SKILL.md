---
name: urs
description: Scores utilities for datacenter siting responsiveness using 8 dimensions (large-load tariffs, interconnection speed, IRP alignment, etc.). Use when the user asks about utility responsiveness for datacenter siting, scoring or comparing utilities, or evaluating which utilities are most responsive to large-load customers.
---
# URS — Utility Responsiveness Scoring

Use this skill when the user asks about utility responsiveness for datacenter siting, scoring utilities, comparing utilities, or evaluating which utilities are most responsive to large-load customers.

## What URS Does

URS systematizes tribal knowledge about **utility behavior** into a numeric score (0–100) and structured rationale. The blocking constraint for datacenter siting is not grid capacity (hyperscalers have that) but which utilities negotiate creatively on tariffs, complete interconnection studies quickly, and have internal champions for large load.

## The 8 Scoring Dimensions

| ID | Label | What It Measures |
|----|-------|------------------|
| `large_load_tariff` | Large-Load Tariff Flexibility | Economic development riders, custom rate schedules, special contracts vs. standard C&I rates |
| `interconnection_speed` | Interconnection Study Speed | Historical pace of system impact and facilities studies (load-side, not FERC queue) |
| `irp_alignment` | IRP Alignment with Large Load Growth | Whether IRP acknowledges/plans for datacenter/industrial load vs. treats it as a threat |
| `regulatory_environment` | Regulatory and Political Environment | State-level structure: datacenter incentives, commission attitudes, legislative actions |
| `leadership_posture` | Utility Leadership Posture | CEO/board signals: welcoming datacenter development vs. viewing as system-stress liability |
| `grid_headroom` | Grid Capacity and Headroom Posture | Posture toward constraints: proactive upgrades, phased delivery vs. hard no |
| `track_record` | Track Record with Prior Large-Load Customers | History serving 50+ MW customers; organizational muscle memory |
| `clean_energy_posture` | Sustainability and Clean Energy Accommodation | Green tariffs, sleeved PPAs, behind-the-meter; 24/7 CFE accommodation |

Each dimension scores 0–100 with confidence 0–1. The composite is a weighted average. Tiers: 80–100 = Highly responsive, 60–79 = Moderately responsive, 40–59 = Mixed signals, 20–39 = Likely slow, 0–19 = Structurally unresponsive.

## When to Use Each Tool

- **urs_import_eia** — When the user needs more utilities than the seed provides, or wants to populate the DB. Import from EIA-861 CSV via `file_path` (local) or `url`. Covers ~3,300 US utilities. Download from eia.gov/electricity/data/eia861/.
- **urs_lookup** — First step when the user mentions a utility by name, state, or ID. Resolves to EIA Utility ID. If ambiguous, present candidates and ask the user to choose.
- **urs_score** — When the user wants to score, evaluate, or compare utilities. Call with `utility_id` from lookup. Include `mw_requirement`, `target_isd`, `use_case` if the user stated them.
- **urs_ingest** — When the user provides a document (IRP, tariff filing, earnings transcript) to add to the knowledge base. Requires file path, source type, utility ID.
- **urs_fetch_edgar** — When the user wants to pull 10-K/10-Q filings from SEC EDGAR for an investor-owned utility. Fetches from SEC's free API, optionally ingests for scoring. Only works for utilities with a CIK mapping (see data/edgar-cik-map.ts). APS (803), Duke (6452), Dominion (13998) are mapped.
- **urs_history** — When the user asks for score history or trends over time.
- **urs_sources** — When the user asks what data backs a score, or which sources are stale.
- **urs_arcgis_sync** — When the user wants to push scores to a map/ArcGIS.
- **urs_arcgis_pull** — When the user wants to pull utility data or scores from ArcGIS. Use `persist: true` to save pulled utilities into the local DB for lookups and scoring.

## Workflow Examples

**"I need Arizona utilities" / "Populate the DB" / "Pull utilities into the database"**
1. `urs_import_eia` with `url` (if a known EIA-861 CSV URL exists) or `file_path` to a downloaded CSV
2. Or `urs_arcgis_pull` with `state: "AZ"` and `persist: true` if ArcGIS already has the data
3. Then `urs_lookup` and `urs_score` as needed

**"Get SEC filings for APS" / "Ingest 10-K for Arizona Public Service"**
1. `urs_lookup`("Arizona Public Service") → utility_id 803
2. `urs_fetch_edgar`(utility_id="803") — fetches 10-K and 10-Q, ingests for scoring
3. `urs_score`(utility_id="803") to see improved score with new data

**"How responsive is Duke Energy Carolinas?"**
1. `urs_lookup`("Duke Energy Carolinas") → get utility_id 6452
2. `urs_score`(utility_id="6452")
3. Present score and rationale conversationally

**"Compare Duke and Dominion in Virginia"**
1. `urs_lookup`("Duke Energy") and `urs_lookup`("Dominion Energy Virginia") — resolve to specific utilities
2. `urs_score` for each
3. Present side-by-side comparison, highlight differences

**"I need 200MW online by mid-2027 in North Carolina"**
1. `urs_lookup` to find NC utilities (Duke Energy Carolinas, Duke Energy Progress, etc.)
2. Offer to score the relevant ones
3. When scoring, pass mw_requirement=200, target_isd="2027-06-01"
4. If user cares about interconnection speed, suggest weight_overrides: { interconnection_speed: 1.5 }

**"What dimensions do you score on?"**
Answer from this skill — no tool call needed.

## Presenting Results

- Lead with composite score and tier label
- Summarize the rationale in 1–2 sentences
- Call out dimensions that drove the score (high or low)
- If confidence is low or dimensions are stale, mention the caveat
- For comparisons, highlight the dimensions where utilities differ most

## Weight Suggestions

- User needs to be online in 18 months → suggest boosting `interconnection_speed`
- User has no clean energy mandate → suggest zero-weighting `clean_energy_posture`
- User is hyperscale campus → default weights are fine; `use_case` affects rationale tone

## Limitations to Mention When Relevant

- **Private negotiations** — Score reflects visible filings; special contracts filed under seal are invisible
- **State vs. utility** — Low `regulatory_environment` may reflect state constraints, not utility willingness
- **Municipal/coop** — Limited public data; expect low confidence
- **Geographic variability** — Score is utility-level, not substation-level; Charlotte vs. rural NC may differ
