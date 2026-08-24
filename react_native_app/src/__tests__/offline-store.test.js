/**
 * Tests for offline SQLite store operations.
 * These test the data layer logic in isolation.
 * In a real test environment, you'd mock react-native-sqlite-storage.
 */

// Mock SQLite for Node.js testing
jest.mock('react-native-sqlite-storage', () => {
  const rows = [];
  const mockDB = {
    executeSql: jest.fn((sql, params) => {
      if (sql.includes('INSERT')) {
        rows.push({ sql, params });
        return Promise.resolve([{ rows: { raw: () => [], item: () => ({}) } }]);
      }
      if (sql.includes('SELECT') && sql.includes('COUNT')) {
        return Promise.resolve([{ rows: { raw: () => [{ count: rows.length }], item: (i) => ({ count: rows.length }) } }]);
      }
      return Promise.resolve([{ rows: { raw: () => rows, item: (i) => rows[i] } }]);
    }),
    close: jest.fn(),
  };
  return {
    enablePromise: jest.fn(),
    openDatabase: jest.fn(() => Promise.resolve(mockDB)),
    __mockDB: mockDB,
    __mockRows: rows,
  };
});

jest.mock('react-native-uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

describe('offline-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const SQLite = require('react-native-sqlite-storage');
    SQLite.__mockRows.length = 0;
  });

  test('createSession generates UUID and inserts row', async () => {
    const { createSession } = require('../db/offline-store');
    const id = await createSession('clinic-1', 'Test Hospital');
    expect(id).toBe('test-uuid-1234');
  });

  test('saveResponses inserts one row per question', async () => {
    const SQLite = require('react-native-sqlite-storage');
    const { saveResponses } = require('../db/offline-store');
    await saveResponses('session-1', { Q1: '40', Q10: '13', Q14: 'Yes' });
    const insertCalls = SQLite.__mockDB.executeSql.mock.calls.filter(c => c[0].includes('offline_responses'));
    expect(insertCalls.length).toBe(3);
  });

  test('updateSessionRisk updates the session', async () => {
    const SQLite = require('react-native-sqlite-storage');
    const { updateSessionRisk } = require('../db/offline-store');
    await updateSessionRisk('session-1', '42.5');
    const updateCalls = SQLite.__mockDB.executeSql.mock.calls.filter(c => c[0].includes('UPDATE'));
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  test('updateConsentPhoto sets the photo path', async () => {
    const SQLite = require('react-native-sqlite-storage');
    const { updateConsentPhoto } = require('../db/offline-store');
    await updateConsentPhoto('session-1', '/path/to/photo.jpg');
    const updateCalls = SQLite.__mockDB.executeSql.mock.calls.filter(c => c[0].includes('consent_photo_path'));
    expect(updateCalls.length).toBe(1);
  });
});
