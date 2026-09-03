const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (!connectionString) {
      throw new Error('POSTGRES_URL environment variable is not set');
    }
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

// Minimal stand-in for the @vercel/postgres `sql` tagged template, backed by
// plain `pg` so this works with any provider's connection string (pooled or
// direct), not just Neon-style pooled ones.
async function sql(strings, ...values) {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}` + strings[i + 1];
  }
  const result = await getPool().query(text, values);
  return { rows: result.rows };
}

let schemaReady;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          is_admin BOOLEAN NOT NULL DEFAULT false,
          permissions TEXT[] NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login_at TIMESTAMPTZ
        )
      `;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`;
      await sql`
        CREATE TABLE IF NOT EXISTS files (
          id SERIAL PRIMARY KEY,
          filename TEXT NOT NULL,
          blob_url TEXT NOT NULL,
          size BIGINT NOT NULL,
          uploaded_by TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS notes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS wordle_words (
          date TEXT PRIMARY KEY,
          word TEXT NOT NULL,
          fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS life_sim (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          age INTEGER NOT NULL DEFAULT 0,
          stats TEXT NOT NULL,
          history TEXT NOT NULL DEFAULT '[]',
          pending_choices TEXT,
          alive BOOLEAN NOT NULL DEFAULT true,
          relationships TEXT NOT NULL DEFAULT '[]',
          career TEXT NOT NULL DEFAULT 'null',
          education TEXT NOT NULL DEFAULT '{"highSchoolGraduated":false,"collegeStatus":"none","collegeYearsRemaining":0,"major":null}',
          assets TEXT NOT NULL DEFAULT '[]',
          achievements TEXT NOT NULL DEFAULT '[]',
          cooldowns TEXT NOT NULL DEFAULT '{}',
          cause_of_death TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Additive migration for deployments created before these columns existed.
      await sql`ALTER TABLE life_sim ADD COLUMN IF NOT EXISTS relationships TEXT NOT NULL DEFAULT '[]'`;
      await sql`ALTER TABLE life_sim ADD COLUMN IF NOT EXISTS career TEXT NOT NULL DEFAULT 'null'`;
      await sql`ALTER TABLE life_sim ADD COLUMN IF NOT EXISTS education TEXT NOT NULL DEFAULT '{"highSchoolGraduated":false,"collegeStatus":"none","collegeYearsRemaining":0,"major":null}'`;
      await sql`ALTER TABLE life_sim ADD COLUMN IF NOT EXISTS assets TEXT NOT NULL DEFAULT '[]'`;
      await sql`ALTER TABLE life_sim ADD COLUMN IF NOT EXISTS achievements TEXT NOT NULL DEFAULT '[]'`;
      await sql`ALTER TABLE life_sim ADD COLUMN IF NOT EXISTS cooldowns TEXT NOT NULL DEFAULT '{}'`;
      await sql`ALTER TABLE life_sim ADD COLUMN IF NOT EXISTS cause_of_death TEXT`;
      await sql`
        CREATE TABLE IF NOT EXISTS connect4_games (
          id SERIAL PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          player1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          player2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          board INTEGER[] NOT NULL,
          turn INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'waiting',
          winner INTEGER,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS roulette_balances (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          balance INTEGER NOT NULL DEFAULT 1000,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS blackjack_games (
          id SERIAL PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          player1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          player2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'waiting',
          deck TEXT NOT NULL DEFAULT '[]',
          player1_hand TEXT NOT NULL DEFAULT '[]',
          player2_hand TEXT NOT NULL DEFAULT '[]',
          dealer_hand TEXT NOT NULL DEFAULT '[]',
          dealer_hidden BOOLEAN NOT NULL DEFAULT true,
          player1_bet INTEGER,
          player2_bet INTEGER,
          player1_status TEXT,
          player2_status TEXT,
          turn TEXT,
          last_result TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })();
  }
  return schemaReady;
}

module.exports = { sql, ensureSchema };
