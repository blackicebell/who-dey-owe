import { Platform } from 'react-native';
import { emptyData } from '../data/defaults';
import { AppData } from '../types';

type NativeDatabase = {
  execSync: (source: string) => void;
  getFirstSync: <T>(source: string, params?: unknown[]) => T | null;
  runSync: (source: string, params?: unknown[]) => unknown;
};

const storageKey = 'who-dey-owe-data';
let nativeDb: NativeDatabase | null = null;

function getNativeDb(): NativeDatabase {
  if (!nativeDb) {
    const SQLite = require('expo-sqlite') as {
      openDatabaseSync: (name: string) => NativeDatabase;
    };
    nativeDb = SQLite.openDatabaseSync('who-dey-owe.db');
  }
  return nativeDb;
}

function getWebStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

export function migrateDatabase() {
  if (Platform.OS === 'web') return;
  getNativeDb().execSync(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function loadData(): AppData {
  if (Platform.OS === 'web') {
    const stored = getWebStorage()?.getItem(storageKey);
    return stored ? { ...emptyData, ...JSON.parse(stored) } : emptyData;
  }

  migrateDatabase();
  const row = getNativeDb().getFirstSync<{ value: string }>('SELECT value FROM app_state WHERE key = ?', ['data']);
  return row ? { ...emptyData, ...JSON.parse(row.value) } : emptyData;
}

export function saveData(data: AppData) {
  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(storageKey, JSON.stringify(data));
    return;
  }

  migrateDatabase();
  getNativeDb().runSync('INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, ?)', [
    'data',
    JSON.stringify(data),
    new Date().toISOString()
  ]);
}

export function clearStoredData() {
  saveData(emptyData);
}
