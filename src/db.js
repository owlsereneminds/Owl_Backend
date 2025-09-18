import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        require: true,              // 👈 force SSL
        rejectUnauthorized: false,  // needed if using AWS RDS
      },
      max: 10,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });
    pool.on('error', (err) => {
      console.error('Postgres pool error', err);
    });
  }
  return pool;
}

// convenience query
export async function query(text, params = []) {
  const p = getPool();
  const res = await p.query(text, params);
  return res;
}
