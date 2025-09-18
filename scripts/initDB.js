// db-init.js
import 'dotenv/config';
import { getPool } from '../src/db.js';

async function init() {
  const pool = getPool();

  await pool.query(`
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
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meetings (
      id SERIAL PRIMARY KEY,
      meeting_code TEXT,
      meeting_title TEXT,
      meet_url TEXT,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      timestamp TIMESTAMP DEFAULT NOW(),
      duration_ms BIGINT,
      raw_json JSONB
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS participants (
      id SERIAL PRIMARY KEY,
      meeting_id INT REFERENCES meetings(id) ON DELETE CASCADE,
      name TEXT,
      join_time TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS engagement_signals (
      id SERIAL PRIMARY KEY,
      meeting_id INT REFERENCES meetings(id) ON DELETE CASCADE,
      participant_name TEXT,
      video_on BOOLEAN
    );
  `);

  console.log("✅ Tables ensured");
  pool.end();
}

init().catch(err => { console.error(err); process.exit(1); });
