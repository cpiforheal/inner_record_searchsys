import { Router } from 'express';
import { getDB } from '../db/connection.js';

const router = Router();
const POOL_LOCATION_ID = '__POOL__';
const MAX_BOOKS_PER_STACK = 25;
const MAX_OVERFLOW_BOOK_INDEX = 99;
const OVERFLOW_TAG = '超容量';

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function normalizeIndex(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_OVERFLOW_BOOK_INDEX ? n : null;
}

function syncOverflowTag(db, recordId, locationId, bookIndex) {
  if (locationId !== POOL_LOCATION_ID && Number(bookIndex) > MAX_BOOKS_PER_STACK) {
    db.prepare(`INSERT OR IGNORE INTO record_tags (record_id, tag, created_by) VALUES (?, ?, '操作员')`)
      .run(recordId, OVERFLOW_TAG);
    return;
  }
  db.prepare('DELETE FROM record_tags WHERE record_id = ? AND tag = ?')
    .run(recordId, OVERFLOW_TAG);
}

function getLocationOr404(db, locationId, res) {
  if (locationId === POOL_LOCATION_ID) {
    res.status(400).json({ message: '暂存池不支持此修复动作' });
    return null;
  }
  const location = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(locationId);
  if (!location) {
    res.status(404).json({ message: '位置不存在' });
    return null;
  }
  return location;
}

function moveThroughTemp(db, records, targetIndexOf, locationId) {
  for (const record of records) {
    db.prepare(`
      UPDATE medical_record_index
      SET book_index = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(-(2000 + record.id), record.id);
  }
  for (const record of records) {
    const nextIndex = targetIndexOf(record);
    db.prepare(`
      UPDATE medical_record_index
      SET book_index = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(nextIndex, record.id);
    syncOverflowTag(db, record.id, locationId, nextIndex);
  }
}

router.post('/location/:locationId/swap', (req, res) => {
  const db = getDB();
  const { locationId } = req.params;
  const leftIndex = normalizeIndex(req.body?.left_index);
  const rightIndex = normalizeIndex(req.body?.right_index);
  if (!getLocationOr404(db, locationId, res)) return;
  if (!leftIndex || !rightIndex || leftIndex === rightIndex) return res.status(400).json({ message: `请输入两个不同的 1-${MAX_OVERFLOW_BOOK_INDEX} 本号` });

  const records = db.prepare(`
    SELECT id, patient_name, inpatient_no, book_index
    FROM medical_record_index
    WHERE location_id = ? AND book_index IN (?, ?)
    ORDER BY book_index
  `).all(locationId, leftIndex, rightIndex);
  if (records.length === 0) return res.status(400).json({ message: '两个本号均为空，无法交换' });

  const op = db.transaction(() => {
    moveThroughTemp(db, records, record => Number(record.book_index) === leftIndex ? rightIndex : leftIndex, locationId);
    db.prepare(`
      INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
      VALUES ('操作员', 'REPAIR_SWAP_BOOK_INDEX', 'location', ?, ?)
    `).run(locationId, `交换/移动第${leftIndex}本与第${rightIndex}本，共 ${records.length} 份`);
  });
  op();

  res.json({ message: `已处理第 ${leftIndex} 本与第 ${rightIndex} 本`, moved: records.length });
});

router.post('/location/:locationId/compact', (req, res) => {
  const db = getDB();
  const { locationId } = req.params;
  const startIndex = normalizeIndex(req.body?.start_index || 1);
  if (!getLocationOr404(db, locationId, res)) return;
  if (!startIndex) return res.status(400).json({ message: `起始本号必须在 1-${MAX_OVERFLOW_BOOK_INDEX} 之间` });

  const records = db.prepare(`
    SELECT id, patient_name, inpatient_no, book_index
    FROM medical_record_index
    WHERE location_id = ? AND book_index >= ?
    ORDER BY book_index
  `).all(locationId, startIndex);
  if (records.length === 0) return res.status(400).json({ message: '该范围内没有可压缩的病历' });

  const changes = records.filter((record, i) => Number(record.book_index) !== startIndex + i);
  if (changes.length === 0) return res.json({ message: '当前范围已经连续，无需压缩', moved: 0 });

  const op = db.transaction(() => {
    moveThroughTemp(db, records, record => startIndex + records.findIndex(r => r.id === record.id), locationId);
    db.prepare(`
      INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
      VALUES ('操作员', 'REPAIR_COMPACT_BOOK_INDEX', 'location', ?, ?)
    `).run(locationId, `从第${startIndex}本开始压缩空位，移动 ${changes.length} 份`);
  });
  op();

  res.json({ message: `已从第 ${startIndex} 本开始压缩空位`, moved: changes.length });
});

router.post('/location/:locationId/rollback-range', (req, res) => {
  const db = getDB();
  const { locationId } = req.params;
  const startIndex = normalizeIndex(req.body?.start_index);
  const endIndex = normalizeIndex(req.body?.end_index);
  if (!getLocationOr404(db, locationId, res)) return;
  if (!startIndex || !endIndex || endIndex < startIndex) return res.status(400).json({ message: '请输入正确的起止本号' });

  const records = db.prepare(`
    SELECT id, patient_name, inpatient_no, book_index
    FROM medical_record_index
    WHERE location_id = ? AND book_index BETWEEN ? AND ?
    ORDER BY book_index
  `).all(locationId, startIndex, endIndex);
  if (records.length === 0) return res.status(400).json({ message: '该范围内没有可退回的病历' });

  const ids = records.map(record => record.id);
  const op = db.transaction(() => {
    db.prepare(`
      UPDATE medical_record_index
      SET location_id = ?, book_index = 0, updated_at = datetime('now','localtime')
      WHERE id IN (${placeholders(ids)})
    `).run(POOL_LOCATION_ID, ...ids);
    db.prepare(`
      DELETE FROM record_tags
      WHERE tag = ? AND record_id IN (${placeholders(ids)})
    `).run(OVERFLOW_TAG, ...ids);
    db.prepare(`
      INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
      VALUES ('操作员', 'REPAIR_ROLLBACK_RANGE', 'location', ?, ?)
    `).run(locationId, `第${startIndex}-${endIndex}本退回暂存池，共 ${records.length} 份`);
  });
  op();

  res.json({ message: `已退回暂存池 ${records.length} 份`, moved: records.length, record_ids: ids });
});

export default router;
