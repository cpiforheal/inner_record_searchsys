import { Router } from 'express';
import { getDB } from '../db/connection.js';

const router = Router();

router.get('/overview', (req, res) => {
  const db = getDB();
  const total = db.prepare('SELECT COUNT(*) as c FROM medical_record_index').get().c;
  const borrowed = db.prepare("SELECT COUNT(*) as c FROM medical_record_index WHERE archive_status='借出'").get().c;
  const overdue = db.prepare("SELECT COUNT(*) as c FROM borrow_logs WHERE returned_at IS NULL AND due_at < datetime('now','localtime')").get().c;
  const pending = db.prepare("SELECT COUNT(*) as c FROM medical_record_index WHERE archive_status='归还待核对'").get().c;
  const missingInfo = db.prepare("SELECT COUNT(*) as c FROM record_tags WHERE tag='缺失占位'").get().c;
  const overflow = db.prepare("SELECT COUNT(*) as c FROM medical_record_index WHERE location_id != '__POOL__' AND book_index > 25").get().c;
  const locations = db.prepare('SELECT COUNT(*) as c FROM archive_locations').get().c;

  res.json({ total, borrowed, overdue, pending, missingInfo, overflow, available: total - borrowed - pending, locations });
});

router.get('/cabinet/:cabinetNo', (req, res) => {
  const db = getDB();
  const no = +req.params.cabinetNo;

  const rows = db.prepare(`
    SELECT l.id as location_id, l.row_no, l.stack_no, l.year_month,
      COUNT(r.id) as record_count,
      SUM(CASE WHEN r.archive_status='借出' THEN 1 ELSE 0 END) as borrowed,
      SUM(CASE WHEN r.archive_status='归还待核对' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN t.record_id IS NOT NULL THEN 1 ELSE 0 END) as missing_info_count,
      SUM(CASE WHEN r.book_index > 25 THEN 1 ELSE 0 END) as overflow_count,
      (
        SELECT COALESCE(SUM(name_count), 0)
        FROM (
          SELECT COUNT(*) as name_count
          FROM medical_record_index dr
          WHERE dr.location_id = l.id AND TRIM(COALESCE(dr.patient_name, '')) != ''
          GROUP BY TRIM(dr.patient_name)
          HAVING COUNT(*) > 1
        )
      ) as duplicate_name_count
    FROM archive_locations l
    LEFT JOIN medical_record_index r ON r.location_id = l.id
    LEFT JOIN record_tags t ON t.record_id = r.id AND t.tag = '缺失占位'
    WHERE l.cabinet_no = ?
    GROUP BY l.id
    ORDER BY l.row_no, l.stack_no
  `).all(no);

  res.json(rows);
});

router.get('/issues', (req, res) => {
  const db = getDB();
  const { limit = 20 } = req.query;
  const rows = db.prepare(`
    SELECT r.id, r.patient_name, r.inpatient_no, r.location_id, r.book_index, r.archive_status, r.discharge_date,
      l.cabinet_no, l.row_no, l.stack_no, l.year_month,
      i.issue_type, i.description as issue_desc, i.risk_level, i.found_at, i.status as issue_status
    FROM medical_record_index r
    JOIN archive_locations l ON r.location_id = l.id
    LEFT JOIN record_issues i ON i.record_id = r.id AND i.status != '已关闭'
    WHERE r.archive_status IN ('归还待核对', '逾期未还', '遗失待查')
    ORDER BY r.updated_at DESC
    LIMIT ?
  `).all(+limit);
  res.json(rows);
});

router.get('/audit-logs', (req, res) => {
  const db = getDB();
  const { limit = 50 } = req.query;
  const rows = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`).all(+limit);
  res.json(rows);
});

export default router;
