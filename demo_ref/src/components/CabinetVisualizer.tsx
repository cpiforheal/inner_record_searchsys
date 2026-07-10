/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Building2, Layers, BookOpen, AlertTriangle, 
  CheckCircle, ArrowUpRight, HelpCircle, Eye, Map, Minimize2 
} from 'lucide-react';
import { Cabinet, Pile, RecordStatus, LayoutDirection } from '../types';
import { CABINETS } from '../data';

interface CabinetVisualizerProps {
  layout: LayoutDirection;
  piles: Pile[];
  selectedPileId: string | null;
  onSelectPile: (pileId: string) => void;
  selectedCabinetId: number;
  onSelectCabinet: (cabId: number) => void;
}

export default function CabinetVisualizer({
  layout,
  piles,
  selectedPileId,
  onSelectPile,
  selectedCabinetId,
  onSelectCabinet,
}: CabinetVisualizerProps) {
  // Local state to aid Direction C (zooming into a selected aisle cabinet's front grid)
  const [mapZoomedCabinet, setMapZoomedCabinet] = useState<number | null>(null);

  // Status mapping to extract styling
  const getStatusColor = (status: RecordStatus, isSelected: boolean) => {
    switch (status) {
      case 'in-shelf': // Green
        return isSelected 
          ? 'bg-emerald-500 border-2 border-slate-900 ring-2 ring-emerald-300 scale-105 z-10' 
          : 'bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-800';
      case 'borrowed': // Yellow
        return isSelected 
          ? 'bg-amber-500 border-2 border-slate-900 ring-2 ring-amber-300 scale-105 z-10' 
          : 'bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-800';
      case 'problem': // Red
        return isSelected 
          ? 'bg-rose-500 border-2 border-slate-900 ring-2 ring-rose-300 scale-105 z-10 animate-pulse' 
          : 'bg-rose-100 hover:bg-rose-200 border border-rose-300 text-rose-800';
      case 'checking': // Gray
        return isSelected 
          ? 'bg-slate-500 border-2 border-slate-900 ring-2 ring-slate-300 scale-105 z-10' 
          : 'bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800';
      default:
        return 'bg-slate-50 border border-slate-200';
    }
  };

  const getStatusLabelC = (status: RecordStatus) => {
    switch (status) {
      case 'in-shelf': return '在架';
      case 'borrowed': return '借出';
      case 'problem': return '缺陷';
      case 'checking': return '核对';
      default: return '';
    }
  };

  // Renders a single cabinets graphical drawer row board
  const renderSingleCabinetGrid = (cabinet: Cabinet, isCompact: boolean = false) => {
    const cabinetPiles = piles.filter(p => p.cabinetId === cabinet.id);
    
    // Rows are usually numbered 1 to rowsCount, top-to-bottom or bottom-to-top. Let's do top row is Row 1.
    const rows = Array.from({ length: cabinet.rowsCount }, (_, index) => index + 1);
    
    return (
      <div 
        key={cabinet.id} 
        id={`cabinet-rendered-${cabinet.id}`}
        className={`bg-[#FAF7F0] border-4 border-[#8B5A2B] rounded-xl shadow-md p-1.5 flex flex-col justify-between transition-all duration-200 ${
          selectedCabinetId === cabinet.id ? 'ring-4 ring-indigo-500/30 border-[#5F3B1D]' : ''
        } ${isCompact ? 'min-h-[160px]' : 'min-h-[360px]'}`}
      >
        {/* Wood Texture Cabinet Header */}
        <div className="bg-[#5F3B1D] text-[#FFF8ED] py-1 px-2 rounded flex items-center justify-between text-[11px] font-semibold tracking-wide mb-1.5 shadow-sm">
          <span className="truncate flex items-center gap-1 font-mono">
            <Building2 size={11} /> 
            {cabinet.code} ({cabinet.rowsCount}层)
          </span>
          <span className="text-[9px] opacity-80 font-normal">
            {cabinet.id}号柜
          </span>
        </div>

        {/* Shelving shelves list */}
        <div className="flex flex-col gap-1.5 flex-1 justify-between">
          {rows.map((rowId) => {
            // Find piles on this row (e.g., piles 1 to pilesPerRow)
            const rowPiles = cabinetPiles.filter(p => p.rowId === rowId);

            return (
              <div 
                key={rowId} 
                className="relative flex-1 flex flex-col justify-end"
              >
                {/* Horizontal Shelf board panel */}
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#8B5A2B] shadow-sm z-0"></div>
                
                {/* Pile cubes listing */}
                <div className="flex items-end justify-between px-0.5 pb-0.5 gap-1 z-10 relative">
                  {/* Left row index indicator */}
                  <div className="text-[9px] font-semibold text-[#8B5A2B]/80 font-mono w-3 shrink-0 select-none pb-0.5">
                    R{rowId}
                  </div>

                  <div className="flex-1 flex gap-0.5 justify-around items-end">
                    {Array.from({ length: cabinet.pilesPerRow }, (_, pileIdx) => {
                      const pileId = pileIdx + 1;
                      const pile = rowPiles.find(p => p.pileId === pileId);
                      
                      if (!pile) {
                        return (
                          <div 
                            key={pileId} 
                            className="bg-stone-50 border border-dashed border-stone-200 flex-1 rounded text-[8px] flex items-center justify-center text-slate-300"
                            style={{ height: isCompact ? '16px' : '36px' }}
                          >
                            空
                          </div>
                        );
                      }

                      const isSelected = selectedPileId === pile.id;

                      return (
                        <button
                          key={pile.id}
                          id={`pile-box-${pile.id}`}
                          onClick={() => {
                            onSelectCabinet(cabinet.id);
                            onSelectPile(pile.id);
                          }}
                          className={`flex-1 rounded flex flex-col items-center justify-center transition-all ${getStatusColor(pile.status, isSelected)}`}
                          style={{ height: isCompact ? '20px' : '52px' }}
                          title={`架位: ${pile.id} [${getStatusLabelC(pile.status)}]\n年月: ${pile.yearMonthRange}\n共计: ${pile.recordsCount}册`}
                        >
                          {/* Inside visual binders or folders for aesthetic texture */}
                          {!isCompact && (
                            <div className="flex flex-col items-center justify-center w-full h-full p-0.5 overflow-hidden">
                              {/* Mono label */}
                              <span className="text-[10px] font-bold font-mono tracking-tighter block leading-none">
                                P{String(pileId).padStart(2, '0')}
                              </span>
                              
                              {/* Stack of records preview line representing density */}
                              <div className="flex justify-center gap-0.5 mt-1 w-full px-1">
                                <span className={`h-1 flex-1 rounded-sm ${isSelected ? 'bg-slate-900' : 'bg-slate-500/50'}`}></span>
                                <span className={`h-1.5 flex-1 rounded-sm ${isSelected ? 'bg-slate-900' : 'bg-slate-500/50'}`}></span>
                                {pile.recordsCount > 12 && (
                                  <span className={`h-1.2 flex-1 rounded-sm ${isSelected ? 'bg-slate-900' : 'bg-slate-500/50'}`}></span>
                                )}
                              </div>
                              
                              {/* Status indicators */}
                              <span className="text-[8px] font-sans scale-90 translate-y-0.5 opacity-95 block leading-none select-none">
                                {pile.recordsCount}册
                              </span>
                            </div>
                          )}

                          {isCompact && (
                            <span className="text-[8px] font-mono leading-none block font-extrabold">
                              {pileId}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Wood Texture Plinth base Footer */}
        <div className="mt-1 bg-[#5F3B1D]/90 px-1 py-0.5 rounded text-[9px] text-[#EAD0A8] text-center font-medium truncate">
          {cabinet.name.replace(/\d+号/, '')}
        </div>
      </div>
    );
  };

  // ==========================================
  // Layout Direction A (Left Side Detailed visual racks)
  // ==========================================
  const renderLayoutA = () => {
    return (
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4" id="visualizer-layout-a">
        {CABINETS.map((cabinet) => {
          const isSelectedCabinet = selectedCabinetId === cabinet.id;
          return (
            <div 
              key={cabinet.id} 
              className={`flex flex-col gap-2 transition-all duration-300 ${
                isSelectedCabinet ? 'scale-[1.01] z-10' : 'opacity-90 hover:opacity-100'
              }`}
              onClick={() => onSelectCabinet(cabinet.id)}
            >
              <div className="flex items-center justify-between px-1.5">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <span className={`inline-block h-2 w-2 rounded-full ${isSelectedCabinet ? 'bg-indigo-600' : 'bg-slate-300'}`}></span>
                  {cabinet.code}号柜
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {piles.filter(p => p.cabinetId === cabinet.id).reduce((sum, current) => sum + current.recordsCount, 0)} 册
                </span>
              </div>
              
              {renderSingleCabinetGrid(cabinet)}
            </div>
          );
        })}
      </div>
    );
  };

  // ==========================================
  // Layout Direction B (Top 5 Small cabinets view)
  // ==========================================
  const renderLayoutB = () => {
    return (
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3" id="visualizer-layout-b">
        {CABINETS.map((cabinet) => {
          const isSelected = selectedCabinetId === cabinet.id;
          return (
            <div 
              key={cabinet.id}
              className={`cursor-pointer transition-all duration-200 ${
                isSelected ? 'ring-2 ring-indigo-500 shadow' : 'opacity-85 hover:opacity-100'
              }`}
              onClick={() => onSelectCabinet(cabinet.id)}
            >
              <div className="flex items-center justify-between px-1 py-0.5 bg-slate-100 border-x border-t border-slate-200 rounded-t-lg">
                <span className="text-[11px] font-bold text-slate-700 truncate">{cabinet.name}</span>
                <span className="text-[9px] text-slate-500 font-mono bg-white px-1 border rounded">C0{cabinet.id}</span>
              </div>
              {renderSingleCabinetGrid(cabinet, true)}
            </div>
          );
        })}
      </div>
    );
  };

  // ==========================================
  // Layout Direction C (Hospital Record Archives Map layout overview)
  // ==========================================
  const renderLayoutC = () => {
    // 2D clinical corridor map representing physical layout of archives room of a compact specialized clinic
    const mapCabinetsCoordinates = [
      { id: 1, name: 'C01号骨科柜', gridArea: 'col-start-1 col-end-2 row-start-2 row-end-8', color: 'border-amber-700 bg-amber-50/10' },
      { id: 2, name: 'C02号内科柜', gridArea: 'col-start-3 col-end-4 row-start-2 row-end-8', color: 'border-amber-700 bg-amber-50/10' },
      { id: 3, name: 'C03号儿科柜', gridArea: 'col-start-5 col-end-6 row-start-2 row-end-8', color: 'border-amber-700 bg-amber-50/10' },
      { id: 4, name: 'C04号五官柜', gridArea: 'col-start-7 col-end-8 row-start-2 row-end-8', color: 'border-amber-700 bg-amber-50/10' },
      { id: 5, name: 'C05号肿瘤柜', gridArea: 'col-start-9 col-end-10 row-start-2 row-end-8', color: 'border-amber-700 bg-amber-50/10' },
    ];

    return (
      <div className="flex flex-col gap-4" id="visualizer-layout-c">
        {mapZoomedCabinet ? (
          /* Zoomed-in Cabinet view overlay with back button */
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm animate-fadeIn" id="corridor-detail-view">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center p-2 rounded-lg bg-indigo-50 text-indigo-600">
                  <Building2 size={18} />
                </span>
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">
                    {CABINETS.find(c => c.id === mapZoomedCabinet)?.name}
                  </h4>
                  <p className="text-xs text-slate-400">
                    档案柜立体定位及微堆状态透视视图
                  </p>
                </div>
              </div>
              <button
                id="quit-zoom-btn"
                onClick={() => setMapZoomedCabinet(null)}
                className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 transition-colors px-3 py-1.5 rounded-lg text-slate-600 text-xs font-medium"
              >
                <Minimize2 size={13} />
                返回科室总览平面图
              </button>
            </div>

            <div className="max-w-2xl mx-auto">
              {renderSingleCabinetGrid(CABINETS.find(c => c.id === mapZoomedCabinet)!)}
            </div>
          </div>
        ) : (
          /* Corridor top-down map plan representation */
          <div className="bg-slate-100/50 border border-slate-200/60 rounded-2xl p-6 relative shadow-inner flex flex-col items-stretch overflow-hidden">
            {/* Map Header details */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-1.5">
                <Map size={16} className="text-slate-500" />
                <span className="text-xs font-bold text-slate-700">科室病案库房（平面摆放鸟瞰图）</span>
              </div>
              <div className="flex items-center gap-3 text-slate-400 text-[10px]">
                <span>【双击/点击柜位】放大剖面查阅每一摞明细</span>
                <span className="inline-block h-3 w-0.5 bg-slate-300"></span>
                <span className="flex items-center gap-1 font-mono text-slate-500">
                  <span className="h-2 w-2 bg-slate-300 border rounded-sm"></span> 门禁通道
                </span>
              </div>
            </div>

            {/* Grid Map Blueprint container */}
            <div className="grid grid-cols-11 grid-rows-8 gap-1.5 bg-white border border-slate-200/80 rounded-xl relative p-6 h-80 shadow-sm" id="archives-chamber-map">
              
              {/* Entrance Gate representation */}
              <div className="col-start-1 col-end-2 row-start-8 row-end-9 bg-slate-400 text-slate-800 flex items-center justify-center text-[10px] font-bold border border-slate-500 rounded-b">
                安全出入口
              </div>

              {/* Fire Safety Icon / Hydrant */}
              <div className="col-start-11 col-end-12 row-start-1 row-end-2 bg-red-100 text-red-700 border border-red-200 flex items-center justify-center text-[9px] font-bold rounded">
                灭火站
              </div>

              {/* Quality Desk */}
              <div className="col-start-11 col-end-12 row-start-6 row-end-8 bg-slate-50 border border-slate-200 text-slate-500 flex items-center justify-center text-[9px] text-center p-1 rounded font-mono">
                微型<br />核对桌
              </div>

              {/* Shelf Ailes loop */}
              {mapCabinetsCoordinates.map((cab) => {
                const actualCabObj = CABINETS.find(c => c.id === cab.id)!;
                const isSelected = selectedCabinetId === cab.id;
                
                // Count status details for labeling
                const cabPiles = piles.filter(p => p.cabinetId === cab.id);
                const hasProblem = cabPiles.some(p => p.status === 'problem');
                const hasBorrowed = cabPiles.some(p => p.status === 'borrowed');

                return (
                  <button
                    key={cab.id}
                    id={`map-aisle-cabinet-${cab.id}`}
                    onClick={() => {
                      onSelectCabinet(cab.id);
                      setMapZoomedCabinet(cab.id);
                    }}
                    className={`flex flex-col items-center justify-center border-2 rounded-lg transition-all text-center p-2 relative ${cab.gridArea} ${
                      isSelected 
                        ? 'border-indigo-600 bg-indigo-50/50 hover:bg-indigo-50 shadow-md scale-[1.01] z-10' 
                        : 'border-[#8B5A2B] bg-[#FFF9F2] hover:bg-[#FAF0E6]/90 shadow-sm'
                    }`}
                  >
                    {/* Visual pile handles representing a cabinet */}
                    <div className="w-1.5 h-1/3 bg-slate-400 absolute left-1 rounded-sm"></div>
                    <div className="w-1.5 h-1/3 bg-slate-400 absolute right-1 rounded-sm"></div>

                    <div className="text-xs font-bold text-slate-800 leading-tight">
                      C0{cab.id} 柜
                    </div>
                    <div className="text-[9px] text-slate-500 mt-1 max-w-[54px] truncate">
                      {actualCabObj.name.split('/')[0].replace(/\d+号/, '')}
                    </div>

                    {/* Status marker tags at map level */}
                    <div className="flex gap-1 mt-2.5">
                      {hasProblem && (
                        <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" title="含缺陷病历"></span>
                      )}
                      {hasBorrowed && (
                        <span className="h-2 w-2 rounded-full bg-amber-400" title="外借中"></span>
                      )}
                      {!hasProblem && !hasBorrowed && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500" title="状态全部正常"></span>
                      )}
                    </div>

                    {/* Hotspot indicator button */}
                    <span className="absolute bottom-1.5 text-[8px] bg-slate-100 border text-slate-500 px-1 py-0.2 rounded font-sans opacity-0 group-hover:opacity-100 transition-opacity">
                      进入详情
                    </span>
                  </button>
                );
              })}

              {/* Text indicator for corridor aisles representation */}
              <div className="col-start-2 col-end-11 row-start-5 row-end-6 flex justify-around items-center text-[10px] text-slate-400 pointer-events-none select-none">
                <span>← 库房主通道一（宽1.2m） →</span>
                <span>← 库房主通道二（宽1.2m） →</span>
              </div>
            </div>
            
            <div className="mt-3 text-center text-[11px] text-slate-400 flex items-center justify-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600"></span>
              库架布局严格对照消防间距，双击纸质柜即进入单柜 3D 水平刨面，检索特定病历摞。
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div id="cabinet-visualizer-root" className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
      {/* Legend Indicator Map bar inside dashboard */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4 border-b border-slate-100 pb-3" id="visualizer-header">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-slate-500 animate-spin-slow" />
          <h2 className="text-sm font-bold text-slate-800">
            {layout === 'A' && '医院纸质病案柜格立体分布图（方向 A）'}
            {layout === 'B' && '药审及问题台账对照一览表（方向 B）'}
            {layout === 'C' && '院内病案室平面库位布置图（方向 C）'}
          </h2>
        </div>

        {/* Legend status markers */}
        <div className="flex flex-wrap items-center gap-3.5 text-[11px] text-slate-500 font-sans">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 bg-emerald-100 border border-emerald-300 rounded-md"></span>
            在架正常
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 bg-amber-100 border border-amber-300 rounded-md"></span>
            部分借阅
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 bg-rose-100 border border-rose-300 rounded-md"></span>
            书写缺陷
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 bg-slate-100 border border-slate-300 rounded-md"></span>
            待核对
          </span>
        </div>
      </div>

      {/* Main Switch renderer */}
      <div id="visualizer-stage">
        {layout === 'A' && renderLayoutA()}
        {layout === 'B' && renderLayoutB()}
        {layout === 'C' && renderLayoutC()}
      </div>
    </div>
  );
}
