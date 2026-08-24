import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { getAllSessions, getPendingCount } from '../db/offline-store';
import { syncAll, onSyncEvent } from '../db/sync-engine';
import { isOnline } from '../services/net-status';

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: '#ffc107', bg: '#fff9e6', icon: '⏳' },
  syncing: { label: 'Syncing', color: '#17a2b8', bg: '#e8f7f8', icon: '🔄' },
  synced: { label: 'Synced', color: '#28a745', bg: '#d4edda', icon: '✓' },
  failed: { label: 'Failed', color: '#dc3545', bg: '#f8d7da', icon: '✕' },
};

const SyncDashboard = () => {
  const [sessions, setSessions] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(false);

  const loadData = useCallback(async () => {
    const all = await getAllSessions();
    setSessions(all);
    const count = await getPendingCount();
    setPendingCount(count);
    setOnline(isOnline());
  }, []);

  useEffect(() => {
    loadData();
    const unsub = onSyncEvent((event) => {
      if (event === 'sync_start') setSyncing(true);
      if (event === 'sync_complete') { setSyncing(false); loadData(); }
      if (event === 'session_synced' || event === 'session_failed') loadData();
    });
    return unsub;
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleSync = async () => {
    if (!isOnline()) {
      return;
    }
    setSyncing(true);
    await syncAll();
    setSyncing(false);
    await loadData();
  };

  const renderSession = ({ item }) => {
    const config = STATUS_CONFIG[item.sync_status] || STATUS_CONFIG.pending;
    const date = new Date(item.created_at);
    const timeStr = date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    return (
      <View style={[styles.sessionCard, { borderLeftColor: config.color }]}>
        <View style={styles.sessionHeader}>
          <Text style={styles.clinicName}>{item.clinic_name || 'Unknown'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
            <Text style={[styles.statusText, { color: config.color }]}>{config.icon} {config.label}</Text>
          </View>
        </View>
        <Text style={styles.sessionTime}>{timeStr}</Text>
        {item.snehita_risk && (
          <Text style={styles.riskText}>Risk: {item.snehita_risk}%</Text>
        )}
        {item.consent_photo_path && (
          <Text style={styles.photoText}>Consent photo captured</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Sync Dashboard</Text>
        <View style={[styles.onlineDot, { backgroundColor: online ? '#28a745' : '#dc3545' }]} />
        <Text style={styles.onlineLabel}>{online ? 'Online' : 'Offline'}</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{sessions.length}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#ffc107' }]}>{pendingCount}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#28a745' }]}>{sessions.filter(s => s.sync_status === 'synced').length}</Text>
          <Text style={styles.statLabel}>Synced</Text>
        </View>
      </View>

      {pendingCount > 0 && (
        <TouchableOpacity
          style={[styles.syncButton, !online && styles.syncButtonDisabled]}
          onPress={handleSync}
          disabled={!online || syncing}
        >
          <Text style={styles.syncButtonText}>
            {syncing ? 'Syncing...' : online ? `Sync ${pendingCount} pending` : 'No internet — sync later'}
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderSession}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#14868C" />}
        ListEmptyComponent={<Text style={styles.emptyText}>No sessions yet. Start a new questionnaire.</Text>}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5FFFF', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#14868C', flex: 1 },
  onlineDot: { width: 10, height: 10, borderRadius: 5 },
  onlineLabel: { fontSize: 13, color: '#666' },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', elevation: 2 },
  statNumber: { fontSize: 28, fontWeight: '800', color: '#14868C' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  syncButton: { backgroundColor: '#14868C', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 16 },
  syncButtonDisabled: { backgroundColor: '#aaa' },
  syncButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sessionCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, borderLeftWidth: 4, elevation: 1 },
  sessionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  clinicName: { fontSize: 15, fontWeight: '600', color: '#333', flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '600' },
  sessionTime: { fontSize: 13, color: '#888' },
  riskText: { fontSize: 13, color: '#14868C', fontWeight: '500', marginTop: 4 },
  photoText: { fontSize: 12, color: '#28a745', marginTop: 2 },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 60, fontSize: 15 },
});

export default SyncDashboard;
