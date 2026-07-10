PRAGMA foreign_keys = ON;

CREATE TABLE archive_locations (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL DEFAULT 'R01',
  cabinet_no INTEGER NOT NULL,
  row_no INTEGER NOT NULL,
  stack_no INTEGER NOT NULL,
  year_month TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE medical_record_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_name TEXT NOT NULL,
  name_initials TEXT,
  inpatient_no TEXT NOT NULL UNIQUE,
  discharge_date TEXT,
  location_id TEXT NOT NULL REFERENCES archive_locations(id),
  book_index INTEGER,
  status TEXT NOT NULL CHECK (status IN ('在架', '借出', '待核对', '遗失待查')),
  created_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_record_patient_name ON medical_record_index(patient_name);
CREATE INDEX idx_record_inpatient_no ON medical_record_index(inpatient_no);
CREATE INDEX idx_record_location ON medical_record_index(location_id);

CREATE TABLE borrow_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inpatient_no TEXT NOT NULL REFERENCES medical_record_index(inpatient_no),
  borrower TEXT NOT NULL,
  department TEXT,
  purpose TEXT,
  borrowed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at TEXT,
  returned_at TEXT,
  handled_by TEXT
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
