import 'dotenv/config';
import { getPool } from '../src/db.js';

async function init() {
  const pool = getPool();
  const query = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      image TEXT,
      given_name TEXT,
      family_name TEXT,
      locale TEXT,
      email_verified BOOLEAN,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;
  await pool.query(query);
  console.log('Users table ensured');
  pool.end();
}

init().catch(err => { console.error(err); process.exit(1); });
