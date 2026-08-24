import { getPendingSessions, getSessionResponses, markSessionSynced, markSessionFailed } from './offline-store';
import { startRemoteSession, submitRemoteQuestionnaire } from '../services/api';
import { isOnline, onConnectivityChange } from '../services/net-status';

let isSyncing = false;
let syncListeners = [];

export function onSyncEvent(callback) {
  syncListeners.push(callback);
  return () => { syncListeners = syncListeners.filter(fn => fn !== callback); };
}

function emit(event, data) {
  syncListeners.forEach(fn => fn(event, data));
}

export async function syncAll() {
  if (isSyncing) return;
  if (!isOnline()) return;

  isSyncing = true;
  emit('sync_start');

  try {
    const pending = await getPendingSessions();

    for (const session of pending) {
      if (session.remote_session_id) {
        await markSessionSynced(session.id, session.remote_session_id);
        continue;
      }

      try {
        emit('syncing_session', { id: session.id, clinicName: session.clinic_name });

        const remoteResult = await startRemoteSession();
        if (!remoteResult.success) throw new Error('Remote session creation failed');

        const remoteSessionId = remoteResult.sessionId;

        const responses = await getSessionResponses(session.id);
        const formDataEn = {};
        for (const r of responses) {
          formDataEn[r.question_key] = r.answer;
        }

        const submitResult = await submitRemoteQuestionnaire(remoteSessionId, formDataEn);
        if (!submitResult.success) throw new Error('Remote submit failed');

        await markSessionSynced(session.id, remoteSessionId);
        emit('session_synced', { id: session.id, remoteId: remoteSessionId });

      } catch (err) {
        console.warn(`Sync failed for session ${session.id}:`, err.message);
        await markSessionFailed(session.id);
        emit('session_failed', { id: session.id, error: err.message });
      }
    }
  } finally {
    isSyncing = false;
    emit('sync_complete');
  }
}

export function startAutoSync() {
  const unsubscribe = onConnectivityChange(async (state) => {
    if (state.isConnected) {
      await syncAll();
    }
  });

  const interval = setInterval(async () => {
    if (isOnline()) await syncAll();
  }, 60000);

  return () => {
    unsubscribe();
    clearInterval(interval);
  };
}
