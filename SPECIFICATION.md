# Utility Responsiveness Scoring (URS) — Technical Specification

This project is a submission for the SemiAnalysis x FluidAnalysis Hackathon

​​SemiAnalysis x Fluidstack is kicking off GTC with Power to Prefill, Dirt to Decode, Transformers to Transformers: A Full-Stack AI Infrastructure Hackathon. The hackathon that spans the entire AI infrastructure stack and we mean the entire stack. Most hackathons start at the API layer. This one starts at the dirt.

​Whether you're building tools for land permitting, optimizing power delivery, automating hardware procurement, orchestrating GPU clusters on SLURM, fine-tuning models, or shipping AI applications, there's a place for you here.

​The next wave of breakthroughs won't come just from better models, but from reimagining every link in the chain that turns raw land into decoded tokens, megawatts into prefill, and electrical transformers into transformer models.

​Civil engineers, systems programmers, ML engineers, and everyone in between are welcome. Fluidstack will issue compute grants, including Claude API credits and managed GPU cluster access, so you can build something real, solo or as a team.

---

## 0. Problem Statement

The blocking constraint for datacenter siting is not information about grid capacity — hyperscalers already have that from OASIS, interconnection queue data, and their own engineering teams. The constraint is **utility behavior**: which utilities negotiate creatively on large-load tariffs, which run every customer through the same 3-year standard interconnection process regardless of MW size, and which have internal champions vs. institutional resistance to large load.

This knowledge currently exists as tribal memory in the heads of experienced site selectors. URS systematizes it into a numeric score and structured rationale per utility, delivered via a **conversational pi agent** and renderable as an ArcGIS feature layer over utility service territory polygons.

---

## 1. Agent Interaction Model

URS is implemented as a **pi agent extension** with custom tools. Users interact via natural language in the terminal rather than REST API calls.

### 1.1 Conversational Interface

Users ask questions in plain language. The agent interprets intent, calls URS tools as needed, and responds conversationally.

| User intent                    | Example utterance                                      | Agent behavior                                                                 |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Score a utility                | "How responsive is Duke Energy Carolinas?"              | `urs_lookup` → `urs_score` → present scorecard conversationally                |
| Score with context             | "Score Duke for 200MW hyperscale targeting mid-2027"   | Extract context from utterance → `urs_score` with mw_requirement, target_isd   |
| Compare utilities              | "Compare Duke and Dominion in Virginia"                 | `urs_lookup` each → `urs_score` each → present comparison                      |
| Look up utility                | "What's utility 6452?"                                 | `urs_lookup` → return metadata                                                 |
| Score history                  | "Show me score history for Duke"                       | `urs_history` → present trend                                                   |
| Ingest document                | "I have Duke's IRP at ./docs/duke-irp.pdf"             | `urs_ingest` → summarize extraction results                                     |
| Re-score with fresh data       | "Re-score Duke, force refresh"                          | `urs_score` with force_refresh                                                  |
| Sync to map                    | "Push these scores to ArcGIS"                          | `urs_arcgis_sync`                                                               |

### 1.2 Score Request Parameters (Tool Interface)

The `urs_score` tool accepts:

| Parameter          | Type    | Required | Description                                                                 |
| ------------------ | ------- | -------- | --------------------------------------------------------------------------- |
| `utility_id`       | string  | yes      | EIA Utility ID (5-digit numeric)                                             |
| `mw_requirement`   | number  | no       | Requested load in MW (e.g. 200)                                             |
| `target_isd`       | string  | no       | Target in-service date, ISO 8601 (e.g. 2027-06-01)                         |
| `interconnection_voltage_kv` | number | no | Preferred voltage level in kV (e.g. 345)                                   |
| `use_case`         | string  | no       | `hyperscale_campus` \| `colocation` \| `edge` \| `enterprise`               |
| `phasing_willing`  | boolean | no       | Whether caller will accept phased delivery                                 |
| `weight_overrides` | object  | no       | Per-dimension weights (0.0–2.0). Keys: dimension IDs. Default 1.0.          |
| `force_refresh`    | boolean | no       | Bypass cache, re-run full pipeline                                         |
| `staleness_threshold_days` | number | no | Flag scores older than this (default 180)                                  |

### 1.3 Utility Identifier Resolution

The canonical identifier is the **EIA Utility Number** (from EIA-861). The `urs_lookup` tool accepts:

