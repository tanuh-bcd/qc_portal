import { getDB } from './schema';
import uuid from 'react-native-uuid';

export async function createSession(clinicId, clinicName) {
  const db = await getDB();
  const id = uuid.v4();
  const now = new Date().toISOString();
  await db.executeSql(
    `INSERT INTO offline_sessions (id, clinic_id, clinic_name, session_start_time, created_at, sync_status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [id, clinicId, clinicName, now, now]
  );
  return id;
}

export async function saveResponses(sessionId, formDataEn) {
  const db = await getDB();
  const now = new Date().toISOString();
  const entries = Object.entries(formDataEn);

  for (const [key, value] of entries) {
    const id = uuid.v4();
    const answer = Array.isArray(value) ? value.join(', ') : String(value);
    await db.executeSql(
      `INSERT INTO offline_responses (id, session_id, question_key, answer, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, sessionId, key, answer, now]
    );
  }
}

export async function updateSessionRisk(sessionId, risk) {
  const db = await getDB();
  const now = new Date().toISOString();
  await db.executeSql(
    `UPDATE offline_sessions SET snehita_risk = ?, session_end_time = ? WHERE id = ?`,
    [risk, now, sessionId]
  );
}

export async function updateConsentPhoto(sessionId, photoPath) {
  const db = await getDB();
  await db.executeSql(
    `UPDATE offline_sessions SET consent_photo_path = ? WHERE id = ?`,
    [photoPath, sessionId]
  );
}

export async function getPendingSessions() {
  const db = await getDB();
  const [results] = await db.executeSql(
    `SELECT * FROM offline_sessions WHERE sync_status = 'pending' ORDER BY created_at ASC`
  );
  return results.rows.raw();
}

export async function getSessionResponses(sessionId) {
  const db = await getDB();
  const [results] = await db.executeSql(
    `SELECT * FROM offline_responses WHERE session_id = ? ORDER BY created_at ASC`,
    [sessionId]
  );
  return results.rows.raw();
}

export async function markSessionSynced(sessionId, remoteId) {
  const db = await getDB();
  await db.executeSql(
    `UPDATE offline_sessions SET sync_status = 'synced', remote_session_id = ? WHERE id = ?`,
    [remoteId, sessionId]
  );
}

export async function markSessionFailed(sessionId) {
  const db = await getDB();
  await db.executeSql(
    `UPDATE offline_sessions SET sync_status = 'failed' WHERE id = ?`,
    [sessionId]
  );
}

export async function getAllSessions() {
  const db = await getDB();
  const [results] = await db.executeSql(
    `SELECT * FROM offline_sessions ORDER BY created_at DESC`
  );
  return results.rows.raw();
}

export async function getPendingCount() {
  const db = await getDB();
  const [results] = await db.executeSql(
    `SELECT COUNT(*) as count FROM offline_sessions WHERE sync_status = 'pending'`
  );
  return results.rows.item(0).count;
}

export async function cacheHospitals(hospitals) {
  const db = await getDB();
  const now = new Date().toISOString();
  await db.executeSql(`DELETE FROM cached_hospitals`);
  for (const h of hospitals) {
    await db.executeSql(
      `INSERT INTO cached_hospitals (id, name, cached_at) VALUES (?, ?, ?)`,
      [h.id, h.name, now]
    );
  }
}

export async function getCachedHospitals() {
  const db = await getDB();
  const [results] = await db.executeSql(
    `SELECT * FROM cached_hospitals ORDER BY name ASC`
  );
  return results.rows.raw();
}
