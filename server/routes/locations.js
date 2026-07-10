import { Router } from 'express';
import { getDB } from '../db/connection.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();
  const { cabinet_no } = req.query;
  let rows;
  if (cabinet_no) {
    rows = db.prepare('SELECT * FROM archive_locations WHERE cabinet_no = ? ORDER BY row_no, stack_no').all(cabinet_no);
  } else {
    rows = db.prepare('SELECT * FROM archive_locations ORDER BY cabinet_no, row_no, stack_no').all();
  }
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const row = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ message: '位置不存在' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { id, cabinet_no, row_no, stack_no, year_month, label_text } = req.body;
  if (!id || !cabinet_no || !row_no || !stack_no) {
    return res.status(400).json({ message: '缺少必填字段' });
  }
  db.prepare(`INSERT INTO archive_locations (id, cabinet_no, row_no, stack_no, year_month, label_text) VALUES (?,?,?,?,?,?)`)
    .run(id, cabinet_no, row_no, stack_no, year_month || null, label_text || null);
  res.status(201).json({ id });
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ message: '位置不存在' });
  const { year_month, label_text } = req.body;
  db.prepare(`UPDATE archive_locations SET year_month=?, label_text=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(year_month ?? existing.year_month, label_text ?? existing.label_text, req.params.id);
  res.json({ message: '更新成功' });
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ message: '位置不存在' });
  const hasRecords = db.prepare('SELECT COUNT(*) as c FROM medical_record_index WHERE location_id = ?').get(req.params.id).c;
  if (hasRecords > 0) return res.status(400).json({ message: `该位置下有 ${hasRecords} 份病历，不能删除` });
  db.prepare('DELETE FROM archive_locations WHERE id = ?').run(req.params.id);
  res.json({ message: '删除成功' });
});

router.post('/batch', (req, res) => {
  const db = getDB();
  const { cabinet_no, rows, stacks_per_row } = req.body;
  if (!cabinet_no || !rows || !stacks_per_row) return res.status(400).json({ message: '缺少参数' });

  const pad = (v) => String(v).padStart(2, '0');
  const cabCode = `C${pad(cabinet_no)}`;
  let created = 0;

  const op = db.transaction(() => {
    for (let r = 1; r <= rows; r++) {
      for (let s = 1; s <= stacks_per_row; s++) {
        const id = `${cabCode}-R${pad(r)}-P${pad(s)}`;
        const exists = db.prepare('SELECT id FROM archive_locations WHERE id = ?').get(id);
        if (!exists) {
          db.prepare(`INSERT INTO archive_locations (id, cabinet_no, row_no, stack_no) VALUES (?,?,?,?)`).run(id, cabinet_no, r, s);
          created++;
        }
      }
    }
  });
  op();
  res.status(201).json({ message: `创建了 ${created} 个位置`, created });
});

router.post('/extend-row', (req, res) => {
  const db = getDB();
  const cabinetNo = Number(req.body.cabinet_no);
  const rowNo = Number(req.body.row_no);
  const stackTo = Number(req.body.stack_to);

  if (!Number.isInteger(cabinetNo) || cabinetNo < 1 || cabinetNo > 99) {
    return res.status(400).json({ message: '架号必须在 1-99 之间' });
  }
  if (!Number.isInteger(rowNo) || rowNo < 1 || rowNo > 50) {
    return res.status(400).json({ message: '排号必须在 1-50 之间' });
  }
  if (!Number.isInteger(stackTo) || stackTo < 1 || stackTo > 200) {
    return res.status(400).json({ message: '摞号必须在 1-200 之间' });
  }

  const pad = (v) => String(v).padStart(2, '0');
  const cabCode = `C${pad(cabinetNo)}`;
  const existingRows = db.prepare(
    'SELECT stack_no FROM archive_locations WHERE cabinet_no = ? AND row_no = ?'
  ).all(cabinetNo, rowNo);
  const existingStacks = new Set(existingRows.map(row => Number(row.stack_no)));
  const missingStacks = [];
  for (let stackNo = 1; stackNo <= stackTo; stackNo++) {
    if (!existingStacks.has(stackNo)) missingStacks.push(stackNo);
  }

  const insert = db.prepare(
    'INSERT INTO archive_locations (id, cabinet_no, row_no, stack_no) VALUES (?,?,?,?)'
  );
  const op = db.transaction(() => {
    for (const stackNo of missingStacks) {
      insert.run(`${cabCode}-R${pad(rowNo)}-P${pad(stackNo)}`, cabinetNo, rowNo, stackNo);
    }
  });
  op();

  res.status(201).json({
    message: `已补充 ${missingStacks.length} 个摞位`,
    created: missingStacks.length,
    cabinet_no: cabinetNo,
    row_no: rowNo,
    stack_to: stackTo,
  });
});

router.delete('/cabinet/:cabinetNo', (req, res) => {
  const db = getDB();
  const no = +req.params.cabinetNo;
  const hasRecords = db.prepare('SELECT COUNT(*) as c FROM medical_record_index r JOIN archive_locations l ON r.location_id = l.id WHERE l.cabinet_no = ?').get(no).c;
  if (hasRecords > 0) return res.status(400).json({ message: `该柜下有 ${hasRecords} 份病历，不能删除` });
  db.prepare('DELETE FROM archive_locations WHERE cabinet_no = ?').run(no);
  res.json({ message: '柜子已删除' });
});

export default router;
