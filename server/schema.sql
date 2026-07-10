PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dictionaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(category, code)
);

CREATE TABLE IF NOT EXISTS archive_locations (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL DEFAULT 'R01',
  cabinet_no INTEGER NOT NULL,
  row_no INTEGER NOT NULL,
  stack_no INTEGER NOT NULL,
  year_month TEXT,
  label_text TEXT,
  capacity_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_loc_cabinet ON archive_locations(cabinet_no);

CREATE TABLE IF NOT EXISTS medical_record_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_name TEXT NOT NULL,
  name_initials TEXT,
  inpatient_no TEXT NOT NULL UNIQUE,
  discharge_date TEXT,
  location_id TEXT NOT NULL REFERENCES archive_locations(id),
  book_index INTEGER,
  archive_status TEXT NOT NULL DEFAULT '在架'
    CHECK (archive_status IN ('在架','借出','逾期未还','归还待核对','遗失待查')),
  risk_status TEXT DEFAULT '正常'
    CHECK (risk_status IN ('正常','低风险','中风险','高风险','待核对')),
  last_checked_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_record_name ON medical_record_index(patient_name);
CREATE INDEX IF NOT EXISTS idx_record_initials ON medical_record_index(name_initials);
CREATE INDEX IF NOT EXISTS idx_record_inpatient_no ON medical_record_index(inpatient_no);
CREATE INDEX IF NOT EXISTS idx_record_location ON medical_record_index(location_id);
CREATE INDEX IF NOT EXISTS idx_record_status ON medical_record_index(archive_status);

CREATE TABLE IF NOT EXISTS borrow_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES medical_record_index(id),
  borrower TEXT NOT NULL,
  department TEXT,
  purpose TEXT,
  borrowed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  due_at TEXT,
  returned_at TEXT,
  borrow_handled_by TEXT,
  return_handled_by TEXT,
  return_condition TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_borrow_record ON borrow_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_borrow_returned ON borrow_logs(returned_at);

CREATE TABLE IF NOT EXISTS record_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES medical_record_index(id),
  issue_type TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT '待核对',
  description TEXT,
  status TEXT NOT NULL DEFAULT '待处理',
  found_by TEXT,
  found_at TEXT DEFAULT (datetime('now','localtime')),
  responsible_department TEXT,
  due_at TEXT,
  rectification_note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_issue_record ON record_issues(record_id);
CREATE INDEX IF NOT EXISTS idx_issue_status ON record_issues(status);

CREATE TABLE IF NOT EXISTS inspection_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_name TEXT NOT NULL,
  inspection_type TEXT,
  inspection_unit TEXT,
  inspection_date TEXT,
  requirement TEXT,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT '进行中',
  owner TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inspection_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES inspection_batches(id),
  record_id INTEGER NOT NULL REFERENCES medical_record_index(id),
  result TEXT,
  issue_summary TEXT,
  rectification_status TEXT DEFAULT '待处理',
  note TEXT
);

CREATE TABLE IF NOT EXISTS record_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES medical_record_index(id),
  tag TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(record_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_tag_record ON record_tags(record_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT '系统',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
