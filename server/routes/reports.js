import { Router } from 'express';
import { getDB } from '../db/connection.js';

const router = Router();
const MISSING_INFO_TAG = '缺失占位';

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendCsv(res, filename, headers, rows) {
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(',')),
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(`\uFEFF${csv}`);
}

function inventoryRows(db, filters = {}) {
  const where = [];
  const params = [MISSING_INFO_TAG];
  if (filters.cabinet_no) {
    where.push('l.cabinet_no = ?');
    params.push(Number(filters.cabinet_no));
  }
  if (filters.status) {
    where.push('r.archive_status = ?');
    params.push(filters.status);
  }
  if (filters.missing_info === '1') {
    where.push('EXISTS(SELECT 1 FROM record_tags t2 WHERE t2.record_id = r.id AND t2.tag = ?)');
    params.push(MISSING_INFO_TAG);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT
      r.id as 系统ID,
      r.patient_name as 患者姓名,
      r.inpatient_no as 住院号,
      r.discharge_date as 出院日期,
      r.archive_status as 归档状态,
      r.risk_status as 风险状态,
      l.cabinet_no as 书架,
      l.row_no as 排,
      l.stack_no as 摞,
      r.book_index as 本号,
      (l.cabinet_no || l.row_no || l.stack_no || printf('%02d', COALESCE(r.book_index, 0))) as 位置编号,
      CASE WHEN EXISTS(SELECT 1 FROM record_tags t WHERE t.record_id = r.id AND t.tag = ?) THEN '是' ELSE '否' END as 占位待补,
      r.last_checked_at as 最近检查时间,
      r.updated_at as 更新时间
    FROM medical_record_index r
    JOIN archive_locations l ON r.location_id = l.id
    ${whereSql}
    ORDER BY l.cabinet_no, l.row_no, l.stack_no, r.book_index
  `).all(...params);
}

router.get('/inventory.csv', (req, res) => {
  const db = getDB();
  const rows = inventoryRows(db, req.query);
  sendCsv(res, '病历盘点表.csv', ['系统ID', '患者姓名', '住院号', '出院日期', '归档状态', '风险状态', '书架', '排', '摞', '本号', '位置编号', '占位待补', '最近检查时间', '更新时间'], rows);
});

router.get('/missing.csv', (req, res) => {
  const db = getDB();
  const rows = inventoryRows(db, { ...req.query, missing_info: '1' });
  sendCsv(res, '占位待补清单.csv', ['系统ID', '患者姓名', '住院号', '出院日期', '归档状态', '风险状态', '书架', '排', '摞', '本号', '位置编号', '占位待补', '最近检查时间', '更新时间'], rows);
});

router.get('/pool.csv', (req, res) => {
  const db = getDB();
  const rows = db.prepare(`
    SELECT id as 系统ID, patient_name as 患者姓名, inpatient_no as 住院号, discharge_date as 出院日期,
      archive_status as 归档状态, risk_status as 风险状态, created_at as 录入时间, updated_at as 更新时间
    FROM medical_record_index
    WHERE location_id = '__POOL__'
    ORDER BY updated_at DESC
  `).all();
  sendCsv(res, '暂存池清单.csv', ['系统ID', '患者姓名', '住院号', '出院日期', '归档状态', '风险状态', '录入时间', '更新时间'], rows);
});

router.get('/borrows.csv', (req, res) => {
  const db = getDB();
  const rows = db.prepare(`
    SELECT b.id as 借阅ID, r.patient_name as 患者姓名, r.inpatient_no as 住院号, r.location_id as 摞位,
      r.book_index as 本号, b.borrower as 借阅人, b.department as 科室部门, b.purpose as 用途,
      b.borrowed_at as 借出时间, b.due_at as 应还时间, b.returned_at as 归还时间,
      CASE WHEN b.returned_at IS NULL THEN '未归还' ELSE '已归还' END as 借阅状态, b.note as 备注
    FROM borrow_logs b
    JOIN medical_record_index r ON r.id = b.record_id
    ORDER BY b.borrowed_at DESC
  `).all();
  sendCsv(res, '借阅清单.csv', ['借阅ID', '患者姓名', '住院号', '摞位', '本号', '借阅人', '科室部门', '用途', '借出时间', '应还时间', '归还时间', '借阅状态', '备注'], rows);
});

router.get('/issues.csv', (req, res) => {
  const db = getDB();
  const rows = db.prepare(`
    SELECT i.id as 问题ID, r.patient_name as 患者姓名, r.inpatient_no as 住院号, r.location_id as 摞位,
      r.book_index as 本号, i.issue_type as 问题类型, i.risk_level as 风险级别,
      i.status as 处理状态, i.description as 问题描述, i.found_by as 登记人,
      i.found_at as 登记时间, i.closed_at as 关闭时间
    FROM record_issues i
    JOIN medical_record_index r ON r.id = i.record_id
    ORDER BY i.found_at DESC
  `).all();
  sendCsv(res, '问题病历清单.csv', ['问题ID', '患者姓名', '住院号', '摞位', '本号', '问题类型', '风险级别', '处理状态', '问题描述', '登记人', '登记时间', '关闭时间'], rows);
});

export default router;
