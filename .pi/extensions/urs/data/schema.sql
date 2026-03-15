-- URS SQLite schema

-- Utilities (EIA-861 crosswalk)
CREATE TABLE IF NOT EXISTS utilities (
  utility_id TEXT PRIMARY KEY,
  utility_name TEXT NOT NULL,
  state TEXT NOT NULL,
  ferc_id TEXT,
  hifld_id TEXT,
  holding_company TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_utilities_name ON utilities(utility_name);
CREATE INDEX IF NOT EXISTS idx_utilities_state ON utilities(state);
CREATE INDEX IF NOT EXISTS idx_utilities_ferc ON utilities(ferc_id);
CREATE INDEX IF NOT EXISTS idx_utilities_hifld ON utilities(hifld_id);

-- Source documents
CREATE TABLE IF NOT EXISTS sources (
  source_id TEXT PRIMARY KEY,
  utility_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  document_date TEXT,
  retrieval_date TEXT DEFAULT (date('now')),
  file_path TEXT,
  dimensions_affected TEXT,
  max_age_days INTEGER,
  next_expected_update TEXT,
  superseded_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (utility_id) REFERENCES utilities(utility_id)
);

CREATE INDEX IF NOT EXISTS idx_sources_utility ON sources(utility_id);
CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(source_type);
CREATE INDEX IF NOT EXISTS idx_sources_date ON sources(document_date);

-- Extracted signals (LLM output)
CREATE TABLE IF NOT EXISTS signals (
  signal_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  extraction_target TEXT NOT NULL,
  payload TEXT NOT NULL,
  extraction_date TEXT DEFAULT (datetime('now')),
  model_version TEXT,
  extraction_confidence REAL,
  FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(source_id);
CREATE INDEX IF NOT EXISTS idx_signals_target ON signals(extraction_target);

-- Score history
CREATE TABLE IF NOT EXISTS scores (
  score_id TEXT PRIMARY KEY,
  utility_id TEXT NOT NULL,
  scored_at TEXT DEFAULT (datetime('now')),
  model_version TEXT NOT NULL,
  composite_score INTEGER NOT NULL,
  composite_confidence REAL NOT NULL,
  tier INTEGER NOT NULL,
  dimension_scores TEXT NOT NULL,
  rationale TEXT,
  context_applied TEXT,
  data_vintage TEXT,
  coverage_warning TEXT,
  FOREIGN KEY (utility_id) REFERENCES utilities(utility_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_utility ON scores(utility_id);
CREATE INDEX IF NOT EXISTS idx_scores_scored_at ON scores(scored_at);