| Input format         | Example                   | Resolution method                                                             |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| EIA Utility ID       | `6452`                    | Direct lookup                                                                 |
| Utility name (fuzzy) | `"Duke Energy Carolinas"` | String match against EIA-861 utility name list; return top match + confidence |
| FERC respondent ID   | `FERC:54`                 | Crosswalk table (EIA-861 ↔ FERC)                                              |
| HIFLD utility ID     | `HIFLD:14354`             | Crosswalk table (EIA-861 ↔ HIFLD)                                             |

If resolution is ambiguous, the tool returns a `resolution` block with candidates. The agent asks the user to disambiguate before proceeding.

---

## 2. Scoring Dimensions

Eight dimensions. Each is scored independently on a 0–100 integer scale where 100 represents maximum responsiveness. Scores are always accompanied by a confidence level.

### 2.1 Large-Load Tariff Flexibility (`large_load_tariff`)

**What it measures:** Whether the utility offers (or has historically negotiated) tariff structures specifically designed for large-load customers — economic development riders, interruptible service agreements, custom rate schedules, contract demand provisions — vs. forcing datacenter loads through standard commercial/industrial rate classes.

**Scoring heuristics:**

- Has a filed and approved large-load or economic development tariff → high score
- Has negotiated special contracts (visible in rate case filings) → high score
- Only standard C&I rate classes, no evidence of flexibility → low score
- Active rate case proposing new large-load provisions → moderate score with upward trajectory flag

**Primary data sources:**

- State PUC/PSC tariff databases (utility-specific tariff books filed with state commission)
- FERC Form 1 (Schedule 304 — large customers and special contracts)
- Rate case docket filings from state commission electronic filing systems (e.g. NC Utilities Commission e-filing, PUC of Texas interchange)

### 2.2 Interconnection Study Speed (`interconnection_speed`)

**What it measures:** Historical pace at which the utility completes system impact studies and facilities studies for large-load interconnection requests. Not the FERC generator interconnection queue — this is about load-side interconnection, which is utility-administered and largely opaque.

**Scoring heuristics:**

- Median study completion time < 6 months → high score
- Median study completion time 6–18 months → moderate score
- Median study completion time > 18 months or no visible data → low score
- Evidence of "fast-track" or parallel study processes for qualified loads → bonus

**Primary data sources:**

- Utility-published interconnection procedures and timelines (usually posted on utility website under "Builders & Developers" or "Economic Development" pages)
- State PUC dockets where interconnection delays were contested
- FERC Form 715 (transmission planning data, filed annually)
- Direct observation from site selector interviews (encoded as structured expert assessments — see §4)

### 2.3 IRP Alignment with Large Load Growth (`irp_alignment`)

**What it measures:** Whether the utility's most recent Integrated Resource Plan acknowledges, plans for, or actively seeks large-load growth (datacenter, industrial, manufacturing) — vs. treating it as a threat to system reliability or a cost-shifting concern.

**Scoring heuristics:**

- IRP contains explicit load growth scenarios for datacenter/industrial loads → high score
- IRP mentions large load as a planning variable but without dedicated scenarios → moderate score
- IRP is silent on large load growth or frames it primarily as a reliability risk → low score
- IRP proposes new generation or transmission specifically to serve anticipated large loads → high score

**Primary data sources:**

- State-filed IRP documents (text — requires LLM extraction; see §4)
- IRP stakeholder comments and commission orders (state PUC docket systems)
- Utility investor presentations and 10-K filings (SEC EDGAR) — often more candid about load growth appetite than regulatory filings

### 2.4 Regulatory and Political Environment (`regulatory_environment`)

