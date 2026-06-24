import { Platform } from 'react-native';
import { emptyData } from '../data/defaults';
import { AppData, AppSettings, Customer, Debt, Payment } from '../types';

type NativeDatabase = {
  execSync: (source: string) => void;
  getFirstSync: <T>(source: string, params?: unknown[]) => T | null;
  getAllSync: <T>(source: string, params?: unknown[]) => T[];
  runSync: (source: string, params?: unknown[]) => unknown;
};

const storageKey = 'who-dey-owe-data';
const schemaVersion = 2;
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

function withDefaultSettings(settings: Partial<AppSettings> | null | undefined): AppSettings {
  return { ...emptyData.settings, ...(settings ?? {}) };
}

function normalizeData(data: Partial<AppData> | null | undefined): AppData {
  return {
    settings: withDefaultSettings(data?.settings),
    customers: data?.customers ?? [],
    debts: data?.debts ?? [],
    payments: data?.payments ?? []
  };
}

export function migrateDatabase() {
  if (Platform.OS === 'web') return;
  const db = getNativeDb();
  db.execSync(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY NOT NULL,
      customer_id TEXT NOT NULL,
      description TEXT NOT NULL,
      original_amount REAL NOT NULL,
      amount_paid REAL NOT NULL,
      balance REAL NOT NULL,
      due_date TEXT,
      note TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY NOT NULL,
      customer_id TEXT NOT NULL,
      debt_id TEXT,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_debts_customer_id ON debts(customer_id);
    CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
    CREATE INDEX IF NOT EXISTS idx_payments_debt_id ON payments(debt_id);
  `);

  const currentVersion = Number(db.getFirstSync<{ value: string }>('SELECT value FROM metadata WHERE key = ?', ['schemaVersion'])?.value ?? '0');
  if (currentVersion < 2) {
    const legacy = db.getFirstSync<{ value: string }>('SELECT value FROM app_state WHERE key = ?', ['data']);
    if (legacy?.value) {
      try {
        saveNativeData(normalizeData(JSON.parse(legacy.value) as AppData));
      } catch {
        saveNativeData(emptyData);
      }
    } else {
      saveNativeData(loadNativeData());
    }
    db.runSync('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['schemaVersion', String(schemaVersion)]);
  }
}

function loadNativeData(): AppData {
  const db = getNativeDb();
  const settingRows = db.getAllSync<{ key: keyof AppSettings; value: string }>('SELECT key, value FROM app_settings');
  const settings = withDefaultSettings(settingRows.reduce<Partial<AppSettings>>((acc, row) => {
    const fallback = emptyData.settings[row.key];
    acc[row.key] = (typeof fallback === 'boolean' ? row.value === 'true' : row.value) as never;
    return acc;
  }, {}));

  const customers = db.getAllSync<{
    id: string; name: string; phone: string; notes: string; created_at: string; updated_at: string;
  }>('SELECT * FROM customers ORDER BY updated_at DESC').map<Customer>((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const debts = db.getAllSync<{
    id: string; customer_id: string; description: string; original_amount: number; amount_paid: number;
    balance: number; due_date: string | null; note: string; status: Debt['status']; created_at: string; updated_at: string;
  }>('SELECT * FROM debts ORDER BY updated_at DESC').map<Debt>((row) => ({
    id: row.id,
    customerId: row.customer_id,
    description: row.description,
    originalAmount: row.original_amount,
    amountPaid: row.amount_paid,
    balance: row.balance,
    dueDate: row.due_date,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  const payments = db.getAllSync<{
    id: string; customer_id: string; debt_id: string | null; amount: number; payment_date: string; note: string; created_at: string;
  }>('SELECT * FROM payments ORDER BY created_at DESC').map<Payment>((row) => ({
    id: row.id,
    customerId: row.customer_id,
    debtId: row.debt_id,
    amount: row.amount,
    paymentDate: row.payment_date,
    note: row.note,
    createdAt: row.created_at
  }));

  return { settings, customers, debts, payments };
}

function saveNativeData(data: AppData) {
  const db = getNativeDb();
  const normalized = normalizeData(data);
  db.execSync('BEGIN TRANSACTION');
  try {
    db.runSync('DELETE FROM app_settings');
    db.runSync('DELETE FROM customers');
    db.runSync('DELETE FROM debts');
    db.runSync('DELETE FROM payments');

    Object.entries(normalized.settings).forEach(([key, value]) => {
      db.runSync('INSERT INTO app_settings (key, value) VALUES (?, ?)', [key, String(value)]);
    });

    normalized.customers.forEach((customer) => {
      db.runSync(
        'INSERT INTO customers (id, name, phone, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [customer.id, customer.name, customer.phone, customer.notes, customer.createdAt, customer.updatedAt]
      );
    });

    normalized.debts.forEach((debt) => {
      db.runSync(
        `INSERT INTO debts
          (id, customer_id, description, original_amount, amount_paid, balance, due_date, note, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [debt.id, debt.customerId, debt.description, debt.originalAmount, debt.amountPaid, debt.balance, debt.dueDate, debt.note, debt.status, debt.createdAt, debt.updatedAt]
      );
    });

    normalized.payments.forEach((payment) => {
      db.runSync(
        'INSERT INTO payments (id, customer_id, debt_id, amount, payment_date, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [payment.id, payment.customerId, payment.debtId, payment.amount, payment.paymentDate, payment.note, payment.createdAt]
      );
    });

    db.runSync('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['schemaVersion', String(schemaVersion)]);
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
}

export function loadData(): AppData {
  if (Platform.OS === 'web') {
    const stored = getWebStorage()?.getItem(storageKey);
    return stored ? normalizeData(JSON.parse(stored) as AppData) : emptyData;
  }

  migrateDatabase();
  return loadNativeData();
}

export function saveData(data: AppData) {
  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(storageKey, JSON.stringify(normalizeData(data)));
    return;
  }

  migrateDatabase();
  saveNativeData(data);
}

export function clearStoredData() {
  saveData(emptyData);
}
