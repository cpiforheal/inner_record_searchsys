import {
  AlertCircle, ArrowLeftRight, ArrowRight, BookOpen, Building2, CheckCircle,
  ChevronLeft, ChevronRight, Clock3, ClipboardCheck, ClipboardList, Database, Download,
  Edit3, FileText, Flag, FolderInput, HardDriveDownload, History, Library, ListCollapse, MapPin, Menu, Plus,
  RefreshCw, RotateCcw, Save, Search, ShieldCheck, Trash2, Users, Wrench, X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { api } from "./api/client.js";

const DEFAULT_CABINET_SHAPES = [
  { id: "C01", no: 1, name: "1号架", rows: 6, stacksPerRow: 6 },
  { id: "C02", no: 2, name: "2号架", rows: 5, stacksPerRow: 7 },
  { id: "C03", no: 3, name: "3号架", rows: 6, stacksPerRow: 7 },
  { id: "C04", no: 4, name: "4号架", rows: 5, stacksPerRow: 6 },
  { id: "C05", no: 5, name: "5号架", rows: 6, stacksPerRow: 6 },
];
const STANDARD_BOOKS_PER_STACK = 25;
const MAX_OVERFLOW_BOOK_INDEX = 99;
const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function pad(v) { return String(v).padStart(2, "0"); }

function parseLocationId(locationId) {
  const match = String(locationId || "").match(/^C(\d+)-R(\d+)-P(\d+)$/i);
  if (!match) return null;
  const cabinet_no = Number(match[1]);
  const row_no = Number(match[2]);
  const stack_no = Number(match[3]);
  if (![cabinet_no, row_no, stack_no].every(Number.isInteger)) return null;
  return {
    cabinet_no,
    row_no,
    stack_no,
    cabinet_id: `C${pad(cabinet_no)}`,
  };
}

function formatPositionCode(locationId, bookIndex) {
  if (locationId === "__POOL__") return "暂存";
  const parsed = parseLocationId(locationId);
  if (!parsed) return locationId || "";
  const book = pad(bookIndex || 0);
  if (parsed.cabinet_no <= 9 && parsed.row_no <= 9 && parsed.stack_no <= 9) {
    return `${parsed.cabinet_no}${parsed.row_no}${parsed.stack_no}${book}`;
  }
  return `${parsed.cabinet_id}-R${pad(parsed.row_no)}-P${pad(parsed.stack_no)}-${book}`;
}

function deriveCabinetShapes(locations = []) {
  const byCabinet = new Map();
  locations.filter(l => l.id !== "__POOL__").forEach(loc => {
    const no = Number(loc.cabinet_no) || 0;
    if (!no) return;
    const current = byCabinet.get(no) || {
      id: `C${pad(no)}`,
      no,
      name: `${no}号架`,
      rows: 0,
      stacksPerRow: 0,
    };
    current.rows = Math.max(current.rows, Number(loc.row_no) || 0);
    current.stacksPerRow = Math.max(current.stacksPerRow, Number(loc.stack_no) || 0);
    byCabinet.set(no, current);
  });
  const shapes = [...byCabinet.values()].sort((a, b) => a.no - b.no).map(shape => {
    const defaultShape = DEFAULT_CABINET_SHAPES.find(c => c.no === shape.no);
    return { ...shape, name: defaultShape?.name || shape.name };
  });
  return shapes.length > 0 ? shapes : DEFAULT_CABINET_SHAPES;
}

// 生成位置编号：书架号+排号+摞号+本序号（两位）
// eg: 11101 = 第1书架 第1排 第1摞 第01本
// 每摞标准容量为25本；第26本以后属于现场超容量追加。
function genLocationCode(record) {
  return formatPositionCode(record.location_id || "", record.book_index || 0);
}

function hasMissingInfo(record) {
  return Boolean(record?.has_missing_info);
}

function hasOverflow(record) {
  return Boolean(record?.has_overflow) || Number(record?.book_index) > STANDARD_BOOKS_PER_STACK;
}

function normalizePatientName(record) {
  return String(record?.patient_name || "").trim();
}

function getDuplicateNameSet(records = []) {
  const counts = new Map();
  records.forEach(record => {
    const name = normalizePatientName(record);
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function hasDuplicateNameInStack(record, duplicateNames) {
  const name = normalizePatientName(record);
  return Boolean(name && duplicateNames?.has(name));
}

function countDuplicateNameRecords(records = [], duplicateNames = getDuplicateNameSet(records)) {
  return records.filter(record => hasDuplicateNameInStack(record, duplicateNames)).length;
}

function formatYearMonth(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "未设置月份";
  return `${match[1]}年${Number(match[2])}月`;
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

// ═══════════════════════════════════════════════
// App
// ═══════════════════════════════════════════════
function App() {
  const [page, setPage] = useState("shelf");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedPileId, setSelectedPileId] = useState("C01-R01-P01");
  const [selectedCabinetId, setSelectedCabinetId] = useState("C01");
  const [cabinetShapes, setCabinetShapes] = useState(DEFAULT_CABINET_SHAPES);
  const [cabinetData, setCabinetData] = useState([]);
  const [shelfRecords, setShelfRecords] = useState([]);
  const [stats, setStats] = useState({ total: 0, borrowed: 0, available: 0, pending: 0, locations: 0 });
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [highlightId, setHighlightId] = useState(null);
  const [poolHighlightId, setPoolHighlightId] = useState(null);
  const [borrowModal, setBorrowModal] = useState(null);
  const [issueModal, setIssueModal] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [toast, setToast] = useState(null);
  const [issuesList, setIssuesList] = useState([]);
  const [shelfManagerOpen, setShelfManagerOpen] = useState(false);
  const [moveModal, setMoveModal] = useState(null);
  const [positionConflict, setPositionConflict] = useState(null);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [timelineRecordId, setTimelineRecordId] = useState(null);
  const [pileActionModal, setPileActionModal] = useState(null);
  const searchTimer = useRef(null);
  const highlightTimer = useRef(null);
  const mainScrollRef = useRef(null);

  useEffect(() => { loadStats(); loadShelfLayout(); loadCabinetData(1); loadIssues(); }, []);
  useEffect(() => { if (selectedPileId) loadShelfRecords(selectedPileId); }, [selectedPileId]);
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  async function loadStats() { try { setStats(await api.getOverview()); } catch (e) { console.error(e); } }
  async function loadShelfLayout(preferredCabinetId = selectedCabinetId) {
    try {
      const shapes = deriveCabinetShapes(await api.getLocations());
      setCabinetShapes(shapes);
      if (!shapes.some(c => c.id === preferredCabinetId)) {
        const next = shapes[0];
        if (next) {
          setSelectedCabinetId(next.id);
          setSelectedPileId(`${next.id}-R01-P01`);
          loadCabinetData(next.no);
        }
      }
    } catch (e) { console.error(e); }
  }
  async function loadCabinetData(no) { try { setCabinetData(await api.getCabinetStats(no)); } catch (e) { console.error(e); } }
  async function loadShelfRecords(locId) { try { const r = await api.getRecordsByLocation(locId); setShelfRecords(r.data || []); } catch (e) { console.error(e); } }
  async function loadIssues() { try { setIssuesList(await api.getIssuesList(20)); } catch (e) { console.error(e); } }
  async function refreshPileContext(locId = selectedPileId) {
    const parsed = parseLocationId(locId);
    await Promise.all([
      locId === selectedPileId ? loadShelfRecords(locId) : Promise.resolve(),
      loadStats(),
      loadIssues(),
      parsed ? loadCabinetData(parsed.cabinet_no) : Promise.resolve(),
    ]);
  }

  function handleSearch(value) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try { const r = await api.searchRecords(value.trim()); setSearchResults(r.data || []); } catch (e) { console.error(e); }
    }, 300);
  }
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 2500); }
  function handlePositionConflict(error) {
    if (error?.code !== "POSITION_CONFLICT") return false;
    setPositionConflict(error);
    return true;
  }
  function syncSelectedPile(locId) {
    const parsed = parseLocationId(locId);
    if (!parsed) return;
    const cabId = parsed.cabinet_id;
    setSelectedPileId(locId);
    if (cabId !== selectedCabinetId) { setSelectedCabinetId(cabId); setCabinetData([]); loadCabinetData(parsed.cabinet_no); }
  }
  function selectPile(locId) {
    syncSelectedPile(locId);
    setPage("shelf");
  }
  function selectSearchResult(r) {
    if (r.location_id === "__POOL__") {
      setPage("pool");
      setHighlightId(null);
      setPoolHighlightId(r.id);
      setQuery("");
      setSearchResults([]);
      showToast(`${r.patient_name} 当前在暂存池，尚未分配书架位置`);
      requestAnimationFrame(() => mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setPoolHighlightId(null), 6000);
      return;
    }
    selectPile(r.location_id);
    setHighlightId(r.id);
    setPoolHighlightId(null);
    setQuery("");
    setSearchResults([]);
    requestAnimationFrame(() => mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 4500);
  }
  async function handlePoolAssigned(locationId, assigned = []) {
    const assignedList = Array.isArray(assigned) ? assigned : [];
    const parsed = parseLocationId(locationId);
    await Promise.all([loadStats(), loadShelfLayout(parsed?.cabinet_id || selectedCabinetId)]);
    if (!locationId || locationId === "__POOL__") {
      const current = parseLocationId(selectedPileId);
      if (current) loadCabinetData(current.cabinet_no);
      return;
    }

    setPage("shelf");
    setSelectedPileId(locationId);
    if (parsed) {
      setSelectedCabinetId(parsed.cabinet_id);
      setCabinetData([]);
      await loadCabinetData(parsed.cabinet_no);
    }
    await loadShelfRecords(locationId);

    const firstAssigned = assignedList[0];
    const highlightRecordId = typeof firstAssigned === "object" ? firstAssigned?.id : firstAssigned;
    if (highlightRecordId) {
      setHighlightId(highlightRecordId);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightId(null), 4500);
    }
    requestAnimationFrame(() => mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }

  async function handleBorrowClick(record) {
    if (record.archive_status === "借出") {
      const active = await api.getActiveBorrows();
      const log = active.find(b => b.record_id === record.id);
      if (log) { await api.returnRecord(log.id, {}); showToast(`已归还：${record.patient_name}`); loadShelfRecords(selectedPileId); loadStats(); loadIssues(); loadCabinetData(parseInt(selectedCabinetId.slice(1))); }
    } else { setBorrowModal(record); }
  }
  async function confirmBorrow(data) {
    try { await api.borrowRecord({ record_id: borrowModal.id, borrower: data.borrower, department: data.department, purpose: data.purpose }); showToast(`已借出：${borrowModal.patient_name}`); setBorrowModal(null); loadShelfRecords(selectedPileId); loadStats(); loadCabinetData(parseInt(selectedCabinetId.slice(1))); } catch (e) { showToast(`失败：${e.message}`); }
  }
  async function handleAddRecord(data) {
    try {
      const r = await api.createRecord({
        patient_name: data.name,
        inpatient_no: data.inpatientNo,
        discharge_date: data.dischargeDate || null,
        location_id: selectedPileId,
        allow_overflow: data.allowOverflow,
        force_overflow: data.allowOverflow,
      });
      showToast(`已录入：${data.name}，第${r.book_index}本`);
      loadShelfRecords(selectedPileId);
      loadStats();
      loadCabinetData(parseInt(selectedCabinetId.slice(1)));
    } catch (e) {
      if (handlePositionConflict(e)) {
        loadShelfRecords(selectedPileId);
        loadStats();
        loadCabinetData(parseInt(selectedCabinetId.slice(1)));
      } else {
        showToast(`录入失败：${e.message}`);
      }
    }
  }
  async function handleReportIssue(record, desc) {
    try {
      await api.reportIssue(record.id, { issue_type: desc.split("：")[0] || desc, description: desc });
      showToast(`已登记缺陷：${record.patient_name}`);
      setIssueModal(null); loadShelfRecords(selectedPileId); loadStats(); loadIssues(); loadCabinetData(parseInt(selectedCabinetId.slice(1)));
    } catch (e) { showToast(`登记失败：${e.message}`); }
  }
  async function handleEditRecord(id, data) {
    try {
      await api.updateRecord(id, data);
      showToast("修改成功");
      loadShelfRecords(selectedPileId);
    } catch (e) {
      if (handlePositionConflict(e)) {
        loadShelfRecords(selectedPileId);
        loadStats();
        loadCabinetData(parseInt(selectedCabinetId.slice(1)));
      } else {
        showToast(`修改失败：${e.message}`);
      }
    }
  }
  async function handleDeleteRecord(id) {
    try { await api.deleteRecord(id); showToast("删除成功"); loadShelfRecords(selectedPileId); loadStats(); loadCabinetData(parseInt(selectedCabinetId.slice(1))); } catch (e) { showToast(`删除失败：${e.message}`); }
  }
  async function handleReturnRecordsToPool(ids) {
    const recordIds = [...new Set((ids || []).map(Number).filter(Number.isFinite))];
    if (recordIds.length === 0) return;
    try {
      const result = await api.assignFromPool({ record_ids: recordIds, location_id: "__POOL__" });
      showToast(result.message || `已退回暂存池 ${recordIds.length} 份`);
      setSearchResults(prev => prev.map(r => recordIds.includes(r.id) ? { ...r, location_id: "__POOL__", book_index: 0 } : r));
      loadShelfRecords(selectedPileId);
      loadStats();
      loadCabinetData(parseInt(selectedCabinetId.slice(1)));
    } catch (e) {
      showToast(`退回失败：${e.message}`);
    }
  }
  async function handleUpdateYearMonth(locId, ym) {
    try { await api.updateLocation(locId, { year_month: ym }); loadCabinetData(parseInt(selectedCabinetId.slice(1))); } catch (e) { showToast(`更新失败：${e.message}`); }
  }
  async function handleToggleMissingInfo(record) {
    const marked = !hasMissingInfo(record);
    try {
      await api.setMissingInfo(record.id, marked);
      const patchFlag = (r) => r.id === record.id ? { ...r, has_missing_info: marked ? 1 : 0 } : r;
      setShelfRecords(prev => prev.map(patchFlag));
      setSearchResults(prev => prev.map(patchFlag));
      loadCabinetData(parseInt(selectedCabinetId.slice(1)));
      loadStats();
      showToast(marked ? `已标记占位：${record.patient_name}` : `已取消占位标记：${record.patient_name}`);
    } catch (e) {
      showToast(`标记失败：${e.message}`);
    }
  }
  async function handleShiftRecords(data) {
    try {
      const result = await api.shiftLocationRecords(selectedPileId, data);
      showToast(result.message || "序号校正成功");
      setShiftModalOpen(false);
      loadShelfRecords(selectedPileId);
      loadStats();
      loadCabinetData(parseInt(selectedCabinetId.slice(1)));
    } catch (e) {
      showToast(`校正失败：${e.message}`);
    }
  }

  const pileInfo = cabinetData.find(d => d.location_id === selectedPileId);
  const missingInfoResults = searchResults.filter(hasMissingInfo).length;
  const overflowResults = searchResults.filter(hasOverflow).length;

  // Sidebar nav items
  const navItems = [
    { id: "shelf", icon: Building2, label: "病案架总览" },
    { id: "pool", icon: FolderInput, label: "暂存池" },
    { id: "ocr", icon: FileText, label: "批量导入" },
    { id: "batch", icon: ListCollapse, label: "批量操作" },
    { id: "tools", icon: Wrench, label: "归档工具" },
    { id: "quality", icon: ClipboardList, label: "病历质控", badge: stats.pending },
    { id: "borrows", icon: ArrowLeftRight, label: "借阅管理", badge: stats.borrowed },
    { id: "backups", icon: ShieldCheck, label: "数据备份" },
    { id: "logs", icon: History, label: "操作日志" },
  ];

  // ─── Return ───────────────────────────────────
  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? "w-56" : "w-16"} flex flex-col bg-slate-900 text-white transition-all duration-200`}>
        <div className="flex items-center gap-2 px-4 py-5 border-b border-slate-700">
          <Library className="w-6 h-6 text-blue-400 shrink-0" />
          {sidebarOpen && <span className="font-bold text-sm truncate">中医肛肠医院病历档案管理平台</span>}
        </div>
        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${page === item.id ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}>
              <item.icon className="w-5 h-5 shrink-0" />
              {sidebarOpen && <span className="truncate">{item.label}</span>}
              {sidebarOpen && item.badge > 0 && <span className="ml-auto bg-red-500 text-xs px-1.5 py-0.5 rounded-full">{item.badge}</span>}
            </button>
          ))}
        </nav>
        {sidebarOpen && (
          <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-400 space-y-1">
            <div>总计 {stats.total} 份</div>
            <div>在架 {stats.available} / 借出 {stats.borrowed}</div>
          </div>
        )}
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center justify-center py-3 border-t border-slate-700 text-slate-400 hover:text-white">
          {sidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b px-6 py-3 flex items-center gap-4 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={query} onChange={e => handleSearch(e.target.value)} placeholder="搜索患者姓名/住院号..."
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {searchResults.length > 0 && <button onClick={() => { setQuery(""); setSearchResults([]); }} className="text-xs text-gray-500 hover:text-red-500">清除结果</button>}
          <button onClick={() => setShowAddForm(true)} className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            <Plus className="w-4 h-4" /> 录入
          </button>
        </header>

        {/* 搜索结果强展示区 */}
        {searchResults.length > 0 && (
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-4 shrink-0 overflow-y-auto max-h-[300px]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-blue-900">定位结果 · {searchResults.length} 条</h3>
                {missingInfoResults > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-200 font-bold">
                    <Flag className="w-3 h-3" />占位待补 {missingInfoResults}
                  </span>
                )}
                {overflowResults > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 font-bold">
                    <AlertCircle className="w-3 h-3" />超容量 {overflowResults}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-blue-600">编号规则：书架号+排号+摞号+本序号</span>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {searchResults.slice(0, 12).map(r => {
                const code = genLocationCode(r);
                const isMissingInfo = hasMissingInfo(r);
                const isOverflow = hasOverflow(r);
                const isPoolRecord = r.location_id === "__POOL__";
                return (
                  <div key={r.id} onClick={() => selectSearchResult(r)}
                    className={`group grid grid-cols-[132px_1fr_auto] items-center gap-4 p-4 rounded-lg border cursor-pointer transition shadow-sm ${isPoolRecord ? "bg-amber-50 border-amber-300 hover:border-amber-500 hover:shadow-md" : isOverflow ? "bg-orange-50 border-orange-300 hover:border-orange-500 hover:shadow-md" : isMissingInfo ? "bg-fuchsia-50 border-fuchsia-300 hover:border-fuchsia-500" : "bg-white border-blue-200 hover:border-blue-500 hover:shadow-md"}`}>
                    <div className={`${isPoolRecord ? "bg-amber-600" : isOverflow ? "bg-orange-600" : isMissingInfo ? "bg-fuchsia-700" : "bg-blue-700"} text-white rounded-lg px-3 py-3 shrink-0`}>
                      <div className="text-[10px] font-bold opacity-80 mb-1">{isPoolRecord ? "当前状态" : "目标编号"}</div>
                      <div className={`${isPoolRecord ? "text-2xl" : "font-mono text-3xl"} font-black leading-none tracking-normal`}>{isPoolRecord ? "暂存池" : code}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-black text-2xl text-gray-950 truncate">{r.patient_name}</div>
                        {isPoolRecord && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 font-bold shrink-0">
                            <FolderInput className="w-3 h-3" />未上架
                          </span>
                        )}
                        {isMissingInfo && <MissingInfoBadge compact />}
                        {isOverflow && <OverflowBadge compact />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-gray-700 bg-gray-100 rounded px-2 py-0.5">{r.inpatient_no}</span>
                        <span className={`inline-flex items-center gap-1 font-bold ${isPoolRecord ? "text-amber-700" : isOverflow ? "text-orange-700" : isMissingInfo ? "text-fuchsia-700" : "text-blue-700"}`}>
                          {isPoolRecord ? <FolderInput className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
                          {isPoolRecord ? "暂存池 · 未分配书架位置" : `${r.location_id} · 第${r.book_index}本`}
                        </span>
                      </div>
                      <div className={`mt-2 text-[11px] font-medium ${isPoolRecord ? "text-amber-700 group-hover:text-amber-900" : "text-blue-600 group-hover:text-blue-800"}`}>
                        {isPoolRecord ? "点击后打开暂存池并定位该病历" : "点击后跳转到对应书架并高亮目标病历"}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={r.archive_status} />
                      <ArrowRight className={`w-5 h-5 ${isPoolRecord ? "text-amber-500" : isOverflow ? "text-orange-500" : isMissingInfo ? "text-fuchsia-500" : "text-blue-500"} group-hover:translate-x-0.5 transition`} />
                    </div>
                  </div>
                );
              })}
            </div>
            {searchResults.length > 12 && <p className="text-xs text-blue-500 mt-2 text-center">还有 {searchResults.length - 12} 条结果...</p>}
          </div>
        )}

        {/* Content */}
        <main ref={mainScrollRef} className="flex-1 overflow-y-auto p-6">
          {page === "shelf" && (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-5 gap-4 mb-6">
                <StatCard icon={Database} label="总病历" value={stats.total} color="blue" />
                <StatCard icon={CheckCircle} label="在架" value={stats.available} color="green" />
                <StatCard icon={ArrowRight} label="借出" value={stats.borrowed} color="orange" />
                <StatCard icon={AlertCircle} label="待整改" value={stats.pending} color="red" />
                <StatCard icon={MapPin} label="位置数" value={stats.locations} color="purple" />
              </div>
              {/* Grid: cabinets + details */}
              <div className="grid grid-cols-12 gap-6">
                <div className="col-span-8 min-w-0 overflow-hidden">
                  <CabinetGrid
                    cabinetShapes={cabinetShapes}
                    cabinetData={cabinetData}
                    selectedCabinetId={selectedCabinetId}
                    selectedPileId={selectedPileId}
                    onSelectCabinet={(cab) => { setSelectedCabinetId(cab.id); setSelectedPileId(`${cab.id}-R01-P01`); setCabinetData([]); loadCabinetData(cab.no); }}
                    onSelectPile={(locId) => { setSelectedPileId(locId); }}
                    onOpenPileModal={(locId) => setPileActionModal({ locationId: locId })}
                    onManageShelf={() => setShelfManagerOpen(true)}
                  />
                </div>
                <div className="col-span-4">
                  <DetailsPanel
                    cabinetShapes={cabinetShapes}
                    pileInfo={pileInfo}
                    selectedPileId={selectedPileId}
                    shelfRecords={shelfRecords}
                    highlightId={highlightId}
                    onBorrow={handleBorrowClick}
                    onReportIssue={(record) => setIssueModal(record)}
                    onEdit={handleEditRecord}
                    onDelete={handleDeleteRecord}
                    onMove={(ids) => setMoveModal(ids)}
                    onReturnToPool={handleReturnRecordsToPool}
                    onUpdateYearMonth={handleUpdateYearMonth}
                    onToggleMissingInfo={handleToggleMissingInfo}
                    onOpenShift={() => setShiftModalOpen(true)}
                    onShowTimeline={(record) => setTimelineRecordId(record.id)}
                  />
                </div>
              </div>
            </>
          )}

          {page === "pool" && <PoolPage poolHighlightId={poolHighlightId} onAssigned={handlePoolAssigned} showToast={showToast} cabinetShapes={cabinetShapes} onPositionConflict={handlePositionConflict} onShowTimeline={(record) => setTimelineRecordId(record.id)} />}

          {page === "ocr" && <OcrImportPage showToast={showToast} onImported={() => { loadStats(); }} onPositionConflict={handlePositionConflict} />}

          {page === "batch" && <BatchPage showToast={showToast} onDone={() => { loadStats(); loadCabinetData(parseInt(selectedCabinetId.slice(1))); loadIssues(); }} />}

          {page === "tools" && (
            <ArchiveToolsPage
              cabinetShapes={cabinetShapes}
              selectedPileId={selectedPileId}
              onLocationChange={syncSelectedPile}
              showToast={showToast}
              onShowTimeline={(recordId) => setTimelineRecordId(recordId)}
              onChanged={(locId = selectedPileId) => { const parsed = parseLocationId(locId); loadShelfRecords(locId); loadStats(); if (parsed) loadCabinetData(parsed.cabinet_no); loadIssues(); }}
            />
          )}

          {page === "quality" && <QualityControl issues={issuesList} onRefresh={loadIssues} onResolve={async (rec) => { await api.resolveIssue(rec.id); showToast(`已解除问题：${rec.patient_name}`); loadIssues(); loadStats(); loadCabinetData(parseInt(selectedCabinetId.slice(1))); }} onSelectPile={selectPile} />}

          {page === "borrows" && (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-bold mb-4">当前借出列表</h2>
              <BorrowsList onReturn={handleBorrowClick} />
            </div>
          )}

          {page === "backups" && <BackupPage showToast={showToast} />}

          {page === "logs" && <AuditLogPage />}
        </main>
      </div>

      {/* Modals */}
      {showAddForm && <AddRecordForm onSubmit={handleAddRecord} onClose={() => setShowAddForm(false)} locationId={selectedPileId} />}
      {borrowModal && <BorrowModal record={borrowModal} onConfirm={confirmBorrow} onClose={() => setBorrowModal(null)} />}
      {issueModal && <IssueModal record={issueModal} onConfirm={(desc) => handleReportIssue(issueModal, desc)} onClose={() => setIssueModal(null)} />}
      {shiftModalOpen && <ShiftRecordsModal selectedPileId={selectedPileId} shelfRecords={shelfRecords} onConfirm={handleShiftRecords} onClose={() => setShiftModalOpen(false)} />}
      {timelineRecordId && <RecordTimelineModal recordId={timelineRecordId} onClose={() => setTimelineRecordId(null)} />}
      {pileActionModal && (
        <PileActionModal
          locationId={pileActionModal.locationId}
          cabinetShapes={cabinetShapes}
          pileInfo={cabinetData.find(d => d.location_id === pileActionModal.locationId)}
          onClose={() => setPileActionModal(null)}
          showToast={showToast}
          onChanged={(locId) => refreshPileContext(locId)}
          onPositionConflict={handlePositionConflict}
          onShowTimeline={(record) => { setPileActionModal(null); setTimelineRecordId(record.id); }}
        />
      )}
      {shelfManagerOpen && (
        <ShelfManager
          onClose={() => { setShelfManagerOpen(false); loadShelfLayout(); loadStats(); }}
          currentCabinet={parseInt(selectedCabinetId.slice(1))}
          onChanged={(cabinetNo) => { loadShelfLayout(); if (cabinetNo) loadCabinetData(cabinetNo); loadStats(); }}
        />
      )}
      {moveModal && <MoveModal recordIds={moveModal} cabinetShapes={cabinetShapes} onClose={() => setMoveModal(null)} onDone={(locationId, assigned) => { setMoveModal(null); if (locationId) handlePoolAssigned(locationId, assigned); else { loadShelfRecords(selectedPileId); loadCabinetData(parseInt(selectedCabinetId.slice(1))); loadStats(); } }} showToast={showToast} onPositionConflict={handlePositionConflict} />}
      {positionConflict && (
        <PositionConflictModal
          conflict={positionConflict}
          onClose={() => setPositionConflict(null)}
          onOpenPool={() => { setPositionConflict(null); setPage("pool"); }}
        />
      )}
      {toast && <div className="fixed bottom-6 right-6 bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">{toast}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════

function StatCard({ icon: Icon, label, value, color }) {
  const colors = { blue: "bg-blue-50 text-blue-600", green: "bg-green-50 text-green-600", orange: "bg-orange-50 text-orange-600", red: "bg-red-50 text-red-600", purple: "bg-purple-50 text-purple-600" };
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}><Icon className="w-5 h-5" /></div>
      <div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-gray-500">{label}</div></div>
    </div>
  );
}

function CabinetGrid({ cabinetShapes, cabinetData, selectedCabinetId, selectedPileId, onSelectCabinet, onSelectPile, onOpenPileModal, onManageShelf }) {
  const cab = cabinetShapes.find(c => c.id === selectedCabinetId) || cabinetShapes[0];
  const [preview, setPreview] = useState(null);
  const [previewCache, setPreviewCache] = useState({});
  const maxRow = Math.max(cab?.rows || 0, ...cabinetData.map(d => Number(d.row_no) || 0), 1);
  const rowNumbers = Array.from({ length: maxRow }, (_, i) => i + 1);
  const rowStackCounts = rowNumbers.map(rowNo => {
    const actualStacks = cabinetData
      .filter(d => Number(d.row_no) === rowNo)
      .map(d => Number(d.stack_no) || 0);
    const actualMax = Math.max(0, ...actualStacks);
    return actualMax || (cabinetData.length === 0 ? cab?.stacksPerRow || 0 : 0);
  });
  const largestRowStacks = Math.max(cab?.stacksPerRow || 0, ...rowStackCounts, 1);
  const largestRowSupports = Math.max(0, Math.ceil(largestRowStacks / 4) - 1);
  const wideShelf = largestRowStacks > 8;
  const shelfMinWidth = wideShelf ? `${largestRowStacks * 54 + largestRowSupports * 14 + 36}px` : undefined;

  useEffect(() => {
    setPreviewCache({});
    setPreview(null);
  }, [cabinetData]);

  function placePreview(event) {
    const width = 344;
    const height = 346;
    const margin = 14;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    return {
      x: Math.min(event.clientX + margin, maxLeft),
      y: Math.min(event.clientY + margin, maxTop),
    };
  }

  async function openPilePreview(locId, pile, event) {
    const position = placePreview(event);
    setPreview({ locId, pile, ...position, loading: !previewCache[locId] });
    if (previewCache[locId]) return;
    try {
      const result = await api.getRecordsByLocation(locId);
      setPreviewCache(prev => ({ ...prev, [locId]: result.data || [] }));
      setPreview(prev => prev?.locId === locId ? { ...prev, loading: false } : prev);
    } catch (e) {
      console.error(e);
      setPreviewCache(prev => ({ ...prev, [locId]: [] }));
      setPreview(prev => prev?.locId === locId ? { ...prev, loading: false, failed: true } : prev);
    }
  }

  function movePilePreview(event) {
    setPreview(prev => prev ? { ...prev, ...placePreview(event) } : prev);
  }

  function closePilePreview() {
    setPreview(null);
  }

  return (
    <div className="space-y-4 min-w-0 overflow-visible">
      {/* Cabinet tabs */}
      <div className="flex gap-2 flex-wrap items-center">
        {cabinetShapes.map(c => (
          <button key={c.id} onClick={() => onSelectCabinet(c)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${c.id === selectedCabinetId ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100 border"}`}>
            {c.name}
          </button>
        ))}
        {onManageShelf && (
          <button onClick={onManageShelf} className="px-3 py-1.5 rounded-lg text-sm font-medium border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition">
            + 管理书架
          </button>
        )}
      </div>
      {/* Cabinet visual - Demo方案A样式 */}
      <div className={`bg-[#FAF7F0] border-4 border-[#8B5A2B] rounded-xl shadow-md p-1.5 min-w-0 overflow-x-auto overflow-y-hidden transition-all ${selectedCabinetId === cab.id ? "ring-4 ring-indigo-500/30 border-[#5F3B1D]" : ""}`}>
        <div className="min-w-0" style={{ minWidth: shelfMinWidth }}>
          <div className="bg-[#5F3B1D] text-[#FFF8ED] py-1 px-2 rounded flex items-center justify-between text-[11px] font-semibold mb-1.5">
            <span className="font-mono flex items-center gap-1 truncate"><Building2 className="w-3 h-3" />{cab.id} ({maxRow}排)</span>
            <span className="text-[9px] opacity-80 truncate">{cab.name} · 最宽 {largestRowStacks} 摞 · 4摞/月段</span>
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            {rowNumbers.map((rowNo, ri) => {
              const rowStackCount = rowStackCounts[ri] || 0;
              return (
            <div key={ri} className="relative flex-1 flex flex-col justify-end min-w-0">
              <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#8B5A2B] z-0"></div>
              <div className="flex items-end px-0.5 pb-0.5 gap-0.5 z-10 relative min-w-0">
                <span className="text-[9px] font-semibold text-[#8B5A2B]/80 font-mono w-5 shrink-0 pb-0.5">R{rowNo}</span>
                <div className={`${wideShelf ? "flex gap-0.5 min-w-max" : "flex-1 flex gap-0.5 min-w-0"}`}>
                  {Array.from({ length: rowStackCount }, (_, pi) => {
                    const locId = `${cab.id}-R${pad(rowNo)}-P${pad(pi + 1)}`;
                    const pile = cabinetData.find(d => d.location_id === locId);
                    const count = pile?.record_count || 0;
                    const hasBorrowed = (pile?.borrowed || 0) > 0;
                    const hasPending = (pile?.pending || 0) > 0;
                    const missingCount = pile?.missing_info_count || 0;
                    const hasMissing = missingCount > 0;
                    const overflowCount = pile?.overflow_count || Math.max(0, count - STANDARD_BOOKS_PER_STACK);
                    const hasOverflowPile = overflowCount > 0;
                    const cachedRows = previewCache[locId] || [];
                    const duplicateNameCount = pile?.duplicate_name_count || (cachedRows.length ? countDuplicateNameRecords(cachedRows) : 0);
                    const hasDuplicateNames = duplicateNameCount > 0;
                    const isSelected = locId === selectedPileId;
                    const showSegmentSupport = (pi + 1) % 4 === 0 && pi + 1 < rowStackCount;
                    const statusClass = isSelected
                      ? (hasPending ? "bg-rose-500 border-2 border-slate-900 ring-2 ring-rose-300" : hasBorrowed ? "bg-amber-500 border-2 border-slate-900 ring-2 ring-amber-300" : count > 0 ? "bg-blue-500 border-2 border-slate-900 ring-2 ring-blue-300" : "bg-emerald-500 border-2 border-slate-900 ring-2 ring-emerald-300")
                      : (hasPending ? "bg-rose-100 hover:bg-rose-200 border border-rose-300 text-rose-800" : hasBorrowed ? "bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-800" : count > 0 ? "bg-blue-100 hover:bg-blue-200 border border-blue-300 text-blue-800" : "bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-600");
                    return (
                      <React.Fragment key={locId}>
                        <button onClick={() => { onSelectPile(locId); onOpenPileModal?.(locId, pile); }}
                          onMouseEnter={(e) => openPilePreview(locId, pile, e)}
                          onMouseMove={movePilePreview}
                          onMouseLeave={closePilePreview}
                          className={`relative rounded flex flex-col items-center justify-center h-[52px] transition-all ${wideShelf ? "w-12 shrink-0" : "flex-1 min-w-0"} ${statusClass} ${hasMissing ? "ring-2 ring-fuchsia-400 ring-offset-1 ring-offset-[#FAF7F0]" : ""} ${hasOverflowPile ? "outline outline-2 outline-orange-500 outline-offset-1" : ""} ${hasDuplicateNames ? "shadow-[inset_0_0_0_2px_rgba(8,145,178,0.65)]" : ""}`}
                          title={`${locId}\n${pile?.year_month || ""}\n${count}册${hasMissing ? `\n占位待补 ${missingCount}册` : ""}${hasOverflowPile ? `\n超容量追加 ${overflowCount}册` : ""}${hasDuplicateNames ? `\n同名同摞 ${duplicateNameCount}册` : ""}`}>
                          {hasDuplicateNames && (
                            <span className="absolute -top-1 -left-1 min-w-4 h-4 px-1 rounded-full bg-cyan-600 text-white text-[9px] font-bold leading-4 shadow-sm">
                              同
                            </span>
                          )}
                          {hasMissing && (
                            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-fuchsia-600 text-white text-[9px] font-bold leading-4 shadow-sm">
                              {missingCount}
                            </span>
                          )}
                          {hasOverflowPile && (
                            <span className="absolute -bottom-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-orange-600 text-white text-[9px] font-bold leading-4 shadow-sm">
                              +{overflowCount}
                            </span>
                          )}
                          <span className={`text-[10px] font-bold font-mono leading-none truncate ${isSelected ? "text-white" : ""}`}>P{pad(pi + 1)}</span>
                          <div className="flex justify-center gap-0.5 mt-1 w-full px-1">
                            <span className={`h-1 flex-1 rounded-sm ${isSelected ? "bg-white/60" : "bg-current opacity-30"}`}></span>
                            <span className={`h-1.5 flex-1 rounded-sm ${isSelected ? "bg-white/60" : "bg-current opacity-30"}`}></span>
                            {count > 10 && <span className={`h-1 flex-1 rounded-sm ${isSelected ? "bg-white/60" : "bg-current opacity-30"}`}></span>}
                          </div>
                          <span className={`text-[8px] mt-0.5 truncate ${isSelected ? "text-white/90" : hasOverflowPile ? "text-orange-700 font-black" : count >= STANDARD_BOOKS_PER_STACK ? "text-red-600 font-bold" : "opacity-80"}`}>
                            {hasOverflowPile ? `${STANDARD_BOOKS_PER_STACK}+${overflowCount}` : `${count}/${STANDARD_BOOKS_PER_STACK}`}
                          </span>
                        </button>
                        {showSegmentSupport && (
                          <div className="relative mx-0.5 h-[58px] w-2 shrink-0 self-end rounded-t-sm border-x border-[#4B2D15] bg-[#6B421F] shadow-[inset_1px_0_0_rgba(255,255,255,0.18),inset_-1px_0_0_rgba(0,0,0,0.25)]" title="中间支架：每4摞一个月份段">
                            <span className="absolute inset-x-0 top-1 h-1 bg-[#A8753D]/70" />
                            <span className="absolute inset-x-0 bottom-1 h-1 bg-[#3E2411]/70" />
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
              );
            })}
          </div>
          <div className="mt-1 bg-[#5F3B1D]/90 px-1 py-0.5 rounded text-[9px] text-[#EAD0A8] text-center font-medium truncate">{cab.name}</div>
        </div>
      </div>
      <div className="mt-2 flex gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200 inline-block" />空位</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-300 inline-block" />有病历</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block" />有借出</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-100 border border-rose-300 inline-block" />待核对</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-fuchsia-600 inline-block" />占位待补</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-600 inline-block" />超容量追加</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-cyan-600 inline-block" />同名同摞</span>
        <span className="flex items-center gap-1"><span className="w-2 h-4 rounded-sm bg-[#6B421F] inline-block" />4摞分隔支架</span>
      </div>
      {preview && (
        <PileHoverPreview
          preview={preview}
          records={previewCache[preview.locId]}
        />
      )}
    </div>
  );
}

function PileHoverPreview({ preview, records }) {
  const rows = records || [];
  const pile = preview.pile || {};
  const recordByIndex = new Map(rows.map(r => [Number(r.book_index), r]));
  const count = pile.record_count || rows.length || 0;
  const borrowed = pile.borrowed || rows.filter(r => r.archive_status === "借出").length;
  const pending = pile.pending || rows.filter(r => r.archive_status && r.archive_status !== "在架" && r.archive_status !== "借出").length;
  const missing = pile.missing_info_count || rows.filter(hasMissingInfo).length;
  const overflowRows = rows.filter(hasOverflow);
  const overflow = pile.overflow_count || overflowRows.length || Math.max(0, count - STANDARD_BOOKS_PER_STACK);
  const duplicateNames = getDuplicateNameSet(rows);
  const duplicateNameCount = pile.duplicate_name_count || countDuplicateNameRecords(rows, duplicateNames);

  function slotClass(record) {
    if (!record) return "bg-gray-50 border-gray-200 text-gray-400";
    if (hasOverflow(record)) return "bg-orange-100 border-orange-300 text-orange-900 shadow-sm";
    if (hasMissingInfo(record)) return "bg-fuchsia-600 border-fuchsia-700 text-white shadow-sm";
    if (record.archive_status === "借出") return "bg-amber-100 border-amber-300 text-amber-900";
    if (record.archive_status && record.archive_status !== "在架") return "bg-rose-100 border-rose-300 text-rose-900";
    return "bg-blue-100 border-blue-300 text-blue-900";
  }

  return (
    <div
      className="pointer-events-none fixed z-50 w-[344px] rounded-lg border border-slate-200 bg-white shadow-2xl"
      style={{ left: preview.x, top: preview.y }}
    >
      <div className="rounded-t-lg bg-slate-900 px-3 py-2 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-sm font-bold">{preview.locId}</div>
            <div className="truncate text-[11px] text-slate-300">{pile.year_month || "未设置年月"}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-bold leading-none">{overflow > 0 ? `${STANDARD_BOOKS_PER_STACK}+${overflow}` : `${count}/${STANDARD_BOOKS_PER_STACK}`}</div>
            <div className="text-[10px] text-slate-300">本摞容量</div>
          </div>
        </div>
        {(borrowed > 0 || pending > 0 || missing > 0 || overflow > 0 || duplicateNameCount > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            {borrowed > 0 && <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-amber-100">借出 {borrowed}</span>}
            {pending > 0 && <span className="rounded bg-rose-400/20 px-1.5 py-0.5 text-rose-100">待核对 {pending}</span>}
            {missing > 0 && <span className="rounded bg-fuchsia-400/25 px-1.5 py-0.5 text-fuchsia-100">占位待补 {missing}</span>}
            {overflow > 0 && <span className="rounded bg-orange-400/25 px-1.5 py-0.5 text-orange-100">超容量 {overflow}</span>}
            {duplicateNameCount > 0 && <span className="rounded bg-cyan-400/25 px-1.5 py-0.5 text-cyan-100">同名同摞 {duplicateNameCount}</span>}
          </div>
        )}
      </div>
      <div className="p-3">
        {preview.loading ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-gray-500">
            加载缩略图...
          </div>
        ) : preview.failed ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-rose-600">
            预览加载失败
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-5 gap-1">
              {Array.from({ length: STANDARD_BOOKS_PER_STACK }, (_, i) => {
                const bookIndex = i + 1;
                const record = recordByIndex.get(bookIndex);
                const isDuplicateName = hasDuplicateNameInStack(record, duplicateNames);
                return (
                  <div
                    key={bookIndex}
                    className={`h-10 min-w-0 rounded border px-1 py-0.5 ${slotClass(record)} ${isDuplicateName ? "ring-2 ring-cyan-300 ring-offset-1" : ""}`}
                    title={isDuplicateName ? "同名同摞" : undefined}
                  >
                    <div className="font-mono text-[9px] font-bold leading-tight">#{pad(bookIndex)}</div>
                    <div className="truncate text-[10px] leading-tight">{record?.patient_name || "空"}</div>
                  </div>
                );
              })}
            </div>
            {overflowRows.length > 0 && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-2">
                <div className="mb-1 flex items-center gap-1 text-[10px] font-bold text-orange-700">
                  <AlertCircle className="h-3 w-3" />超容量附加区
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {overflowRows.map(record => {
                    const isDuplicateName = hasDuplicateNameInStack(record, duplicateNames);
                    return (
                    <div key={record.id} className={`min-w-0 rounded border border-orange-300 bg-white px-1.5 py-1 text-orange-900 ${isDuplicateName ? "ring-2 ring-cyan-300 ring-offset-1" : ""}`} title={isDuplicateName ? "同名同摞" : undefined}>
                      <div className="font-mono text-[9px] font-bold">#{record.book_index}</div>
                      <div className="truncate text-[10px]">{record.patient_name}</div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-blue-100 border border-blue-300" />在架</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-amber-100 border border-amber-300" />借出</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-rose-100 border border-rose-300" />待核对</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-fuchsia-600" />占位待补</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-orange-100 border border-orange-300" />超容量</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-cyan-100 border border-cyan-300" />同名同摞</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-gray-50 border border-gray-200" />空位</span>
        </div>
      </div>
    </div>
  );
}

function PileActionModal({ locationId, cabinetShapes, pileInfo, onClose, showToast, onChanged, onPositionConflict, onShowTimeline }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", inpatientNo: "", dischargeDate: "", bookIndex: "", remark: "" });
  const [addForm, setAddForm] = useState({ name: "", inpatientNo: "", dischargeDate: "", allowOverflow: false });

  const parsedLocation = parseLocationId(locationId);
  const cabName = cabinetShapes.find(c => c.id === parsedLocation?.cabinet_id)?.name || "";
  const sortedRecords = [...records].sort((a, b) => Number(a.book_index || 0) - Number(b.book_index || 0));
  const filteredRecords = sortedRecords.filter(record => {
    const text = `${record.patient_name || ""} ${record.inpatient_no || ""} ${record.book_index || ""} ${genLocationCode(record)}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  const inShelf = records.filter(r => r.archive_status === "在架").length;
  const borrowed = records.filter(r => r.archive_status === "借出").length;
  const missingInfo = records.filter(hasMissingInfo).length;
  const overflowCount = records.filter(hasOverflow).length;
  const duplicateNames = getDuplicateNameSet(records);
  const duplicateNameCount = countDuplicateNameRecords(records, duplicateNames);

  useEffect(() => {
    setQuery("");
    setEditingId(null);
    loadRecords();
  }, [locationId]);

  async function loadRecords() {
    setLoading(true);
    try {
      const result = await api.getRecordsByLocation(locationId);
      setRecords(result.data || []);
    } catch (e) {
      showToast(`加载失败：${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function normalizeDate(value) {
    return String(value || "").slice(0, 10);
  }

  function startEdit(record) {
    setEditingId(record.id);
    setEditForm({
      name: record.patient_name || "",
      inpatientNo: record.inpatient_no || "",
      dischargeDate: normalizeDate(record.discharge_date),
      bookIndex: String(record.book_index || ""),
      remark: record.remark || "",
    });
  }

  async function afterChanged(message) {
    if (message) showToast(message);
    await loadRecords();
    await onChanged?.(locationId);
  }

  async function submitAdd() {
    const name = addForm.name.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const created = await api.createRecord({
        patient_name: name,
        inpatient_no: addForm.inpatientNo.trim(),
        discharge_date: addForm.dischargeDate || null,
        location_id: locationId,
        allow_overflow: addForm.allowOverflow,
        force_overflow: addForm.allowOverflow,
      });
      setAddForm({ name: "", inpatientNo: "", dischargeDate: "", allowOverflow: false });
      await afterChanged(`已录入：${name}，第${created.book_index}本`);
    } catch (e) {
      if (onPositionConflict?.(e)) await afterChanged("");
      else showToast(`录入失败：${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit(record) {
    const name = editForm.name.trim();
    const bookIndex = Number(editForm.bookIndex);
    if (!name || !Number.isInteger(bookIndex) || bookIndex < 1 || saving) return;
    setSaving(true);
    try {
      await api.updateRecord(record.id, {
        patient_name: name,
        inpatient_no: editForm.inpatientNo.trim(),
        discharge_date: editForm.dischargeDate || null,
        location_id: locationId,
        book_index: bookIndex,
        remark: editForm.remark,
        allow_overflow: bookIndex > STANDARD_BOOKS_PER_STACK,
      });
      setEditingId(null);
      await afterChanged("修改成功");
    } catch (e) {
      if (onPositionConflict?.(e)) await afterChanged("");
      else showToast(`修改失败：${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(record) {
    if (!confirm(`确认删除 ${record.patient_name} 的病历记录？`)) return;
    try {
      await api.deleteRecord(record.id);
      await afterChanged("删除成功");
    } catch (e) {
      showToast(`删除失败：${e.message}`);
    }
  }

  async function returnToPool(record) {
    if (!confirm(`确认将 ${record.patient_name} 的病历退回暂存池？`)) return;
    try {
      const result = await api.assignFromPool({ record_ids: [record.id], location_id: "__POOL__" });
      await afterChanged(result.message || "已退回暂存池");
    } catch (e) {
      showToast(`退回失败：${e.message}`);
    }
  }

  async function toggleMissingInfo(record) {
    try {
      const marked = !hasMissingInfo(record);
      await api.setMissingInfo(record.id, marked);
      await afterChanged(marked ? `已标记占位：${record.patient_name}` : `已取消占位：${record.patient_name}`);
    } catch (e) {
      showToast(`标记失败：${e.message}`);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/45 px-4 py-5" onClick={onClose}>
      <div className="mx-auto flex h-full max-h-[900px] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-slate-900 px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xl font-black leading-none">{locationId}</span>
              {pileInfo?.year_month && <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-bold">{formatYearMonth(pileInfo.year_month)}</span>}
              {duplicateNameCount > 0 && <DuplicateNameBadge compact />}
              {overflowCount > 0 && <OverflowBadge compact />}
              {missingInfo > 0 && <MissingInfoBadge compact />}
            </div>
            <div className="mt-1 text-xs text-slate-300">
              {cabName || "病案架"} · 第 {parsedLocation?.row_no || "-"} 排 · 第 {parsedLocation?.stack_no || "-"} 摞
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid shrink-0 grid-cols-4 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50 text-center text-xs">
          <div className="p-3"><span className="block text-slate-500">总册数</span><strong className="font-mono text-xl text-slate-900">{records.length}</strong></div>
          <div className="p-3"><span className="block text-slate-500">在架</span><strong className="font-mono text-xl text-emerald-600">{inShelf}</strong></div>
          <div className="p-3"><span className="block text-slate-500">借出</span><strong className="font-mono text-xl text-amber-600">{borrowed}</strong></div>
          <div className="p-3"><span className="block text-slate-500">超容量/占位</span><strong className="font-mono text-xl text-orange-600">{overflowCount}/{missingInfo}</strong></div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-12 gap-0">
          <div className="col-span-8 flex min-h-0 flex-col border-r border-slate-100">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 p-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  placeholder="在本摞内查姓名、住院号、序号或位置编号"
                />
              </div>
              <button onClick={loadRecords} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                <RefreshCw className="h-4 w-4" />刷新
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex h-52 items-center justify-center text-sm text-slate-500">正在加载本摞病历...</div>
              ) : filteredRecords.length === 0 ? (
                <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400">
                  {records.length === 0 ? "该摞暂无病历" : "没有匹配的病历"}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredRecords.map(record => {
                    const isEditing = editingId === record.id;
                    const isOverflow = hasOverflow(record);
                    const isMissingInfo = hasMissingInfo(record);
                    const isDuplicateName = hasDuplicateNameInStack(record, duplicateNames);
                    return (
                      <div key={record.id} className={`rounded-lg border p-3 transition ${isOverflow ? "border-orange-300 bg-orange-50/70" : isMissingInfo ? "border-fuchsia-200 bg-fuchsia-50/60" : "border-slate-200 bg-white"} ${isDuplicateName ? "ring-2 ring-cyan-200" : ""}`}>
                        {isEditing ? (
                          <div className="grid grid-cols-12 gap-2">
                            <input value={editForm.bookIndex} onChange={e => setEditForm(prev => ({ ...prev, bookIndex: e.target.value }))} className="col-span-2 rounded border px-2 py-1.5 text-sm font-mono" placeholder="序号" />
                            <input value={editForm.name} onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))} className="col-span-3 rounded border px-2 py-1.5 text-sm font-bold" placeholder="姓名" />
                            <input value={editForm.inpatientNo} onChange={e => setEditForm(prev => ({ ...prev, inpatientNo: e.target.value }))} className="col-span-3 rounded border px-2 py-1.5 text-sm font-mono" placeholder="住院号可后补" />
                            <input type="date" value={editForm.dischargeDate} onChange={e => setEditForm(prev => ({ ...prev, dischargeDate: e.target.value }))} className="col-span-2 rounded border px-2 py-1.5 text-sm" />
                            <div className="col-span-2 flex justify-end gap-1">
                              <button onClick={() => submitEdit(record)} disabled={saving || !editForm.name.trim()} className="rounded bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:opacity-50" aria-label="保存">
                                <Save className="h-4 w-4" />
                              </button>
                              <button onClick={() => setEditingId(null)} className="rounded bg-slate-100 p-2 text-slate-600 hover:bg-slate-200" aria-label="取消">
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                            <input value={editForm.remark} onChange={e => setEditForm(prev => ({ ...prev, remark: e.target.value }))} className="col-span-12 rounded border px-2 py-1.5 text-sm" placeholder="备注" />
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded bg-slate-900 px-2 py-1 font-mono text-xs font-black text-white">{genLocationCode(record)}</span>
                                  <span className="text-lg font-black text-slate-950">{record.patient_name}</span>
                                  {isDuplicateName && <DuplicateNameBadge compact />}
                                  {isMissingInfo && <MissingInfoBadge compact />}
                                  {isOverflow && <OverflowBadge compact />}
                                  <StatusBadge status={record.archive_status} />
                                </div>
                                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                                  <span className="font-mono font-bold text-slate-700">住院号：{record.inpatient_no || "待后补"}</span>
                                  <span>第 {record.book_index} 本</span>
                                  {record.discharge_date && <span>出院：{normalizeDate(record.discharge_date)}</span>}
                                </div>
                                {record.remark && <div className="mt-2 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{record.remark}</div>}
                              </div>
                              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                <button onClick={() => startEdit(record)} className="rounded bg-slate-100 p-2 text-slate-600 hover:bg-slate-200" aria-label="编辑">
                                  <Edit3 className="h-4 w-4" />
                                </button>
                                <button onClick={() => toggleMissingInfo(record)} className={`rounded p-2 ${isMissingInfo ? "bg-fuchsia-600 text-white hover:bg-fuchsia-700" : "bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100"}`} aria-label={isMissingInfo ? "取消占位" : "标记占位"}>
                                  <Flag className="h-4 w-4" />
                                </button>
                                <button onClick={() => returnToPool(record)} className="rounded bg-amber-50 p-2 text-amber-700 hover:bg-amber-100" aria-label="退回暂存池">
                                  <FolderInput className="h-4 w-4" />
                                </button>
                                <button onClick={() => onShowTimeline?.(record)} className="rounded bg-slate-100 p-2 text-slate-600 hover:bg-slate-200" aria-label="轨迹">
                                  <History className="h-4 w-4" />
                                </button>
                                {record.archive_status !== "借出" && (
                                  <button onClick={() => deleteRecord(record)} className="rounded bg-red-50 p-2 text-red-600 hover:bg-red-100" aria-label="删除">
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="col-span-4 min-h-0 overflow-y-auto bg-white p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
              <Plus className="h-4 w-4 text-blue-600" />快速新增到本摞
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500">患者姓名</label>
                <input value={addForm.name} onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="必填" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">住院号</label>
                <input value={addForm.inpatientNo} onChange={e => setAddForm(prev => ({ ...prev, inpatientNo: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono" placeholder="可后补" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">出院日期</label>
                <input type="date" value={addForm.dischargeDate} onChange={e => setAddForm(prev => ({ ...prev, dischargeDate: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
              <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${addForm.allowOverflow ? "border-orange-200 bg-orange-50 text-orange-700" : "border-slate-100 bg-slate-50 text-slate-600"}`}>
                <input type="checkbox" checked={addForm.allowOverflow} onChange={e => setAddForm(prev => ({ ...prev, allowOverflow: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-orange-600" />
                <span>
                  追加到第26本以后
                  <span className="mt-0.5 block">用于现场同一摞已经超出25本的情况。</span>
                </span>
              </label>
              <button onClick={submitAdd} disabled={saving || !addForm.name.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                <Plus className="h-4 w-4" />新增病历
              </button>
            </div>

            <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
              <div className="font-bold text-slate-800">操作说明</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <span className="inline-flex items-center gap-1"><Edit3 className="h-3 w-3" />编辑</span>
                <span className="inline-flex items-center gap-1"><Trash2 className="h-3 w-3" />删除</span>
                <span className="inline-flex items-center gap-1"><Flag className="h-3 w-3" />占位</span>
                <span className="inline-flex items-center gap-1"><FolderInput className="h-3 w-3" />暂存</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailsPanel({ cabinetShapes, pileInfo, selectedPileId, shelfRecords, highlightId, onBorrow, onReportIssue, onEdit, onDelete, onMove, onReturnToPool, onUpdateYearMonth, onToggleMissingInfo, onOpenShift, onShowTimeline }) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editNo, setEditNo] = useState("");
  const [editRemark, setEditRemark] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState(new Set());
  const highlightedRecordRef = useRef(null);

  useEffect(() => {
    if (!highlightId || !highlightedRecordRef.current) return;
    const frame = requestAnimationFrame(() => {
      highlightedRecordRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [highlightId, shelfRecords]);

  function startEdit(r) { setEditingId(r.id); setEditName(r.patient_name); setEditNo(r.inpatient_no); setEditRemark(r.remark || ""); }
  function cancelEdit() { setEditingId(null); }
  function submitEdit(r) { if (editName && editNo) { onEdit(r.id, { patient_name: editName, inpatient_no: editNo, remark: editRemark }); setEditingId(null); } }
  function toggleBatchSelect(id) { setBatchSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); }
  function selectAllBatch() { setBatchSelected(new Set(shelfRecords.map(r => r.id))); }
  function handleBatchMove() { if (batchSelected.size > 0) onMove([...batchSelected]); setBatchMode(false); setBatchSelected(new Set()); }
  function handleBatchReturnToPool() {
    if (batchSelected.size === 0) return;
    if (!confirm(`确认将选中的 ${batchSelected.size} 份病历退回暂存池？`)) return;
    onReturnToPool([...batchSelected]);
    setBatchMode(false);
    setBatchSelected(new Set());
  }

  const parsedLocation = parseLocationId(selectedPileId);
  const row = parsedLocation?.row_no || 0;
  const stack = parsedLocation?.stack_no || 0;
  const cabName = cabinetShapes.find(c => c.id === parsedLocation?.cabinet_id)?.name || "";
  const inShelf = shelfRecords.filter(r => r.archive_status === "在架").length;
  const borrowed = shelfRecords.filter(r => r.archive_status === "借出").length;
  const pending = shelfRecords.filter(r => r.archive_status !== "在架" && r.archive_status !== "借出").length;
  const missingInfo = shelfRecords.filter(hasMissingInfo).length;
  const overflowRecords = shelfRecords.filter(hasOverflow);
  const overflowCount = overflowRecords.length;
  const duplicateNames = getDuplicateNameSet(shelfRecords);
  const duplicateNameCount = countDuplicateNameRecords(shelfRecords, duplicateNames);

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">位置详情</h3>
        <span className="text-xs text-white bg-indigo-600 font-mono px-2 py-0.5 rounded font-bold">{selectedPileId}</span>
      </div>

      {/* 简略信息卡片 */}
      <div>
        <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1.5 mb-2">
          <Building2 className="w-4 h-4 text-gray-400" />
          {cabName}
        </h4>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mb-3">
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-lg p-2">
            <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>第 {row} 排 · 第 {stack} 摞</span>
          </div>
          <MonthSelector
            value={pileInfo?.year_month || ""}
            onChange={(next) => onUpdateYearMonth(selectedPileId, next)}
          />
        </div>
        <div className="grid grid-cols-4 text-center text-xs divide-x divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
          <div className="p-2.5 bg-gray-50/50"><span className="text-[10px] text-gray-400 block">总册数</span><span className="text-base font-bold font-mono text-gray-700">{shelfRecords.length}</span></div>
          <div className="p-2.5 bg-gray-50/50"><span className="text-[10px] text-gray-400 block">在架可用</span><span className="text-base font-bold font-mono text-emerald-600">{inShelf}</span></div>
          <div className="p-2.5 bg-gray-50/50"><span className="text-[10px] text-gray-400 block">外借中</span><span className="text-base font-bold font-mono text-amber-500">{borrowed}</span></div>
          <div className="p-2.5 bg-gray-50/50"><span className="text-[10px] text-gray-400 block">存有缺陷</span><span className="text-base font-bold font-mono text-rose-500">{pending}</span></div>
        </div>
        {missingInfo > 0 && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-700">
            <Flag className="w-4 h-4 shrink-0" />
            <span className="font-bold">本摞有 {missingInfo} 份占位待补病历</span>
          </div>
        )}
        {duplicateNameCount > 0 && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-700">
            <Users className="w-4 h-4 shrink-0" />
            <span className="font-bold">本摞有 {duplicateNameCount} 份同名病历，取册时请核对住院号和本号</span>
          </div>
        )}
        {overflowCount > 0 && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-bold">本摞有 {overflowCount} 份超容量追加病历，请按现场实物单独核对</span>
          </div>
        )}
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {/* 批量操作栏 */}
        <div className="flex items-center justify-between py-1">
          <div className="flex gap-2">
            <button onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()); }}
              className={`text-xs px-2 py-1 rounded font-medium ${batchMode ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {batchMode ? "退出多选" : "多选移动"}
            </button>
            <button onClick={onOpenShift}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded font-medium bg-amber-50 text-amber-700 hover:bg-amber-100">
              <RotateCcw className="w-3 h-3" />序号校正
            </button>
          </div>
          {batchMode && (
            <div className="flex gap-2 items-center">
              <button onClick={selectAllBatch} className="text-xs text-blue-600 hover:underline">全选</button>
              <span className="text-xs text-gray-400">已选 {batchSelected.size}</span>
              {batchSelected.size > 0 && <button onClick={handleBatchMove} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded">移动选中</button>}
              {batchSelected.size > 0 && <button onClick={handleBatchReturnToPool} className="text-xs px-2 py-1 bg-amber-600 text-white rounded">退回暂存池</button>}
            </div>
          )}
        </div>
        {shelfRecords.length === 0 && <p className="text-sm text-gray-400">该位置暂无病历</p>}
        {shelfRecords.map(r => {
          const isMissingInfo = hasMissingInfo(r);
          const isOverflow = hasOverflow(r);
          const isDuplicateName = hasDuplicateNameInStack(r, duplicateNames);
          return (
          <div key={r.id} ref={highlightId === r.id ? highlightedRecordRef : null}
            className={`p-3 border rounded-lg transition ${isOverflow ? "border-orange-300 bg-orange-50/70" : isMissingInfo ? "border-fuchsia-200 bg-fuchsia-50/60" : ""} ${isDuplicateName ? "ring-2 ring-cyan-200" : ""} ${highlightId === r.id ? "ring-2 ring-blue-500 bg-blue-50 shadow-sm" : ""} ${batchMode && batchSelected.has(r.id) ? "bg-indigo-50 border-indigo-300" : ""}`}
            onClick={batchMode ? () => toggleBatchSelect(r.id) : undefined}>
            {batchMode && (
              <div className="flex items-center gap-2 mb-2">
                <input type="checkbox" checked={batchSelected.has(r.id)} onChange={() => toggleBatchSelect(r.id)} className="w-4 h-4 rounded" />
                <span className="font-medium text-sm">{r.patient_name}</span>
                <span className="text-xs text-gray-500 ml-auto">{r.inpatient_no}</span>
              </div>
            )}
            {!batchMode && editingId === r.id ? (
              <div className="space-y-2">
                <input value={editName} onChange={e => setEditName(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" placeholder="姓名" />
                <input value={editNo} onChange={e => setEditNo(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" placeholder="住院号" />
                <input value={editRemark} onChange={e => setEditRemark(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" placeholder="备注（选填）" />
                <div className="flex gap-2">
                  <button onClick={() => submitEdit(r)} className="text-xs px-2 py-1 bg-blue-600 text-white rounded">保存</button>
                  <button onClick={cancelEdit} className="text-xs px-2 py-1 bg-gray-100 rounded">取消</button>
                </div>
              </div>
            ) : !batchMode && (
              <>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium text-sm truncate">{r.patient_name}</span>
                    {isDuplicateName && <DuplicateNameBadge />}
                    {isMissingInfo && <MissingInfoBadge />}
                    {isOverflow && <OverflowBadge />}
                  </div>
                  <StatusBadge status={r.archive_status} />
                </div>
                <div className={`text-xs mb-2 ${isOverflow ? "text-orange-700 font-bold" : isMissingInfo ? "text-fuchsia-700 font-medium" : "text-gray-500"}`}>
                  住院号：{r.inpatient_no} | 第{r.book_index}本{isOverflow ? " · 超出标准25本" : ""}
                </div>
                {r.remark && <div className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded mb-2">{r.remark}</div>}
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => onBorrow(r)}
                    className={`text-xs px-2 py-1 rounded ${r.archive_status === "借出" ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-blue-100 text-blue-700 hover:bg-blue-200"}`}>
                    {r.archive_status === "借出" ? "归还" : "借阅"}
                  </button>
                  {r.archive_status === "在架" && (
                    <button onClick={() => onReportIssue(r)} className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">缺陷</button>
                  )}
                  <button onClick={() => startEdit(r)} className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">编辑</button>
                  <button onClick={() => onToggleMissingInfo(r)}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${isMissingInfo ? "bg-fuchsia-600 text-white hover:bg-fuchsia-700" : "bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100"}`}>
                    <Flag className="w-3 h-3" />{isMissingInfo ? "取消占位" : "标记占位"}
                  </button>
                  <button onClick={() => onMove([r.id])} className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100">移动</button>
                  <button onClick={() => { if (confirm(`确认将 ${r.patient_name} 的病历退回暂存池？`)) onReturnToPool([r.id]); }}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100">
                    <FolderInput className="w-3 h-3" />暂存
                  </button>
                  <button onClick={() => onShowTimeline(r)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200">
                    <History className="w-3 h-3" />轨迹
                  </button>
                  {r.archive_status !== "借出" && (
                    <button onClick={() => { if (confirm(`确认删除 ${r.patient_name} 的病历记录？`)) onDelete(r.id); }}
                      className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">删除</button>
                  )}
                </div>
              </>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = { "在架": "bg-green-100 text-green-700", "借出": "bg-orange-100 text-orange-700", "归还待核对": "bg-yellow-100 text-yellow-700" };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${map[status] || "bg-gray-100 text-gray-600"}`}>{status}</span>;
}

function DuplicateNameBadge({ compact = false }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200 font-bold shrink-0 ${compact ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[10px]"}`}>
      <Users className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
      同名同摞
    </span>
  );
}

function MissingInfoBadge({ compact = false }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-200 font-bold shrink-0 ${compact ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[10px]"}`}>
      <Flag className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
      占位待补
    </span>
  );
}

function OverflowBadge({ compact = false }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 border border-orange-200 font-bold shrink-0 ${compact ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[10px]"}`}>
      <AlertCircle className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
      超容量
    </span>
  );
}

function MonthSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const currentYear = Number(String(value || "").slice(0, 4)) || new Date().getFullYear();
  const currentMonth = Number(String(value || "").slice(5, 7)) || 0;
  const [year, setYear] = useState(currentYear);

  useEffect(() => {
    if (!open) setYear(currentYear);
  }, [currentYear, open]);

  function choose(month) {
    onChange(`${year}-${pad(month)}`);
    setOpen(false);
  }

  function chooseThisMonth() {
    const now = new Date();
    onChange(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
    setOpen(false);
  }

  function clearMonth() {
    onChange("");
    setOpen(false);
  }

  return (
    <div className="relative min-w-0">
      <button type="button" onClick={() => setOpen(v => !v)}
        className={`flex w-full items-center gap-1.5 rounded-lg border p-2 text-left transition ${value ? "border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300" : "border-gray-100 bg-gray-50 text-gray-500 hover:border-amber-200"}`}>
        <Clock3 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-bold">{formatYearMonth(value)}</span>
        <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <>
          <button type="button" aria-label="关闭月份选择" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <button type="button" onClick={() => setYear(y => y - 1)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="font-mono text-lg font-black text-slate-900">{year}</div>
              <button type="button" onClick={() => setYear(y => y + 1)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {MONTH_LABELS.map((label, index) => {
                const month = index + 1;
                const selected = year === currentYear && month === currentMonth;
                return (
                  <button key={label} type="button" onClick={() => choose(month)}
                    className={`h-9 rounded-md border text-sm font-bold transition ${selected ? "border-amber-500 bg-amber-500 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"}`}>
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={chooseThisMonth}
                className="rounded-md bg-slate-100 px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200">
                本月
              </button>
              <button type="button" onClick={clearMonth}
                className="rounded-md bg-gray-50 px-2 py-1.5 text-xs font-bold text-gray-500 hover:bg-gray-100">
                清空
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RecordTimelineModal({ recordId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.getRecordTimeline(recordId)
      .then(result => { if (!cancelled) setData(result); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recordId]);

  const record = data?.record;
  const toneClass = {
    blue: "bg-blue-100 text-blue-700 border-blue-200",
    green: "bg-emerald-100 text-emerald-700 border-emerald-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    rose: "bg-rose-100 text-rose-700 border-rose-200",
    fuchsia: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
    indigo: "bg-indigo-100 text-indigo-700 border-indigo-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-[620px] max-w-[94vw] max-h-[86vh] shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <History className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-lg text-gray-900">病历生命周期</h3>
            {record && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold text-gray-900">{record.patient_name}</span>
                <span className="font-mono text-gray-600">{record.inpatient_no}</span>
                <span className="font-mono font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{record.position_code}</span>
                {record.has_missing_info ? <MissingInfoBadge compact /> : null}
                {hasOverflow(record) ? <OverflowBadge compact /> : null}
              </div>
            )}
          </div>
          <button onClick={onClose} className="ml-auto"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {loading && <div className="text-sm text-gray-400 py-8 text-center">正在加载轨迹...</div>}
        {error && <div className="rounded-lg bg-red-50 text-red-600 text-sm px-3 py-2">{error}</div>}
        {!loading && !error && (
          <div className="overflow-y-auto pr-1 space-y-3">
            {(data?.events || []).length === 0 && <div className="text-sm text-gray-400 py-8 text-center">暂无轨迹记录</div>}
            {(data?.events || []).map((event, idx) => (
              <div key={`${event.time}-${idx}`} className="grid grid-cols-[128px_1fr] gap-3">
                <div className="text-[11px] font-mono text-gray-400 pt-1">{event.time}</div>
                <div className="relative pb-3">
                  {idx < (data.events.length - 1) && <div className="absolute left-3 top-7 bottom-0 w-px bg-gray-200" />}
                  <div className="flex gap-3">
                    <span className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${toneClass[event.tone] || toneClass.slate}`}>
                      <span className="w-2 h-2 rounded-full bg-current" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-gray-900">{event.title}</div>
                      {event.detail && <div className="text-xs text-gray-500 mt-0.5 break-words">{String(event.detail).slice(0, 220)}</div>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PositionConflictModal({ conflict, onClose, onOpenPool }) {
  const existing = conflict.existing_record;
  const rolledBack = conflict.rolled_back_record_ids || [];
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-[460px] max-w-[92vw] shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-lg text-gray-900">病历编号已被占用</h3>
            <p className="text-sm text-gray-500 mt-1">本次冲突记录已自动回滚到暂存池，避免覆盖当前书架位置。</p>
          </div>
          <button onClick={onClose} className="ml-auto"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
            <span className="text-xs text-red-500 block mb-1">重复编号</span>
            <span className="font-mono text-2xl font-bold text-red-700">{conflict.position_code || "未知编号"}</span>
          </div>
          {existing && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-500 block mb-1">当前占用病历</span>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-gray-800 truncate">{existing.patient_name}</span>
                <span className="font-mono text-xs text-gray-500">{existing.inpatient_no}</span>
              </div>
            </div>
          )}
          <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-indigo-700">
            已退回暂存池：<span className="font-mono font-bold">{rolledBack.length}</span> 份
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">知道了</button>
          <button onClick={onOpenPool} className="inline-flex items-center gap-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            <FolderInput className="w-4 h-4" /> 查看暂存池
          </button>
        </div>
      </div>
    </div>
  );
}

function AddRecordForm({ onSubmit, onClose, locationId }) {
  const [name, setName] = useState("");
  const [inpatientNo, setInpatientNo] = useState("");
  const [dischargeDate, setDischargeDate] = useState("");
  const [allowOverflow, setAllowOverflow] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">录入病历</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-xs text-gray-500">位置</label><div className="text-sm font-medium">{locationId}</div></div>
          <div><label className="text-xs text-gray-500">患者姓名</label><input value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
          <div><label className="text-xs text-gray-500">住院号</label><input value={inpatientNo} onChange={e => setInpatientNo(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
          <div><label className="text-xs text-gray-500">出院日期</label><input type="date" value={dischargeDate} onChange={e => setDischargeDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
          <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${allowOverflow ? "border-orange-200 bg-orange-50 text-orange-700" : "border-gray-100 bg-gray-50 text-gray-600"}`}>
            <input type="checkbox" checked={allowOverflow} onChange={e => setAllowOverflow(e.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-600" />
            <span>
              直接追加到第26本以后
              <span className="block mt-0.5">用于现场已经把病历超放在同一摞的情况，不占用1-25标准空位。</span>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">取消</button>
          <button onClick={() => { if (name && inpatientNo) { onSubmit({ name, inpatientNo, dischargeDate, allowOverflow }); onClose(); } }}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">确认录入</button>
        </div>
      </div>
    </div>
  );
}

function BorrowModal({ record, onConfirm, onClose }) {
  const [borrower, setBorrower] = useState("");
  const [department, setDepartment] = useState("");
  const [purpose, setPurpose] = useState("");
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">借阅登记</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="mb-3 text-sm"><span className="text-gray-500">病历：</span>{record.patient_name}（{record.inpatient_no}）</div>
        <div className="space-y-3">
          <div><label className="text-xs text-gray-500">借阅人</label><input value={borrower} onChange={e => setBorrower(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" required /></div>
          <div><label className="text-xs text-gray-500">科室</label><input value={department} onChange={e => setDepartment(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="如：医保办" required /></div>
          <div><label className="text-xs text-gray-500">用途</label><input value={purpose} onChange={e => setPurpose(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="如：医保检查（选填）" /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">取消</button>
          <button onClick={() => { if (borrower && department) onConfirm({ borrower, department, purpose }); }}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">确认借出</button>
        </div>
      </div>
    </div>
  );
}

function IssueModal({ record, onConfirm, onClose }) {
  const [issueType, setIssueType] = useState("缺护理记录单");
  const [desc, setDesc] = useState("");
  const issueTypes = ["缺护理记录单", "缺体温单", "缺医嘱单", "签名缺失", "装订不规范", "其他"];
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">缺陷登记</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="mb-3 text-sm"><span className="text-gray-500">病历：</span>{record.patient_name}（{record.inpatient_no}）</div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">问题类型</label>
            <select value={issueType} onChange={e => setIssueType(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
              {issueTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">问题描述</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="补充说明（可选）" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">取消</button>
          <button onClick={() => onConfirm(`${issueType}${desc ? "：" + desc : ""}`)}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">确认登记</button>
        </div>
      </div>
    </div>
  );
}

function ShiftRecordsModal({ selectedPileId, shelfRecords, onConfirm, onClose }) {
  const maxBook = Math.max(0, ...shelfRecords.map(r => Number(r.book_index) || 0));
  const [startIndex, setStartIndex] = useState(maxBook > 1 ? 2 : 1);
  const [endIndex, setEndIndex] = useState(maxBook || STANDARD_BOOKS_PER_STACK);
  const [direction, setDirection] = useState(-1);
  const [releaseBlocker, setReleaseBlocker] = useState(false);

  const start = Number(startIndex);
  const end = Number(endIndex);
  const affected = shelfRecords.filter(r => Number(r.book_index) >= start && Number(r.book_index) <= end);
  const targetStart = start + Number(direction);
  const targetEnd = end + Number(direction);
  const boundaryIndex = Number(direction) === -1 ? start - 1 : end + 1;
  const boundaryRecord = shelfRecords.find(r => Number(r.book_index) === boundaryIndex);
  const isValid = Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= MAX_OVERFLOW_BOOK_INDEX && targetStart >= 1 && targetEnd <= MAX_OVERFLOW_BOOK_INDEX && affected.length > 0;

  function submit() {
    if (!isValid) return;
    onConfirm({ start_index: start, end_index: end, direction: Number(direction), release_blocker: releaseBlocker });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-[460px] max-w-[92vw] shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">序号校正</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700 mb-4">
          当前摞位：<span className="font-mono font-bold">{selectedPileId}</span>。适合处理“从某一本开始，后面全部错后一位/错前一位”的情况。
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">起始本号</label>
              <input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={startIndex} onChange={e => setStartIndex(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">结束本号</label>
              <input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={endIndex} onChange={e => setEndIndex(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">校正方向</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button onClick={() => setDirection(-1)}
                className={`px-3 py-2 rounded-lg text-sm border ${direction === -1 ? "bg-amber-600 text-white border-amber-600" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                整体前移一位
              </button>
              <button onClick={() => setDirection(1)}
                className={`px-3 py-2 rounded-lg text-sm border ${direction === 1 ? "bg-amber-600 text-white border-amber-600" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                整体后移一位
              </button>
            </div>
          </div>

          <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${releaseBlocker ? "border-red-200 bg-red-50 text-red-700" : "border-gray-100 bg-gray-50 text-gray-600"}`}>
            <input type="checkbox" checked={releaseBlocker} onChange={e => setReleaseBlocker(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-red-600" />
            <span>
              边界被占用时退回暂存池
              <span className="block mt-0.5">
                {boundaryIndex >= 1 && boundaryIndex <= MAX_OVERFLOW_BOOK_INDEX
                  ? `目标边界：第 ${boundaryIndex} 本${boundaryRecord ? `，当前为 ${boundaryRecord.patient_name}` : "，当前未占用"}`
                  : "当前方向会超出本摞范围"}
              </span>
            </span>
          </label>

          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-600">
            将影响 <span className="font-mono font-bold text-gray-900">{affected.length}</span> 份病历：
            第 <span className="font-mono font-bold">{start || "-"}</span>-<span className="font-mono font-bold">{end || "-"}</span> 本
            变为第 <span className="font-mono font-bold">{targetStart || "-"}</span>-<span className="font-mono font-bold">{targetEnd || "-"}</span> 本
            {releaseBlocker && boundaryRecord && (
              <span className="block mt-1 text-red-600">第 {boundaryIndex} 本 {boundaryRecord.patient_name} 将退回暂存池</span>
            )}
          </div>

          {!isValid && (
            <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
              请确认范围内有病历，且校正后的本号仍在 1-{MAX_OVERFLOW_BOOK_INDEX} 之间。
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">取消</button>
          <button onClick={submit} disabled={!isValid}
            className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">确认校正</button>
        </div>
      </div>
    </div>
  );
}

function ArchiveToolsPage({ cabinetShapes, selectedPileId, onLocationChange, showToast, onShowTimeline, onChanged }) {
  const [tab, setTab] = useState("inspection");
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState(selectedPileId);

  useEffect(() => { loadLocations(); }, []);
  useEffect(() => { if (selectedPileId) setLocationId(selectedPileId); }, [selectedPileId]);

  async function loadLocations() {
    try {
      const rows = await api.getLocations();
      setLocations(rows.filter(l => l.id !== "__POOL__"));
    } catch (e) {
      showToast(`位置加载失败：${e.message}`);
    }
  }

  function chooseLocation(nextId) {
    setLocationId(nextId);
    onLocationChange(nextId);
  }

  const selectedLocation = locations.find(l => l.id === locationId);
  const tabs = [
    { id: "inspection", label: "归档检查", icon: ClipboardCheck },
    { id: "repair", label: "修复工具箱", icon: Wrench },
    { id: "locator", label: "位置解释器", icon: MapPin },
    { id: "reports", label: "盘点报表", icon: Download },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">归档工具</h2>
            <div className="text-xs text-gray-500 mt-1">{selectedLocation ? `第${selectedLocation.cabinet_no}架 · 第${selectedLocation.row_no}排 · 第${selectedLocation.stack_no}摞` : locationId}</div>
          </div>
          <div className="flex items-center gap-2">
            <select value={locationId} onChange={e => chooseLocation(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[220px]">
              {locations.map(l => (
                <option key={l.id} value={l.id}>
                  第{l.cabinet_no}架 第{l.row_no}排 第{l.stack_no}摞 {l.year_month ? `(${l.year_month})` : ""}
                </option>
              ))}
            </select>
            <button onClick={loadLocations} className="p-2 rounded-lg border text-gray-500 hover:text-blue-600 hover:border-blue-300" title="刷新位置">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {tabs.map(item => (
            <button key={item.id} onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${tab === item.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
              <item.icon className="w-4 h-4" />{item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "inspection" && <InspectionTab locationId={locationId} showToast={showToast} onChanged={() => onChanged(locationId)} />}
      {tab === "repair" && <RepairToolsTab locationId={locationId} showToast={showToast} onChanged={() => onChanged(locationId)} />}
      {tab === "locator" && <LocationCodeInterpreter showToast={showToast} onLocationChange={chooseLocation} onShowTimeline={onShowTimeline} />}
      {tab === "reports" && <ReportsTab cabinetShapes={cabinetShapes} selectedLocation={selectedLocation} showToast={showToast} />}
    </div>
  );
}

function LocationCodeInterpreter({ showToast, onLocationChange, onShowTimeline }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function explain(e) {
    e?.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    try {
      setResult(await api.explainLocationCode(code.trim()));
    } catch (err) {
      setResult(null);
      showToast(`解析失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  const parsed = result?.parsed;
  const record = result?.record;

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-5 bg-white rounded-xl shadow-sm p-5 space-y-4">
        <div>
          <h3 className="font-bold text-sm">位置编码解释器</h3>
          <p className="text-xs text-gray-500 mt-1">输入书架编号后解析到具体摞位和本号。</p>
        </div>
        <form onSubmit={explain} className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">位置编号</label>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="如 11101"
              className="w-full border rounded-lg px-3 py-3 text-3xl font-mono font-black mt-1 tracking-normal text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button type="submit" disabled={loading || !code.trim()}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {loading ? "解析中..." : "解析编号"}
          </button>
        </form>
      </div>

      <div className="col-span-7 bg-white rounded-xl shadow-sm p-5">
        {!result ? (
          <div className="h-full min-h-[220px] flex items-center justify-center text-sm text-gray-400">等待输入位置编号</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3 text-center">
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-3"><div className="text-[10px] text-blue-500">书架</div><div className="text-2xl font-black text-blue-800">{parsed.cabinet_no}</div></div>
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3"><div className="text-[10px] text-emerald-500">排</div><div className="text-2xl font-black text-emerald-800">{parsed.row_no}</div></div>
              <div className="rounded-lg bg-amber-50 border border-amber-100 p-3"><div className="text-[10px] text-amber-500">摞</div><div className="text-2xl font-black text-amber-800">{parsed.stack_no}</div></div>
              <div className={`rounded-lg p-3 ${Number(parsed.book_index) > STANDARD_BOOKS_PER_STACK ? "bg-orange-50 border border-orange-200" : "bg-slate-50 border border-slate-100"}`}>
                <div className={`text-[10px] ${Number(parsed.book_index) > STANDARD_BOOKS_PER_STACK ? "text-orange-600" : "text-slate-500"}`}>本号</div>
                <div className={`text-2xl font-black ${Number(parsed.book_index) > STANDARD_BOOKS_PER_STACK ? "text-orange-800" : "text-slate-800"}`}>{parsed.book_index || "-"}</div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="text-xs text-gray-500 mb-1">系统位置</div>
              <div className="font-mono font-black text-xl text-gray-900">{parsed.location_id}</div>
              {!result.location && <div className="text-xs text-red-600 mt-2">当前系统尚未创建这个摞位。</div>}
            </div>

            {record ? (
              <div className={`rounded-lg border px-4 py-3 ${hasOverflow(record) ? "bg-orange-50 border-orange-200" : record.has_missing_info ? "bg-fuchsia-50 border-fuchsia-200" : "bg-blue-50 border-blue-100"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-500 mb-1">当前占用病历</div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-2xl font-black text-gray-950 truncate">{record.patient_name}</span>
                      {record.has_missing_info ? <MissingInfoBadge compact /> : null}
                      {hasOverflow(record) ? <OverflowBadge compact /> : null}
                    </div>
                    <div className="mt-1 font-mono text-sm text-gray-600">{record.inpatient_no}</div>
                  </div>
                  <StatusBadge status={record.archive_status} />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 font-medium">
                该本号当前没有病历占用。
              </div>
            )}

            <div className="flex justify-end gap-2">
              {record && (
                <button onClick={() => onShowTimeline(record.id)}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">
                  <History className="w-4 h-4" /> 查看生命周期
                </button>
              )}
              {result.location && (
                <button onClick={() => { onLocationChange(parsed.location_id); showToast(`已定位到 ${parsed.location_id}`); }}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  <MapPin className="w-4 h-4" /> 定位到书架
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InspectionTab({ locationId, showToast, onChanged }) {
  const [checklist, setChecklist] = useState(null);
  const [checkedBy, setCheckedBy] = useState("操作员");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (locationId) loadChecklist(); }, [locationId]);

  async function loadChecklist() {
    setLoading(true);
    try {
      setChecklist(await api.getLocationChecklist(locationId));
    } catch (e) {
      showToast(`检查表加载失败：${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function confirmInspection() {
    try {
      const result = await api.confirmLocationInspection(locationId, { checked_by: checkedBy, note });
      showToast(result.message || "归档检查已保存");
      setNote("");
      loadChecklist();
      onChanged();
    } catch (e) {
      showToast(`保存失败：${e.message}`);
    }
  }

  const summary = checklist?.summary || {};
  const checklistRecords = [
    ...(checklist?.cells || []).map(cell => cell.record).filter(Boolean),
    ...(checklist?.overflow_cells || []).map(cell => cell.record).filter(Boolean),
  ];
  const duplicateNames = getDuplicateNameSet(checklistRecords);
  const duplicateNameCount = countDuplicateNameRecords(checklistRecords, duplicateNames);
  const statusText = { empty: "空", ok: "正常", missing_info: "占位", overflow: "超容量", borrowed: "借出", issue: "待核对" };
  const statusClass = {
    empty: "border-gray-200 bg-gray-50 text-gray-400",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
    missing_info: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800 ring-2 ring-fuchsia-200",
    overflow: "border-orange-300 bg-orange-50 text-orange-800 ring-2 ring-orange-100",
    borrowed: "border-amber-300 bg-amber-50 text-amber-800",
    issue: "border-rose-300 bg-rose-50 text-rose-800",
  };

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-8 bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm">1-25 本位检查表</h3>
            {duplicateNameCount > 0 && <DuplicateNameBadge compact />}
          </div>
          <button onClick={loadChecklist} disabled={loading} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">
            <RefreshCw className="w-3 h-3" />刷新
          </button>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {(checklist?.cells || []).map(cell => {
            const record = cell.record;
            const isDuplicateName = hasDuplicateNameInStack(record, duplicateNames);
            return (
              <div key={cell.book_index} className={`min-h-[92px] rounded-lg border p-2 ${statusClass[cell.status]} ${isDuplicateName ? "ring-2 ring-cyan-200" : ""}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-bold text-sm">#{pad(cell.book_index)}</span>
                  <span className="text-[10px] font-bold">{statusText[cell.status]}</span>
                </div>
                {record ? (
                  <div className="space-y-1 min-w-0">
                    <div className="text-sm font-bold truncate">{record.patient_name}</div>
                    {isDuplicateName && <DuplicateNameBadge compact />}
                    <div className="text-[11px] font-mono truncate opacity-80">{record.inpatient_no}</div>
                    {record.active_borrower && <div className="text-[10px] truncate">借阅：{record.active_borrower}</div>}
                  </div>
                ) : (
                  <div className="text-xs mt-5 text-center">空位</div>
                )}
              </div>
            );
          })}
        </div>
        {(checklist?.overflow_cells || []).length > 0 && (
          <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-orange-800">
              <AlertCircle className="h-4 w-4" />超容量附加区
            </div>
            <div className="grid grid-cols-5 gap-2">
              {checklist.overflow_cells.map(cell => {
                const record = cell.record;
                const isDuplicateName = hasDuplicateNameInStack(record, duplicateNames);
                return (
                  <div key={cell.book_index} className={`min-h-[92px] rounded-lg border p-2 ${statusClass[cell.status]} ${isDuplicateName ? "ring-2 ring-cyan-200" : ""}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold text-sm">#{cell.book_index}</span>
                      <span className="text-[10px] font-bold">{statusText[cell.status]}</span>
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="text-sm font-bold truncate">{record.patient_name}</div>
                      {isDuplicateName && <DuplicateNameBadge compact />}
                      <div className="text-[11px] font-mono truncate opacity-80">{record.inpatient_no}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="col-span-4 space-y-4">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="font-bold text-sm mb-3">检查概览</h3>
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xl font-mono font-bold text-emerald-700">{summary.ok || 0}</div><div className="text-emerald-700">正常</div></div>
            <div className="rounded-lg bg-gray-50 p-3"><div className="text-xl font-mono font-bold text-gray-600">{summary.empty || 0}</div><div className="text-gray-500">空位</div></div>
            <div className="rounded-lg bg-fuchsia-50 p-3"><div className="text-xl font-mono font-bold text-fuchsia-700">{summary.missing_info || 0}</div><div className="text-fuchsia-700">占位待补</div></div>
            <div className="rounded-lg bg-orange-50 p-3"><div className="text-xl font-mono font-bold text-orange-700">{summary.overflow || 0}</div><div className="text-orange-700">超容量</div></div>
            <div className="rounded-lg bg-rose-50 p-3 col-span-2"><div className="text-xl font-mono font-bold text-rose-700">{(summary.borrowed || 0) + (summary.issue || 0)}</div><div className="text-rose-700">需关注</div></div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <h3 className="font-bold text-sm">确认留痕</h3>
          <div>
            <label className="text-xs text-gray-500">检查人</label>
            <input value={checkedBy} onChange={e => setCheckedBy(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500">备注</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="例如：实物已核对，缺失占位待后续补录" />
          </div>
          <button onClick={confirmInspection} className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            确认本摞检查
          </button>
        </div>
      </div>
    </div>
  );
}

function RepairToolsTab({ locationId, showToast, onChanged }) {
  const [records, setRecords] = useState([]);
  const [startIndex, setStartIndex] = useState(2);
  const [endIndex, setEndIndex] = useState(STANDARD_BOOKS_PER_STACK);
  const [direction, setDirection] = useState(-1);
  const [releaseBlocker, setReleaseBlocker] = useState(false);
  const [gapIndex, setGapIndex] = useState(1);
  const [leftIndex, setLeftIndex] = useState(1);
  const [rightIndex, setRightIndex] = useState(2);
  const [compactStart, setCompactStart] = useState(1);
  const [rollbackStart, setRollbackStart] = useState(1);
  const [rollbackEnd, setRollbackEnd] = useState(1);

  useEffect(() => { if (locationId) loadRecords(); }, [locationId]);

  async function loadRecords() {
    try {
      const result = await api.getRecordsByLocation(locationId);
      const rows = result.data || [];
      setRecords(rows);
      setEndIndex(Math.max(1, ...rows.map(r => Number(r.book_index) || 0)));
    } catch (e) {
      showToast(`病历加载失败：${e.message}`);
    }
  }

  async function runAction(action) {
    try {
      const result = await action();
      showToast(result.message || "处理完成");
      await loadRecords();
      onChanged();
    } catch (e) {
      showToast(`处理失败：${e.message}`);
    }
  }

  const maxBook = Math.max(0, ...records.map(r => Number(r.book_index) || 0));
  const recordByIndex = new Map(records.map(r => [Number(r.book_index), r]));
  const overflowRecords = records.filter(hasOverflow);
  const duplicateNames = getDuplicateNameSet(records);
  const duplicateNameCount = countDuplicateNameRecords(records, duplicateNames);

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-5 space-y-4">
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <h3 className="font-bold text-sm">整体前移/后移</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-500">起始本号</label><input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={startIndex} onChange={e => setStartIndex(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            <div><label className="text-xs text-gray-500">结束本号</label><input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={endIndex} onChange={e => setEndIndex(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setDirection(-1)} className={`px-3 py-2 rounded-lg text-sm border ${direction === -1 ? "bg-amber-600 text-white border-amber-600" : "bg-white"}`}>前移一位</button>
            <button onClick={() => setDirection(1)} className={`px-3 py-2 rounded-lg text-sm border ${direction === 1 ? "bg-amber-600 text-white border-amber-600" : "bg-white"}`}>后移一位</button>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={releaseBlocker} onChange={e => setReleaseBlocker(e.target.checked)} className="h-4 w-4 accent-red-600" />
            边界占用时退回暂存池
          </label>
          <button onClick={() => runAction(() => api.shiftLocationRecords(locationId, { start_index: Number(startIndex), end_index: Number(endIndex), direction, release_blocker: releaseBlocker }))}
            className="w-full py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700">执行序号校正</button>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <h3 className="font-bold text-sm">插入空位</h3>
          <div><label className="text-xs text-gray-500">插入到第几本</label><input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={gapIndex} onChange={e => setGapIndex(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
          <button onClick={() => runAction(() => api.shiftLocationRecords(locationId, { start_index: Number(gapIndex), end_index: maxBook, direction: 1, release_blocker: false }))}
            disabled={maxBook <= 0 || Number(gapIndex) > maxBook}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">从此本号后移让位</button>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <h3 className="font-bold text-sm">交换/移动本号</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-500">本号 A</label><input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={leftIndex} onChange={e => setLeftIndex(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            <div><label className="text-xs text-gray-500">本号 B</label><input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={rightIndex} onChange={e => setRightIndex(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
          </div>
          <button onClick={() => runAction(() => api.swapLocationBooks(locationId, { left_index: Number(leftIndex), right_index: Number(rightIndex) }))}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">交换或移动</button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h3 className="font-bold text-sm">压缩空位</h3>
            <input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={compactStart} onChange={e => setCompactStart(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => runAction(() => api.compactLocationBooks(locationId, { start_index: Number(compactStart) }))}
              className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700">压缩</button>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <h3 className="font-bold text-sm">范围退回</h3>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={rollbackStart} onChange={e => setRollbackStart(e.target.value)} className="w-full border rounded-lg px-2 py-2 text-sm" />
              <input type="number" min="1" max={MAX_OVERFLOW_BOOK_INDEX} value={rollbackEnd} onChange={e => setRollbackEnd(e.target.value)} className="w-full border rounded-lg px-2 py-2 text-sm" />
            </div>
            <button onClick={() => { if (confirm(`确认将第 ${rollbackStart}-${rollbackEnd} 本退回暂存池？`)) runAction(() => api.rollbackLocationRange(locationId, { start_index: Number(rollbackStart), end_index: Number(rollbackEnd) })); }}
              className="w-full py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">退回</button>
          </div>
        </div>
      </div>

      <div className="col-span-7 bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm">当前摞位预览</h3>
            {duplicateNameCount > 0 && <DuplicateNameBadge compact />}
          </div>
          <button onClick={loadRecords} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"><RefreshCw className="w-3 h-3" />刷新</button>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: STANDARD_BOOKS_PER_STACK }, (_, i) => {
            const bookIndex = i + 1;
            const record = recordByIndex.get(bookIndex);
            const isMissing = hasMissingInfo(record);
            const isDuplicateName = hasDuplicateNameInStack(record, duplicateNames);
            return (
              <div key={bookIndex} className={`min-h-[78px] rounded-lg border p-2 ${record ? isMissing ? "bg-fuchsia-50 border-fuchsia-300 text-fuchsia-800" : "bg-blue-50 border-blue-200 text-blue-800" : "bg-gray-50 border-gray-200 text-gray-400"} ${isDuplicateName ? "ring-2 ring-cyan-200" : ""}`}>
                <div className="font-mono font-bold text-xs mb-1">#{pad(bookIndex)}</div>
                {record ? (
                  <>
                    <div className="text-sm font-bold truncate">{record.patient_name}</div>
                    {isDuplicateName && <DuplicateNameBadge compact />}
                    <div className="text-[10px] font-mono truncate">{record.inpatient_no}</div>
                  </>
                ) : <div className="text-xs text-center mt-4">空</div>}
              </div>
            );
          })}
        </div>
        {overflowRecords.length > 0 && (
          <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-orange-800">
              <AlertCircle className="h-4 w-4" />超容量附加区
            </div>
            <div className="grid grid-cols-5 gap-2">
              {overflowRecords.map(record => {
                const isDuplicateName = hasDuplicateNameInStack(record, duplicateNames);
                return (
                <div key={record.id} className={`min-h-[78px] rounded-lg border border-orange-300 bg-white p-2 text-orange-800 ${isDuplicateName ? "ring-2 ring-cyan-200" : ""}`}>
                  <div className="font-mono font-bold text-xs mb-1">#{record.book_index}</div>
                  <div className="text-sm font-bold truncate">{record.patient_name}</div>
                  {isDuplicateName && <DuplicateNameBadge compact />}
                  <div className="text-[10px] font-mono truncate">{record.inpatient_no}</div>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportsTab({ cabinetShapes, selectedLocation, showToast }) {
  const [cabinetNo, setCabinetNo] = useState(selectedLocation?.cabinet_no || "");
  const [status, setStatus] = useState("");

  useEffect(() => { setCabinetNo(selectedLocation?.cabinet_no || ""); }, [selectedLocation?.cabinet_no]);

  async function downloadReport(type, params, filename) {
    try {
      await api.downloadReport(type, params, filename);
      showToast(`已生成：${filename}`);
    } catch (e) {
      showToast(`导出失败：${e.message}`);
    }
  }

  const filters = { cabinet_no: cabinetNo, status };
  const cards = [
    { type: "inventory", title: "全量盘点表", filename: "病历盘点表.csv", params: filters },
    { type: "missing", title: "占位待补清单", filename: "占位待补清单.csv", params: { cabinet_no: cabinetNo } },
    { type: "pool", title: "暂存池清单", filename: "暂存池清单.csv", params: {} },
    { type: "borrows", title: "借阅清单", filename: "借阅清单.csv", params: {} },
    { type: "issues", title: "问题病历清单", filename: "问题病历清单.csv", params: {} },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">书架范围</label>
          <select value={cabinetNo} onChange={e => setCabinetNo(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[160px]">
            <option value="">全部书架</option>
            {cabinetShapes.map(c => <option key={c.no} value={c.no}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">归档状态</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[160px]">
            <option value="">全部状态</option>
            <option value="在架">在架</option>
            <option value="借出">借出</option>
            <option value="归还待核对">归还待核对</option>
            <option value="遗失待查">遗失待查</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {cards.map(card => (
          <button key={card.type} onClick={() => downloadReport(card.type, card.params, card.filename)}
            className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50 transition">
            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-gray-900">{card.title}</div>
              <div className="text-xs text-gray-500 mt-1">CSV</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function IssueLedger({ issues, onRefresh }) {
  return null;
}

// ─── Quality Control (病历质控台账) ───
function QualityControl({ issues, onRefresh, onResolve, onSelectPile }) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><ClipboardList className="w-5 h-5 text-red-500" />病历质控台账</h2>
          <p className="text-xs text-gray-500 mt-1">点击条目展开详情，可标记"问题已解决"恢复在架状态</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded-lg border border-red-100 font-medium">待处理 {issues.length} 例</span>
          <button onClick={onRefresh} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 px-3 py-1.5 border rounded-lg">
            <RefreshCw className="w-4 h-4" /> 刷新
          </button>
        </div>
      </div>
      {issues.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-300" />
          <p className="text-sm">所有病历状态正常，暂无待处理问题</p>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map(rec => {
            const isExpanded = expandedId === rec.id;
            return (
              <div key={rec.id} className={`border rounded-lg transition ${isExpanded ? "border-red-200 bg-red-50/30" : "hover:bg-gray-50"}`}>
                {/* 折叠头部 - 点击展开 */}
                <button onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  <span className="font-medium text-sm flex-1 truncate">{rec.patient_name}</span>
                  <span className="text-xs text-gray-500 font-mono">{rec.inpatient_no}</span>
                  <span className="text-xs text-gray-400 font-mono">{rec.location_id}</span>
                  <StatusBadge status={rec.archive_status} />
                </button>
                {/* 展开详情 */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-red-100 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div><span className="text-gray-500">住院号：</span><span className="font-mono">{rec.inpatient_no}</span></div>
                      <div><span className="text-gray-500">位置：</span><span className="font-mono">{rec.location_id} 第{rec.book_index}本</span></div>
                      <div><span className="text-gray-500">出院日期：</span><span>{rec.discharge_date || "—"}</span></div>
                      <div><span className="text-gray-500">当前状态：</span><span className="text-red-600 font-medium">{rec.archive_status}</span></div>
                    </div>
                    {(rec.issue_type || rec.issue_desc) && (
                      <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                          <span className="text-xs font-bold text-red-700">问题详情</span>
                          {rec.risk_level && <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded font-medium">{rec.risk_level}</span>}
                        </div>
                        {rec.issue_type && <div className="text-sm font-medium text-red-800 mt-1">{rec.issue_type}</div>}
                        {rec.issue_desc && <div className="text-xs text-red-600 mt-1 leading-relaxed">{rec.issue_desc}</div>}
                        {rec.found_at && <div className="text-[10px] text-gray-400 mt-2">发现时间：{rec.found_at}</div>}
                      </div>
                    )}
                    <div className="flex gap-2 pt-2">
                      <button onClick={() => onResolve(rec)}
                        className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">
                        问题已解决（恢复在架）
                      </button>
                      <button onClick={() => onSelectPile(rec.location_id)}
                        className="text-xs px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium">
                        定位到书架
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Borrows List ───
function BorrowsList({ onReturn }) {
  const [borrows, setBorrows] = useState([]);
  useEffect(() => { api.getActiveBorrows().then(setBorrows).catch(console.error); }, []);
  return (
    <>
      {borrows.length === 0 && <p className="text-gray-500 text-sm">暂无借出记录</p>}
      <div className="space-y-2">
        {borrows.map(b => (
          <div key={b.id} className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <span className="font-medium text-sm">{b.patient_name}</span>
              <span className="text-gray-500 text-xs ml-2">{b.inpatient_no}</span>
              <span className="text-gray-400 text-xs ml-2">借阅人：{b.borrower}</span>
              <span className="text-gray-400 text-xs ml-2">科室：{b.department || "—"}</span>
              <span className="text-gray-400 text-xs ml-2">{b.borrowed_at}</span>
            </div>
            <button onClick={() => onReturn({ id: b.record_id, archive_status: "借出", patient_name: b.patient_name })}
              className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700">归还</button>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Backup Page ───
function BackupPage({ showToast }) {
  const [payload, setPayload] = useState({ status: null, backups: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState("");
  const [verifyResults, setVerifyResults] = useState({});

  useEffect(() => { loadBackups(); }, []);

  async function loadBackups() {
    try {
      setLoading(true);
      setPayload(await api.getBackups());
    } catch (e) {
      showToast?.(`读取备份失败：${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function createBackup() {
    try {
      setCreating(true);
      const result = await api.createBackup();
      showToast?.(result.message || "备份已完成");
      await loadBackups();
    } catch (e) {
      showToast?.(`备份失败：${e.message}`);
    } finally {
      setCreating(false);
    }
  }

  async function verifyBackup(filename) {
    try {
      setVerifying(filename);
      const result = await api.verifyBackup(filename);
      setVerifyResults(prev => ({ ...prev, [filename]: result }));
      showToast?.(result.ok ? "备份完整性正常" : "备份校验异常，请不要作为恢复依据");
    } catch (e) {
      showToast?.(`校验失败：${e.message}`);
    } finally {
      setVerifying("");
    }
  }

  async function downloadBackup(filename) {
    try {
      await api.downloadBackup(filename);
      showToast?.("备份文件已开始下载");
    } catch (e) {
      showToast?.(`下载失败：${e.message}`);
    }
  }

  const status = payload.status || {};
  const backups = payload.backups || [];
  const latest = status.latest;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />数据备份
            </h2>
            <p className="text-sm text-gray-500 mt-1">当前数据库的本地备份、完整性校验和下载出口。</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadBackups} disabled={loading}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 px-3 py-2 border rounded-lg disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />刷新
            </button>
            <button onClick={createBackup} disabled={creating}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium disabled:opacity-50">
              {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <HardDriveDownload className="w-4 h-4" />}
              {creating ? "备份中" : "立即备份"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="border rounded-lg p-4 bg-blue-50 border-blue-100">
            <div className="text-xs text-blue-700 font-medium">备份数量</div>
            <div className="text-2xl font-black text-blue-950 mt-1">{status.count ?? backups.length}</div>
            <div className="text-[11px] text-blue-600 mt-1">最多保留 {status.keep || "-"} 份</div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500 font-medium">当前数据库</div>
            <div className="text-xl font-bold mt-1">{formatBytes(status.db_size)}</div>
            <div className="text-[11px] text-gray-400 mt-1 truncate" title={status.db_modified_at || ""}>{formatDateTime(status.db_modified_at)}</div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500 font-medium">最近备份</div>
            <div className="text-sm font-bold mt-2 truncate" title={latest?.filename || ""}>{latest?.filename || "暂无"}</div>
            <div className="text-[11px] text-gray-400 mt-1">{formatDateTime(latest?.modified_at)}</div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs text-gray-500 font-medium">外部镜像目录</div>
            <div className={`text-sm font-bold mt-2 truncate ${status.extra_backup_dir ? "text-green-700" : "text-amber-700"}`} title={status.extra_backup_dir || ""}>
              {status.extra_backup_dir ? "已配置" : "未配置"}
            </div>
            <div className="text-[11px] text-gray-400 mt-1">可用 BACKUP_EXTRA_DIR 指向U盘或网盘</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-gray-50 border text-gray-600 min-w-0">
            <span className="font-bold text-gray-700">数据库：</span>
            <span className="font-mono break-all">{status.db_path || "-"}</span>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 border text-gray-600 min-w-0">
            <span className="font-bold text-gray-700">备份目录：</span>
            <span className="font-mono break-all">{status.backup_dir || "-"}</span>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 leading-relaxed">
          当前备份仍主要保存在本机目录。为了应对电脑损坏、硬盘故障、误删、系统重装这类极端情况，建议每天录入结束后点一次“立即备份”，再下载或复制一份到U盘、移动硬盘或院内共享盘。
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm">备份文件</h3>
          <span className="text-xs text-gray-400">校验结果只验证备份库能否被 SQLite 正常读取</span>
        </div>
        {backups.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-10">暂无备份文件，请先点击“立即备份”。</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 gap-2 bg-gray-50 text-xs font-medium text-gray-500 px-3 py-2">
              <span className="col-span-4">文件名</span>
              <span className="col-span-2">大小</span>
              <span className="col-span-3">生成时间</span>
              <span className="col-span-1">校验</span>
              <span className="col-span-2 text-right">操作</span>
            </div>
            <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
              {backups.map(file => {
                const verified = verifyResults[file.filename];
                return (
                  <div key={file.filename} className="grid grid-cols-12 gap-2 items-center px-3 py-3 text-sm hover:bg-gray-50">
                    <span className="col-span-4 font-mono text-xs text-gray-800 truncate" title={file.filename}>{file.filename}</span>
                    <span className="col-span-2 text-gray-600">{formatBytes(file.size)}</span>
                    <span className="col-span-3 text-gray-500 text-xs">{formatDateTime(file.modified_at)}</span>
                    <span className="col-span-1">
                      {verified ? (
                        <span className={`text-xs font-bold ${verified.ok ? "text-green-700" : "text-red-700"}`}>{verified.ok ? "正常" : "异常"}</span>
                      ) : (
                        <span className="text-xs text-gray-400">未校验</span>
                      )}
                    </span>
                    <span className="col-span-2 flex justify-end gap-2">
                      <button onClick={() => verifyBackup(file.filename)} disabled={verifying === file.filename}
                        className="px-2.5 py-1.5 border rounded-lg text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                        {verifying === file.filename ? "校验中" : "校验"}
                      </button>
                      <button onClick={() => downloadBackup(file.filename)}
                        className="px-2.5 py-1.5 bg-slate-800 text-white rounded-lg text-xs hover:bg-slate-900">
                        下载
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Audit Log Page ───
function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { api.getAuditLogs(100).then(setLogs).catch(console.error); }, []);
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2"><History className="w-5 h-5 text-slate-500" />操作日志</h2>
        <button onClick={() => api.getAuditLogs(100).then(setLogs)} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 px-3 py-1.5 border rounded-lg">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>
      {logs.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">暂无操作记录</p>
      ) : (
        <div className="space-y-1 max-h-[600px] overflow-y-auto">
          <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 px-3 py-2 bg-gray-50 rounded-lg sticky top-0">
            <span className="col-span-3">时间</span>
            <span className="col-span-2">操作人</span>
            <span className="col-span-2">动作</span>
            <span className="col-span-2">对象类型</span>
            <span className="col-span-3">详情</span>
          </div>
          {logs.map(log => (
            <div key={log.id} className="grid grid-cols-12 gap-2 items-center px-3 py-2 text-xs border-b border-gray-50 hover:bg-gray-50">
              <span className="col-span-3 text-gray-500 font-mono">{log.created_at}</span>
              <span className="col-span-2 text-gray-700">{log.actor}</span>
              <span className="col-span-2"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${log.action === "POST" ? "bg-green-100 text-green-700" : log.action === "PUT" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>{log.action}</span></span>
              <span className="col-span-2 text-gray-600">{log.target_type}</span>
              <span className="col-span-3 text-gray-400 truncate" title={log.detail}>{log.target_id || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ShelfManager({ onClose, currentCabinet, onChanged }) {
  const [rows, setRows] = useState(6);
  const [stacks, setStacks] = useState(6);
  const [cabinetNo, setCabinetNo] = useState(currentCabinet);
  const [locations, setLocations] = useState([]);
  const [targetRow, setTargetRow] = useState(1);
  const [targetStack, setTargetStack] = useState(8);
  const [msg, setMsg] = useState("");

  useEffect(() => { setCabinetNo(currentCabinet); }, [currentCabinet]);
  useEffect(() => { loadLocations(); }, [cabinetNo]);
  useEffect(() => {
    const rowMax = currentRowMaxStack();
    if (targetStack <= rowMax) setTargetStack(rowMax + 1);
  }, [targetRow, locations]);

  async function loadLocations() {
    try {
      const rows = await api.getLocations(cabinetNo);
      const shelfLocations = rows.filter(l => l.id !== "__POOL__");
      setLocations(shelfLocations);
      const maxRows = Math.max(1, ...shelfLocations.map(l => Number(l.row_no) || 0));
      const maxStacks = Math.max(1, ...shelfLocations.map(l => Number(l.stack_no) || 0));
      setRows(maxRows);
      setStacks(maxStacks);
      setTargetRow(prev => Math.min(Math.max(prev || 1, 1), maxRows));
    } catch (e) {
      console.error(e);
      setLocations([]);
    }
  }

  function currentRowMaxStack(row = targetRow) {
    return Math.max(0, ...locations.filter(l => Number(l.row_no) === Number(row)).map(l => Number(l.stack_no) || 0));
  }

  async function handleAddRow() {
    try {
      await api.batchCreateLocations({ cabinet_no: cabinetNo, rows: rows, stacks_per_row: stacks });
      await loadLocations();
      onChanged?.(cabinetNo);
      setMsg(`已创建/补全 ${cabinetNo}号架 ${rows}排，每排补到第 ${stacks} 摞`);
    } catch (e) { setMsg(`失败：${e.message}`); }
  }

  async function handleExtendRow() {
    try {
      const result = await api.extendLocationRow({ cabinet_no: cabinetNo, row_no: targetRow, stack_to: targetStack });
      await loadLocations();
      onChanged?.(cabinetNo);
      setMsg(`已为 ${cabinetNo}号架第 ${targetRow} 排补充 ${result.created || 0} 个摞位，当前到第 ${targetStack} 摞`);
    } catch (e) {
      setMsg(`失败：${e.message}`);
    }
  }

  async function handleDeleteCabinet() {
    if (!confirm(`确认删除 ${cabinetNo}号架？只有整柜都没有病历时才允许删除。`)) return;
    try {
      await api.deleteCabinet(cabinetNo);
      await loadLocations();
      onChanged?.();
      setMsg(`${cabinetNo}号架已删除`);
    } catch (e) { setMsg(`失败：${e.message}`); }
  }

  const maxRows = Math.max(1, rows, ...locations.map(l => Number(l.row_no) || 0));
  const rowMaxStack = currentRowMaxStack();

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-[560px] max-w-[92vw] shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">书架管理</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-4">
          <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
            <h4 className="text-sm font-bold text-indigo-800 mb-3">按排追加横向摞位</h4>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs text-gray-500">架号</label><input type="number" min="1" max="99" value={cabinetNo} onChange={e => setCabinetNo(+e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
              <div>
                <label className="text-xs text-gray-500">排号</label>
                <select value={targetRow} onChange={e => setTargetRow(+e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-white">
                  {Array.from({ length: maxRows }, (_, i) => i + 1).map(row => <option key={row} value={row}>第 {row} 排</option>)}
                </select>
              </div>
              <div><label className="text-xs text-gray-500">补到第几摞</label><input type="number" min={Math.max(1, rowMaxStack + 1)} max="200" value={targetStack} onChange={e => setTargetStack(+e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            </div>
            <div className="mt-2 text-[11px] text-indigo-600">当前第 {targetRow} 排已到第 {rowMaxStack || 0} 摞；每一摞固定容量仍为 25 本。</div>
            <button onClick={handleExtendRow} className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 w-full font-medium">补充这一排摞位</button>
          </div>
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
            <h4 className="text-sm font-bold text-blue-800 mb-3">初始化/整架补全</h4>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs text-gray-500">架号</label><input type="number" min="1" max="99" value={cabinetNo} onChange={e => setCabinetNo(+e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
              <div><label className="text-xs text-gray-500">排数</label><input type="number" min="1" max="50" value={rows} onChange={e => setRows(+e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
              <div><label className="text-xs text-gray-500">每排补到摞号</label><input type="number" min="1" max="200" value={stacks} onChange={e => setStacks(+e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
            </div>
            <button onClick={handleAddRow} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 w-full font-medium">按整架补全位置</button>
          </div>
          <div className="p-4 bg-red-50 rounded-lg border border-red-100">
            <h4 className="text-sm font-bold text-red-800 mb-2">删除整架</h4>
            <p className="text-xs text-red-600 mb-3">仅能删除整架都没有病历的位置；任意摞位已有病历时后端会拒绝。</p>
            <button onClick={handleDeleteCabinet} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 font-medium">删除 {cabinetNo}号架</button>
          </div>
          {msg && <div className="text-sm text-center p-2 bg-gray-100 rounded-lg">{msg}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Pool Page (暂存池) ───
function PoolPage({ poolHighlightId, onAssigned, showToast, cabinetShapes, onPositionConflict, onShowTimeline }) {
  const [poolGroups, setPoolGroups] = useState([{ key: "all", label: "全部暂存", count: 0, records: [] }]);
  const [activeGroup, setActiveGroup] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [name, setName] = useState("");
  const [inpNo, setInpNo] = useState("");
  const [assignCabinet, setAssignCabinet] = useState("");
  const [assignTarget, setAssignTarget] = useState("");
  const [allowOverflowAssign, setAllowOverflowAssign] = useState(false);
  const [locations, setLocations] = useState([]);
  const nameRef = useRef(null);
  const highlightedPoolRecordRef = useRef(null);

  useEffect(() => { loadPool(); loadLocations(); }, []);
  useEffect(() => { setSelected(new Set()); }, [activeGroup]);
  useEffect(() => { if (poolHighlightId) setActiveGroup("all"); }, [poolHighlightId]);
  async function loadPool() {
    try {
      const result = await api.getGroupedPool();
      setPoolGroups(result.groups || [{ key: "all", label: "全部暂存", count: 0, records: [] }]);
    } catch (e) {
      console.error(e);
      const fallback = await api.getPool();
      setPoolGroups([{ key: "all", label: "全部暂存", count: fallback.total || 0, records: fallback.data || [] }]);
    }
  }
  async function loadLocations() { try { const r = await api.getLocations(); setLocations(r.filter(l => l.id !== "__POOL__")); } catch (e) { console.error(e); } }

  const filteredLocations = assignCabinet ? locations.filter(l => l.cabinet_no === parseInt(assignCabinet)) : [];
  const currentGroup = poolGroups.find(group => group.key === activeGroup) || poolGroups[0] || { records: [] };
  const poolRecords = currentGroup.records || [];

  useEffect(() => {
    if (!poolHighlightId) return;
    requestAnimationFrame(() => {
      highlightedPoolRecordRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [poolHighlightId, activeGroup, poolRecords.length]);

  async function handleQuickAdd(e) {
    e.preventDefault();
    if (!name.trim() || !inpNo.trim()) return;
    try {
      await api.createRecord({ patient_name: name.trim(), inpatient_no: inpNo.trim() });
      showToast(`已暂存：${name.trim()}`);
      setName(""); setInpNo(""); nameRef.current?.focus(); loadPool();
    } catch (e) { showToast(`失败：${e.message}`); }
  }

  function toggleSelect(id) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function selectAll() { setSelected(new Set(poolRecords.map(r => r.id))); }
  function clearSelection() { setSelected(new Set()); }

  async function handleAssign() {
    if (!assignTarget || selected.size === 0) { showToast("请选择病历和目标位置"); return; }
    const targetLocationId = assignTarget;
    const selectedIds = [...selected];
    try {
      const result = await api.assignFromPool({
        record_ids: selectedIds,
        location_id: targetLocationId,
        allow_overflow: allowOverflowAssign,
        force_overflow: allowOverflowAssign,
      });
      showToast(result.message || `已分配 ${selectedIds.length} 份到 ${targetLocationId}`);
      setSelected(new Set()); setAssignTarget(""); setAllowOverflowAssign(false);
      await loadPool();
      await onAssigned?.(targetLocationId, result.assigned || selectedIds.map(id => ({ id, location_id: targetLocationId })));
    } catch (e) {
      if (onPositionConflict?.(e)) {
        setSelected(new Set());
        await loadPool();
        await onAssigned?.();
      } else {
        showToast(`分配失败：${e.message}`);
      }
    }
  }

  async function handleDelete(id) {
    if (!confirm("确认删除？")) return;
    try { await api.deleteRecord(id); loadPool(); } catch (e) { showToast(`删除失败：${e.message}`); }
  }

  return (
    <div className="space-y-4">
      {/* 快速录入 */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-1"><FolderInput className="w-5 h-5 text-blue-500" />暂存池</h2>
        <p className="text-xs text-gray-500 mb-4">快速录入病历，无需指定书架位置。录入后可批量分配到具体摞位。</p>
        <form onSubmit={handleQuickAdd} className="flex gap-3 items-end">
          <div className="flex-1"><label className="text-xs text-gray-500">患者姓名</label><input ref={nameRef} value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" required autoFocus /></div>
          <div className="flex-1"><label className="text-xs text-gray-500">住院号</label><input value={inpNo} onChange={e => setInpNo(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" required /></div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium shrink-0">录入暂存</button>
        </form>
      </div>

      {/* 暂存列表 + 分配 */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm">暂存病历 ({poolRecords.length} 份)</h3>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs text-blue-600 hover:underline">全选本区</button>
            <button onClick={clearSelection} className="text-xs text-gray-500 hover:underline">清除</button>
            <button onClick={loadPool} className="text-xs text-gray-500 hover:underline flex items-center gap-1"><RefreshCw className="w-3 h-3" />刷新</button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          {poolGroups.map(group => (
            <button key={group.key} onClick={() => setActiveGroup(group.key)}
              className={`rounded-lg border px-3 py-2 text-left transition ${activeGroup === group.key ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100"}`}>
              <div className="text-xs font-bold truncate">{group.label}</div>
              <div className="text-xl font-mono font-black leading-tight">{group.count || 0}</div>
            </button>
          ))}
        </div>

        {poolRecords.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">{activeGroup === "all" ? "暂存池为空，请在上方快速录入" : "当前分区暂无病历"}</p>
        ) : (
          <>
            <div className="space-y-1 max-h-[300px] overflow-y-auto mb-4">
              {poolRecords.map(r => {
                const isHighlighted = poolHighlightId === r.id;
                return (
                <div key={r.id} ref={isHighlighted ? highlightedPoolRecordRef : null}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition cursor-pointer ${isHighlighted ? "bg-amber-50 border-amber-400 ring-2 ring-amber-300 shadow-sm" : selected.has(r.id) ? "bg-blue-50 border-blue-300" : "hover:bg-gray-50"}`}
                  onClick={() => toggleSelect(r.id)}>
                  <input type="checkbox" checked={selected.has(r.id)} onClick={e => e.stopPropagation()} onChange={() => toggleSelect(r.id)} className="w-4 h-4 rounded" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-sm truncate ${isHighlighted ? "font-black text-amber-900" : "font-medium"}`}>{r.patient_name}</span>
                      {isHighlighted && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-bold shrink-0">搜索定位</span>
                      )}
                      {r.has_missing_info ? <MissingInfoBadge compact /> : null}
                      {r.pool_group_label && activeGroup === "all" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">{r.pool_group_label}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 font-mono">{r.inpatient_no}</span>
                  <button onClick={(e) => { e.stopPropagation(); onShowTimeline(r); }} className="text-xs text-slate-500 hover:text-slate-800 px-1">轨迹</button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }} className="text-xs text-red-500 hover:text-red-700 px-1">删除</button>
                </div>
                );
              })}
            </div>

            {/* 分配操作 */}
            {selected.size > 0 && (
              <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                <div className="text-sm font-medium text-indigo-800 mb-2">已选 {selected.size} 份，分配到：</div>
                <div className="flex gap-2">
                  <select value={assignCabinet} onChange={e => { setAssignCabinet(e.target.value); setAssignTarget(""); }}
                    className="w-32 border rounded-lg px-2 py-2 text-sm bg-white">
                    <option value="">选择书架</option>
                    {cabinetShapes.map(c => <option key={c.no} value={c.no}>{c.name}</option>)}
                  </select>
                  <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)}
                    className="flex-1 border rounded-lg px-2 py-2 text-sm bg-white" disabled={!assignCabinet}>
                    <option value="">{assignCabinet ? "选择摞位" : "请先选书架"}</option>
                    {filteredLocations.map(l => (
                      <option key={l.id} value={l.id}>第{l.row_no}排 第{l.stack_no}摞{l.year_month ? ` (${l.year_month})` : ""}</option>
                    ))}
                  </select>
                  <button onClick={handleAssign} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 font-medium shrink-0">确认分配</button>
                </div>
                <label className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${allowOverflowAssign ? "border-orange-200 bg-orange-50 text-orange-700" : "border-indigo-100 bg-white/70 text-indigo-600"}`}>
                  <input type="checkbox" checked={allowOverflowAssign} onChange={e => setAllowOverflowAssign(e.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-600" />
                  <span>
                    直接追加到第26本以后
                    <span className="block mt-0.5">默认只使用1-25标准本位；勾选后不填标准空位，直接进入超容量附加区。</span>
                  </span>
                </label>
                <p className="text-[10px] text-indigo-500 mt-2">分配后病历将进入目标摞位首个连续空位，并自动定位到该摞位</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Batch Page (批量操作) ───
function BatchPage({ showToast, onDone }) {
  const [mode, setMode] = useState("borrow"); // borrow | return | issue
  const [method, setMethod] = useState("names"); // names | date
  const [namesInput, setNamesInput] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [borrower, setBorrower] = useState("");
  const [department, setDepartment] = useState("");
  const [purpose, setPurpose] = useState("");
  const [issueType, setIssueType] = useState("缺护理记录单");
  const [issueDesc, setIssueDesc] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeBorrows, setActiveBorrows] = useState([]);
  const [selectedReturns, setSelectedReturns] = useState(new Set());

  useEffect(() => { if (mode === "return") loadActiveBorrows(); }, [mode]);
  async function loadActiveBorrows() { try { setActiveBorrows(await api.getActiveBorrows()); } catch (e) { console.error(e); } }

  function parseNames() { return namesInput.split(/[,，\n\s]+/).map(s => s.trim()).filter(Boolean); }

  async function handleBatchBorrow() {
    if (!borrower.trim()) { showToast("请填写借阅人"); return; }
    const names = method === "names" ? parseNames() : null;
    if (method === "names" && names.length === 0) { showToast("请输入患者姓名"); return; }
    if (method === "date" && !dateFrom) { showToast("请选择起始日期"); return; }

    setLoading(true);
    try {
      const payload = { borrower: borrower.trim(), department: department.trim(), purpose: purpose.trim() };
      if (method === "names") payload.names = names;
      else { payload.date_from = dateFrom; if (dateTo) payload.date_to = dateTo; }
      const r = await api.batchBorrow(payload);
      setResult(r);
      showToast(`批量借出 ${r.borrowed} 份`);
      onDone();
    } catch (e) { showToast(`失败：${e.message}`); }
    setLoading(false);
  }

  async function handleBatchReturn() {
    if (selectedReturns.size === 0) { showToast("请选择要归还的病历"); return; }
    setLoading(true);
    try {
      await api.batchReturn({ record_ids: [...selectedReturns] });
      showToast(`批量归还 ${selectedReturns.size} 份`);
      setSelectedReturns(new Set());
      loadActiveBorrows();
      onDone();
    } catch (e) { showToast(`失败：${e.message}`); }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode("borrow")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${mode === "borrow" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>批量借出</button>
          <button onClick={() => setMode("return")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${mode === "return" ? "bg-green-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>批量归还</button>
        </div>

        {mode === "borrow" && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">适用场景：卫健委/医保检查抽调病历，按姓名清单或出院日期范围批量借出。</p>

            {/* 筛选方式 */}
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={method === "names"} onChange={() => setMethod("names")} className="w-4 h-4" />
                按姓名清单
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={method === "date"} onChange={() => setMethod("date")} className="w-4 h-4" />
                按出院日期范围
              </label>
            </div>

            {method === "names" && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">患者姓名（每行一个，或用逗号分隔）</label>
                <textarea value={namesInput} onChange={e => setNamesInput(e.target.value)} rows={5}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="张三&#10;李四&#10;王五" />
                <span className="text-xs text-gray-400 mt-1 block">已输入 {parseNames().length} 个姓名</span>
              </div>
            )}

            {method === "date" && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">出院日期从</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
                <div><label className="text-xs text-gray-500">出院日期到</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
              </div>
            )}

            {/* 借阅信息 */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-gray-50 rounded-lg">
              <div><label className="text-xs text-gray-500">借阅人/单位</label><input value={borrower} onChange={e => setBorrower(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="如：市卫健委" /></div>
              <div><label className="text-xs text-gray-500">科室/部门</label><input value={department} onChange={e => setDepartment(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="如：医保科" /></div>
              <div><label className="text-xs text-gray-500">用途</label><input value={purpose} onChange={e => setPurpose(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="如：年度检查" /></div>
            </div>

            <button onClick={handleBatchBorrow} disabled={loading}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? "处理中..." : "确认批量借出"}
            </button>
          </div>
        )}

        {mode === "return" && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">勾选需要归还的病历，一键批量归还。</p>
            <div className="flex gap-2 mb-2">
              <button onClick={() => setSelectedReturns(new Set(activeBorrows.map(b => b.record_id)))} className="text-xs text-blue-600 hover:underline">全选</button>
              <button onClick={() => setSelectedReturns(new Set())} className="text-xs text-gray-500 hover:underline">清除</button>
              <button onClick={loadActiveBorrows} className="text-xs text-gray-500 hover:underline flex items-center gap-1"><RefreshCw className="w-3 h-3" />刷新</button>
              <span className="text-xs text-gray-400 ml-auto">当前借出 {activeBorrows.length} 份，已选 {selectedReturns.size} 份</span>
            </div>
            <div className="max-h-[350px] overflow-y-auto space-y-1">
              {activeBorrows.map(b => (
                <div key={b.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition ${selectedReturns.has(b.record_id) ? "bg-green-50 border-green-300" : "hover:bg-gray-50"}`}
                  onClick={() => { const s = new Set(selectedReturns); s.has(b.record_id) ? s.delete(b.record_id) : s.add(b.record_id); setSelectedReturns(s); }}>
                  <input type="checkbox" checked={selectedReturns.has(b.record_id)} readOnly className="w-4 h-4 rounded" />
                  <span className="font-medium text-sm flex-1">{b.patient_name}</span>
                  <span className="text-xs text-gray-500 font-mono">{b.inpatient_no}</span>
                  <span className="text-xs text-gray-400">{b.borrower}</span>
                  <span className="text-xs text-gray-400">{b.borrowed_at?.slice(0, 10)}</span>
                </div>
              ))}
              {activeBorrows.length === 0 && <p className="text-gray-400 text-sm text-center py-6">当前无借出病历</p>}
            </div>
            {selectedReturns.size > 0 && (
              <button onClick={handleBatchReturn} disabled={loading}
                className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                {loading ? "处理中..." : `确认归还 ${selectedReturns.size} 份`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 结果展示 */}
      {result && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h3 className="font-bold text-sm mb-2 text-green-700">操作结果</h3>
          <p className="text-sm text-gray-700 mb-2">{result.message}</p>
          {result.records && result.records.length > 0 && (
            <div className="max-h-[200px] overflow-y-auto space-y-1">
              {result.records.map(r => (
                <div key={r.id} className="text-xs text-gray-600 flex gap-2 p-1.5 bg-gray-50 rounded">
                  <span className="font-medium">{r.patient_name}</span>
                  <span className="text-gray-400 font-mono">{r.inpatient_no}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Move Modal (移动病历) ───
function MoveModal({ recordIds, cabinetShapes, onClose, onDone, showToast, onPositionConflict }) {
  const [mode, setMode] = useState("code"); // code | select
  const [codeInput, setCodeInput] = useState("");
  const [cabinet, setCabinet] = useState("");
  const [locations, setLocations] = useState([]);
  const [target, setTarget] = useState("");
  const [allowOverflow, setAllowOverflow] = useState(false);

  useEffect(() => { if (cabinet) loadLocs(); }, [cabinet]);
  async function loadLocs() { try { const r = await api.getLocations(cabinet); setLocations(r.filter(l => l.id !== "__POOL__")); } catch (e) { console.error(e); } }

  // 解析编号：11101 → location_id=C01-R01-P01, start_index=1
  function parseCode(code) {
    const s = code.trim();
    const fullMatch = s.match(/^C(\d+)-R(\d+)-P(\d+)(?:[-\s#:]?(\d{1,3}))$/i);
    if (fullMatch) {
      const cabNo = Number(fullMatch[1]);
      const rowNo = Number(fullMatch[2]);
      const stackNo = Number(fullMatch[3]);
      const bookIdx = Number(fullMatch[4]);
      if (!cabNo || !rowNo || !stackNo || !bookIdx || bookIdx > MAX_OVERFLOW_BOOK_INDEX) return null;
      if (bookIdx > STANDARD_BOOKS_PER_STACK && !allowOverflow) return null;
      return { locId: `C${pad(cabNo)}-R${pad(rowNo)}-P${pad(stackNo)}`, bookIdx };
    }
    if (s.length < 4) return null;
    let cabNo, rowNo, stackNo, bookIdx;
    if (s.length === 4) { cabNo = +s[0]; rowNo = +s[1]; stackNo = +s[2]; bookIdx = +s[3]; }
    else if (s.length === 5) { cabNo = +s[0]; rowNo = +s[1]; stackNo = +s[2]; bookIdx = +s.slice(3); }
    else { return null; }
    if (!cabNo || !rowNo || !stackNo || !bookIdx) return null;
    if (bookIdx > MAX_OVERFLOW_BOOK_INDEX) return null;
    if (bookIdx > STANDARD_BOOKS_PER_STACK && !allowOverflow) return null;
    const locId = `C${pad(cabNo)}-R${pad(rowNo)}-P${pad(stackNo)}`;
    return { locId, bookIdx };
  }

  async function handleMoveByCode() {
    const parsed = parseCode(codeInput);
    if (!parsed) { showToast("编号格式错误，示例：11101 或 C01-R01-P12-01"); return; }
    try {
      const result = await api.assignFromPool({ record_ids: recordIds, location_id: parsed.locId, start_index: parsed.bookIdx, allow_overflow: allowOverflow });
      showToast(`已移动到 ${parsed.locId} 第${parsed.bookIdx}本`);
      onDone(parsed.locId, result.assigned || recordIds.map(id => ({ id, location_id: parsed.locId })));
    } catch (e) {
      if (onPositionConflict?.(e)) onDone();
      else showToast(`移动失败：${e.message}`);
    }
  }

  async function handleMoveBySelect() {
    if (!target) { showToast("请选择目标位置"); return; }
    try {
      const result = await api.assignFromPool({ record_ids: recordIds, location_id: target, allow_overflow: allowOverflow, force_overflow: allowOverflow });
      showToast(`已移动 ${recordIds.length} 份到 ${target}`);
      onDone(target, result.assigned || recordIds.map(id => ({ id, location_id: target })));
    } catch (e) {
      if (onPositionConflict?.(e)) onDone();
      else showToast(`移动失败：${e.message}`);
    }
  }

  const parsed = parseCode(codeInput);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-[440px] max-w-[90vw] shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">移动病历</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4">将 {recordIds.length} 份病历移动到新位置</p>
        <label className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${allowOverflow ? "border-orange-200 bg-orange-50 text-orange-700" : "border-gray-100 bg-gray-50 text-gray-600"}`}>
          <input type="checkbox" checked={allowOverflow} onChange={e => setAllowOverflow(e.target.checked)} className="mt-0.5 h-4 w-4 accent-orange-600" />
          <span>
            直接移动到第26本以后
            <span className="block mt-0.5">输入具体编号时按编号移动；下拉选择时勾选后会追加到超容量附加区。</span>
          </span>
        </label>

        {/* 模式切换 */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode("code")} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === "code" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"}`}>输入编号</button>
          <button onClick={() => setMode("select")} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === "select" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"}`}>下拉选择</button>
        </div>

        {mode === "code" && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">目标编号（如 11101；多位摞号用 C01-R01-P12-01）</label>
              <input value={codeInput} onChange={e => setCodeInput(e.target.value)} placeholder="输入编号，如 11101 或 C01-R01-P12-01"
                className="w-full border rounded-lg px-3 py-2.5 text-lg font-mono font-bold mt-1 tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {codeInput && parsed && (
              <div className="text-xs text-indigo-600 bg-indigo-50 p-2 rounded-lg">
                解析：{parsed.locId} · 第{parsed.bookIdx}本
              </div>
            )}
            {codeInput && !parsed && (
              <div className="text-xs text-red-500 bg-red-50 p-2 rounded-lg">
                格式错误，请输入4-5位数字，或完整编号 C01-R01-P12-01；第26本以后需先勾选超容量。
              </div>
            )}
            <button onClick={handleMoveByCode} disabled={!parsed}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 font-medium">确认移动</button>
          </div>
        )}

        {mode === "select" && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">目标书架</label>
              <select value={cabinet} onChange={e => { setCabinet(e.target.value); setTarget(""); }}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-white">
                <option value="">选择书架</option>
                {cabinetShapes.map(c => <option key={c.no} value={c.no}>{c.name}</option>)}
              </select>
            </div>
            {cabinet && (
              <div>
                <label className="text-xs text-gray-500">目标摞位</label>
                <select value={target} onChange={e => setTarget(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1 bg-white">
                  <option value="">选择摞位</option>
                  {locations.map(l => <option key={l.id} value={l.id}>第{l.row_no}排 第{l.stack_no}摞{l.year_month ? ` (${l.year_month})` : ""}</option>)}
                </select>
              </div>
            )}
            <button onClick={handleMoveBySelect} disabled={!target}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 font-medium">确认移动</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Import Page (批量导入) ───
function OcrImportPage({ showToast, onImported, onPositionConflict }) {
  const [step, setStep] = useState("upload"); // upload | mapping | review
  const [rawData, setRawData] = useState([]);
  const [colMapping, setColMapping] = useState({ name: -1, inpNo: -1, date: -1 });
  const [editableRows, setEditableRows] = useState([]);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [mode, setMode] = useState("paste"); // paste | file | ai
  const [pasteText, setPasteText] = useState("");
  const [aiImageDataUrl, setAiImageDataUrl] = useState("");
  const [aiFileName, setAiFileName] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMeta, setAiMeta] = useState(null);
  const fileRef = useRef(null);
  const aiFileRef = useRef(null);

  function selectedImportableRowIndexes(rows) {
    return rows.reduce((acc, r, i) => {
      if (r.name) acc.push(i);
      return acc;
    }, []);
  }

  function normalizeNameToken(value) {
    const name = String(value || "").replace(/[^一-鿿]/g, "");
    return name.length >= 2 && name.length <= 5 ? name : "";
  }

  function isInpatientNoToken(value) {
    return /^ZY\d+/i.test(value) || /^0{1,3}\d{7,}$/.test(value) || /^\d{8,}$/.test(value);
  }

  function isPositionCodeToken(value) {
    return /^\d{4,5}$/.test(value);
  }

  function parseLooseManualText(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const rows = [];
    const looseNumbers = [];
    const looseNames = [];
    const loosePositions = [];

    for (const line of lines) {
      const tokens = line.match(/[A-Za-z]?\d+|[一-鿿]{2,5}/g) || [];
      const names = tokens.map(normalizeNameToken).filter(Boolean);
      const inpatientNos = tokens.filter(isInpatientNoToken).map(v => v.replace(/^ZY/i, "ZY").replace(/^[A-Za-z](?=\d{5,}$)/, "0"));
      const positions = tokens.filter(v => isPositionCodeToken(v) && !isInpatientNoToken(v));

      if (names.length > 0) {
        names.forEach((name, idx) => {
          rows.push({
            name,
            inpNo: inpatientNos[idx] || inpatientNos[0] || "",
            date: "",
            positionCode: positions[idx] || positions[0] || "",
          });
        });
      } else {
        looseNumbers.push(...inpatientNos);
        loosePositions.push(...positions);
      }

      if (names.length === 0) {
        const onlyName = normalizeNameToken(line);
        if (onlyName) looseNames.push(onlyName);
      }
    }

    if (rows.length > 0) {
      let numberIndex = 0;
      let positionIndex = 0;
      return rows.map(row => ({
        ...row,
        inpNo: row.inpNo || looseNumbers[numberIndex++] || "",
        positionCode: row.positionCode || loosePositions[positionIndex++] || "",
      }));
    }

    const maxLen = Math.max(looseNumbers.length, looseNames.length, loosePositions.length);
    for (let i = 0; i < maxLen; i++) {
      const name = looseNames[i] || "";
      const inpNo = looseNumbers[i] || "";
      const positionCode = loosePositions[i] || "";
      if (name || inpNo || positionCode) rows.push({ name, inpNo, date: "", positionCode });
    }
    return rows;
  }

  function detectColumns(data) {
    const sample = data.slice(0, Math.min(5, data.length));
    let nameCol = -1, noCol = -1, dateCol = -1;
    const maxCols = Math.max(...sample.map(r => r.length));

    for (let col = 0; col < maxCols; col++) {
      const values = sample.map(r => String(r[col] ?? "").trim()).filter(Boolean);
      const numericCount = values.filter(v => /^\d{5,}$/.test(v) || /^[A-Za-z]?\d{5,}$/.test(v)).length;
      const chineseCount = values.filter(v => /[一-鿿]/.test(v)).length;
      const dateCount = values.filter(v => /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)).length;

      if (numericCount >= 2 && noCol === -1) noCol = col;
      else if (chineseCount >= 2 && nameCol === -1) nameCol = col;
      else if (dateCount >= 2 && dateCol === -1) dateCol = col;
    }
    return { name: nameCol, inpNo: noCol, date: dateCol };
  }

  function parseMappedRows(data, mapping) {
    const rows = [];
    for (const row of data) {
      const cells = row.map(c => String(c ?? "").trim().replace(/\n/g, ""));
      // 跳过表头
      if (cells.some(c => c === "住院号" || c === "姓名" || c.includes("名单"))) continue;

      // 多组并排：逐列扫描相邻的住院号+姓名，空列不会打乱位置
      let pairedCount = 0;
      for (let ci = 0; ci < cells.length - 1; ci++) {
        const candidates = [
          { noVal: cells[ci], nameVal: cells[ci + 1] },
          { noVal: cells[ci + 1], nameVal: cells[ci] },
        ];
        const matched = candidates.find(({ noVal, nameVal }) => {
          const name = nameVal.replace(/[^一-鿿]/g, "");
          return /^[A-Za-z]?\d{5,}$/.test(noVal) && name.length >= 2 && name.length <= 5;
        });
        if (matched) {
          rows.push({
            name: matched.nameVal.replace(/[^一-鿿]/g, ""),
            inpNo: matched.noVal.replace(/^[A-Za-z]/, "0"),
            date: "",
          });
          pairedCount++;
          ci++;
        }
      }
      if (pairedCount > 0) continue;

      // 单组模式
      let name = "", inpNo = "", date = "";
      if (mapping.inpNo >= 0 && cells[mapping.inpNo]) {
        const v = cells[mapping.inpNo].replace(/^[A-Za-z]/, "0");
        if (/^\d{5,}$/.test(v)) inpNo = v;
      }
      if (mapping.name >= 0 && cells[mapping.name]) {
        name = cells[mapping.name].replace(/[^一-鿿]/g, "");
        if (name.length < 2 || name.length > 5) name = "";
      }
      if (mapping.date >= 0 && cells[mapping.date]) {
        const v = cells[mapping.date];
        if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)) date = v.replace(/\//g, "-");
      }
      if (name || inpNo) rows.push({ name, inpNo, date });
    }
    return rows;
  }

  function handlePasteImport() {
    if (!pasteText.trim()) return;
    const rows = parseLooseManualText(pasteText);

    setEditableRows(rows.map((r, i) => ({ ...r, _id: i })));
    setSelectedRows(new Set(selectedImportableRowIndexes(rows)));
    if (rows.length === 0) showToast("未解析到有效数据");
    else showToast(`解析 ${rows.length} 行，${rows.filter(r => r.name && r.inpNo).length} 行含住院号，${rows.filter(r => r.name && !r.inpNo).length} 行将作为待补编号导入`);
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isExcel = /\.(xlsx?|xls)$/i.test(file.name);

    try {
      let data = [];
      if (isExcel) {
        const xlsxModule = await import("xlsx");
        const XLSX = xlsxModule.default || xlsxModule;
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
      } else {
        const text = await file.text();
        data = text.split("\n").map(l => l.split(/[,\t;]+/).map(s => s.trim()));
      }
      // 过滤空行
      data = data.filter(row => row && row.some(c => String(c ?? "").trim()));
      if (data.length === 0) { showToast("文件为空"); return; }
      const detected = detectColumns(data);
      setRawData(data);
      setColMapping(detected);
      setStep("mapping");
      showToast(`已读取 ${data.length} 行，请确认映射后解析`);
    } catch (err) {
      showToast(`文件解析失败：${err.message}`);
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
  }

  async function handleAiImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      showToast("请上传 png、jpg、jpeg 或 webp 图片");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast("图片过大，请先压缩到 8MB 以内");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAiImageDataUrl(dataUrl);
      setAiFileName(file.name);
      setAiMeta(null);
      showToast("图片已读取，可以开始AI识别");
    } catch (err) {
      showToast(`图片读取失败：${err.message}`);
    }
  }

  async function handleAiRecognize() {
    if (!aiImageDataUrl) {
      showToast("请先选择手写清单图片");
      return;
    }
    setAiLoading(true);
    try {
      const result = await api.recognizeHandwriting({ imageDataUrl: aiImageDataUrl });
      const rows = (result.rows || []).map((r, i) => ({
        name: r.name || "",
        inpNo: r.inpatient_no || "",
        date: r.discharge_date || "",
        positionCode: r.position_code || "",
        confidence: r.confidence,
        notes: r.notes || "",
        source: "ai",
        _id: i,
      }));
      setEditableRows(rows);
      setSelectedRows(new Set(selectedImportableRowIndexes(rows)));
      setStep("review");
      setAiMeta({ count: result.count || rows.length, model: result.model || "" });
      if (rows.length === 0) {
        showToast("AI未识别到可用行，请换更清晰图片或手动录入");
      } else {
        const complete = rows.filter(r => r.name && r.inpNo).length;
        showToast(`AI识别 ${rows.length} 行，${complete} 行含住院号，姓名完整的行可先导入暂存池`);
      }
    } catch (err) {
      showToast(`AI识别失败：${err.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  function autoDetectColumns(data) {
    setColMapping(detectColumns(data));
  }

  function applyMapping() {
    try {
      const rows = parseMappedRows(rawData, colMapping);
      if (rows.length === 0) {
        showToast("未解析到有效病历，请检查住院号/姓名列映射");
        return;
      }

      setEditableRows(rows.map((r, i) => ({ ...r, _id: i })));
      setSelectedRows(new Set(selectedImportableRowIndexes(rows)));
      setStep("review");
      showToast(`解析 ${rows.length} 条，${rows.filter(r => r.name && r.inpNo).length} 条含住院号，${rows.filter(r => r.name && !r.inpNo).length} 条将作为待补编号导入`);
    } catch (err) {
      showToast(`解析失败：${err.message}`);
    }
  }

  function updateRow(idx, field, value) {
    setEditableRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }
  function toggleRow(idx) {
    setSelectedRows(prev => { const s = new Set(prev); s.has(idx) ? s.delete(idx) : s.add(idx); return s; });
  }

  const hasAiDetail = editableRows.some(r => r.positionCode || r.confidence !== undefined || r.notes);

  function switchImportMode(nextMode) {
    setMode(nextMode);
    if (nextMode !== "file" || mode !== "file") setStep("upload");
  }

  async function handleImport() {
    const toImport = editableRows.filter((_, i) => selectedRows.has(i)).filter(r => r.name);
    if (toImport.length === 0) { showToast("没有可导入的有效数据（至少需要姓名）"); return; }

    // 前端去重：检查列表内是否有重复住院号
    const seen = new Set();
    const dupsInList = [];
    const unique = [];
    for (const r of toImport) {
      if (r.inpNo && seen.has(r.inpNo)) { dupsInList.push(r.inpNo); }
      else {
        if (r.inpNo) seen.add(r.inpNo);
        unique.push(r);
      }
    }
    if (dupsInList.length > 0) {
      showToast(`列表内有 ${dupsInList.length} 条重复住院号已自动跳过`);
    }

    let success = 0, fail = 0;
    const failedList = [];
    let generatedMissingNo = 0;
    for (const r of unique) {
      try {
        const created = await api.createRecord({
          patient_name: r.name,
          inpatient_no: r.inpNo || "",
          discharge_date: r.date || null,
          source_position_code: r.positionCode || "",
        });
        if (created.generated_missing_no) generatedMissingNo++;
        success++;
      } catch (e) {
        if (onPositionConflict?.(e)) {
          success++;
        } else {
          fail++;
          failedList.push(r.inpNo);
        }
      }
    }
    let msg = `导入完成：成功 ${success} 条`;
    if (generatedMissingNo > 0) msg += `，待补编号 ${generatedMissingNo} 条`;
    if (fail > 0) msg += `，跳过 ${fail} 条（系统中已存在）`;
    if (dupsInList.length > 0) msg += `，列表内重复 ${dupsInList.length} 条`;
    showToast(msg);
    onImported();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-1"><FileText className="w-5 h-5 text-blue-500" />批量导入</h2>
        <p className="text-xs text-gray-500 mb-4">粘贴文本、上传 Excel/CSV 文件，或上传手写清单图片；只录姓名也可以先导入暂存池，住院号后续补齐。</p>

        <div className="flex gap-2 mb-4">
          <button onClick={() => switchImportMode("paste")} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === "paste" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>文本粘贴</button>
          <button onClick={() => switchImportMode("file")} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === "file" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>文件导入</button>
          <button onClick={() => switchImportMode("ai")} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${mode === "ai" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>AI手写识别</button>
        </div>

        {mode === "paste" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">支持一行一个姓名，也支持“11101 张三”或“住院号 姓名”；分段粘贴住院号和姓名时仍会按顺序配对。</p>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={8}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder={"11101 余孝莲\n11102 霍善利\n\n或：\n余孝莲\n霍善利\n\n或：\n住院号\n0020224444\n0020224446\n姓名\n余孝莲\n霍善利"} />
            <button onClick={handlePasteImport} disabled={!pasteText.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium disabled:opacity-50">解析文本</button>
          </div>
        )}

        {mode === "file" && step === "upload" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">支持 .xlsx / .csv / .txt，上传后可手动指定哪列是住院号、哪列是姓名</p>
            <input ref={fileRef} type="file" accept=".csv,.txt,.xls,.xlsx" onChange={handleFileUpload}
              className="w-full border rounded-lg px-3 py-2 text-sm file:mr-3 file:px-3 file:py-1 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium" />
          </div>
        )}

        {mode === "file" && step === "mapping" && rawData.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">请确认列映射（点击下方表头选择对应字段），系统已自动猜测：</p>
            <div className="border rounded-lg overflow-hidden max-h-[200px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {rawData[0] && rawData[0].map((_, ci) => (
                      <th key={ci} className="p-2 text-center">
                        <select value={colMapping.inpNo === ci ? "inpNo" : colMapping.name === ci ? "name" : colMapping.date === ci ? "date" : ""}
                          onChange={e => { const v = e.target.value; setColMapping(prev => { const m = {...prev}; Object.keys(m).forEach(k => { if (m[k] === ci) m[k] = -1; }); if (v) m[v] = ci; return m; }); }}
                          className="text-xs border rounded px-1 py-0.5 w-full bg-white">
                          <option value="">忽略</option>
                          <option value="inpNo">住院号</option>
                          <option value="name">姓名</option>
                          <option value="date">出院日期</option>
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rawData.slice(0, 6).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className={`p-1.5 text-center truncate max-w-[100px] ${colMapping.inpNo === ci ? "bg-blue-50" : colMapping.name === ci ? "bg-green-50" : colMapping.date === ci ? "bg-yellow-50" : ""}`}>
                          {String(cell ?? "").slice(0, 15)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 text-xs text-gray-500">
              <span className="px-2 py-0.5 bg-blue-50 rounded">蓝=住院号</span>
              <span className="px-2 py-0.5 bg-green-50 rounded">绿=姓名</span>
              <span className="px-2 py-0.5 bg-yellow-50 rounded">黄=出院日期</span>
            </div>
            <div className="flex gap-2">
              <button onClick={applyMapping} disabled={colMapping.inpNo === -1 && colMapping.name === -1}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium disabled:opacity-50">确认映射并解析</button>
              <button onClick={() => { setStep("upload"); setRawData([]); }} className="px-4 py-2 border rounded-lg text-sm text-gray-600">重新选择文件</button>
            </div>
          </div>
        )}

        {mode === "ai" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">上传手写病案清单照片，AI会提取姓名、位置编号和可见住院号；识别结果必须人工核对后再导入。</p>
            <input ref={aiFileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAiImageChange}
              className="w-full border rounded-lg px-3 py-2 text-sm file:mr-3 file:px-3 file:py-1 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium" />
            {aiImageDataUrl && (
              <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3 items-start">
                <div className="border rounded-lg overflow-hidden bg-gray-50">
                  <img src={aiImageDataUrl} alt="待识别手写清单" className="w-full max-h-64 object-contain" />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium text-gray-800 truncate">{aiFileName}</div>
                  <div className="text-xs text-gray-500">建议拍平、光线均匀，尽量让每一列编号和姓名完整入镜。</div>
                  {aiMeta && <div className="text-xs text-gray-500">上次识别：{aiMeta.count} 行{aiMeta.model ? ` · ${aiMeta.model}` : ""}</div>}
                  <div className="flex gap-2">
                    <button onClick={handleAiRecognize} disabled={aiLoading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium disabled:opacity-50 flex items-center gap-2">
                      {aiLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
                      {aiLoading ? "识别中" : "开始AI识别"}
                    </button>
                    <button onClick={() => { setAiImageDataUrl(""); setAiFileName(""); setAiMeta(null); if (aiFileRef.current) aiFileRef.current.value = ""; }}
                      className="px-4 py-2 border rounded-lg text-sm text-gray-600">清除图片</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {editableRows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">解析结果（可编辑）· {editableRows.length} 条</h3>
            <div className="flex gap-2 items-center">
              <button onClick={() => setSelectedRows(new Set(editableRows.map((_, i) => i)))} className="text-xs text-blue-600 hover:underline">全选</button>
              <button onClick={() => setSelectedRows(new Set(selectedImportableRowIndexes(editableRows)))} className="text-xs text-blue-600 hover:underline">选有姓名</button>
              <button onClick={() => setSelectedRows(new Set())} className="text-xs text-gray-500 hover:underline">清除</button>
              <span className="text-xs text-gray-400">已选 {selectedRows.size}/{editableRows.length}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            <span className="px-2 py-1 bg-green-50 text-green-700 rounded">可导入 {editableRows.filter(r => r.name).length} 条</span>
            <span className="px-2 py-1 bg-fuchsia-50 text-fuchsia-700 rounded">待补住院号 {editableRows.filter(r => r.name && !r.inpNo).length} 条</span>
            <span className="px-2 py-1 bg-yellow-50 text-yellow-700 rounded">缺姓名 {editableRows.filter(r => !r.name).length} 条</span>
          </div>
          <div className="max-h-[400px] overflow-y-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
                <tr>
                  <th className="p-2 w-8"></th>
                  {hasAiDetail && <th className="p-2 text-left">位置编号</th>}
                  <th className="p-2 text-left">姓名</th>
                  <th className="p-2 text-left">住院号</th>
                  <th className="p-2 text-left">出院日期</th>
                  {hasAiDetail && <th className="p-2 text-left">可信度</th>}
                  {hasAiDetail && <th className="p-2 text-left">备注</th>}
                  <th className="p-2 w-16">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {editableRows.map((r, i) => (
                  <tr key={i} className={`${selectedRows.has(i) ? "bg-blue-50/50" : ""} ${!r.name ? "bg-yellow-50/50" : !r.inpNo ? "bg-fuchsia-50/40" : ""}`}>
                    <td className="p-2 text-center"><input type="checkbox" checked={selectedRows.has(i)} onChange={() => toggleRow(i)} className="w-4 h-4 rounded" /></td>
                    {hasAiDetail && <td className="p-2"><input value={r.positionCode || ""} onChange={e => updateRow(i, "positionCode", e.target.value)} className="w-full border rounded px-2 py-1 text-sm font-mono" placeholder="如11101" /></td>}
                    <td className="p-2"><input value={r.name} onChange={e => updateRow(i, "name", e.target.value)} className={`w-full border rounded px-2 py-1 text-sm ${!r.name ? "border-yellow-400 bg-yellow-50" : ""}`} placeholder="必填" /></td>
                    <td className="p-2"><input value={r.inpNo} onChange={e => updateRow(i, "inpNo", e.target.value)} className={`w-full border rounded px-2 py-1 text-sm font-mono ${!r.inpNo ? "border-fuchsia-300 bg-fuchsia-50" : ""}`} placeholder="可后补" /></td>
                    <td className="p-2"><input value={r.date} onChange={e => updateRow(i, "date", e.target.value)} className="w-full border rounded px-2 py-1 text-sm" placeholder="可选" /></td>
                    {hasAiDetail && <td className="p-2 text-xs text-gray-600">{r.confidence === null || r.confidence === undefined ? "-" : `${Math.round(Number(r.confidence) * 100)}%`}</td>}
                    {hasAiDetail && <td className="p-2"><input value={r.notes || ""} onChange={e => updateRow(i, "notes", e.target.value)} className="w-full border rounded px-2 py-1 text-xs" placeholder="无" /></td>}
                    <td className="p-2 text-center"><button onClick={() => { setEditableRows(prev => prev.filter((_, idx) => idx !== i)); setSelectedRows(prev => { const s = new Set(); [...prev].filter(x => x !== i).forEach(x => s.add(x > i ? x - 1 : x)); return s; }); }} className="text-xs text-red-500 hover:text-red-700">删除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center mt-4">
            <button onClick={() => setEditableRows(prev => [...prev, { name: "", inpNo: "", date: "", _id: prev.length }])}
              className="text-xs px-3 py-1.5 border rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1"><Plus className="w-3 h-3" />手动添加行</button>
            <button onClick={handleImport} disabled={selectedRows.size === 0}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium disabled:opacity-50">
              导入选中 {selectedRows.size} 条到暂存池
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { App };