**What it measures:** How the state-level regulatory structure enables or constrains utility responsiveness. A utility may be willing but regulatorily unable. Factors: regulated vs. deregulated market structure, commission attitudes toward large-load incentives, legislative actions (e.g. Virginia's data center tax exemptions), and commission precedent on special contracts.

**Scoring heuristics:**

- State has explicit datacenter incentive legislation → high score
- Commission has approved special large-load contracts without prolonged proceedings → high score
- Commission has rejected or heavily conditioned large-load proposals → low score
- Deregulated market with competitive retail choice → scored differently (retail choice partially bypasses utility behavior)

**Primary data sources:**

- State legislature bill tracking (LegiScan or state-specific legislative databases)
- State PUC docket decisions on large-load applications
- DSIRE (Database of State Incentives for Renewables & Efficiency) — covers some economic development incentives
- NCSL and EIA state electricity profiles

### 2.5 Utility Leadership Posture (`leadership_posture`)

**What it measures:** Public and semi-public signals from utility C-suite and board about appetite for large-load customers. Some utility CEOs actively court hyperscalers; others view them as system-stress liabilities. This dimension captures the human element that structured data misses.

**Scoring heuristics:**

- CEO/COO public statements welcoming datacenter development → high score
- Utility has dedicated "large customer" or "economic development" team with named contacts → high score
- Utility leadership publicly expressed concern about large-load impact on residential rates → low score
- No visible leadership engagement on large-load topic → moderate-low score (absence is signal)

**Primary data sources:**

- Earnings call transcripts (SEC EDGAR, Seeking Alpha)
- Utility press releases and newsroom
- Trade press coverage (Utility Dive, T&D World, RTO Insider)
- Conference presentations (DistribuTECH, EEI, Infocast)
- Requires LLM extraction — see §4

### 2.6 Grid Capacity and Headroom Posture (`grid_headroom`)

**What it measures:** Not absolute MW available (the caller already has that), but the utility's **posture** toward capacity constraints. Does the utility treat constrained areas as a hard no, or does it proactively propose transmission upgrades, phased interconnection, or creative delivery solutions? A utility with 50 MW of headroom that offers to build 200 MW of new capacity scores higher than one with 500 MW of headroom that refuses to engage.

**Scoring heuristics:**

- Utility has proposed or built speculative transmission to attract load → high score
- Utility offers phased delivery or interim solutions while upgrades are built → high score
- Utility cites capacity constraints and declines to engage → low score
- Utility has published hosting capacity maps or large-load availability tools → moderate-high score

**Primary data sources:**

- FERC Form 715 and OASIS postings (transmission availability)
- Utility-published hosting capacity maps
- Transmission planning documents from RTOs/ISOs (where applicable)
- State PUC transmission planning dockets

### 2.7 Track Record with Prior Large-Load Customers (`track_record`)

**What it measures:** Concrete history of serving large-load customers. Utilities that have successfully onboarded 100+ MW loads have organizational muscle memory. Utilities encountering their first large-load request will be slower regardless of willingness.

**Scoring heuristics:**

- Has served multiple 50+ MW customers → high score
- Has served at least one large-load customer but limited history → moderate score
- No known large-load customers in territory → low score
- Known customer complaints or public disputes about large-load service → negative adjustment

**Primary data sources:**

- FERC Form 1, Schedule 304 (large customers)
- EIA-861 (large customer counts and sales data by utility)
- Public announcements of datacenter developments in utility territory
- State PUC dockets (complaints, service quality proceedings)

### 2.8 Sustainability and Clean Energy Accommodation (`clean_energy_posture`)

**What it measures:** Most hyperscalers require 24/7 carbon-free energy or at minimum renewable PPAs. This dimension scores how readily the utility accommodates these requirements — green tariff availability, willingness to enable behind-the-meter or sleeved PPAs, participation in clean energy programs.

**Scoring heuristics:**

- Has an approved green tariff or renewable direct-access program → high score
- Allows sleeved PPAs or behind-the-meter generation → high score
- Blocks third-party PPAs and offers no green tariff alternative → low score
- Has announced but not yet implemented clean energy programs → moderate score

**Primary data sources:**

- State PUC tariff books (green rider / renewable energy tariff filings)
- Clean Energy Buyers Alliance (CEBA) deal tracker
- Utility sustainability reports and SEC climate disclosures
- RPS/CES compliance filings

---

## 3. Score Aggregation

### 3.1 Composite Score Calculation

Each dimension produces a raw score \(s_i \in [0, 100]\) and a confidence \(c_i \in [0, 1]\).

The composite score is a weighted average:

\[
S = \frac{\sum*{i=1}^{8} w_i \cdot s_i \cdot c_i}{\sum*{i=1}^{8} w_i \cdot c_i}
\]

Where \(w_i\) is the weight for dimension \(i\). Default weights are all 1.0. The user can override weights via the `weight_overrides` parameter in `urs_score` (see §1.2). Weighting by confidence ensures that low-confidence dimensions do not dominate the composite.

### 3.2 Default Weight Rationale

All dimensions default to equal weight (1.0) because the relative importance of each depends on the user's specific situation. A user with a 36-month timeline cares less about `interconnection_speed` than one trying to be online in 18 months. A user with no clean energy mandate may zero out `clean_energy_posture`.

The agent does not prescribe "correct" weights. It provides the building blocks and can suggest weight adjustments based on stated priorities.

### 3.3 Composite Confidence

Composite confidence is the weighted average of per-dimension confidences:

\[
C = \frac{\sum*{i=1}^{8} w_i \cdot c_i}{\sum*{i=1}^{8} w_i}
\]

### 3.4 Score Bucketing

For display and feature-layer symbology, the composite maps to a tier:

| Composite score | Tier | Label                     |
| --------------- | ---- | ------------------------- |
| 80–100          | 1    | Highly responsive         |
| 60–79           | 2    | Moderately responsive     |
| 40–59           | 3    | Mixed signals             |
| 20–39           | 4    | Likely slow               |
| 0–19            | 5    | Structurally unresponsive |

---

## 4. LLM Enrichment Layer

The LLM is not a scoring engine. It is a structured data extraction engine and a narrative generation engine. It does not assign scores — the scoring logic described in §2 is deterministic and runs in application code. The LLM operates at two points in the pipeline.

### 4.1 Stage 1: Source Ingestion and Structured Extraction

**Input:** Unstructured text from IRP documents, rate case testimony, earnings call transcripts, news articles, utility press releases, regulatory orders.

**Task:** Extract structured signals that feed the scoring heuristics. Specifically:

| Extraction target                   | Source type                          | Output structure                                                                                                                                       |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Large-load tariff mentions          | Rate case testimony, tariff filings  | `{ has_large_load_tariff: bool, tariff_name: str, filing_date: date, terms_summary: str }`                                                             |
| Interconnection timeline references | PUC dockets, utility procedures      | `{ stated_timeline_months: number, fast_track_available: bool, conditions: str }`                                                                      |
| IRP load growth language            | IRP narrative chapters               | `{ acknowledges_datacenter_growth: bool, has_dedicated_scenario: bool, tone: 'positive' \| 'neutral' \| 'cautious' \| 'negative', key_quotes: str[] }` |
| Leadership statements               | Earnings calls, press, conferences   | `{ speaker: str, date: date, sentiment: 'positive' \| 'neutral' \| 'negative', quote: str, context: str }`                                             |
| Clean energy program details        | Tariff books, sustainability reports | `{ program_name: str, type: 'green_tariff' \| 'ppa_enabled' \| 'btm_allowed', status: 'approved' \| 'proposed' \| 'rejected', restrictions: str }`     |

**LLM configuration:**

- Model: Claude 3.5 Sonnet or equivalent (sufficient for extraction; reasoning models are unnecessary overhead here)
- Temperature: 0 for extraction tasks
- Each extraction prompt includes the source document (or relevant section) and a JSON schema for the expected output
- Extraction results are stored in a structured database and versioned by source document date

**Guardrails:**

- Every LLM extraction output is tagged with `source_document_id`, `extraction_date`, and `model_version`
- Extraction outputs that fail JSON schema validation are flagged for human review
- No extraction output is used in scoring without source provenance

### 4.2 Stage 2: Rationale Generation

**Input:** The completed scorecard (all 8 dimension scores, the composite, source citations).

**Task:** Generate a human-readable narrative (2–4 paragraphs) explaining why the utility received its score. The rationale must:

1. Reference specific evidence (tariff names, IRP sections, leadership quotes)
2. Call out the dimensions that most influenced the composite
3. Note any dimensions with low confidence and explain why
4. If caller-provided context (MW, timeline) affected the interpretation, explain how

**LLM configuration:**

- Model: Claude 3.5 Sonnet or equivalent
- Temperature: 0.3 (allow slight fluency variation but not creative departures)
- System prompt enforces factual grounding: "Do not state anything not directly supported by the scored evidence. If evidence is thin, say so."

**Output:** Plain text rationale stored in the response object's `rationale` field.

### 4.3 Where the LLM Does NOT Operate

- The LLM does not assign dimension scores. Scoring is deterministic from structured extraction outputs.
- The LLM does not decide dimension weights.
- The LLM does not interpolate missing data. If a data source is unavailable, the dimension confidence drops; the LLM does not hallucinate a substitute.

---

## 5. Output Schema

### 5.1 Score Response (Internal Structure)

The `urs_score` tool returns a structured scorecard. The agent presents this conversationally to the user. The internal structure:

```json
{
  "utility_id": "6452",
  "utility_name": "Duke Energy Carolinas, LLC",
  "state": "NC",
  "resolution": {
    "method": "eia_direct",
    "confidence": 1.0,
    "alternatives": []
  },
  "composite_score": 72,
  "composite_confidence": 0.81,
  "tier": 2,
  "tier_label": "Moderately responsive",
  "dimensions": [
    {
      "id": "large_load_tariff",
      "label": "Large-Load Tariff Flexibility",
      "score": 85,
      "confidence": 0.9,
      "weight_applied": 1.5,
      "evidence_summary": "Approved Large General Service (LGS) and Optional Power Service (OPS) tariffs with demand ratchet provisions. Economic development rider (Rider ED) available for qualifying loads >5 MW.",
      "sources": [
        {
          "type": "tariff_filing",
          "title": "NCUC Docket E-7 Sub 1276 — Duke Energy Carolinas Tariff Book",
          "date": "2025-09-14",
          "url": "https://starw1.ncuc.gov/NCUC/ViewFile.aspx?Id=..."
        }
      ],
      "data_freshness": "2025-09-14",
      "stale": false
    }
  ],
  "rationale": "Duke Energy Carolinas scores in the 'Moderately responsive' tier, driven by strong tariff flexibility and a clear track record of serving large loads in the Charlotte metro area. The utility's Economic Development Rider (Rider ED) provides negotiable demand charges for qualified loads above 5 MW, and FERC Form 1 data shows three customers in the 50–150 MW range as of the most recent filing. However, interconnection study timelines remain a concern: contested dockets in 2024 revealed 14–18 month study completion times for facilities-level reviews, placing the utility in the moderate range on that dimension. The most recent IRP (2024 filing) includes a 'high electrification' scenario that models datacenter load growth but does not propose dedicated transmission to serve it. Confidence is moderate (0.81) due to limited public data on actual negotiated contract terms, which are filed under seal.",
  "context_applied": {
    "mw_requirement": 200,
    "target_isd": "2027-06-01",
    "notes": "200 MW requirement against a 2027 target date is aggressive for this utility's historical study timelines. Phased delivery (if acceptable) would improve feasibility."
  },
  "scored_at": "2026-03-15T14:22:00Z",
  "model_version": "urs-1.2.0",
  "data_vintage": {
    "oldest_source": "2024-01-15",
    "newest_source": "2025-09-14",
    "staleness_flags": ["interconnection_speed"]
  }
}
```

### 5.2 ArcGIS Feature Service Attribute Mapping

The output schema maps to an ArcGIS feature layer where each feature is a utility service territory polygon (sourced from HIFLD or EIA-861 territory shapefiles). The feature attributes are a flattened projection of the score response.

| Feature attribute | Type         | Source field                                      |
| ----------------- | ------------ | ------------------------------------------------- |
| `UTILITY_ID`      | String(10)   | `utility_id`                                      |
| `UTILITY_NAME`    | String(255)  | `utility_name`                                    |
| `STATE`           | String(2)    | `state`                                           |
| `URS_COMPOSITE`   | SmallInteger | `composite_score`                                 |
| `URS_CONFIDENCE`  | Float        | `composite_confidence`                            |
| `URS_TIER`        | SmallInteger | `tier`                                            |
| `URS_TIER_LABEL`  | String(50)   | `tier_label`                                      |
| `DIM_TARIFF`      | SmallInteger | `dimensions[large_load_tariff].score`             |
| `DIM_INTERCON`    | SmallInteger | `dimensions[interconnection_speed].score`         |
| `DIM_IRP`         | SmallInteger | `dimensions[irp_alignment].score`                 |
| `DIM_REGULATORY`  | SmallInteger | `dimensions[regulatory_environment].score`        |
| `DIM_LEADERSHIP`  | SmallInteger | `dimensions[leadership_posture].score`            |
| `DIM_HEADROOM`    | SmallInteger | `dimensions[grid_headroom].score`                 |
| `DIM_TRACK`       | SmallInteger | `dimensions[track_record].score`                  |
| `DIM_CLEAN`       | SmallInteger | `dimensions[clean_energy_posture].score`          |
| `URS_RATIONALE`   | String(4000) | `rationale` (truncated to fit ArcGIS field limit) |
| `URS_SCORED_AT`   | Date         | `scored_at`                                       |
| `URS_DATA_OLDEST` | Date         | `data_vintage.oldest_source`                      |
| `URS_DATA_NEWEST` | Date         | `data_vintage.newest_source`                      |
| `URS_STALE_FLAGS` | String(500)  | `data_vintage.staleness_flags` (comma-separated)  |
| `URS_MODEL_VER`   | String(20)   | `model_version`                                   |

The feature layer is updated via the ArcGIS REST API (`applyEdits`) when scores are computed or refreshed. The layer supports `where` clause filtering (e.g. `URS_TIER <= 2 AND STATE = 'VA'`) for downstream map applications.

**Symbology:** Tier-based graduated color scheme on utility territory polygons. Tier 1 = dark green, Tier 2 = light green, Tier 3 = yellow, Tier 4 = orange, Tier 5 = red. Polygon borders follow HIFLD service territory boundaries.

---

## 6. Data Pipeline — Stage-by-Stage

```
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 0: Source Acquisition                                        │
│  Scheduled crawlers pull documents from EIA, FERC, state PUCs,    │
│  SEC EDGAR, trade press. Store raw documents in blob storage       │
│  with metadata (utility_id, source_type, retrieval_date).          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 1: LLM Extraction (§4.1)                                     │
│  For each new/updated document, run extraction prompts.            │
│  Output: structured JSON signals stored in scoring database.       │
│  Tag each extraction with source_doc_id, model_version, date.      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 2: Structured Data Merge                                     │
│  Merge LLM-extracted signals with direct structured sources        │
│  (EIA-861 tables, FERC Form 1 CSVs, OASIS data).                  │
│  Resolve conflicts: structured source wins over LLM extraction     │
│  when both cover the same fact.                                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 3: Dimension Scoring                                         │
│  Apply heuristic rules (§2) to merged data.                        │
│  Deterministic: same inputs always produce same scores.            │
│  Output: 8 dimension scores + 8 confidence values.                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 4: Composite Aggregation (§3)                                │
│  Apply caller weights (or defaults).                               │
│  Compute composite score and confidence.                           │
│  Assign tier.                                                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 5: Rationale Generation (§4.2)                               │
│  LLM generates narrative from scorecard + evidence.                │
│  Output: rationale text with source citations.                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 6: Response Assembly & Feature Layer Write                   │
│  Assemble full response object (§5.1).                             │
│  Write flattened attributes to ArcGIS feature service (§5.2).     │
│  Cache response for repeat requests within staleness window.       │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.1 Execution Modes

**On-demand (agent request):** When the user asks to score a utility, the agent calls `urs_score`. The system checks the cache. If a cached score exists and all dimension data is within the staleness threshold, return the cached score. Otherwise, run stages 3–6 against the most recent extracted data. Stages 0–2 run asynchronously and are not triggered per-request.

**Batch refresh:** A scheduled job (daily or weekly) can run stages 0–2 for all tracked utilities. When new source documents are acquired, affected utilities are flagged for re-scoring. Stage 3–6 re-run for flagged utilities and update the feature layer.

**Manual override:** The user can request "re-score Duke with fresh data" — the agent calls `urs_score` with `force_refresh: true`, bypassing the cache and re-running stages 1–6.

---

## 7. Data Freshness and Staleness Model

### 7.1 Source Freshness Tracking

Every data source used in scoring is tracked with:

```json
{
  "source_id": "ncuc-e7-sub-1276",
  "utility_id": "6452",
  "source_type": "rate_case_filing",
  "dimensions_affected": ["large_load_tariff", "regulatory_environment"],
  "document_date": "2025-09-14",
  "retrieval_date": "2025-10-01",
  "next_expected_update": "2026-09-01",
  "superseded_by": null
}
```

### 7.2 Staleness Triggers

A dimension score becomes stale when any of the following occur:

| Trigger                                     | Detection method                                        | Affected dimensions                              |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| New IRP filed                               | Monitor state PUC docket RSS/API for IRP docket numbers | `irp_alignment`, `grid_headroom`                 |
| Rate case opened or closed                  | Monitor state PUC docket activity                       | `large_load_tariff`, `regulatory_environment`    |
| Utility leadership change                   | News monitoring (LLM-flagged from trade press crawl)    | `leadership_posture`                             |
| New interconnection study results published | FERC e-filing and utility website crawl                 | `interconnection_speed`, `grid_headroom`         |
| State legislation enacted                   | LegiScan alerts for energy/utility/datacenter bills     | `regulatory_environment`, `clean_energy_posture` |
| Calendar-based expiration                   | Source age exceeds `max_age` for source type            | All dimensions using that source                 |

### 7.3 Maximum Source Age by Type

| Source type              | Max age before stale | Rationale                                                            |
| ------------------------ | -------------------- | -------------------------------------------------------------------- |
| Tariff filing            | 365 days             | Tariffs are typically stable but rate cases can change them          |
| IRP                      | 730 days (2 years)   | IRPs are filed on 2–3 year cycles                                    |
| Rate case order          | 365 days             | Rate cases settle in 6–18 months; a year-old order is still relevant |
| Earnings call transcript | 180 days             | Leadership tone shifts quarterly                                     |
| News/press               | 90 days              | Short shelf life for sentiment signals                               |
| EIA-861 data             | 365 days             | Annual publication                                                   |
| FERC Form 1              | 365 days             | Annual publication                                                   |

### 7.4 Staleness in the Response

The response includes a `data_vintage` object (see §5.1) listing the oldest and newest source dates and any dimensions currently flagged as stale. The user can set `staleness_threshold_days` in the `urs_score` call to control what counts as stale for their purposes.

When a score is returned with stale dimensions, the response includes a top-level `"stale": true` flag and the rationale text opens with a staleness caveat.

---

## 8. Pi Extension — Tool Interface

URS is implemented as a pi extension (`.pi/extensions/urs/`) that registers six tools. The URS skill (`.pi/skills/urs/SKILL.md`) provides domain knowledge so the agent knows when and how to use them.

### 8.1 `urs_score` — Score a Utility

Primary tool. Parameters: `utility_id` (required), `mw_requirement`, `target_isd`, `use_case`, `weight_overrides`, `force_refresh`, `staleness_threshold_days`. Returns full scorecard (see §5.1).

### 8.2 `urs_lookup` — Resolve a Utility

Parameters: `query` (EIA ID, utility name, or prefixed ID). Returns utility metadata or ranked candidates if ambiguous.

### 8.3 `urs_ingest` — Ingest Source Document

Parameters: `file_path`, `source_type`, `utility_id`, `document_date`. Runs LLM extraction, stores signals in DB. Returns extraction summary.

### 8.4 `urs_history` — Score History

Parameters: `utility_id`, `since` (optional ISO 8601). Returns historical scores for trend visualization.

### 8.5 `urs_sources` — List Data Sources

Parameters: `utility_id`, `dimension`, `stale_only` (all optional). Returns sources used in scoring with freshness status.

### 8.6 `urs_arcgis_sync` — Sync to ArcGIS Feature Layer

Parameters: `utility_ids` (optional; omit to sync all). Pushes current scores to the ArcGIS feature service for map visualization.

### 8.7 Conversational UX Advantages

The agent interface enables behaviors a REST API cannot:

- **Disambiguation:** When `urs_lookup` returns multiple candidates (e.g. "Duke Energy Carolinas" vs "Duke Energy Indiana"), the agent asks the user to clarify.
- **Contextual explanation:** The agent can highlight dimensions most relevant to the user's stated MW, timeline, or use case.
- **Guided exploration:** "Which utilities in Virginia score highest for interconnection speed?" — agent can iterate lookups and scores.
- **Weight suggestions:** Based on "I need to be online in 18 months," the agent can suggest boosting `interconnection_speed` weight.
- **Dimension questions:** "What dimensions do you score on?" answered from skill knowledge without a tool call.

---

## 9. Key Limitations and Failure Modes

### 9.1 The Private Negotiation Problem

The most important dimension — actual willingness to negotiate flexible terms — is inherently opaque. Filed tariffs show what a utility offers publicly. Negotiated special contracts are often filed under seal or in confidential docket attachments. The score reflects the **visible** surface area of responsiveness, which may undercount utilities that negotiate aggressively but privately.

**Mitigation:** The confidence score on `large_load_tariff` and `track_record` will be lower when no special contracts are visible. The rationale text will note the absence. The agent can explain this limitation when presenting scores. Over time, expert input (site selector interviews → structured assessments) can supplement public data, but this creates a dependency on non-automated sources.

### 9.2 State-Level Confounding

A utility operating in a hostile regulatory environment may score low on `regulatory_environment` and `large_load_tariff` even if the utility itself is willing. The score conflates utility behavior with state-level constraints. A caller comparing Duke Energy Carolinas (NC) to Duke Energy Indiana (IN) might see different scores for entities under the same holding company, reflecting regulatory differences rather than corporate posture.

**Mitigation:** The `regulatory_environment` dimension is explicitly separate from utility-specific dimensions. Users who want to isolate utility behavior can zero-weight it via `weight_overrides`. The rationale text should distinguish regulatory constraint from utility reluctance.

### 9.3 Small and Municipal Utility Blindness

The scoring model works best for large IOUs (investor-owned utilities) that have extensive public filings. Municipal utilities, cooperatives, and public power entities file less with FERC and state PUCs, and often have no IRP requirement. For these entities, multiple dimensions will have low confidence or missing data.

**Mitigation:** The composite confidence score will be low, and the response will include a `coverage_warning` field:

```json
{
  "coverage_warning": "Municipal utility — limited public filing data. Dimensions irp_alignment, large_load_tariff, and leadership_posture are scored with <0.3 confidence."
}
```

### 9.4 LLM Extraction Errors

The LLM extraction layer (§4.1) can misinterpret tariff language, miss relevant IRP sections, or incorrectly classify leadership sentiment. Extraction errors propagate to dimension scores.

**Mitigation:**

- Schema validation catches structural errors
- High-stakes extractions (tariff terms, interconnection timelines) are spot-checked by analysts on a sampling basis
- Extraction outputs include `extraction_confidence` and the raw source passage, enabling downstream audit
- The system logs extraction model version; if a model update degrades quality, rollback is possible

### 9.5 Temporal Lag

Utility behavior changes when a new CEO is appointed, when a rate case settles, or when a state passes new legislation. The scoring system is reactive: it detects these events through its crawlers and re-scores, but there is inherent lag between the event and the score update. During this window, the score is wrong.

**Mitigation:** The staleness model (§7) is the primary defense. High-impact events (leadership change, major rate case closure) trigger alerts for manual review and expedited re-scoring. The `scored_at` timestamp and `data_vintage` fields let the user assess recency. The agent should mention staleness when presenting scores.

### 9.6 Circular Scoring Risk

If URS scores become widely used, they could influence utility behavior (utilities may perform responsiveness to improve their score). This is arguably a positive externality — but it means historical scores may not predict future behavior if the utility is gaming the metric rather than genuinely changing.

**Mitigation:** No technical mitigation. Acknowledge in documentation. Monitor for utilities whose scores improve without corresponding evidence changes.

### 9.7 Score Precision is False Precision

An integer score on a 0–100 scale implies more precision than the underlying data supports. The difference between a 67 and a 72 is not meaningful. The tier system (§3.4) is the appropriate level of granularity for most decisions.

**Mitigation:** The score response returns both the numeric score (for sorting and comparison) and the tier (for decision-making). The agent should discourage over-indexing on small score differences when presenting results. Consider adding a `score_range` field (e.g. `[65, 78]`) representing the plausible range given confidence levels.

### 9.8 Geographic Mismatch

A utility's service territory is not uniform. Duke Energy Carolinas may be highly responsive to a datacenter in the Charlotte area (existing transmission, substations, precedent) and unresponsive to one in a rural part of their territory with no transmission headroom. URS scores at the utility level, not the substation level.

**Mitigation:** The `urs_score` parameters (`mw_requirement`, `interconnection_voltage_kv`) allow the user to specify load and voltage, which adjusts the score commentary. Future versions could accept lat/lon and intersect against known transmission infrastructure. For now, the rationale text should note geographic variability where evidence supports it.

---

## Appendix A: EIA Utility ID Coverage

EIA-861 covers approximately 3,300 utilities in the US. URS targets the ~200 investor-owned utilities that serve the vast majority of US load and are the most likely counterparties for datacenter interconnection. Municipal and cooperative utilities are scored where data is available but with reduced confidence.

## Appendix B: Data Source Summary

| Source            | URL / Access                                                                         | Update frequency                 | Structured?         | Dimensions fed                                   |
| ----------------- | ------------------------------------------------------------------------------------ | -------------------------------- | ------------------- | ------------------------------------------------ |
| EIA-861           | eia.gov/electricity/data/eia861                                                      | Annual (March)                   | Yes                 | `track_record`                                   |
| FERC Form 1       | ferc.gov/industries-data/electric/general-information/electric-industry-forms/form-1 | Annual (April)                   | Yes                 | `track_record`, `large_load_tariff`              |
| FERC Form 715     | ferc.gov                                                                             | Annual                           | Yes                 | `interconnection_speed`, `grid_headroom`         |
| State PUC dockets | Varies by state (50 systems)                                                         | Ongoing                          | No (LLM extraction) | All dimensions                                   |
| SEC EDGAR         | sec.gov/cgi-bin/browse-edgar                                                         | Quarterly (10-Q) / Annual (10-K) | Partially           | `leadership_posture`, `irp_alignment`            |
| LegiScan          | legiscan.com/api                                                                     | Ongoing                          | Yes                 | `regulatory_environment`                         |
| DSIRE             | dsireusa.org                                                                         | Ongoing                          | Yes                 | `regulatory_environment`, `clean_energy_posture` |
| CEBA Deal Tracker | cebuyers.org                                                                         | Quarterly                        | Partially           | `clean_energy_posture`                           |
| Utility Dive      | utilitydive.com                                                                      | Daily                            | No (LLM extraction) | `leadership_posture`                             |
| OASIS             | Various RTO/ISO nodes                                                                | Ongoing                          | Yes                 | `grid_headroom`                                  |
| HIFLD             | hifld-geoplatform.opendata.arcgis.com                                                | Periodic                         | Yes (GIS)           | Territory polygons                               |
