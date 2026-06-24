export type Tab = 'Home' | 'Customers' | 'Overdue' | 'Reports' | 'Settings';
export type DebtStatus = 'Active' | 'Part-paid' | 'Cleared' | 'Overdue';
export type CustomerStatus = 'Owing' | 'Cleared' | 'Overdue';
export type ThemePreference = 'system' | 'light' | 'dark';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type Debt = {
  id: string;
  customerId: string;
  description: string;
  originalAmount: number;
  amountPaid: number;
  balance: number;
  dueDate: string | null;
  note: string;
  status: DebtStatus;
  createdAt: string;
  updatedAt: string;
};

export type Payment = {
  id: string;
  customerId: string;
  debtId: string | null;
  amount: number;
  paymentDate: string;
  note: string;
  createdAt: string;
};

export type AppSettings = {
  onboardingComplete: boolean;
  businessName: string;
  ownerName: string;
  reminderTemplate: string;
  currencySymbol: string;
  themePreference: ThemePreference;
};

export type AppData = {
  settings: AppSettings;
  customers: Customer[];
  debts: Debt[];
  payments: Payment[];
};

export type CustomerSummary = Customer & {
  balance: number;
  totalPaid: number;
  status: CustomerStatus;
  lastUpdated: string;
  overdueBalance: number;
  debtCount: number;
};
