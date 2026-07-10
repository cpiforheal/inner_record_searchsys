import { Router } from 'express';
import { getDB } from '../db/connection.js';
import { pinyin } from 'pinyin-pro';

const router = Router();
const MISSING_INFO_TAG = '缺失占位';
const OVERFLOW_TAG = '超容量';
const POOL_LOCATION_ID = '__POOL__';
const MAX_BOOKS_PER_STACK = 25;
const MAX_OVERFLOW_BOOK_INDEX = 99;
const TEMP_INPATIENT_PREFIX = 'TEMP-MISSING-';

function getInitials(name) {
  return pinyin(name, { pattern: 'first', toneType: 'none' }).replace(/\s/g, '').toUpperCase();
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function formatLocationCode(locationId, bookIndex) {
  if (locationId === POOL_LOCATION_ID) return '暂存';
  const match = String(locationId || '').match(/^C(\d+)-R(\d+)-P(\d+)$/i);
  if (!match) return locationId || '';
  const cabNo = Number(match[1]) || 0;
  const rowNo = Number(match[2]) || 0;
  const stackNo = Number(match[3]) || 0;
  const book = String(bookIndex || 0).padStart(2, '0');
  if (cabNo <= 9 && rowNo <= 9 && stackNo <= 9) return `${cabNo}${rowNo}${stackNo}${book}`;
  return `C${String(cabNo).padStart(2, '0')}-R${String(rowNo).padStart(2, '0')}-P${String(stackNo).padStart(2, '0')}-${book}`;
}

function summarizeRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    patient_name: record.patient_name,
    inpatient_no: record.inpatient_no,
    location_id: record.location_id,
    book_index: record.book_index,
    has_missing_info: record.has_missing_info,
    has_overflow: record.has_overflow,
  };
}

