/**
 * Tests for the sync engine — verifies sync behavior, idempotency, and error handling.
 */

jest.mock('../db/offline-store', () => ({
  getPendingSessions: jest.fn(),
  getSessionResponses: jest.fn(),
  markSessionSynced: jest.fn(),
  markSessionFailed: jest.fn(),
}));

jest.mock('../services/api', () => ({
  startRemoteSession: jest.fn(),
  submitRemoteQuestionnaire: jest.fn(),
}));

jest.mock('../services/net-status', () => ({
  isOnline: jest.fn(() => true),
  onConnectivityChange: jest.fn(() => () => {}),
}));

const store = require('../db/offline-store');
const api = require('../services/api');
const net = require('../services/net-status');

describe('syncAll', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('syncs pending sessions to remote', async () => {
    const { syncAll } = require('../db/sync-engine');

    store.getPendingSessions.mockResolvedValue([
      { id: 'local-1', clinic_name: 'Test', remote_session_id: null }
    ]);
    store.getSessionResponses.mockResolvedValue([
      { question_key: 'Q1', answer: '40' },
      { question_key: 'Q10', answer: '13' },
    ]);
    api.startRemoteSession.mockResolvedValue({ success: true, sessionId: 'remote-1' });
    api.submitRemoteQuestionnaire.mockResolvedValue({ success: true });

    await syncAll();

    expect(api.startRemoteSession).toHaveBeenCalledTimes(1);
    expect(api.submitRemoteQuestionnaire).toHaveBeenCalledWith('remote-1', { Q1: '40', Q10: '13' });
    expect(store.markSessionSynced).toHaveBeenCalledWith('local-1', 'remote-1');
  });

  test('skips already-synced sessions', async () => {
    const { syncAll } = require('../db/sync-engine');

    store.getPendingSessions.mockResolvedValue([
      { id: 'local-1', clinic_name: 'Test', remote_session_id: 'already-synced' }
    ]);

    await syncAll();

    expect(api.startRemoteSession).not.toHaveBeenCalled();
    expect(store.markSessionSynced).toHaveBeenCalledWith('local-1', 'already-synced');
  });

  test('marks session failed on API error', async () => {
    const { syncAll } = require('../db/sync-engine');

    store.getPendingSessions.mockResolvedValue([
      { id: 'local-1', clinic_name: 'Test', remote_session_id: null }
    ]);
    api.startRemoteSession.mockRejectedValue(new Error('Network error'));

    await syncAll();

    expect(store.markSessionFailed).toHaveBeenCalledWith('local-1');
  });

  test('does nothing when offline', async () => {
    net.isOnline.mockReturnValue(false);
    const { syncAll } = require('../db/sync-engine');

    store.getPendingSessions.mockResolvedValue([
      { id: 'local-1', clinic_name: 'Test', remote_session_id: null }
    ]);

    await syncAll();

    expect(api.startRemoteSession).not.toHaveBeenCalled();
    net.isOnline.mockReturnValue(true); // reset
  });

  test('handles empty pending list', async () => {
    const { syncAll } = require('../db/sync-engine');
    store.getPendingSessions.mockResolvedValue([]);

    await syncAll();

    expect(api.startRemoteSession).not.toHaveBeenCalled();
    expect(store.markSessionSynced).not.toHaveBeenCalled();
  });

  test('syncs multiple sessions sequentially', async () => {
    const { syncAll } = require('../db/sync-engine');

    store.getPendingSessions.mockResolvedValue([
      { id: 'local-1', clinic_name: 'Test', remote_session_id: null },
      { id: 'local-2', clinic_name: 'Test', remote_session_id: null },
    ]);
    store.getSessionResponses.mockResolvedValue([{ question_key: 'Q1', answer: '30' }]);
    api.startRemoteSession
      .mockResolvedValueOnce({ success: true, sessionId: 'remote-1' })
      .mockResolvedValueOnce({ success: true, sessionId: 'remote-2' });
    api.submitRemoteQuestionnaire.mockResolvedValue({ success: true });

    await syncAll();

    expect(store.markSessionSynced).toHaveBeenCalledTimes(2);
    expect(store.markSessionSynced).toHaveBeenCalledWith('local-1', 'remote-1');
    expect(store.markSessionSynced).toHaveBeenCalledWith('local-2', 'remote-2');
  });
});
