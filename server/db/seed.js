import { initDB, getDB } from './connection.js';
import { pinyin } from 'pinyin-pro';

const cabinetShapes = [
  { id: 'C01', name: '1号柜', rows: 6, stacksPerRow: 6 },
  { id: 'C02', name: '2号柜', rows: 5, stacksPerRow: 7 },
  { id: 'C03', name: '3号柜', rows: 6, stacksPerRow: 7 },
  { id: 'C04', name: '4号柜', rows: 5, stacksPerRow: 6 },
  { id: 'C05', name: '5号柜', rows: 6, stacksPerRow: 6 },
];

function pad(v) { return String(v).padStart(2, '0'); }

function getInitials(name) {
  return pinyin(name, { pattern: 'first', toneType: 'none' }).replace(/\s/g, '').toUpperCase();
}

initDB();
const db = getDB();

console.log('Seeding locations...');

const insertLoc = db.prepare(`
  INSERT OR IGNORE INTO archive_locations (id, cabinet_no, row_no, stack_no, year_month, label_text)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertRecord = db.prepare(`
  INSERT OR IGNORE INTO medical_record_index (patient_name, name_initials, inpatient_no, discharge_date, location_id, book_index, archive_status)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const surnames = ['张', '李', '王', '赵', '陈', '刘', '周', '吴', '郑', '孙', '马', '朱'];
const names = ['明远', '秀兰', '建国', '春梅', '志强', '玉珍', '晓峰', '桂英', '海波', '丽娜', '文斌', '慧芳'];

let seed = 0;
let locCount = 0;
let recCount = 0;

const seedAll = db.transaction(() => {
  for (const cabinet of cabinetShapes) {
    for (let row = 1; row <= cabinet.rows; row++) {
      for (let stack = 1; stack <= cabinet.stacksPerRow; stack++) {
        seed++;
        const mi = (seed + cabinetShapes.indexOf(cabinet) * 4) % 36;
        const year = 2023 + Math.floor(mi / 12);
        const month = (mi % 12) + 1;
        const locId = `${cabinet.id}-R${pad(row)}-P${pad(stack)}`;
        const ym = `${year}-${pad(month)}`;

        insertLoc.run(locId, parseInt(cabinet.id.slice(1)), row, stack, ym, `${cabinet.name} 第${row}行 第${stack}摞`);
        locCount++;

        const count = Math.min(18 + ((seed * 7) % 28), 16);
        const borrowed = (seed * 3) % 5;
        const pending = (seed + row + stack) % 6 === 0 ? 2 : 0;

        for (let i = 0; i < count; i++) {
          const serial = seed * 100 + i + 1;
          const pName = `${surnames[(serial + i) % surnames.length]}${names[(serial + seed) % names.length]}`;
          const inpNo = `ZY${year}${pad(month)}${String(serial).padStart(4, '0')}`;
          const dDate = `${year}-${pad(month)}-${pad(((i * 3) % 26) + 1)}`;
          const status = i < borrowed ? '借出' : i < borrowed + pending ? '归还待核对' : '在架';
          const initials = getInitials(pName);

          insertRecord.run(pName, initials, inpNo, dDate, locId, i + 1, status);
          recCount++;
        }
      }
    }
  }
});

seedAll();
console.log(`Seeded ${locCount} locations, ${recCount} records.`);
process.exit(0);
