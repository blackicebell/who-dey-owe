import { AppData, AppSettings } from '../types';

export const defaultReminderTemplate =
  'Hello {customerName}, this is a reminder that your outstanding balance is {balance}. Please make payment when convenient. Thank you.';

export const defaultSettings: AppSettings = {
  onboardingComplete: false,
  businessName: '',
  ownerName: '',
  reminderTemplate: defaultReminderTemplate,
  currencySymbol: '₦',
  themePreference: 'system'
};

export const emptyData: AppData = {
  settings: defaultSettings,
  customers: [],
  debts: [],
  payments: []
};
