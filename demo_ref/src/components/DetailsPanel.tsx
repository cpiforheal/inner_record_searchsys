/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Building2, MapPin, Calendar, Layers, FileText, CheckCircle, 
  ArrowUpRight, AlertCircle, RefreshCw, UserCheck, HelpCircle, 
  ArrowLeftRight, FileEdit, X, PlusCircle
} from 'lucide-react';
import { MedicalRecord, Pile, RecordStatus } from '../types';

interface DetailsPanelProps {
  selectedPile: Pile | null;
  highlightedRecordId?: string;
  onUpdateRecord: (updatedRecord: MedicalRecord) => void;
  onClose?: () => void;
}

export default function DetailsPanel({
  selectedPile,
  highlightedRecordId,
  onUpdateRecord,
  onClose
}: DetailsPanelProps) {
  // Local states for inline interactive actions
  const [activeRecordAction, setActiveRecordAction] = useState<{
    recordId: string;
    type: 'borrow' | 'report_issue' | 'rectify_status';
  } | null>(null);

  // Quick form inputs
  const [borrowerName, setBorrowerName] = useState('');
  const [issueText, setIssueText] = useState('');

  if (!selectedPile) {
    return (
      <div 
        id="details-placeholder-panel" 
        className="h-full bg-white border border-slate-200/80 rounded-2xl flex flex-col items-center justify-center p-8 text-center"
      >
        <div className="p-4 bg-slate-50 rounded-full text-slate-400 mb-4 animate-pulse">
          <Layers size={36} strokeWidth={1.5} />
        </div>
        <h4 className="text-sm font-semibold text-slate-700 mb-1">未选中病案档位</h4>
        <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
          请在左侧点击可视化的档案柜、单行或具体病历摞（小方格），即可在此处加载其内部成员病案清单、借阅状态与整改明细。
        </p>
      </div>
    );
  }

  // Derived properties from records
  const { records } = selectedPile;
  const inShelfCount = records.filter(r => r.status === 'in-shelf').length;
  const borrowedCount = records.filter(r => r.status === 'borrowed').length;
  const problemCount = records.filter(r => r.status === 'problem').length;
  const checkingCount = records.filter(r => r.status === 'checking').length;

  const handleBorrowSubmit = (record: MedicalRecord) => {
    if (!borrowerName.trim()) return;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    onUpdateRecord({
      ...record,
      status: 'borrowed',
      borrower: borrowerName,
      borrowDate: dateStr,
    });
    
    // reset
    setBorrowerName('');
    setActiveRecordAction(null);
  };

  const handleReportIssueSubmit = (record: MedicalRecord) => {
    if (!issueText.trim()) return;
    onUpdateRecord({
      ...record,
      status: 'problem',
      issueDesc: issueText,
      rectified: false
    });
    
    // reset
    setIssueText('');
    setActiveRecordAction(null);
  };

  const handleReturnRecord = (record: MedicalRecord) => {
    onUpdateRecord({
      ...record,
      status: 'in-shelf',
      borrower: undefined,
      borrowDate: undefined
    });
  };

  const handleRectifiedToggle = (record: MedicalRecord) => {
    onUpdateRecord({
      ...record,
      rectified: !record.rectified
    });
  };

  const handleVerifyRecord = (record: MedicalRecord) => {
    onUpdateRecord({
      ...record,
      status: 'in-shelf'
    });
  };

  const cabinetNameMap: Record<number, string> = {
    1: '01号柜 - 骨科/创伤',
    2: '02号柜 - 内科/心脑血管',
    3: '03号柜 - 儿科/妇产',
    4: '04号柜 - 五官/皮肤',
    5: '05号柜 - 肿瘤/重症',
  };

  return (
    <div 
      id="details-active-panel" 
      className="bg-white border border-slate-200/80 rounded-2xl shadow-sm flex flex-col h-full overflow-hidden"
    >
      {/* Header Panel */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 relative">
        {onClose && (
          <button 
            onClick={onClose}
            className="md:hidden absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
          >
            <X size={16} />
          </button>
        )}
        <div className="flex items-center gap-2 mb-2">
          <div className="bg-indigo-600 text-white font-mono px-2.5 py-0.5 rounded text-xs font-bold tracking-wider">
            {selectedPile.id}
          </div>
          <span className="text-xs text-slate-400 font-medium font-mono">架位编码</span>
        </div>
        
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5">
          <Building2 size={16} className="text-slate-400" />
          {cabinetNameMap[selectedPile.cabinetId]}
        </h3>
        
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-500">
          <div className="flex items-center gap-1.5 bg-white border border-slate-100 rounded-lg p-2">
            <MapPin size={13} className="text-indigo-500 shrink-0" />
            <span className="truncate">第 {selectedPile.rowId} 层 · 第 {selectedPile.pileId} 摞</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white border border-slate-100 rounded-lg p-2">
            <Calendar size={13} className="text-amber-500 shrink-0" />
            <span className="truncate">{selectedPile.yearMonthRange}</span>
          </div>
        </div>
      </div>

      {/* Mini shelf summary metrics */}
      <div className="grid grid-cols-4 border-b border-slate-100 text-center text-xs divide-x divide-slate-100 bg-white" id="pile-micro-stats">
        <div className="p-2.5">
          <span className="text-[10px] text-slate-400 block font-medium">总册数</span>
          <span className="text-sm font-bold font-mono text-slate-700">{selectedPile.recordsCount}</span>
        </div>
        <div className="p-2.5">
          <span className="text-[10px] text-slate-400 block font-medium">在架可用</span>
          <span className="text-sm font-bold font-mono text-emerald-600">{inShelfCount}</span>
        </div>
        <div className="p-2.5">
          <span className="text-[10px] text-slate-400 block font-medium">外借中</span>
          <span className="text-sm font-bold font-mono text-amber-500">{borrowedCount}</span>
        </div>
        <div className="p-2.5">
          <span className="text-[10px] text-slate-400 block font-medium">存有缺陷</span>
          <span className="text-sm font-bold font-mono text-rose-500">{problemCount}</span>
        </div>
      </div>

      {/* Embedded Action Drawers (Inline forms to execute simulation state) */}
      {activeRecordAction && (
        <div className="p-3.5 bg-slate-50 border-b border-slate-100 text-xs animate-fadeIn" id="inline-action-drawer">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-slate-700 flex items-center gap-1">
              {activeRecordAction.type === 'borrow' && (
                <>
                  <ArrowLeftRight size={13} className="text-amber-500" />
                  纸质病历外借登记模拟
                </>
              )}
              {activeRecordAction.type === 'report_issue' && (
                <>
                  <AlertCircle size={13} className="text-rose-500" />
                  病历书写质控缺陷登记
                </>
              )}
            </span>
            <button 
              onClick={() => setActiveRecordAction(null)}
              className="p-1 rounded bg-slate-200 hover:bg-slate-300 transition-colors"
            >
              <X size={12} />
            </button>
          </div>

          {activeRecordAction.type === 'borrow' && (
            <div className="space-y-2">
              <p className="text-slate-500 text-[11px]">
                输入申请借阅的临床科室及医师姓名，提交后本份病案对应指示图标将变为黄色：
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1 focus:outline-none focus:border-amber-500"
                  placeholder="如: 陈医生 (泌尿外科)"
                  value={borrowerName}
                  onChange={e => setBorrowerName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const rec = records.find(r => r.id === activeRecordAction.recordId);
                      if (rec) handleBorrowSubmit(rec);
                    }
                  }}
                  autoFocus
                />
                <button
                  onClick={() => {
                    const rec = records.find(r => r.id === activeRecordAction.recordId);
                    if (rec) handleBorrowSubmit(rec);
                  }}
                  className="bg-amber-600 text-white rounded px-3.5 py-1 font-medium hover:bg-amber-700 transition-colors"
                >
                  确认借出
                </button>
              </div>
            </div>
          )}

          {activeRecordAction.type === 'report_issue' && (
            <div className="space-y-2">
              <p className="text-slate-500 text-[11px]">
                登记病历质控审核发现的档案缺陷（提交后状态自动转为待整改红色）：
              </p>
              <div className="space-y-1.5">
                <select
                  className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-700"
                  onChange={e => setIssueText(e.target.value)}
                  value={issueText}
                >
                  <option value="">-- 请选择或手工输入质控问题 --</option>
                  <option value="未按规定妥当签署首页及出院小结主治签名">未按规定签署首页及出院小结主治签名</option>
                  <option value="病案首页ICD-10诊断编码存在模糊或误填">病案首页ICD-10诊断编码存在模糊或误填</option>
                  <option value="急诊留观记录与入院主诉存在核心信息相左">急诊留观记录与入院主诉存在核心信息相左</option>
                  <option value="手术记录缺漏首刀及辅助医生双重质检签章">手术记录缺漏首刀及辅助医生双重质检签章</option>
                  <option value="化验报告归档顺序错版，缺乏知情证明">化验报告归档顺序错版，缺乏知情证明</option>
                </select>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1 focus:outline-none focus:border-rose-500"
                    placeholder="输入自定义问题说明..."
                    value={issueText}
                    onChange={e => setIssueText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const rec = records.find(r => r.id === activeRecordAction.recordId);
                        if (rec) handleReportIssueSubmit(rec);
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const rec = records.find(r => r.id === activeRecordAction.recordId);
                      if (rec) handleReportIssueSubmit(rec);
                    }}
                    className="bg-rose-600 text-white rounded px-3.5 py-1 font-medium hover:bg-rose-700 transition-colors"
                  >
                    记录缺陷
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Record details list container */}
      <div className="flex-1 overflow-y-auto" id="record-details-list">
        {records.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            暂无历史归档病历，本档位为空。
          </div>
        ) : (
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold sticky top-0 border-b border-slate-100 z-10">
              <tr>
                <th className="py-2.5 px-4">病案号 & 患者</th>
                <th className="py-2.5 px-3">本号</th>
                <th className="py-2.5 px-3">当前状态</th>
                <th className="py-2.5 px-4 text-right">仿真流程交互</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((record) => {
                const isHighlighted = highlightedRecordId === record.id;
                
                return (
                  <tr 
                    key={record.id}
                    id={`record-row-${record.id}`}
                    className={`transition-colors hover:bg-slate-50/50 ${
                      isHighlighted ? 'bg-indigo-50/60 font-medium' : ''
                    }`}
                  >
                    {/* Patient and inpatient no Column */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col">
                        <span className="text-slate-800 font-medium text-xs flex items-center gap-1.5">
                          {record.name}
                          {isHighlighted && (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-600 animate-ping"></span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5">{record.inpatientNo}</span>
                      </div>
                    </td>

                    {/* Book number Column */}
                    <td className="py-3.5 px-3 text-slate-500 font-mono">
                      第 {record.volumeNo} 册
                    </td>

                    {/* Status Column */}
                    <td className="py-3.5 px-3">
                      <div className="flex flex-col gap-1 items-start">
                        {record.status === 'in-shelf' && (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100 font-medium text-[10px]">
                            <span className="h-1 w-1 rounded-full bg-emerald-500"></span>
                            在架内
                          </span>
                        )}
                        {record.status === 'borrowed' && (
                          <div className="flex flex-col">
                            <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-100 font-medium text-[10px]">
                              <span className="h-1 w-1 rounded-full bg-amber-500"></span>
                              柜外借阅
                            </span>
                            <span className="text-[9px] text-slate-400 mt-0.5 truncate max-w-[120px]" title={record.borrower}>
                              {record.borrower} · {record.borrowDate}
                            </span>
                          </div>
                        )}
                        {record.status === 'problem' && (
                          <div className="flex flex-col">
                            <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded border border-rose-100 font-medium text-[10px]">
                              <span className="h-1 w-1 rounded-full bg-rose-500"></span>
                              质控缺陷
                            </span>
                            <span className="text-[9px] text-rose-500 mt-0.5 font-medium leading-tight max-w-[130px]" title={record.issueDesc}>
                              {record.issueDesc}
                            </span>
                            {record.rectified ? (
                              <span className="inline-flex items-center gap-0.5 text-[9px] text-indigo-600 font-semibold bg-indigo-50 border border-indigo-100 rounded px-1 mt-1 shrink-0">
                                <RefreshCw size={8} className="animate-spin" /> 已完成整改(待质检复核)
                              </span>
                            ) : (
                              <span className="text-[9px] text-slate-400 mt-1">
                                待发起纠错整改
                              </span>
                            )}
                          </div>
                        )}
                        {record.status === 'checking' && (
                          <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-100 font-medium text-[10px]">
                            <span className="h-1 w-1 rounded-full bg-indigo-500"></span>
                            待核对手工册
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Simulation operations Column */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {record.status === 'in-shelf' && (
                          <>
                            <button
                              id={`borrow-btn-${record.id}`}
                              onClick={() => {
                                setBorrowerName('');
                                setActiveRecordAction({ recordId: record.id, type: 'borrow' });
                              }}
                              className="text-[10px] bg-slate-100 hover:bg-amber-50 hover:text-amber-700 border border-slate-200 hover:border-amber-200 text-slate-600 px-2 py-1 rounded transition-colors"
                              title="登记借出"
                            >
                              借阅登记
                            </button>
                            <button
                              id={`defect-btn-${record.id}`}
                              onClick={() => {
                                setIssueText('');
                                setActiveRecordAction({ recordId: record.id, type: 'report_issue' });
                              }}
                              className="text-[10px] bg-slate-100 hover:bg-rose-50 hover:text-rose-700 border border-slate-200 hover:border-rose-200 text-slate-600 px-2 py-1 rounded transition-colors"
                              title="标记为问题病案"
                            >
                              缺陷登记
                            </button>
                          </>
                        )}

                        {record.status === 'borrowed' && (
                          <button
                            id={`return-btn-${record.id}`}
                            onClick={() => handleReturnRecord(record)}
                            className="text-[10px] bg-emerald-600 hover:bg-emerald-700 border border-emerald-500 text-white px-2 py-1 rounded transition-colors"
                          >
                            归还回箱
                          </button>
                        )}

                        {record.status === 'problem' && (
                          <div className="flex flex-col gap-1 items-end">
                            <button
                              id={`rectify-btn-${record.id}`}
                              onClick={() => handleRectifiedToggle(record)}
                              className={`text-[10px] border px-2 py-1 rounded transition-colors ${
                                record.rectified 
                                  ? 'bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 border-slate-200 hover:border-indigo-200 text-slate-500'
                                  : 'bg-indigo-600 hover:bg-indigo-700 border-indigo-500 text-white font-medium'
                              }`}
                            >
                              {record.rectified ? '撤修重改' : '登记已整改'}
                            </button>
                            
                            {/* If it was corrected we can offer to full restore back into standard shelf */}
                            {record.rectified && (
                              <button
                                id={`verify-pass-btn-${record.id}`}
                                onClick={() => handleVerifyRecord(record)}
                                className="text-[9px] text-emerald-600 hover:underline flex items-center gap-0.5 mt-0.5"
                              >
                                <CheckCircle size={10} /> 审核通过(归架)
                              </button>
                            )}
                          </div>
                        )}

                        {record.status === 'checking' && (
                          <button
                            id={`verify-btn-${record.id}`}
                            onClick={() => handleVerifyRecord(record)}
                            className="text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded transition-colors"
                          >
                            核对正确并入库
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer hint */}
      <div className="p-3 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 text-center font-sans">
        提示：病历一经借出、整改或通过审核，左侧对应的可视化框架格色将自动刷新
      </div>
    </div>
  );
}
