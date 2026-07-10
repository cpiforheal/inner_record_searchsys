const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error = new Error(err.message || `请求失败: ${res.status}`);
    Object.assign(error, err, { status: res.status });
    throw error;
  }
  return res.json();
}

async function download(path, filename) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `下载失败: ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function qs(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  getLocations: (cabinetNo) => request(`/locations${cabinetNo ? `?cabinet_no=${cabinetNo}` : ''}`),
  createLocation: (data) => request('/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id, data) => request(`/locations/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: (id) => request(`/locations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  batchCreateLocations: (data) => request('/locations/batch', { method: 'POST', body: JSON.stringify(data) }),
  extendLocationRow: (data) => request('/locations/extend-row', { method: 'POST', body: JSON.stringify(data) }),
  deleteCabinet: (no) => request(`/locations/cabinet/${no}`, { method: 'DELETE' }),
  searchRecords: (q) => request(`/records/search?q=${encodeURIComponent(q)}`),
  getRecordsByLocation: (locationId) => request(`/records?location_id=${encodeURIComponent(locationId)}`),
  createRecord: (data) => request('/records', { method: 'POST', body: JSON.stringify(data) }),
  updateRecord: (id, data) => request(`/records/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  shiftLocationRecords: (locationId, data) => request(`/records/location/${encodeURIComponent(locationId)}/shift`, { method: 'PUT', body: JSON.stringify(data) }),
  getLocationChecklist: (locationId) => request(`/inspections/location/${encodeURIComponent(locationId)}/checklist`),
  confirmLocationInspection: (locationId, data) => request(`/inspections/location/${encodeURIComponent(locationId)}/confirm`, { method: 'POST', body: JSON.stringify(data) }),
  swapLocationBooks: (locationId, data) => request(`/archive-tools/location/${encodeURIComponent(locationId)}/swap`, { method: 'POST', body: JSON.stringify(data) }),
  compactLocationBooks: (locationId, data) => request(`/archive-tools/location/${encodeURIComponent(locationId)}/compact`, { method: 'POST', body: JSON.stringify(data) }),
  rollbackLocationRange: (locationId, data) => request(`/archive-tools/location/${encodeURIComponent(locationId)}/rollback-range`, { method: 'POST', body: JSON.stringify(data) }),
  downloadReport: (type, params = {}, filename = `${type}.csv`) => download(`/reports/${type}.csv${qs(params)}`, filename),
  setMissingInfo: (id, marked) => request(`/records/${id}/missing-info`, { method: 'PUT', body: JSON.stringify({ marked }) }),
  getRecordTimeline: (id) => request(`/records/${id}/timeline`),
  explainLocationCode: (code) => request(`/records/location-code/${encodeURIComponent(code)}`),
  deleteRecord: (id) => request(`/records/${id}`, { method: 'DELETE' }),
  getPool: () => request('/records/pool'),
  getGroupedPool: () => request('/records/pool/grouped'),
  assignFromPool: (data) => request('/records/pool/assign', { method: 'PUT', body: JSON.stringify(data) }),
  reportIssue: (id, data) => request(`/records/${id}/issue`, { method: 'POST', body: JSON.stringify(data) }),
  resolveIssue: (id) => request(`/records/${id}/resolve`, { method: 'POST' }),
  borrowRecord: (data) => request('/borrows', { method: 'POST', body: JSON.stringify(data) }),
  batchBorrow: (data) => request('/borrows/batch', { method: 'POST', body: JSON.stringify(data) }),
  batchReturn: (data) => request('/borrows/batch-return', { method: 'POST', body: JSON.stringify(data) }),
  returnRecord: (id, data) => request(`/borrows/${id}/return`, { method: 'PUT', body: JSON.stringify(data) }),
  getActiveBorrows: () => request('/borrows?status=active'),
  getOverview: () => request('/stats/overview'),
  getCabinetStats: (no) => request(`/stats/cabinet/${no}`),
  getIssuesList: (limit = 20) => request(`/stats/issues?limit=${limit}`),
  getAuditLogs: (limit = 50) => request(`/stats/audit-logs?limit=${limit}`),
  recognizeHandwriting: (data) => request('/ai/handwriting', { method: 'POST', body: JSON.stringify(data) }),
  getBackups: () => request('/backups'),
  createBackup: () => request('/backups', { method: 'POST' }),
  verifyBackup: (filename) => request(`/backups/${encodeURIComponent(filename)}/verify`, { method: 'POST' }),
  downloadBackup: (filename) => download(`/backups/${encodeURIComponent(filename)}/download`, filename),
};
