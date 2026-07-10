import { getDB } from '../db/connection.js';

export function auditLog(req, res, next) {
  if (req.method === 'GET') return next();

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    try {
      const db = getDB();
      const path = req.path.replace(/^\/api\//, '');
      const targetType = path.split('/')[0] || 'unknown';
      const targetId = req.params?.id || body?.id || '';
      db.prepare(`INSERT INTO audit_logs (actor, action, target_type, target_id, detail) VALUES (?,?,?,?,?)`)
        .run('操作员', req.method, targetType, String(targetId), JSON.stringify({ body: req.body, response_status: res.statusCode }));
    } catch (e) { /* ignore audit failures */ }
    return originalJson(body);
  };
  next();
}
