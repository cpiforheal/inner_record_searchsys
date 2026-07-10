/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Cabinet, MedicalRecord, Pile, RecordStatus } from './types';

// Helper to pad numbers with zero
export const formatId = (c: number, r: number, p: number): string => {
  const cc = String(c).padStart(2, '0');
  const rr = String(r).padStart(2, '0');
  const pp = String(p).padStart(2, '0');
  return `C${cc}-R${rr}-P${pp}`;
};

// Seeded random helper for reproducible, realistic layouts
const createSeededRandom = (seed: number) => {
  let h = seed;
  return () => {
    h = Math.sin(h) * 10000;
    return h - Math.floor(h);
  };
};

export const CABINETS: Cabinet[] = [
  { id: 1, name: '01号骨科/创伤病案柜', code: 'C01', rowsCount: 5, pilesPerRow: 6 },
  { id: 2, name: '02号内科/心脑血管病案柜', code: 'C02', rowsCount: 5, pilesPerRow: 7 },
  { id: 3, name: '03号儿科/妇产病案柜', code: 'C03', rowsCount: 6, pilesPerRow: 6 },
  { id: 4, name: '04号五官/皮肤全科病案柜', code: 'C04', rowsCount: 6, pilesPerRow: 7 },
  { id: 5, name: '05号肿瘤/重症监测病案柜', code: 'C05', rowsCount: 5, pilesPerRow: 6 },
];

const LAST_NAMES = ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '董', '萧', '程'];
const FIRST_NAME_MUTATIONS = ['某某', '某', '国庆', '建华', '晓玲', '明', '红', '伟', '芳', '秀英', '敏', '静', '超', '强', '军', '勇', '梅', '杰', '丽'];

const BORROWERS = [
  '王医生 (心胸外科)',
  '张质控员 (医务处)',
  '李主任 (心血管内科)',
  '陈质控员 (病案管理科)',
  '刘医生 (儿科)',
  '周护士长 (重症监护室)',
  '何医生 (妇产科)',
  '赵教授 (肿瘤科)',
  '黄督导 (医保办)'
];

const ISSUE_DESCRIPTIONS = [
  '未按规定签署首页及出院小结主治签名',
  '病案首页ICD-10诊断编码存在模糊或误填',
  '病程记录连续三天缺少上级医师查房意见',
  '手术同意书患者或家属签署人关系未注明',
  '非24小时内补记的急诊留观记录无时间注记',
  '输血同意书及化验结果单缺漏装订',
  '自费药物告知同意书缺失经办医生签名',
  '知情同意书未填写签署具体年月日时间'
];

export const generateInitialData = (): { records: MedicalRecord[]; piles: Pile[] } => {
  const records: MedicalRecord[] = [];
  const piles: Pile[] = [];
  const rand = createSeededRandom(1008);

  // Generate cabinets, rows, piles
  for (const cab of CABINETS) {
    const yearBase = 2021 + cab.id; // C01: 2022, C02: 2023, etc.
    
    for (let r = 1; r <= cab.rowsCount; r++) {
      for (let p = 1; p <= cab.pilesPerRow; p++) {
        const pileCode = formatId(cab.id, r, p);
        const yearMonthRange = `${yearBase}年${String(Math.ceil((r * 2) % 12) || 12).padStart(2, '0')}月`;
        
        // Number of records in this pile: between 8 and 22
        const count = Math.floor(rand() * 15) + 8;
        const pileRecords: MedicalRecord[] = [];

        // Distribute some statuses randomly but predictably based on the pile code
        // We want a few problems, borrowings, and verifications to show visual contrast
        let pileStatusValue = rand();
        let pileHasProblem = pileStatusValue < 0.12; // 12% chance for problem
        let pileHasBorrow = !pileHasProblem && pileStatusValue < 0.25; // 13% chance of borrow
        let pileHasVerify = !pileHasProblem && !pileHasBorrow && pileStatusValue < 0.35; // 10% chance checking

        for (let i = 0; i < count; i++) {
          const lName = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
          const fName = FIRST_NAME_MUTATIONS[Math.floor(rand() * FIRST_NAME_MUTATIONS.length)];
          const name = `${lName}${fName}`;
          
          const inpatientNo = `ZY${yearBase}${String(Math.floor(rand() * 900000) + 100000)}`;
          const volumeNo = rand() > 0.85 ? 2 : 1; // Most are 1 book, some are book 2

          let recStatus: RecordStatus = 'in-shelf';
          let borrower: string | undefined = undefined;
          let borrowDate: string | undefined = undefined;
          let issueDesc: string | undefined = undefined;
          let rectified = false;

          // If the pile has a special state, assign it to a few records inside
          if (pileHasProblem && i === 0) {
            recStatus = 'problem';
            issueDesc = ISSUE_DESCRIPTIONS[Math.floor(rand() * ISSUE_DESCRIPTIONS.length)];
          } else if (pileHasBorrow && i === 1) {
            recStatus = 'borrowed';
            borrower = BORROWERS[Math.floor(rand() * BORROWERS.length)];
            borrowDate = `2026-05-${String(Math.floor(rand() * 15) + 10).padStart(2, '0')}`;
          } else if (pileHasVerify && i === 2) {
            recStatus = 'checking';
          } else if (rand() > 0.96) {
            // Random isolated states
            const randomStatusRand = rand();
            if (randomStatusRand < 0.3) {
              recStatus = 'borrowed';
              borrower = BORROWERS[Math.floor(rand() * BORROWERS.length)];
              borrowDate = `2026-05-${String(Math.floor(rand() * 15) + 10).padStart(2, '0')}`;
            } else if (randomStatusRand < 0.7) {
              recStatus = 'problem';
              issueDesc = ISSUE_DESCRIPTIONS[Math.floor(rand() * ISSUE_DESCRIPTIONS.length)];
            } else {
              recStatus = 'checking';
            }
          }

          const recordId = `${pileCode}-REC-${String(i).padStart(3, '0')}`;
          const currentRecord: MedicalRecord = {
            id: recordId,
            name,
            inpatientNo,
            volumeNo,
            status: recStatus,
            cabinetId: cab.id,
            rowId: r,
            pileId: p,
            borrower,
            borrowDate,
            issueDesc,
            rectified,
            yearMonth: `${yearBase}年${String(Math.ceil((r * 2) % 12) || 12).padStart(2, '0')}月`,
          };

          records.push(currentRecord);
          pileRecords.push(currentRecord);
        }

        // Determine main status of this pile
        // If there's an active problem record in the pile, pile status is 'problem'
        // Else if there's any borrowed, pile status is 'borrowed'
        // Else if there's any checking, pile status is 'checking'
        // Else 'in-shelf'
        let pileStatus: RecordStatus = 'in-shelf';
        const problemCount = pileRecords.filter(r => r.status === 'problem').length;
        const borrowedCount = pileRecords.filter(r => r.status === 'borrowed').length;
        const checkingCount = pileRecords.filter(r => r.status === 'checking').length;

        if (problemCount > 0) {
          pileStatus = 'problem';
        } else if (borrowedCount > 0) {
          pileStatus = 'borrowed';
        } else if (checkingCount > 0) {
          pileStatus = 'checking';
        }

        piles.push({
          id: pileCode,
          cabinetId: cab.id,
          rowId: r,
          pileId: p,
          status: pileStatus,
          recordsCount: count,
          borrowedCount,
          problemCount,
          checkingCount,
          yearMonthRange,
          records: pileRecords,
        });
      }
    }
  }

  return { records, piles };
};
