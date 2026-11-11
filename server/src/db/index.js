// 資料庫連線：
// - 有設定 DATABASE_URL → 連 Supabase（PostgreSQL）
// - 沒有設定 → 用 PGlite（跑在本機的 PostgreSQL），資料存在 server/.data/
// 兩者都是 PostgreSQL，所以 SQL 寫法完全一樣。
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// PGLITE_DIR 可以指定別的資料夾（例如測試用），不影響平常的資料
const DATA_DIR = process.env.PGLITE_DIR || fileURLToPath(new URL('../../.data/pglite', import.meta.url));

let driver;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    return {
      kind: 'supabase',
      query: async (text, params) => (await pool.query(text, params)).rows,
      exec: async (sql) => { await pool.query(sql); },
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: async (t, p) => (await client.query(t, p)).rows });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  mkdirSync(DATA_DIR, { recursive: true });
  const db = await PGlite.create(DATA_DIR);
  return {
    kind: 'local',
    query: async (text, params) => (await db.query(text, params)).rows,
    exec: async (sql) => { await db.exec(sql); },
    transaction: (fn) => db.transaction((tx) => fn({ query: async (t, p) => (await tx.query(t, p)).rows })),
    close: () => db.close(),
  };
}

export async function getDb() {
  driver ??= await connect();
  return driver;
}

export async function query(text, params) {
  return (await getDb()).query(text, params);
}

export async function transaction(fn) {
  return (await getDb()).transaction(fn);
}
