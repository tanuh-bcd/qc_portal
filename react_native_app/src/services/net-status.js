import NetInfo from '@react-native-community/netinfo';

let listeners = [];
let currentState = { isConnected: false };

export function initNetworkListener() {
  return NetInfo.addEventListener(state => {
    currentState = { isConnected: state.isConnected && state.isInternetReachable };
    listeners.forEach(fn => fn(currentState));
  });
}

export function isOnline() {
  return currentState.isConnected;
}

export function onConnectivityChange(callback) {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter(fn => fn !== callback);
  };
}

export async function checkConnectivity() {
  const state = await NetInfo.fetch();
  currentState = { isConnected: state.isConnected && state.isInternetReachable };
  return currentState.isConnected;
}
