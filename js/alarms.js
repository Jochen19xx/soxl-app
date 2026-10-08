// Preisalarme: Push-Abo beim eigenen Server anmelden und Alarme verwalten.
import { SERVER_URL, loadState, saveState } from './config.js';

function deviceId() {
  const state = loadState();
  if (!state.deviceId) { state.deviceId = crypto.randomUUID(); saveState(state); }
  return state.deviceId;
}

const b64ToBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function call(path, method = 'GET', body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

// 'ok' | 'ios-install' (iPhone, nicht als App installiert) | 'unsupported' | 'no-server'
export function pushSupport() {
  if (!SERVER_URL) return 'no-server';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !standalone) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

export const permission = () => ('Notification' in window ? Notification.permission : 'denied');

// Fragt nach Erlaubnis (nur auf Knopfdruck aufrufen) und meldet das Gerät beim Server an.
export async function enablePush({ ask = true } = {}) {
  if (ask && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.');
  }
  if (Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await call('/push/key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  }
  await call('/push/device', 'POST', { id: deviceId(), subscription: { endpoint: sub.endpoint } });
  return true;
}

export const listAlarms = async () => (await call(`/push/alarms?id=${deviceId()}`)).alarms;
export const addAlarm = (alarm) => call('/push/alarms', 'POST', { id: deviceId(), alarm });
export const deleteAlarm = (alarmId) => call(`/push/alarms?id=${deviceId()}&alarmId=${encodeURIComponent(alarmId)}`, 'DELETE');
export const sendTest = () => call('/push/test', 'POST', { id: deviceId() });
export const getPrefs = async () => (await call(`/push/prefs?id=${deviceId()}`)).prefs;
export const setPrefs = (prefs) => call('/push/prefs', 'POST', { id: deviceId(), prefs });
