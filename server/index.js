import express from 'express';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { initDB } from './db/connection.js';
import { setupBackup } from './services/backup.js';
import { auditLog } from './middleware/auditLog.js';
import locationsRouter from './routes/locations.js';
import recordsRouter from './routes/records.js';
import borrowsRouter from './routes/borrows.js';
import statsRouter from './routes/stats.js';
import inspectionsRouter from './routes/inspections.js';
import archiveToolsRouter from './routes/archiveTools.js';
import reportsRouter from './routes/reports.js';
import aiRouter from './routes/ai.js';
import backupsRouter from './routes/backups.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

const PORT = process.env.PORT || 3001;

initDB();

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use('/api', auditLog);

app.use('/api/locations', locationsRouter);
app.use('/api/records', recordsRouter);
app.use('/api/borrows', borrowsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/inspections', inspectionsRouter);
app.use('/api/archive-tools', archiveToolsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/backups', backupsRouter);

if (process.env.NODE_ENV === 'production') {
  const distPath = resolve(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('/{*path}', (req, res) => res.sendFile(resolve(distPath, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || '服务器错误' });
});

setupBackup();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] http://0.0.0.0:${PORT}`);
});
