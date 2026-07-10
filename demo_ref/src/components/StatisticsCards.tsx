/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Database, CheckCircle, ArrowUpRight, AlertCircle, RefreshCw } from 'lucide-react';
import { GlobalStats } from '../types';

interface StatisticsCardsProps {
  stats: GlobalStats;
}

export default function StatisticsCards({ stats }: StatisticsCardsProps) {
  const cards = [
    {
      id: 'total',
      label: '已建索引',
      value: stats.totalRecords.toLocaleString(),
      sub: '纸质病历电子化',
      icon: Database,
      bgColor: 'bg-slate-50 border-slate-200/60',
      iconColor: 'text-slate-600 bg-slate-100',
      textColor: 'text-slate-900',
    },
    {
      id: 'on-shelf',
      label: '在架病历',
      value: stats.onShelfRecords.toLocaleString(),
      sub: '库房内可供查阅',
      icon: CheckCircle,
      bgColor: 'bg-emerald-50/50 border-emerald-100',
      iconColor: 'text-emerald-600 bg-emerald-50',
      textColor: 'text-emerald-700',
    },
    {
      id: 'borrowed',
      label: '借出病历',
      value: stats.borrowedRecords.toLocaleString(),
      sub: '临床科室借阅中',
      icon: ArrowUpRight,
      bgColor: 'bg-amber-50/50 border-amber-100',
      iconColor: 'text-amber-600 bg-amber-50',
      textColor: 'text-amber-700',
    },
    {
      id: 'problem',
      label: '问题病历',
      value: stats.problemRecords.toLocaleString(),
      sub: '书写缺陷/缺漏项',
      icon: AlertCircle,
      bgColor: 'bg-rose-50/50 border-rose-100',
      iconColor: 'text-rose-600 bg-rose-50',
      textColor: 'text-rose-700',
    },
    {
      id: 'rectified',
      label: '待整改',
      value: stats.pendingRectification.toLocaleString(),
      sub: '限期要求医生纠正',
      icon: RefreshCw,
      bgColor: 'bg-indigo-50/50 border-indigo-100',
      iconColor: 'text-indigo-600 bg-indigo-50',
      textColor: 'text-indigo-700',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3.5" id="stats-section">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.id}
            id={`stat-card-${card.id}`}
            className={`border rounded-xl p-4 flex items-start justify-between transition-all hover:shadow-sm duration-200 ${card.bgColor}`}
          >
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-slate-500 block truncate">
                {card.label}
              </span>
              <span className={`text-2xl font-bold font-mono tracking-tight block my-1 ${card.textColor}`}>
                {card.value}
              </span>
              <span className="text-[10px] text-slate-400 block truncate">
                {card.sub}
              </span>
            </div>
            <div className={`p-2 rounded-lg shrink-0 ${card.iconColor}`}>
              <Icon size={18} strokeWidth={2} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
