import 'dotenv/config';
import { getPool } from '../src/db.js';

async function check() {
  const pool = getPool();
  try {
    const res = await pool.query('SELECT * FROM users LIMIT 10');
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

check();
