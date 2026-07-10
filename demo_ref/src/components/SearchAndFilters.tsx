/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Search, MapPin, User, FileText, CheckCircle2, ChevronRight, X } from 'lucide-react';
import { MedicalRecord, Pile } from '../types';

interface SearchAndFiltersProps {
  records: MedicalRecord[];
  piles: Pile[];
  onSelectPile: (pileId: string, recordId?: string) => void;
}

export default function SearchAndFilters({ records, piles, onSelectPile }: SearchAndFiltersProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<(
    | { type: 'record'; id: string; name: string; inpatientNo: string; position: string; status: string; record: MedicalRecord }
    | { type: 'pile'; id: string; position: string; yearMonth: string; recordsCount: number; status: string }
  )[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close suggestions on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update suggestions on search query change
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    const lowerQuery = query.toLowerCase().trim();
    const results: typeof suggestions = [];

    // 1. Search location codes (piles)
    const matchedPiles = piles.filter(
      p => p.id.toLowerCase().includes(lowerQuery)
    );
    for (const p of matchedPiles.slice(0, 5)) {
      results.push({
        type: 'pile',
        id: p.id,
        position: p.id,
        yearMonth: p.yearMonthRange,
        recordsCount: p.recordsCount,
        status: p.status,
      });
    }

    // 2. Search medical records (by name or inpatientNo)
    const matchedRecords = records.filter(
      r =>
        r.name.toLowerCase().includes(lowerQuery) ||
        r.inpatientNo.toLowerCase().includes(lowerQuery)
    );
    for (const r of matchedRecords.slice(0, 8)) {
      const positionCode = `C${String(r.cabinetId).padStart(2, '0')}-R${String(r.rowId).padStart(2, '0')}-P${String(r.pileId).padStart(2, '0')}`;
      results.push({
        type: 'record',
        id: r.id,
        name: r.name,
        inpatientNo: r.inpatientNo,
        position: positionCode,
        status: r.status,
        record: r,
      });
    }

    setSuggestions(results);
  }, [query, records, piles]);

  const handleSelectSuggestion = (item: typeof suggestions[0]) => {
    if (item.type === 'pile') {
      onSelectPile(item.id);
    } else {
      onSelectPile(item.position, item.id);
    }
    setQuery('');
    setIsFocused(false);
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'in-shelf':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'borrowed':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'problem':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'checking':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const getStatusLabelCn = (status: string) => {
    switch (status) {
      case 'in-shelf': return '在架';
      case 'borrowed': return '已借出';
      case 'problem': return '问题/缺陷';
      case 'checking': return '待核对';
      default: return '未知';
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xl" id="search-container">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
          <Search size={18} />
        </div>
        <input
          id="global-search-input"
          type="text"
          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl py-2.5 pl-10 pr-9 text-sm placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 transition-all font-sans"
          placeholder="关键词搜索 姓名 / 住院号 (如 ZY2026...) / 位置编码 (如 C03-R02-P01)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsFocused(true);
          }}
          onFocus={() => setIsFocused(true)}
        />
        {query && (
          <button
            id="clear-search-btn"
            onClick={() => setQuery('')}
            className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {isFocused && suggestions.length > 0 && (
        <div
          id="search-suggestions"
          className="absolute z-50 w-full mt-1.5 bg-white border border-slate-200/80 rounded-xl shadow-lg max-h-80 overflow-y-auto divide-y divide-slate-100"
        >
          <div className="px-3.5 py-2 text-[10px] font-semibold text-slate-400 bg-slate-50/50 uppercase tracking-widest">
            匹配索引结果
          </div>
          {suggestions.map((item) => (
            <button
              key={`${item.type}-${item.id}`}
              id={`search-item-${item.id}`}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50/75 transition-colors group"
              onClick={() => handleSelectSuggestion(item)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-lg shrink-0 ${
                  item.type === 'pile' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-600'
                }`}>
                  {item.type === 'pile' ? <MapPin size={16} /> : <User size={16} />}
                </div>
                <div className="min-w-0">
                  {item.type === 'pile' ? (
                    <div>
                      <span className="font-semibold text-sm font-mono text-slate-800">
                        {item.position}
                      </span>
                      <span className="text-xs text-slate-400 ml-2">
                        （一摞共 {item.recordsCount} 份病历 - {item.yearMonth}）
                      </span>
                    </div>
                  ) : (
                    <div>
                      <span className="font-semibold text-sm text-slate-800">
                        {item.name}
                      </span>
                      <span className="text-xs font-mono text-slate-400 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded ml-2">
                        {item.inpatientNo}
                      </span>
                      <span className="text-xs text-slate-500 block mt-0.5">
                        定位于架位 <span className="font-mono bg-indigo-50 text-indigo-700 px-1 py-0.2 rounded font-medium text-[11px]">{item.position}</span> · 第 {item.record.volumeNo} 本
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[10px] px-2 py-0.5 font-medium rounded-full border ${getStatusBadgeClass(item.status)}`}>
                  {getStatusLabelCn(item.status)}
                </span>
                <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}

      {isFocused && query.trim() && suggestions.length === 0 && (
        <div id="search-no-results" className="absolute z-50 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg p-6 text-center text-slate-400">
          <FileText className="mx-auto mb-2 text-slate-300" size={24} />
          <span className="text-xs">未找到匹配的病本患者或柜位编码</span>
        </div>
      )}
    </div>
  );
}
