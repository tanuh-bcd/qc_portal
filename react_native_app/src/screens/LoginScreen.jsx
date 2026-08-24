import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { fetchHospitals } from '../services/api';
import { cacheHospitals, getCachedHospitals } from '../db/offline-store';
import { checkConnectivity } from '../services/net-status';

const LoginScreen = ({ navigation }) => {
  const [hospitals, setHospitals] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    loadHospitals();
  }, []);

  const loadHospitals = async () => {
    setLoading(true);
    const online = await checkConnectivity();

    if (online) {
      try {
        const data = await fetchHospitals();
        setHospitals(data);
        await cacheHospitals(data);
        setOffline(false);
      } catch {
        const cached = await getCachedHospitals();
        setHospitals(cached);
        setOffline(cached.length > 0);
      }
    } else {
      const cached = await getCachedHospitals();
      setHospitals(cached);
      setOffline(true);
    }
    setLoading(false);
  };

  const handleSelect = (hospital) => {
    setSelected(hospital);
    navigation.navigate('PatientFlow', {
      clinicId: String(hospital.id),
      clinicName: hospital.name,
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={require('../assets/tanuh.png')} style={styles.logo} resizeMode="contain" />
        <Image source={require('../assets/IISc_logo.png')} style={styles.logo} resizeMode="contain" />
      </View>

      <Text style={styles.title}>PinkShieldAI</Text>
      <Text style={styles.subtitle}>Breast Cancer Risk Prediction Tool</Text>

      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>Offline mode — using cached data</Text>
        </View>
      )}

      <Text style={styles.selectLabel}>Select your clinic:</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#14868C" style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.list}>
          {hospitals.map((h) => (
            <TouchableOpacity
              key={h.id}
              style={[styles.hospitalCard, selected?.id === h.id && styles.hospitalCardActive]}
              onPress={() => handleSelect(h)}
            >
              <Text style={[styles.hospitalName, selected?.id === h.id && styles.hospitalNameActive]}>
                {h.name}
              </Text>
            </TouchableOpacity>
          ))}
          {hospitals.length === 0 && (
            <Text style={styles.emptyText}>No clinics available. Connect to the internet to load.</Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5FFFF', padding: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  logo: { width: 80, height: 60 },
  title: { fontSize: 28, fontWeight: '800', color: '#e91e8c', textAlign: 'center', letterSpacing: 1 },
  subtitle: { fontSize: 16, color: '#14868C', textAlign: 'center', marginBottom: 24, fontWeight: '600' },
  offlineBanner: { backgroundColor: '#fef3cd', padding: 10, borderRadius: 8, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#ffc107' },
  offlineText: { color: '#856404', fontSize: 13, fontWeight: '500' },
  selectLabel: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  list: { gap: 10 },
  hospitalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 18, borderWidth: 2, borderColor: '#e8f4f5', elevation: 2 },
  hospitalCardActive: { borderColor: '#14868C', backgroundColor: '#f0fafb' },
  hospitalName: { fontSize: 16, color: '#333', fontWeight: '500' },
  hospitalNameActive: { color: '#14868C', fontWeight: '700' },
  emptyText: { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 14 },
});

export default LoginScreen;
