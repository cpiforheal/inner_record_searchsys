import { Router } from 'express';
import { getDB } from '../db/connection.js';

const router = Router();
const MISSING_INFO_TAG = '缺失占位';
const MAX_BOOKS_PER_STACK = 25;

function buildRecordStatus(record) {
  if (!record) return 'empty';
  if (Number(record.book_index) > MAX_BOOKS_PER_STACK) return 'overflow';
  if (record.has_missing_info) return 'missing_info';
  if (record.archive_status === '借出') return 'borrowed';
  if (record.open_issue_count > 0 || record.archive_status === '归还待核对') return 'issue';
  return 'ok';
}

router.get('/location/:locationId/checklist', (req, res) => {
  const db = getDB();
  const { locationId } = req.params;
  const location = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(locationId);
  if (!location) return res.status(404).json({ message: '位置不存在' });

  const rows = db.prepare(`
    SELECT r.*,
      EXISTS(SELECT 1 FROM record_tags t WHERE t.record_id = r.id AND t.tag = ?) as has_missing_info,
      (r.location_id != '__POOL__' AND r.book_index > ?) as has_overflow,
      (SELECT COUNT(*) FROM record_issues i WHERE i.record_id = r.id AND i.status != '已关闭') as open_issue_count,
      (SELECT borrower FROM borrow_logs b WHERE b.record_id = r.id AND b.returned_at IS NULL ORDER BY b.borrowed_at DESC LIMIT 1) as active_borrower
    FROM medical_record_index r
    WHERE r.location_id = ?
    ORDER BY r.book_index
  `).all(MISSING_INFO_TAG, MAX_BOOKS_PER_STACK, locationId);

  const byIndex = new Map(rows.map(record => [Number(record.book_index), record]));
  const cells = Array.from({ length: MAX_BOOKS_PER_STACK }, (_, i) => {
    const bookIndex = i + 1;
    const record = byIndex.get(bookIndex) || null;
    return {
      book_index: bookIndex,
      status: buildRecordStatus(record),
      record,
    };
  });
  const overflowCells = rows
    .filter(record => Number(record.book_index) > MAX_BOOKS_PER_STACK)
    .map(record => ({
      book_index: Number(record.book_index),
      status: buildRecordStatus(record),
      record,
    }));

  const summary = [...cells, ...overflowCells].reduce((acc, cell) => {
    acc[cell.status] = (acc[cell.status] || 0) + 1;
    return acc;
  }, { empty: 0, ok: 0, missing_info: 0, borrowed: 0, issue: 0, overflow: 0 });

  res.json({ location, cells, overflow_cells: overflowCells, summary });
});

router.post('/location/:locationId/confirm', (req, res) => {
  const db = getDB();
  const { locationId } = req.params;
  const { checked_by, note } = req.body || {};

  const location = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(locationId);
  if (!location) return res.status(404).json({ message: '位置不存在' });

  const records = db.prepare(`
    SELECT r.*,
      EXISTS(SELECT 1 FROM record_tags t WHERE t.record_id = r.id AND t.tag = ?) as has_missing_info,
      (r.location_id != '__POOL__' AND r.book_index > ?) as has_overflow,
      (SELECT COUNT(*) FROM record_issues i WHERE i.record_id = r.id AND i.status != '已关闭') as open_issue_count
    FROM medical_record_index r
    WHERE r.location_id = ?
    ORDER BY r.book_index
  `).all(MISSING_INFO_TAG, MAX_BOOKS_PER_STACK, locationId);

  const op = db.transaction(() => {
    const batch = db.prepare(`
      INSERT INTO inspection_batches
        (batch_name, inspection_type, inspection_unit, inspection_date, status, owner, note)
      VALUES (?, '摞位归档检查', ?, datetime('now','localtime'), '已完成', ?, ?)
    `).run(`${locationId} 归档检查`, locationId, checked_by || '操作员', note || null);

    for (const record of records) {
      const status = buildRecordStatus(record);
      const result = status === 'ok' ? '正常' : status === 'missing_info' ? '占位待补' : status === 'overflow' ? '超容量' : status === 'borrowed' ? '借出' : '待核对';
      db.prepare(`
        INSERT INTO inspection_records (batch_id, record_id, result, issue_summary, rectification_status, note)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        batch.lastInsertRowid,
        record.id,
        result,
        status === 'ok' ? null : `第${record.book_index}本：${result}`,
        status === 'ok' ? '无需处理' : '待处理',
        note || null
      );
    }

    db.prepare(`
      UPDATE medical_record_index
      SET last_checked_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
      WHERE location_id = ?
    `).run(locationId);

    db.prepare(`
      INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
      VALUES (?, 'CONFIRM_LOCATION_INSPECTION', 'location', ?, ?)
    `).run(checked_by || '操作员', locationId, `完成摞位归档检查，共 ${records.length} 份病历${note ? `；${note}` : ''}`);

    return batch.lastInsertRowid;
  });

  const batchId = op();
  res.status(201).json({ id: batchId, message: `已完成 ${locationId} 归档检查`, checked_records: records.length });
});

export default router;
