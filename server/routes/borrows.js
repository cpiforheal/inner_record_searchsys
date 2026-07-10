import { Router } from 'express';
import { getDB } from '../db/connection.js';

const router = Router();

router.post('/', (req, res) => {
  const db = getDB();
  const { record_id, borrower, department, purpose, due_at, handled_by } = req.body;
  if (!record_id || !borrower) return res.status(400).json({ message: '病历ID和借阅人为必填' });

  const borrow = db.transaction(() => {
    const record = db.prepare('SELECT * FROM medical_record_index WHERE id = ?').get(record_id);
    if (!record) throw { status: 404, message: '病历不存在' };
    if (record.archive_status === '借出') throw { status: 400, message: '该病历已借出' };

    const result = db.prepare(`
      INSERT INTO borrow_logs (record_id, borrower, department, purpose, due_at, borrow_handled_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(record_id, borrower, department || null, purpose || null, due_at || null, handled_by || null);

    db.prepare(`UPDATE medical_record_index SET archive_status='借出', updated_at=datetime('now','localtime') WHERE id=?`).run(record_id);

    return result.lastInsertRowid;
  });

  try {
    const id = borrow();
    res.status(201).json({ id, message: '借出成功' });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message || '借出失败' });
  }
});

router.put('/:id/return', (req, res) => {
  const db = getDB();
  const { return_handled_by, return_condition, note } = req.body;

  const returnOp = db.transaction(() => {
    const log = db.prepare('SELECT * FROM borrow_logs WHERE id = ?').get(req.params.id);
    if (!log) throw { status: 404, message: '借阅记录不存在' };
    if (log.returned_at) throw { status: 400, message: '已归还' };

    db.prepare(`UPDATE borrow_logs SET returned_at=datetime('now','localtime'), return_handled_by=?, return_condition=?, note=? WHERE id=?`)
      .run(return_handled_by || null, return_condition || null, note || null, req.params.id);

    db.prepare(`UPDATE medical_record_index SET archive_status='在架', updated_at=datetime('now','localtime') WHERE id=?`).run(log.record_id);
  });

  try {
    returnOp();
    res.json({ message: '归还成功' });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message || '归还失败' });
  }
});

router.get('/', (req, res) => {
  const db = getDB();
  const { status, record_id } = req.query;

  if (record_id) {
    const rows = db.prepare('SELECT * FROM borrow_logs WHERE record_id = ? ORDER BY created_at DESC').all(record_id);
    return res.json(rows);
  }

  if (status === 'active') {
    const rows = db.prepare(`SELECT b.*, r.patient_name, r.inpatient_no, r.location_id
      FROM borrow_logs b JOIN medical_record_index r ON b.record_id = r.id
      WHERE b.returned_at IS NULL ORDER BY b.borrowed_at DESC`).all();
    return res.json(rows);
  }

  if (status === 'overdue') {
    const rows = db.prepare(`SELECT b.*, r.patient_name, r.inpatient_no, r.location_id
      FROM borrow_logs b JOIN medical_record_index r ON b.record_id = r.id
      WHERE b.returned_at IS NULL AND b.due_at < datetime('now','localtime')
      ORDER BY b.due_at`).all();
    return res.json(rows);
  }

  const rows = db.prepare('SELECT * FROM borrow_logs ORDER BY created_at DESC LIMIT 50').all();
  res.json(rows);
});

router.post('/batch', (req, res) => {
  const db = getDB();
  const { record_ids, names, date_from, date_to, borrower, department, purpose } = req.body;
  if (!borrower) return res.status(400).json({ message: '借阅人为必填' });

  let targetRecords = [];

  if (record_ids && record_ids.length > 0) {
    const placeholders = record_ids.map(() => '?').join(',');
    targetRecords = db.prepare(`SELECT * FROM medical_record_index WHERE id IN (${placeholders}) AND archive_status = '在架'`).all(...record_ids);
  } else if (names && names.length > 0) {
    const placeholders = names.map(() => '?').join(',');
    targetRecords = db.prepare(`SELECT * FROM medical_record_index WHERE patient_name IN (${placeholders}) AND archive_status = '在架'`).all(...names);
  } else if (date_from && date_to) {
    targetRecords = db.prepare(`SELECT * FROM medical_record_index WHERE discharge_date >= ? AND discharge_date <= ? AND archive_status = '在架'`).all(date_from, date_to);
  } else if (date_from) {
    targetRecords = db.prepare(`SELECT * FROM medical_record_index WHERE discharge_date >= ? AND archive_status = '在架'`).all(date_from);
  } else {
    return res.status(400).json({ message: '请提供 record_ids、names 或日期范围' });
  }

  if (targetRecords.length === 0) return res.json({ message: '未找到符合条件的在架病历', borrowed: 0 });

  const op = db.transaction(() => {
    for (const record of targetRecords) {
      db.prepare(`INSERT INTO borrow_logs (record_id, borrower, department, purpose) VALUES (?, ?, ?, ?)`)
        .run(record.id, borrower, department || null, purpose || null);
      db.prepare(`UPDATE medical_record_index SET archive_status='借出', updated_at=datetime('now','localtime') WHERE id=?`)
        .run(record.id);
    }
  });
  op();
  res.json({ message: `批量借出 ${targetRecords.length} 份`, borrowed: targetRecords.length, records: targetRecords.map(r => ({ id: r.id, patient_name: r.patient_name, inpatient_no: r.inpatient_no })) });
});

router.post('/batch-return', (req, res) => {
  const db = getDB();
  const { record_ids } = req.body;
  if (!record_ids || !record_ids.length) return res.status(400).json({ message: '请提供要归还的病历ID列表' });

  const op = db.transaction(() => {
    for (const rid of record_ids) {
      const log = db.prepare(`SELECT id FROM borrow_logs WHERE record_id = ? AND returned_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(rid);
      if (log) {
        db.prepare(`UPDATE borrow_logs SET returned_at=datetime('now','localtime') WHERE id=?`).run(log.id);
      }
      db.prepare(`UPDATE medical_record_index SET archive_status='在架', updated_at=datetime('now','localtime') WHERE id=? AND archive_status='借出'`).run(rid);
    }
  });
  op();
  res.json({ message: `批量归还 ${record_ids.length} 份` });
});

export default router;
