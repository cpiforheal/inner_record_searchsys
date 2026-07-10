import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../data/archive.db');

let db;

export function initDB() {
  mkdirSync(resolve(__dirname, '../../data/backups'), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(resolve(__dirname, '../schema.sql'), 'utf-8');
  db.exec(schema);

  // 确保暂存池虚拟位置存在
  db.prepare(`INSERT OR IGNORE INTO archive_locations (id, cabinet_no, row_no, stack_no, label_text) VALUES ('__POOL__', 0, 0, 0, '暂存池')`).run();
  ensureUniqueRecordPositions(db);

  return db;
}

function ensureUniqueRecordPositions(db) {
  const duplicates = db.prepare(`
    SELECT location_id, book_index, group_concat(id) as ids, COUNT(*) as c
    FROM medical_record_index
    WHERE location_id != '__POOL__' AND book_index IS NOT NULL
    GROUP BY location_id, book_index
    HAVING c > 1
  `).all();

  if (duplicates.length > 0) {
    const fixDuplicates = db.transaction(() => {
      for (const dup of duplicates) {
        const ids = String(dup.ids).split(',').map(Number).sort((a, b) => a - b);
        const rollbackIds = ids.slice(1);
        if (rollbackIds.length === 0) continue;
        db.prepare(`
          UPDATE medical_record_index
          SET location_id='__POOL__', book_index=0, updated_at=datetime('now','localtime')
          WHERE id IN (${rollbackIds.map(() => '?').join(',')})
        `).run(...rollbackIds);
        db.prepare(`
          INSERT INTO audit_logs (actor, action, target_type, target_id, detail)
          VALUES ('系统', 'ROLLBACK_DUPLICATE_POSITION', 'records', ?, ?)
        `).run(rollbackIds.join(','), `重复位置 ${dup.location_id} 第${dup.book_index}本，已退回暂存池`);
      }
    });
    fixDuplicates();
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_record_unique_shelf_position
    ON medical_record_index(location_id, book_index)
    WHERE location_id != '__POOL__' AND book_index IS NOT NULL
  `);
}

export function getDB() {
  if (!db) throw new Error('Database not initialized');
  return db;
}