function parseLocationCode(input) {
  const raw = String(input || '').trim();
  const locationMatch = raw.match(/^C(\d+)-R(\d+)-P(\d+)(?:[-\s#:]?(\d{1,3}))?$/i);
  let cabNo;
  let rowNo;
  let stackNo;
  let bookIndex;

  if (locationMatch) {
    cabNo = Number(locationMatch[1]);
    rowNo = Number(locationMatch[2]);
    stackNo = Number(locationMatch[3]);
    bookIndex = locationMatch[4] ? Number(locationMatch[4]) : null;
  } else {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 4) {
      cabNo = Number(digits[0]);
      rowNo = Number(digits[1]);
      stackNo = Number(digits[2]);
      bookIndex = Number(digits[3]);
    } else if (digits.length >= 5 && digits.length <= 6) {
      cabNo = Number(digits[0]);
      rowNo = Number(digits[1]);
      stackNo = Number(digits[2]);
      bookIndex = Number(digits.slice(3));
    } else {
      return null;
    }
  }

  if (!Number.isInteger(cabNo) || !Number.isInteger(rowNo) || !Number.isInteger(stackNo)) return null;
  if (cabNo < 1 || rowNo < 1 || stackNo < 1) return null;
  if (bookIndex !== null && (!Number.isInteger(bookIndex) || bookIndex < 1 || bookIndex > MAX_OVERFLOW_BOOK_INDEX)) return null;

  const locationId = `C${String(cabNo).padStart(2, '0')}-R${String(rowNo).padStart(2, '0')}-P${String(stackNo).padStart(2, '0')}`;
  return {
    location_id: locationId,
    cabinet_no: cabNo,
    row_no: rowNo,
    stack_no: stackNo,
    book_index: bookIndex,
    position_code: bookIndex ? formatLocationCode(locationId, bookIndex) : locationId,
  };
}

function classifyPoolRecord(record) {
  const latestText = `${record.latest_action || ''} ${record.latest_audit_detail || ''}`;
  if (record.has_missing_info) return { key: 'missing_info', label: '信息缺失占位' };
  if (/冲突|重复|退回|ROLLBACK|CONFLICT/i.test(latestText)) return { key: 'conflict_rollback', label: '冲突回滚' };
  if ((record.open_issue_count || 0) > 0 || record.risk_status === '待核对' || !['在架', '借出'].includes(record.archive_status)) {
    return { key: 'pending_issue', label: '待核对' };
  }
  return { key: 'manual_pending', label: '待人工定位' };
}

function getPositionRecord(db, locationId, bookIndex, excludedIds = []) {
  const excluded = excludedIds.map(Number).filter(Number.isFinite);
  const excludedSql = excluded.length ? `AND id NOT IN (${placeholders(excluded)})` : '';
  return db.prepare(`
    SELECT * FROM medical_record_index
    WHERE location_id = ? AND book_index = ? ${excludedSql}
    LIMIT 1
  `).get(locationId, bookIndex, ...excluded);
}

function findAvailableRange(db, locationId, count, excludedIds = []) {
  const excluded = excludedIds.map(Number).filter(Number.isFinite);
  const excludedSql = excluded.length ? `AND id NOT IN (${placeholders(excluded)})` : '';
  const occupiedRows = db.prepare(`
    SELECT book_index FROM medical_record_index
    WHERE location_id = ? AND book_index IS NOT NULL ${excludedSql}
  `).all(locationId, ...excluded);
  const occupied = new Set(occupiedRows.map(row => row.book_index));

  for (let start = 1; start <= MAX_BOOKS_PER_STACK - count + 1; start++) {
    let available = true;
    for (let offset = 0; offset < count; offset++) {
      if (occupied.has(start + offset)) {
        available = false;
        break;
      }
    }
    if (available) return start;
  }
  return null;
}

function isOverflowIndex(bookIndex) {
  return Number(bookIndex) > MAX_BOOKS_PER_STACK;
}

function findNextOverflowIndex(db, locationId, excludedIds = []) {
  const excluded = excludedIds.map(Number).filter(Number.isFinite);
  const excludedSql = excluded.length ? `AND id NOT IN (${placeholders(excluded)})` : '';
  const row = db.prepare(`
    SELECT COALESCE(MAX(book_index), ?) as max_index
    FROM medical_record_index
    WHERE location_id = ? AND book_index IS NOT NULL ${excludedSql}
  `).get(MAX_BOOKS_PER_STACK, locationId, ...excluded);
  return Math.max(MAX_BOOKS_PER_STACK, Number(row.max_index) || MAX_BOOKS_PER_STACK) + 1;
}

function syncOverflowTag(db, recordId, locationId, bookIndex, createdBy = '系统') {
  if (locationId !== POOL_LOCATION_ID && isOverflowIndex(bookIndex)) {
    db.prepare(`INSERT OR IGNORE INTO record_tags (record_id, tag, created_by) VALUES (?, ?, ?)`)
      .run(recordId, OVERFLOW_TAG, createdBy);
    return;
  }
  db.prepare('DELETE FROM record_tags WHERE record_id = ? AND tag = ?')
    .run(recordId, OVERFLOW_TAG);
}

function recordFlagSelect(alias = 'r') {
  return `
    EXISTS(SELECT 1 FROM record_tags t WHERE t.record_id = ${alias}.id AND t.tag = ?) as has_missing_info,
    (${alias}.location_id != '${POOL_LOCATION_ID}' AND ${alias}.book_index > ${MAX_BOOKS_PER_STACK}) as has_overflow
  `;
}

function rollbackRecordsToPool(db, ids, detail = '位置编号冲突，已退回暂存池') {
  const validIds = [...new Set((ids || []).map(Number).filter(Number.isFinite))];
  if (validIds.length === 0) return [];
  db.prepare(`
    UPDATE medical_record_index
    SET location_id = ?, book_index = 0, updated_at = datetime('now','localtime')
    WHERE id IN (${placeholders(validIds)})
  `).run(POOL_LOCATION_ID, ...validIds);
  db.prepare(`
    DELETE FROM record_tags
    WHERE tag = ? AND record_id IN (${placeholders(validIds)})
  `).run(OVERFLOW_TAG, ...validIds);
  db.prepare(`
    INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
    VALUES ('系统', 'ROLLBACK_POSITION_CONFLICT', 'records', ?, ?)
  `).run(validIds.join(','), detail);
  return validIds;
}

function sendPositionConflict(res, conflict, rolledBackIds = []) {
  const code = formatLocationCode(conflict.location_id, conflict.book_index);
  return res.status(409).json({
    code: 'POSITION_CONFLICT',
    message: `位置编号 ${code} 已被其他病历占用，相关病历已退回暂存池`,
    position_code: code,
    location_id: conflict.location_id,
    book_index: conflict.book_index,
    existing_record: summarizeRecord(conflict.existing_record),
    rolled_back_record_ids: rolledBackIds,
  });
}

function isSqliteUniqueError(error) {
  return error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(error?.message || '').includes('UNIQUE');
}

function isTemporaryInpatientNo(value) {
  return String(value || '').startsWith(TEMP_INPATIENT_PREFIX);
}

function makeTemporaryInpatientNo(db) {
  for (let i = 0; i < 20; i++) {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;
    const value = `${TEMP_INPATIENT_PREFIX}${suffix}`;
    const exists = db.prepare('SELECT 1 FROM medical_record_index WHERE inpatient_no = ?').get(value);
    if (!exists) return value;
  }
  throw new Error('临时编号生成失败，请重试');
}

router.get('/pool', (req, res) => {
  const db = getDB();
  const rows = db.prepare(`
    SELECT r.*,
      ${recordFlagSelect('r')}
    FROM medical_record_index r
    WHERE r.location_id = '__POOL__'
    ORDER BY r.created_at DESC
  `).all(MISSING_INFO_TAG);
  res.json({ data: rows, total: rows.length });
});

router.get('/pool/grouped', (req, res) => {
  const db = getDB();
  const rows = db.prepare(`
    SELECT r.*,
      ${recordFlagSelect('r')},
      (SELECT COUNT(*) FROM record_issues i WHERE i.record_id = r.id AND i.status != '已关闭') as open_issue_count,
      (SELECT a.action FROM audit_logs a
        WHERE a.target_id = CAST(r.id AS TEXT)
           OR a.target_id LIKE CAST(r.id AS TEXT) || ',%'
           OR a.target_id LIKE '%,' || CAST(r.id AS TEXT)
           OR a.target_id LIKE '%,' || CAST(r.id AS TEXT) || ',%'
        ORDER BY a.created_at DESC LIMIT 1) as latest_action,
      (SELECT a.detail FROM audit_logs a
        WHERE a.target_id = CAST(r.id AS TEXT)
           OR a.target_id LIKE CAST(r.id AS TEXT) || ',%'
           OR a.target_id LIKE '%,' || CAST(r.id AS TEXT)
           OR a.target_id LIKE '%,' || CAST(r.id AS TEXT) || ',%'
        ORDER BY a.created_at DESC LIMIT 1) as latest_audit_detail
    FROM medical_record_index r
    WHERE r.location_id = ?
    ORDER BY r.created_at DESC
  `).all(MISSING_INFO_TAG, POOL_LOCATION_ID);

  const groups = [
    { key: 'all', label: '全部暂存', count: rows.length, records: rows },
    { key: 'missing_info', label: '信息缺失占位', count: 0, records: [] },
    { key: 'conflict_rollback', label: '冲突回滚', count: 0, records: [] },
    { key: 'pending_issue', label: '待核对', count: 0, records: [] },
    { key: 'manual_pending', label: '待人工定位', count: 0, records: [] },
  ];
  const byKey = new Map(groups.map(group => [group.key, group]));
  rows.forEach(record => {
    const groupInfo = classifyPoolRecord(record);
    const next = { ...record, pool_group: groupInfo.key, pool_group_label: groupInfo.label };
    const group = byKey.get(groupInfo.key);
    if (group) {
      group.records.push(next);
      group.count += 1;
    }
  });
  byKey.get('all').records = rows.map(record => {
    const groupInfo = classifyPoolRecord(record);
    return { ...record, pool_group: groupInfo.key, pool_group_label: groupInfo.label };
  });
  res.json({ groups, total: rows.length });
});

router.put('/pool/assign', (req, res) => {
  const db = getDB();
  const { record_ids, location_id, start_index, allow_overflow, force_overflow } = req.body;
  if (!record_ids || !record_ids.length || !location_id) return res.status(400).json({ message: '缺少参数' });
  const movingIds = [...new Set(record_ids.map(Number).filter(Number.isFinite))];
  if (movingIds.length !== record_ids.length) return res.status(400).json({ message: '病历ID格式不正确' });
  const movingCount = db.prepare(`
    SELECT COUNT(*) as c FROM medical_record_index
    WHERE id IN (${placeholders(movingIds)})
  `).get(...movingIds).c;
  if (movingCount !== movingIds.length) return res.status(404).json({ message: '部分病历不存在' });

  const loc = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(location_id);
  if (!loc) return res.status(404).json({ message: '目标位置不存在' });
  if (location_id === POOL_LOCATION_ID) {
    rollbackRecordsToPool(db, movingIds, '手动退回暂存池');
    return res.json({ message: `已退回暂存池 ${movingIds.length} 份` });
  }

  const explicitStart = start_index !== undefined && start_index !== null && start_index !== '';
  let baseIdx = explicitStart ? Number(start_index) : null;
  if (!baseIdx && allow_overflow && force_overflow) baseIdx = findNextOverflowIndex(db, location_id, movingIds);
  if (!baseIdx) baseIdx = findAvailableRange(db, location_id, movingIds.length, movingIds);
  if (!baseIdx && allow_overflow) baseIdx = findNextOverflowIndex(db, location_id, movingIds);
  if (!Number.isInteger(baseIdx) || baseIdx < 1) return res.status(400).json({ message: '目标起始编号不正确' });
  const endIdx = baseIdx + movingIds.length - 1;
  if (endIdx > MAX_BOOKS_PER_STACK && !allow_overflow) {
    return res.status(400).json({ message: `该摞最多 ${MAX_BOOKS_PER_STACK} 本，本次分配会超出容量` });
  }
  if (endIdx > MAX_OVERFLOW_BOOK_INDEX) {
    return res.status(400).json({ message: `超容量追加最多支持到第 ${MAX_OVERFLOW_BOOK_INDEX} 本` });
  }

  for (let i = 0; i < movingIds.length; i++) {
    const bookIndex = baseIdx + i;
    const existing = getPositionRecord(db, location_id, bookIndex, movingIds);
    if (existing) {
      const rolledBackIds = rollbackRecordsToPool(db, movingIds, `位置编号 ${formatLocationCode(location_id, bookIndex)} 冲突，已退回暂存池`);
      return sendPositionConflict(res, { location_id, book_index: bookIndex, existing_record: existing }, rolledBackIds);
    }
  }

  const op = db.transaction(() => {
    db.prepare(`
      UPDATE medical_record_index
      SET location_id = ?, book_index = 0, updated_at = datetime('now','localtime')
      WHERE id IN (${placeholders(movingIds)})
    `).run(POOL_LOCATION_ID, ...movingIds);
    movingIds.forEach((id, i) => {
      const nextIndex = baseIdx + i;
      db.prepare(`UPDATE medical_record_index SET location_id=?, book_index=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(location_id, nextIndex, id);
      syncOverflowTag(db, id, location_id, nextIndex, '系统');
    });
    if (endIdx > MAX_BOOKS_PER_STACK) {
      db.prepare(`
        INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
        VALUES ('系统', 'ASSIGN_OVERFLOW_RECORDS', 'records', ?, ?)
      `).run(movingIds.join(','), `显式追加到 ${location_id} 第${baseIdx}-${endIdx}本，超出标准25本容量`);
    }
  });
  try {
    op();
    res.json({
      message: `已分配 ${movingIds.length} 份病历到 ${location_id}`,
      location_id,
      assigned: movingIds.map((id, i) => ({
        id,
        location_id,
        book_index: baseIdx + i,
        position_code: formatLocationCode(location_id, baseIdx + i),
      })),
    });
  } catch (e) {
    if (isSqliteUniqueError(e)) {
      const rolledBackIds = rollbackRecordsToPool(db, movingIds, '唯一编号约束冲突，已退回暂存池');
      return sendPositionConflict(res, { location_id, book_index: baseIdx, existing_record: null }, rolledBackIds);
    }
    res.status(500).json({ message: e.message });
  }
});

router.get('/search', (req, res) => {
  const db = getDB();
  const { q, page = 1, size = 20 } = req.query;
  if (!q || !q.trim()) return res.json({ data: [], total: 0 });

  const term = `%${q.trim()}%`;
  const offset = (page - 1) * size;

  const rows = db.prepare(`
    SELECT r.*, l.cabinet_no, l.row_no, l.stack_no, l.year_month, l.label_text,
      ${recordFlagSelect('r')}
    FROM medical_record_index r
    JOIN archive_locations l ON r.location_id = l.id
    WHERE r.patient_name LIKE ?
       OR r.name_initials LIKE ?
       OR r.inpatient_no LIKE ?
       OR r.discharge_date LIKE ?
       OR r.location_id LIKE ?
    ORDER BY r.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(MISSING_INFO_TAG, term, term, term, term, term, +size, offset);

  const countRow = db.prepare(`
    SELECT COUNT(*) as total FROM medical_record_index r
    WHERE r.patient_name LIKE ?
       OR r.name_initials LIKE ?
       OR r.inpatient_no LIKE ?
       OR r.discharge_date LIKE ?
       OR r.location_id LIKE ?
  `).get(term, term, term, term, term);

  res.json({ data: rows, total: countRow.total, page: +page, size: +size });
});

router.get('/location-code/:code', (req, res) => {
  const db = getDB();
  const parsed = parseLocationCode(req.params.code);
  if (!parsed) return res.status(400).json({ message: '编号格式错误，示例：11101 = 第1架第1排第1摞第01本' });

  const location = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(parsed.location_id);
  const record = parsed.book_index ? db.prepare(`
    SELECT r.*,
      EXISTS(SELECT 1 FROM record_tags t WHERE t.record_id = r.id AND t.tag = ?) as has_missing_info
      , (r.location_id != '${POOL_LOCATION_ID}' AND r.book_index > ${MAX_BOOKS_PER_STACK}) as has_overflow
    FROM medical_record_index r
    WHERE r.location_id = ? AND r.book_index = ?
    LIMIT 1
  `).get(MISSING_INFO_TAG, parsed.location_id, parsed.book_index) : null;

  res.json({
    input: req.params.code,
    parsed,
    location: location || null,
    occupied: Boolean(record),
    record: summarizeRecord(record) ? { ...summarizeRecord(record), archive_status: record.archive_status, has_missing_info: record.has_missing_info } : null,
  });
});

router.get('/', (req, res) => {
  const db = getDB();
  const { location_id, page = 1, size = 50 } = req.query;
  const offset = (page - 1) * size;

  if (location_id) {
    const rows = db.prepare(`
    SELECT r.*,
        ${recordFlagSelect('r')}
      FROM medical_record_index r
      WHERE r.location_id = ?
      ORDER BY r.book_index
    `).all(MISSING_INFO_TAG, location_id);
    return res.json({ data: rows, total: rows.length });
  }

  const rows = db.prepare(`
    SELECT r.*,
      ${recordFlagSelect('r')}
    FROM medical_record_index r
    ORDER BY r.id DESC
    LIMIT ? OFFSET ?
  `).all(MISSING_INFO_TAG, +size, offset);
  res.json({ data: rows, page: +page, size: +size });
});

router.put('/location/:locationId/shift', (req, res) => {
  const db = getDB();
  const { locationId } = req.params;
  const { start_index, end_index, direction, release_blocker } = req.body;
  const startIndex = Number(start_index);
  const dir = Number(direction);
  const releaseBlocker = Boolean(release_blocker);

  if (locationId === POOL_LOCATION_ID) return res.status(400).json({ message: '暂存池不支持序号校正' });
  if (!Number.isInteger(startIndex) || startIndex < 1 || startIndex > MAX_OVERFLOW_BOOK_INDEX) {
    return res.status(400).json({ message: `起始编号必须在 1-${MAX_OVERFLOW_BOOK_INDEX} 之间` });
  }
  if (![1, -1].includes(dir)) return res.status(400).json({ message: '移动方向不正确' });

  const loc = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(locationId);
  if (!loc) return res.status(404).json({ message: '目标位置不存在' });

  const maxIndex = db.prepare(`
    SELECT COALESCE(MAX(book_index), 0) as max_index
    FROM medical_record_index
    WHERE location_id = ? AND book_index IS NOT NULL
  `).get(locationId).max_index;
  const endIndex = end_index ? Number(end_index) : maxIndex;
  if (!Number.isInteger(endIndex) || endIndex < startIndex || endIndex > MAX_OVERFLOW_BOOK_INDEX) {
    return res.status(400).json({ message: `结束编号必须在 ${startIndex}-${MAX_OVERFLOW_BOOK_INDEX} 之间` });
  }

  const moving = db.prepare(`
    SELECT id, patient_name, inpatient_no, book_index
    FROM medical_record_index
    WHERE location_id = ? AND book_index BETWEEN ? AND ?
    ORDER BY book_index
  `).all(locationId, startIndex, endIndex);
  if (moving.length === 0) return res.status(400).json({ message: '该范围内没有可校正的病历' });

  const movingIds = moving.map(r => r.id);
  const targetIndexes = moving.map(r => r.book_index + dir);
  const outOfRange = targetIndexes.find(idx => idx < 1 || idx > MAX_OVERFLOW_BOOK_INDEX);
  if (outOfRange) {
    return res.status(400).json({ message: `校正后编号 ${outOfRange} 超出 1-${MAX_OVERFLOW_BOOK_INDEX} 范围` });
  }

  const uniqueTargetIndexes = [...new Set(targetIndexes)];
  const blockers = db.prepare(`
    SELECT *
    FROM medical_record_index
    WHERE location_id = ?
      AND book_index IN (${placeholders(uniqueTargetIndexes)})
      AND id NOT IN (${placeholders(movingIds)})
    ORDER BY book_index
  `).all(locationId, ...uniqueTargetIndexes, ...movingIds);
  if (blockers.length > 0 && !releaseBlocker) {
    const conflict = blockers[0];
    return res.status(409).json({
      code: 'SHIFT_POSITION_BLOCKED',
      message: `目标编号 ${formatLocationCode(locationId, conflict.book_index)} 已被 ${conflict.patient_name} 占用，请先处理该病历或调整校正范围`,
      position_code: formatLocationCode(locationId, conflict.book_index),
      existing_record: summarizeRecord(conflict),
    });
  }

  const op = db.transaction(() => {
    if (blockers.length > 0) {
      rollbackRecordsToPool(
        db,
        blockers.map(record => record.id),
        `序号校正释放目标位置：${blockers.map(record => formatLocationCode(locationId, record.book_index)).join('、')}`
      );
    }
    for (const record of moving) {
      db.prepare(`
        UPDATE medical_record_index
        SET book_index = ?, updated_at = datetime('now','localtime')
        WHERE id = ?
      `).run(-(1000 + record.id), record.id);
    }
    for (const record of moving) {
      const nextIndex = record.book_index + dir;
      db.prepare(`
        UPDATE medical_record_index
        SET book_index = ?, updated_at = datetime('now','localtime')
        WHERE id = ?
      `).run(nextIndex, record.id);
      syncOverflowTag(db, record.id, locationId, nextIndex, '操作员');
    }
    db.prepare(`
      INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
      VALUES ('操作员', 'SHIFT_BOOK_INDEX', 'location', ?, ?)
    `).run(
      locationId,
      `第${startIndex}-${endIndex}本整体${dir === -1 ? '前移' : '后移'}一位，共${moving.length}份${blockers.length ? `；退回占用病历${blockers.length}份到暂存池` : ''}`
    );
  });

  try {
    op();
    res.json({
      message: `${blockers.length ? `已先退回 ${blockers.length} 份占用病历到暂存池，` : ''}已将 ${moving.length} 份病历整体${dir === -1 ? '前移' : '后移'}一位`,
      shifted: moving.length,
      released: blockers.length,
      location_id: locationId,
      start_index: startIndex,
      end_index: endIndex,
      direction: dir,
    });
  } catch (e) {
    if (isSqliteUniqueError(e)) return res.status(409).json({ message: '序号校正发生编号冲突，请刷新后重试' });
    res.status(500).json({ message: e.message });
  }
});

router.get('/:id/timeline', (req, res) => {
  const db = getDB();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: '病历ID格式不正确' });

  const record = db.prepare(`
    SELECT r.*, l.cabinet_no, l.row_no, l.stack_no, l.year_month,
      ${recordFlagSelect('r')}
    FROM medical_record_index r
    LEFT JOIN archive_locations l ON r.location_id = l.id
    WHERE r.id = ?
  `).get(MISSING_INFO_TAG, id);
  if (!record) return res.status(404).json({ message: '病历不存在' });

  const events = [];
  const addEvent = (time, type, title, detail, tone = 'slate') => {
    if (!time) return;
    events.push({ time, type, title, detail, tone });
  };

  addEvent(record.created_at, 'record', '录入系统', `住院号 ${record.inpatient_no}`, 'blue');
  addEvent(record.updated_at, 'record', '最近更新', `当前状态：${record.archive_status}`, 'slate');
  addEvent(record.last_checked_at, 'inspection', '归档检查', '本病历所在位置被检查确认', 'green');
  addEvent(record.updated_at, 'location', '当前位置', `${formatLocationCode(record.location_id, record.book_index)} · ${record.location_id}`, record.location_id === POOL_LOCATION_ID ? 'amber' : 'indigo');

  db.prepare('SELECT * FROM borrow_logs WHERE record_id = ? ORDER BY borrowed_at DESC').all(id).forEach(log => {
    addEvent(log.borrowed_at, 'borrow', '借出', `${log.borrower}${log.department ? ` · ${log.department}` : ''}${log.purpose ? ` · ${log.purpose}` : ''}`, 'amber');
    addEvent(log.returned_at, 'return', '归还', `${log.return_condition || '已归还'}${log.note ? ` · ${log.note}` : ''}`, 'green');
  });

  db.prepare('SELECT * FROM record_issues WHERE record_id = ? ORDER BY found_at DESC').all(id).forEach(issue => {
    addEvent(issue.found_at || issue.created_at, 'issue', `登记缺陷：${issue.issue_type}`, issue.description || issue.risk_level || '待核对', 'rose');
    addEvent(issue.closed_at, 'resolve', `关闭缺陷：${issue.issue_type}`, issue.rectification_note || '问题已关闭', 'green');
  });

  db.prepare('SELECT * FROM record_tags WHERE record_id = ? ORDER BY created_at DESC').all(id).forEach(tag => {
    addEvent(tag.created_at, 'tag', `标记：${tag.tag}`, tag.created_by ? `标记人：${tag.created_by}` : '病历标签', tag.tag === MISSING_INFO_TAG ? 'fuchsia' : tag.tag === OVERFLOW_TAG ? 'amber' : 'slate');
  });

  db.prepare(`
    SELECT * FROM audit_logs
    WHERE target_id = ?
       OR target_id = ?
       OR target_id LIKE ?
       OR target_id LIKE ?
       OR target_id LIKE ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(String(id), record.location_id, `${id},%`, `%,${id}`, `%,${id},%`).forEach(log => {
    addEvent(log.created_at, 'audit', `操作日志：${log.action}`, log.detail || log.target_type, 'slate');
  });

  events.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  res.json({
    record: { ...summarizeRecord(record), archive_status: record.archive_status, has_missing_info: record.has_missing_info, has_overflow: record.has_overflow, position_code: formatLocationCode(record.location_id, record.book_index) },
    events,
  });
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const row = db.prepare(`
    SELECT r.*,
      ${recordFlagSelect('r')}
    FROM medical_record_index r
    WHERE r.id = ?
  `).get(MISSING_INFO_TAG, req.params.id);
  if (!row) return res.status(404).json({ message: '病历不存在' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = getDB();
  const { patient_name, inpatient_no, discharge_date, location_id, book_index, source_position_code, allow_overflow, force_overflow } = req.body;
  if (!patient_name) {
    return res.status(400).json({ message: '姓名为必填' });
  }

  const initials = getInitials(patient_name);
  const normalizedInpatientNo = String(inpatient_no || '').trim();
  const generatedMissingNo = !normalizedInpatientNo;
  const nextInpatientNo = normalizedInpatientNo || makeTemporaryInpatientNo(db);
  const locId = location_id || POOL_LOCATION_ID;
  let idx = book_index ? Number(book_index) : null;

  try {
    const loc = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(locId);
    if (!loc) return res.status(404).json({ message: '目标位置不存在' });

    // 标准容量仍是25本，超出的同摞追加必须显式允许。
    if (locId !== POOL_LOCATION_ID) {
      if (!idx && allow_overflow && force_overflow) idx = findNextOverflowIndex(db, locId);
      if (!idx) idx = findAvailableRange(db, locId, 1);
      if (!idx && allow_overflow) idx = findNextOverflowIndex(db, locId);
      if (!idx) {
        return res.status(400).json({ message: `该摞位已满（${MAX_BOOKS_PER_STACK}/${MAX_BOOKS_PER_STACK}），请分配到下一摞` });
      }
      if (!Number.isInteger(idx) || idx < 1 || idx > MAX_OVERFLOW_BOOK_INDEX) {
        return res.status(400).json({ message: `病历编号必须在 1-${MAX_OVERFLOW_BOOK_INDEX} 之间` });
      }
      if (idx > MAX_BOOKS_PER_STACK && !allow_overflow) {
        return res.status(400).json({ message: `第 ${idx} 本属于超容量追加，请先勾选允许超容量` });
      }
      const existingAtPosition = getPositionRecord(db, locId, idx);
      if (existingAtPosition) {
        const insertRollback = db.transaction(() => {
          const result = db.prepare(`
            INSERT INTO medical_record_index (patient_name, name_initials, inpatient_no, discharge_date, location_id, book_index, risk_status)
            VALUES (?, ?, ?, ?, ?, 0, ?)
          `).run(patient_name, initials, nextInpatientNo, discharge_date || null, POOL_LOCATION_ID, generatedMissingNo ? '待核对' : '正常');
          if (generatedMissingNo) {
            db.prepare(`INSERT OR IGNORE INTO record_tags (record_id, tag, created_by) VALUES (?, ?, '系统')`)
              .run(result.lastInsertRowid, MISSING_INFO_TAG);
          }
          db.prepare(`
            INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
            VALUES ('系统', 'CREATE_RECORD', 'record', ?, ?)
          `).run(String(result.lastInsertRowid), generatedMissingNo
            ? `仅姓名录入，系统生成待补编号 ${nextInpatientNo}${source_position_code ? `；纸面位置 ${source_position_code}` : ''}`
            : `手工录入${source_position_code ? `；纸面位置 ${source_position_code}` : ''}`);
          return result;
        });
        const result = insertRollback();
        return sendPositionConflict(res, {
          location_id: locId,
          book_index: idx,
          existing_record: existingAtPosition,
        }, [result.lastInsertRowid]);
      }
    } else {
      idx = 0;
    }

    const op = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO medical_record_index (patient_name, name_initials, inpatient_no, discharge_date, location_id, book_index, risk_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(patient_name, initials, nextInpatientNo, discharge_date || null, locId, idx, generatedMissingNo ? '待核对' : '正常');
      if (generatedMissingNo) {
        db.prepare(`INSERT OR IGNORE INTO record_tags (record_id, tag, created_by) VALUES (?, ?, '系统')`)
          .run(result.lastInsertRowid, MISSING_INFO_TAG);
      }
      syncOverflowTag(db, result.lastInsertRowid, locId, idx, '系统');
      db.prepare(`
        INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
        VALUES ('系统', 'CREATE_RECORD', 'record', ?, ?)
      `).run(String(result.lastInsertRowid), `${generatedMissingNo
        ? `仅姓名录入，系统生成待补编号 ${nextInpatientNo}`
        : '手工录入'}${source_position_code ? `；纸面位置 ${source_position_code}` : ''}${idx > MAX_BOOKS_PER_STACK ? `；超容量追加第${idx}本` : ''}`);
      return result;
    });
    const result = op();
    res.status(201).json({ id: result.lastInsertRowid, book_index: idx, inpatient_no: nextInpatientNo, generated_missing_no: generatedMissingNo });
  } catch (e) {
    if (isSqliteUniqueError(e)) return res.status(400).json({ message: `住院号 ${nextInpatientNo} 已存在` });
    res.status(500).json({ message: e.message });
  }
});

router.put('/:id', (req, res) => {
  const db = getDB();
  const { patient_name, inpatient_no, discharge_date, location_id, book_index, archive_status, remark, allow_overflow } = req.body;
  const existing = db.prepare('SELECT * FROM medical_record_index WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ message: '病历不存在' });

  const name = patient_name || existing.patient_name;
  const initials = patient_name ? getInitials(patient_name) : existing.name_initials;
  const nextLocationId = location_id || existing.location_id;
  const nextBookIndex = book_index ?? existing.book_index;

  if (nextLocationId !== POOL_LOCATION_ID) {
    const loc = db.prepare('SELECT * FROM archive_locations WHERE id = ?').get(nextLocationId);
    if (!loc) return res.status(404).json({ message: '目标位置不存在' });
    if (!Number.isInteger(Number(nextBookIndex)) || Number(nextBookIndex) < 1 || Number(nextBookIndex) > MAX_OVERFLOW_BOOK_INDEX) {
      return res.status(400).json({ message: `病历编号必须在 1-${MAX_OVERFLOW_BOOK_INDEX} 之间` });
    }
    if (Number(nextBookIndex) > MAX_BOOKS_PER_STACK && !allow_overflow) {
      return res.status(400).json({ message: `第 ${nextBookIndex} 本属于超容量追加，请先勾选允许超容量` });
    }
    const existingAtPosition = getPositionRecord(db, nextLocationId, Number(nextBookIndex), [existing.id]);
    if (existingAtPosition) {
      const rolledBackIds = rollbackRecordsToPool(db, [existing.id], `位置编号 ${formatLocationCode(nextLocationId, nextBookIndex)} 冲突，已退回暂存池`);
      return sendPositionConflict(res, {
        location_id: nextLocationId,
        book_index: Number(nextBookIndex),
        existing_record: existingAtPosition,
      }, rolledBackIds);
    }
  }

  try {
    const nextInpatientNo = inpatient_no || existing.inpatient_no;
    const op = db.transaction(() => {
      db.prepare(`
        UPDATE medical_record_index
        SET patient_name=?, name_initials=?, inpatient_no=?, discharge_date=?, location_id=?, book_index=?, archive_status=?, remark=?, updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(name, initials, nextInpatientNo, discharge_date ?? existing.discharge_date,
        nextLocationId, nextLocationId === POOL_LOCATION_ID ? 0 : Number(nextBookIndex), archive_status || existing.archive_status, remark ?? existing.remark ?? null, req.params.id);

      if (inpatient_no && !isTemporaryInpatientNo(inpatient_no)) {
        db.prepare('DELETE FROM record_tags WHERE record_id = ? AND tag = ?')
          .run(req.params.id, MISSING_INFO_TAG);
      }
      syncOverflowTag(db, req.params.id, nextLocationId, nextLocationId === POOL_LOCATION_ID ? 0 : Number(nextBookIndex), '操作员');
    });
    op();

    res.json({ message: '更新成功' });
  } catch (e) {
    if (isSqliteUniqueError(e)) return res.status(400).json({ message: `住院号 ${inpatient_no || existing.inpatient_no} 已存在` });
    res.status(500).json({ message: e.message });
  }
});

router.post('/:id/issue', (req, res) => {
  const db = getDB();
  const { issue_type, description } = req.body;
  if (!issue_type) return res.status(400).json({ message: '问题类型为必填' });

  const record = db.prepare('SELECT * FROM medical_record_index WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ message: '病历不存在' });

  const op = db.transaction(() => {
    db.prepare(`INSERT INTO record_issues (record_id, issue_type, description, risk_level, status, found_by) VALUES (?, ?, ?, '待核对', '待处理', '操作员')`)
      .run(req.params.id, issue_type, description || null);
    db.prepare(`UPDATE medical_record_index SET archive_status='归还待核对', risk_status='待核对', updated_at=datetime('now','localtime') WHERE id=?`)
      .run(req.params.id);
  });
  op();
  res.status(201).json({ message: '缺陷登记成功' });
});

router.post('/:id/resolve', (req, res) => {
  const db = getDB();
  const record = db.prepare('SELECT * FROM medical_record_index WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ message: '病历不存在' });

  const op = db.transaction(() => {
    db.prepare(`UPDATE record_issues SET status='已关闭', closed_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE record_id=? AND status != '已关闭'`)
      .run(req.params.id);
    db.prepare(`UPDATE medical_record_index SET archive_status='在架', risk_status='正常', updated_at=datetime('now','localtime') WHERE id=?`)
      .run(req.params.id);
  });
  op();
  res.json({ message: '问题已解决' });
});

router.put('/:id/missing-info', (req, res) => {
  const db = getDB();
  const { marked } = req.body;
  const record = db.prepare('SELECT * FROM medical_record_index WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ message: '病历不存在' });

  const op = db.transaction(() => {
    if (marked) {
      db.prepare(`INSERT OR IGNORE INTO record_tags (record_id, tag, created_by) VALUES (?, ?, '操作员')`)
        .run(req.params.id, MISSING_INFO_TAG);
    } else {
      db.prepare('DELETE FROM record_tags WHERE record_id = ? AND tag = ?')
        .run(req.params.id, MISSING_INFO_TAG);
    }
    db.prepare(`UPDATE medical_record_index SET updated_at=datetime('now','localtime') WHERE id=?`)
      .run(req.params.id);
  });
  op();

  res.json({ id: +req.params.id, has_missing_info: marked ? 1 : 0 });
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM medical_record_index WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ message: '病历不存在' });
  if (existing.archive_status === '借出') return res.status(400).json({ message: '借出中的病历不能删除，请先归还' });

  db.prepare('DELETE FROM borrow_logs WHERE record_id = ?').run(req.params.id);
  db.prepare('DELETE FROM record_tags WHERE record_id = ?').run(req.params.id);
  db.prepare('DELETE FROM medical_record_index WHERE id = ?').run(req.params.id);
  res.json({ message: '删除成功' });
});

export default router;
