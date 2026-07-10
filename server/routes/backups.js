import { Router } from 'express';
import { getBackupPath, getBackupStatus, listBackups, runBackup, verifyBackup } from '../services/backup.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    status: getBackupStatus(),
    backups: listBackups(),
  });
});

router.post('/', async (req, res) => {
  const backup = await runBackup({ reason: 'manual' });
  res.status(201).json({
    message: '备份已完成',
    backup,
    status: getBackupStatus(),
  });
});

router.post('/:filename/verify', (req, res) => {
  res.json(verifyBackup(req.params.filename));
});

router.get('/:filename/download', (req, res) => {
  const fullPath = getBackupPath(req.params.filename);
  res.download(fullPath, req.params.filename);
});

export default router;
