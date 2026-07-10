/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  Building2, BookOpen, Search, Layers, ShieldCheck, 
  RefreshCw, MapPin, ListCollapse, Database, HelpCircle, 
  ChevronRight, ArrowRight, TableProperties, Library, Info
} from 'lucide-react';

import { generateInitialData, CABINETS } from './data';
import { LayoutDirection, MedicalRecord, Pile, GlobalStats, RecordStatus } from './types';

import StatisticsCards from './components/StatisticsCards';
import SearchAndFilters from './components/SearchAndFilters';
import CabinetVisualizer from './components/CabinetVisualizer';
import DetailsPanel from './components/DetailsPanel';

export default function App() {
  // 1. Core State Managers
  const [data, setData] = useState(() => generateInitialData());
  const [layout, setLayout] = useState<LayoutDirection>('A');
  const [selectedPileId, setSelectedPileId] = useState<string | null>('C03-R04-P02'); // Setup default detailed pile C03-R04-P02 to keep page high context on initial load
  const [selectedCabinetId, setSelectedCabinetId] = useState<number>(3); // Initial highlights Cabinet 3
  const [highlightedRecordId, setHighlightedRecordId] = useState<string | undefined>(undefined);

  // 2. Computed Global Stats derived dynamically from records list state
  const globalStats = useMemo<GlobalStats>(() => {
    const total = data.records.length;
    let onShelf = 0;
    let borrowed = 0;
    let problem = 0;
    let pendingRectify = 0;

    for (const r of data.records) {
      if (r.status === 'in-shelf') onShelf++;
      else if (r.status === 'borrowed') borrowed++;
      else if (r.status === 'problem') {
        problem++;
        if (!r.rectified) {
          pendingRectify++;
        }
      } else if (r.status === 'checking') {
        onShelf++; // checking acts as physical catalog check
      }
    }

    return {
      totalRecords: total,
      onShelfRecords: onShelf,
      borrowedRecords: borrowed,
      problemRecords: problem,
      pendingRectification: pendingRectify
    };
  }, [data.records]);

  // 3. Computed Selected Pile object structure
  const currentSelectedPile = useMemo<Pile | null>(() => {
    if (!selectedPileId) return null;
    
    // Find base pile information
    const foundPileIndex = data.piles.findIndex(p => p.id === selectedPileId);
    if (foundPileIndex === -1) return null;
    
    // Filter records belonging to this pile
    const pileCodeParts = selectedPileId.split('-'); // ["C03", "R04", "P02"]
    const cabId = parseInt(pileCodeParts[0].replace('C', ''), 10);
    const rowId = parseInt(pileCodeParts[1].replace('R', ''), 10);
    const pileId = parseInt(pileCodeParts[2].replace('P', ''), 10);

    const pileRecords = data.records.filter(
      r => r.cabinetId === cabId && r.rowId === rowId && r.pileId === pileId
    );

    const basePile = data.piles[foundPileIndex];

    // Determine pile status based on records
    let pileStatus: RecordStatus = 'in-shelf';
    const problemRecords = pileRecords.filter(r => r.status === 'problem');
    const borrowedRecords = pileRecords.filter(r => r.status === 'borrowed');
    const checkingRecords = pileRecords.filter(r => r.status === 'checking');

    if (problemRecords.length > 0) {
      pileStatus = 'problem';
    } else if (borrowedRecords.length > 0) {
      pileStatus = 'borrowed';
    } else if (checkingRecords.length > 0) {
      pileStatus = 'checking';
    }

    return {
      ...basePile,
      status: pileStatus,
      recordsCount: pileRecords.length,
      borrowedCount: borrowedRecords.length,
      problemCount: problemRecords.length,
      checkingCount: checkingRecords.length,
      records: pileRecords
    };
  }, [selectedPileId, data.records, data.piles]);

  // 4. Update Handler linking records actions (borrowing, returning, correcting)
  const handleUpdateRecord = (updatedRecord: MedicalRecord) => {
    setData((prev) => {
      // Create new array of records with the updated record substituted
      const updatedRecords = prev.records.map((r) => 
        r.id === updatedRecord.id ? updatedRecord : r
      );

      // Re-map the piles to compute their derived status directly
      const updatedPiles = prev.piles.map((pile) => {
        if (
          pile.cabinetId === updatedRecord.cabinetId &&
          pile.rowId === updatedRecord.rowId &&
          pile.pileId === updatedRecord.pileId
        ) {
          // Re-compute states
          const sibRecords = updatedRecords.filter(
            r => r.cabinetId === pile.cabinetId && r.rowId === pile.rowId && r.pileId === pile.pileId
          );
          
          let pStatus: RecordStatus = 'in-shelf';
          const prob = sibRecords.filter(r => r.status === 'problem').length;
          const borr = sibRecords.filter(r => r.status === 'borrowed').length;
          const chk = sibRecords.filter(r => r.status === 'checking').length;

          if (prob > 0) pStatus = 'problem';
          else if (borr > 0) pStatus = 'borrowed';
          else if (chk > 0) pStatus = 'checking';

          return {
            ...pile,
            status: pStatus,
            recordsCount: sibRecords.length,
            borrowedCount: borr,
            problemCount: prob,
            checkingCount: chk,
          };
        }
        return pile;
      });

      return {
        records: updatedRecords,
        piles: updatedPiles
      };
    });
  };

  const handleSelectPileFromSearch = (pileId: string, recordId?: string) => {
    // Determine Cabinet Id
    const cabinetCode = pileId.split('-')[0]; // "C03"
    const cabId = parseInt(cabinetCode.replace('C', ''), 10);
    
    setSelectedCabinetId(cabId);
    setSelectedPileId(pileId);
    
    if (recordId) {
      setHighlightedRecordId(recordId);
      // Auto-scrolling assist to highlighted grid row inside details
      setTimeout(() => {
        const rowEl = document.getElementById(`record-row-${recordId}`);
        if (rowEl) {
          rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 350);
    } else {
      setHighlightedRecordId(undefined);
    }
  };

  // 5. Derived list representing Direction B problem ledger index
  const activeIssuesLedgerList = useMemo(() => {
    return data.records
      .filter(r => r.status === 'problem')
      .slice(0, 15); // Show top 15 problem records for administrative overview
  }, [data.records]);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-800" id="applet-viewport">
      
      {/* SaaS Administrative Header bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 shrink-0 sticky top-0 z-30" id="header-bar">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Logo Brand details */}
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 p-2.5 rounded-xl text-white shadow shadow-indigo-500/20 shrink-0">
              <Library size={20} strokeWidth={2.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight">
                  本地纸质病案柜可视化索引系统
                </h1>
                <span className="bg-slate-800 border border-slate-700/80 text-slate-400 font-mono text-[9px] px-1.5 py-0.2 rounded font-medium">
                  内置工作站 v2.6.4
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">
                小型专科医院电子索引 · 医院内部库房实景对照看板 (纸质原档专用)
              </p>
            </div>
          </div>

          {/* Dynamic Search bar proxy */}
          <div className="flex-1 max-w-lg md:ml-6">
            <SearchAndFilters 
              records={data.records}
              piles={data.piles}
              onSelectPile={handleSelectPileFromSearch}
            />
          </div>

          {/* Quick status stamp metadata */}
          <div className="hidden lg:flex items-center gap-2.5 text-xs text-slate-400 font-mono">
            <div className="flex items-center gap-1 bg-slate-800 px-2.5 py-1 rounded border border-slate-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              <span>数据正常联机</span>
            </div>
            <span className="text-slate-500 text-[10px]">终端 02</span>
          </div>
        </div>
      </header>

      {/* Primary Container space */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-5">
        
        {/* Layout Selector and Description */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 shadow-sm shrink-0" id="layout-controller">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">视图方案对照组</span>
              <span className="inline-block h-3 w-px bg-slate-200"></span>
              <span className="text-xs text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded">交互效果展示</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-xl">
              为充分演示前端效果，本工作台内置了 <strong className="text-slate-800 font-medium">3个不同布局方向</strong>。您可以随时在右侧选项卡间无缝切换，点击特定方格后系统将在右侧刷新其归档历史、并支持借阅/归还仿真修改：
            </p>
          </div>

          {/* Elegant direction tabs switcher */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60 grow md:grow-0" id="layout-tabs">
            <button
              id="layout-tab-a"
              onClick={() => { setLayout('A'); setHighlightedRecordId(undefined); }}
              className={`flex-1 md:flex-none px-4 py-2 text-xs rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 ${
                layout === 'A' 
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/50' 
                  : 'text-slate-600 hover:text-indigo-600'
              }`}
            >
              <Layers size={14} />
              方向 A: 立架大柜
            </button>
            <button
              id="layout-tab-b"
              onClick={() => { setLayout('B'); setHighlightedRecordId(undefined); }}
              className={`flex-1 md:flex-none px-4 py-2 text-xs rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 ${
                layout === 'B' 
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/50' 
                  : 'text-slate-600 hover:text-indigo-600'
              }`}
            >
              <TableProperties size={14} />
              方向 B: 紧凑总览
            </button>
            <button
              id="layout-tab-c"
              onClick={() => { setLayout('C'); setHighlightedRecordId(undefined); }}
              className={`flex-1 md:flex-none px-4 py-2 text-xs rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 ${
                layout === 'C' 
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/50' 
                  : 'text-slate-600 hover:text-indigo-600'
              }`}
            >
              <MapPin size={14} />
              方向 C: 平面地图
            </button>
          </div>
        </div>

        {/* Global Statistics Indicators */}
        <StatisticsCards stats={globalStats} />

        {/* Layout implementations */}
        {layout === 'A' || layout === 'C' ? (
          /* ========================================================================= */
          /* Direction A & C Workstation Core Structure: Left large shelfs, Right Panel */
          /* ========================================================================= */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start flex-1" id="layout-stage-ac">
            
            {/* Visualizing Grid box is left 8 columns */}
            <div className="lg:col-span-8 flex flex-col gap-4">
              <CabinetVisualizer 
                layout={layout}
                piles={data.piles}
                selectedPileId={selectedPileId}
                onSelectPile={setSelectedPileId}
                selectedCabinetId={selectedCabinetId}
                onSelectCabinet={setSelectedCabinetId}
              />

              {/* Floor Plan Tip box (when in Direction A) */}
              {layout === 'A' && (
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 flex gap-2.5 items-start text-xs text-slate-500">
                  <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-700 block">方向 A (当前) 说明：</span>
                    <span className="leading-relaxed">本侧边为医院五个科室档案架。您可以选择其中任何一柜的某个方格（例如 C03-R04-P02，代表 Cabinet 3, Row 4, Pile 2），即可加载对应病册名册。每个小格上的数量代表对应格内的病案累计厚度栈（册数），支持多维度实时数据同步。</span>
                  </div>
                </div>
              )}
            </div>

            {/* Right Detailed Panel is right 4 columns */}
            <div className="lg:col-span-4 lg:sticky lg:top-[85px] h-[550px] lg:h-[calc(100vh-230px)] min-h-[460px]">
              <DetailsPanel 
                selectedPile={currentSelectedPile}
                highlightedRecordId={highlightedRecordId}
                onUpdateRecord={handleUpdateRecord}
              />
            </div>

          </div>
        ) : (
          /* ========================================================================= */
          /* Direction B: Top 5 Compact Cabinets overview, Bottom Grid view layout     */
          /* ========================================================================= */
          <div className="flex flex-col gap-5 items-stretch flex-1" id="layout-stage-b">
            
            {/* Top Compact rack representations */}
            <div className="w-full">
              <CabinetVisualizer 
                layout="B"
                piles={data.piles}
                selectedPileId={selectedPileId}
                onSelectPile={setSelectedPileId}
                selectedCabinetId={selectedCabinetId}
                onSelectCabinet={setSelectedCabinetId}
              />
            </div>

            {/* Bottom ledger layout: Left: Chosen Stack Record details (DetailPanel), Right: Mass defect audit Ledger */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              
              {/* Detail panel of chosen pile */}
              <div className="lg:col-span-7 h-[540px]">
                <DetailsPanel 
                  selectedPile={currentSelectedPile}
                  highlightedRecordId={highlightedRecordId}
                  onUpdateRecord={handleUpdateRecord}
                />
              </div>

              {/* Active aggregate issue ledger column for hospital admins overview */}
              <div className="lg:col-span-5 bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex flex-col h-[540px]" id="issue-audit-ledger">
                <div className="border-b border-slate-100 pb-3 mb-3.5 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1">
                      <ListCollapse size={15} className="text-rose-500" />
                      全库房问题病历统一整改台账（方向 B 特色）
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      全科室集中审核缺陷展示，点击定位对应柜位
                    </p>
                  </div>
                  <span className="bg-rose-50 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded border border-rose-100 font-mono">
                    待处理: {globalStats.pendingRectification} 例
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto pr-1 text-xs text-slate-600 divide-y divide-slate-100" id="defects-history-lines">
                  {activeIssuesLedgerList.length === 0 ? (
                    <div className="p-8 text-center text-slate-400">
                      所有归档病案均已整改合格，暂无缺陷台账。
                    </div>
                  ) : (
                    activeIssuesLedgerList.map((rec) => {
                      const posCode = `C${String(rec.cabinetId).padStart(2, '0')}-R${String(rec.rowId).padStart(2, '0')}-P${String(rec.pileId).padStart(2, '0')}`;
                      
                      return (
                        <div 
                          key={rec.id}
                          className="py-3 flex flex-col gap-2 hover:bg-slate-50/50 transition-colors p-2.5 rounded-xl cursor-pointer"
                          onClick={() => handleSelectPileFromSearch(posCode, rec.id)}
                          title="点击聚焦此病历在对应档案柜上的位置"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-800 flex items-center gap-1">
                              {rec.name} 
                              <span className="text-[10px] text-slate-400 font-mono">({rec.inpatientNo})</span>
                            </span>
                            <span className="font-mono text-[10px] bg-slate-100 text-slate-600 border px-1.5 py-0.2 rounded font-medium">
                              位置:{posCode}
                            </span>
                          </div>

                          <div className="text-[11px] text-rose-600 font-medium bg-rose-50/50 border border-thin border-rose-100/50 p-2 rounded-lg leading-relaxed flex items-start gap-1">
                            <span className="text-[10px] font-bold shrink-0 mt-0.5">【缺陷条目】</span>
                            <span>{rec.issueDesc}</span>
                          </div>

                          <div className="flex justify-between items-center text-[10px] text-slate-400">
                            <span>所属科室: {CABINETS.find(c => c.id === rec.cabinetId)?.name.split('/')[0].replace(/\d+号/, '')}</span>
                            <span className="text-indigo-600 flex items-center gap-0.5 hover:underline font-bold">
                              定位病架架位 <ArrowRight size={10} />
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-100 text-[10px] text-slate-400 text-center">
                  注意：上方汇总表格仅提取书写含有关键错漏信息的册目
                </div>
              </div>

            </div>
          </div>
        )}
      </main>

      {/* Elegant minimalist site footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-5 mt-auto text-slate-400 text-xs shrink-0" id="applet-footer">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center sm:flex sm:items-center sm:justify-between">
          <p className="font-sans">
            本地病案室可视化索引系统 · 医院信息科/档案安全技术处研制
          </p>
          <p className="mt-2 sm:mt-0 font-sans text-[11px] text-slate-500">
            仅作库架状态和病因索引映射参考图样，数据经过严格脱敏
          </p>
        </div>
      </footer>
    </div>
  );
}
