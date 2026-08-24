import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';
import Toast from 'react-native-toast-message';

import LoginScreen from './src/screens/LoginScreen';
import PatientFlow from './src/screens/PatientFlow';
import SyncDashboard from './src/screens/SyncDashboard';

import { initNetworkListener } from './src/services/net-status';
import { startAutoSync, onSyncEvent } from './src/db/sync-engine';
import { getPendingCount } from './src/db/offline-store';

const Stack = createNativeStackNavigator();

function App() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const unsubNet = initNetworkListener();
    const unsubSync = startAutoSync();

    const unsubEvent = onSyncEvent(async (event) => {
      if (event === 'sync_complete' || event === 'session_synced') {
        const count = await getPendingCount();
        setPendingCount(count);
      }
      if (event === 'session_synced') {
        Toast.show({ type: 'success', text1: 'Session synced', text2: 'Data uploaded to cloud', visibilityTime: 2000 });
      }
      if (event === 'session_failed') {
        Toast.show({ type: 'error', text1: 'Sync failed', text2: 'Will retry when online', visibilityTime: 3000 });
      }
    });

    getPendingCount().then(setPendingCount);

    return () => {
      unsubNet();
      unsubSync();
      unsubEvent();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Login"
          screenOptions={{
            headerStyle: { backgroundColor: '#14868C' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '600' },
          }}
        >
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PatientFlow"
            component={PatientFlow}
            options={{ title: 'Patient Questionnaire' }}
          />
          <Stack.Screen
            name="SyncDashboard"
            component={SyncDashboard}
            options={{
              title: 'Sync',
              headerRight: () => (
                pendingCount > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{pendingCount}</Text>
                  </View>
                ) : null
              ),
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <Toast />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: '#ffc107',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginRight: 8,
  },
  badgeText: {
    color: '#111',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default App;
