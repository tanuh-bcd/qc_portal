import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db = null;

export async function getDB() {
  if (db) return db;
  db = await SQLite.openDatabase({ name: 'tanuh_bcd.db', location: 'default' });
  await initTables(db);
  return db;
}

async function initTables(database) {
  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS offline_sessions (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      clinic_name TEXT,
      session_start_time TEXT NOT NULL,
      session_end_time TEXT,
      snehita_risk TEXT,
      consent_photo_path TEXT,
      sync_status TEXT DEFAULT 'pending',
      remote_session_id TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS offline_responses (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      question_key TEXT NOT NULL,
      question_text TEXT,
      answer TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES offline_sessions(id)
    )
  `);

  await database.executeSql(`
    CREATE TABLE IF NOT EXISTS cached_hospitals (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      cached_at TEXT NOT NULL
    )
  `);
}

export async function closeDB() {
  if (db) {
    await db.close();
    db = null;
  }
}
