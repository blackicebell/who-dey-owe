import { AppData, AppSettings } from '../types';

export const defaultReminderTemplate =
  'Hello {customerName}, this is a reminder from {businessName} that your outstanding balance is {balance}. Please make payment when convenient. Thank you.';

export const defaultSettings: AppSettings = {
  onboardingComplete: false,
  businessName: '',
  ownerName: '',
  reminderTemplate: defaultReminderTemplate,
  currencySymbol: '₦',
  themePreference: 'system',
  appLockEnabled: false,
  appLockPinHash: ''
};

export const emptyData: AppData = {
  settings: defaultSettings,
  customers: [],
  debts: [],
  payments: []
};
