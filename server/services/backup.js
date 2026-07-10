import cron from 'node-cron';
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { resolve, dirname, sep } from 'path';
import { fileURLToPath } from 'url';
import { getDB } from '../db/connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(__dirname, '../../data/backups');
const DB_PATH = resolve(__dirname, '../../data/archive.db');
const MAX_BACKUPS = Number(process.env.BACKUP_KEEP || 120);
const EXTRA_BACKUP_DIR = process.env.BACKUP_EXTRA_DIR ? resolve(process.env.BACKUP_EXTRA_DIR) : '';

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function toBackupInfo(filename) {
  const fullPath = resolve(BACKUP_DIR, filename);
  const stat = statSync(fullPath);
  return {
    filename,
    path: fullPath,
    size: stat.size,
    created_at: stat.birthtime.toISOString(),
    modified_at: stat.mtime.toISOString(),
  };
}

function removeBackupSidecars(fullPath) {
  [`${fullPath}-wal`, `${fullPath}-shm`].forEach(path => {
    if (existsSync(path)) unlinkSync(path);
  });
}

function normalizeBackupFile(fullPath) {
  const backupDB = new Database(fullPath);
  try {
    backupDB.pragma('journal_mode = DELETE');
  } finally {
    backupDB.close();
    removeBackupSidecars(fullPath);
  }
}

function cleanupOldBackups() {
  const files = listBackups();
  files.slice(MAX_BACKUPS).forEach(f => {
    const fullPath = resolve(BACKUP_DIR, f.filename);
    unlinkSync(fullPath);
    removeBackupSidecars(fullPath);
  });
}

function copyToExtraDir(filename, sourcePath) {
  if (!EXTRA_BACKUP_DIR) return null;
  mkdirSync(EXTRA_BACKUP_DIR, { recursive: true });
  const dest = resolve(EXTRA_BACKUP_DIR, filename);
  copyFileSync(sourcePath, dest);
  return dest;
}

export async function runBackup(options = {}) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const reason = String(options.reason || 'auto').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'auto';
  const filename = `archive-${reason}-${nowStamp()}.db`;
  const dest = resolve(BACKUP_DIR, filename);
  const db = getDB();
  await db.backup(dest);
  normalizeBackupFile(dest);

  const mirrorPath = copyToExtraDir(filename, dest);
  cleanupOldBackups();
  console.log(`[backup] ${dest}`);
  return { ...toBackupInfo(filename), mirror_path: mirrorPath };
}

export function listBackups() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  return readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(toBackupInfo)
    .sort((a, b) => b.modified_at.localeCompare(a.modified_at));
}

export function getBackupPath(filename) {
  const safeName = String(filename || '');
  if (!/^[\w.-]+\.db$/.test(safeName)) {
    const err = new Error('备份文件名不合法');
    err.status = 400;
    throw err;
  }
  const fullPath = resolve(BACKUP_DIR, safeName);
  if (!fullPath.startsWith(`${BACKUP_DIR}${sep}`) || !existsSync(fullPath)) {
    const err = new Error('备份文件不存在');
    err.status = 404;
    throw err;
  }
  return fullPath;
}

export function verifyBackup(filename) {
  const fullPath = getBackupPath(filename);
  const backupDB = new Database(fullPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = backupDB.pragma('integrity_check', { simple: true });
    const quick = backupDB.pragma('quick_check', { simple: true });
    return {
      filename,
      ok: integrity === 'ok' && quick === 'ok',
      integrity,
      quick,
      checked_at: new Date().toISOString(),
    };
  } finally {
    backupDB.close();
    removeBackupSidecars(fullPath);
  }
}

export function getBackupStatus() {
  const backups = listBackups();
  const dbStat = existsSync(DB_PATH) ? statSync(DB_PATH) : null;
  return {
    db_path: DB_PATH,
    db_size: dbStat?.size || 0,
    db_modified_at: dbStat?.mtime.toISOString() || null,
    backup_dir: BACKUP_DIR,
    extra_backup_dir: EXTRA_BACKUP_DIR || null,
    keep: MAX_BACKUPS,
    count: backups.length,
    latest: backups[0] || null,
  };
}

function hasBackupToday() {
  const today = new Date().toDateString();
  return listBackups().some(file => new Date(file.modified_at).toDateString() === today);
}

export function setupBackup() {
  cron.schedule('0 2 * * *', () => {
    runBackup({ reason: 'daily' }).catch(e => console.error('[backup] failed:', e.message));
  });

  setTimeout(() => {
    try {
      if (hasBackupToday()) return;
      runBackup({ reason: 'startup' }).catch(e => console.error('[backup] startup failed:', e.message));
    } catch (e) {
      console.error('[backup] startup failed:', e.message);
    }
  }, 3000);
}
