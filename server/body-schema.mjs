/** Weekly body-composition readings (bioimpedance scale). Separate file so db.mjs can create it without an import cycle. */
export const BODY_SCHEMA = `
CREATE TABLE IF NOT EXISTS body_comp (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight REAL,
  fat_pct REAL,
  skeletal_kg REAL,
  muscle_kg REAL,
  lean_kg REAL,
  water_kg REAL,
  protein_kg REAL,
  bone_kg REAL,
  visceral REAL,
  bmr REAL,
  impedance TEXT,
  standard INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  manual_cols TEXT,
  source TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);
`;
