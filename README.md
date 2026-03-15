# Utility Responsiveness Scoring (URS)

**SemiAnalysis x Fluidstack Hackathon** — *Power to Prefill, Dirt to Decode, Transformers to Transformers: A Full-Stack AI Infrastructure Hackathon*

URS addresses the **utility behavior** constraint for datacenter siting: which utilities negotiate creatively on large-load tariffs, which run every customer through standard interconnection processes, and which have internal champions vs. institutional resistance to large load.

- **[Slides](slides/)** — [PDF](slides/utility-responsiveness-score.pdf) | [PowerPoint](slides/utility-responsiveness-score.pptx)
- **[Technical Specification](SPECIFICATION.md)** — Full spec including scoring dimensions, data pipeline, and tool interface

---

## Quick Start

URS is a [pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) extension. Install pi and run from this directory:

```bash
npm install -g @mariozechner/pi-coding-agent
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

Then ask:

- "Score Duke Energy Carolinas"
- "Compare utilities in Virginia"
- "How responsive is Dominion for 200MW?"

**Setup:** Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`. For ArcGIS sync and pull, set `ARCGIS_API_KEY` and `ARCGIS_FEATURE_SERVICE_URL`. For `urs_fetch_eia`, set `EIA_API_KEY` (free at eia.gov/opendata). For `urs_fetch_legiscan`, set `LEGISCAN_API_KEY` (free at legiscan.com).

**Tools:** `urs_score`, `urs_lookup`, `urs_ingest`, `urs_history`, `urs_sources`, `urs_fetch_edgar`, `urs_fetch_pudl`, `urs_fetch_eia`, `urs_fetch_legiscan`, `urs_fetch_hifld`, `urs_import_eia`, `urs_arcgis_sync`, `urs_arcgis_pull`

---

## EIA-861 Data

To populate the utilities database beyond the seed (~3,300 US utilities):

1. Go to [EIA-861 detailed data files](https://www.eia.gov/electricity/data/eia861/)
2. Download the ZIP for the desired year (e.g. [f8612024.zip](https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip) for 2024)
3. Extract the ZIP and locate the Utility file (e.g. `Utility.csv` or `Utility_Data.csv` — naming varies by year)
4. If the file is Excel (`.xlsx`), export or save it as CSV
5. Import via pi: ask "Import EIA-861 from `./path/to/Utility.csv`" or use the `urs_import_eia` tool with `file_path` pointing to the CSV

The import expects columns `Utility_Number`, `Utility_Name`, and `State` (or common aliases). Optional: `Entity_Type`, `FERC_ID`, `HIFLD_ID`.

---

## License

MIT
