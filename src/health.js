import express from 'express';
import { getPool } from './db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const client = await getPool().connect();
    await client.query('SELECT 1');
    client.release();
    return res.json({ status: 'healthy', message: 'DB ok' });
  } catch (err) {
    console.error('health error', err);
    return res.status(500).json({ status: 'unhealthy', error: err.message || String(err) });
  }
});

export default router;
