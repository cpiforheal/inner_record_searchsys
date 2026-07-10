/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type RecordStatus = 'in-shelf' | 'borrowed' | 'problem' | 'checking';

export interface MedicalRecord {
  id: string;
  name: string;
  inpatientNo: string;
  volumeNo: number; // 第几本
  status: RecordStatus;
  cabinetId: number; // 1-5
  rowId: number;     // 1-6
  pileId: number;    // 1-7
  borrower?: string;      // 借阅人 (如果是借出状态)
  borrowDate?: string;    // 借出时间
  issueDesc?: string;     // 问题描述 (如果是问题病历/待整改)
  rectified?: boolean;    // 是否已申请整改
  yearMonth: string;      // 归档年月
}

export interface Pile {
  id: string; // C01-R01-P01
  cabinetId: number;
  rowId: number;
  pileId: number;
  status: RecordStatus;
  recordsCount: number;
  borrowedCount: number;
  problemCount: number;
  checkingCount: number;
  yearMonthRange: string;
  records: MedicalRecord[];
}

export interface Cabinet {
  id: number; // 1 - 5
  name: string; // e.g. "A号病案柜"
  code: string; // e.g. "C01"
  rowsCount: number; // 5或6行
  pilesPerRow: number; // 6或7摞
}

export interface GlobalStats {
  totalRecords: number;     // 已建索引
  onShelfRecords: number;   // 在架病历
  borrowedRecords: number;  // 借出病历
  problemRecords: number;   // 问题病历
  pendingRectification: number; // 待整改
}

export type LayoutDirection = 'A' | 'B' | 'C';
