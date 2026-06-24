import { addDays, isOverdue, todayKey } from '../utils/date';
import { AppData, Customer, CustomerSummary, Debt, DebtStatus, Payment } from '../types';

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getDebtStatus(debt: Pick<Debt, 'balance' | 'amountPaid' | 'dueDate'>): DebtStatus {
  if (debt.balance <= 0) return 'Cleared';
  if (isOverdue(debt.dueDate, debt.balance)) return 'Overdue';
  if (debt.amountPaid > 0) return 'Part-paid';
  return 'Active';
}

export function normalizeDebt(debt: Debt): Debt {
  const balance = Math.max(0, debt.originalAmount - debt.amountPaid);
  const next = { ...debt, balance };
  return { ...next, status: getDebtStatus(next) };
}

export function getCustomerSummaries(data: AppData): CustomerSummary[] {
  return data.customers.map((customer) => {
    const customerDebts = data.debts.filter((debt) => debt.customerId === customer.id).map(normalizeDebt);
    const customerPayments = data.payments.filter((payment) => payment.customerId === customer.id);
    const balance = customerDebts.reduce((sum, debt) => sum + debt.balance, 0);
    const overdueBalance = customerDebts.reduce((sum, debt) => debt.status === 'Overdue' ? sum + debt.balance : sum, 0);
    const totalPaid = customerPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const lastUpdated = [customer.updatedAt, ...customerDebts.map((debt) => debt.updatedAt), ...customerPayments.map((payment) => payment.createdAt)]
      .sort()
      .at(-1) ?? customer.updatedAt;

    return {
      ...customer,
      balance,
      overdueBalance,
      totalPaid,
      debtCount: customerDebts.filter((debt) => debt.balance > 0).length,
      status: overdueBalance > 0 ? 'Overdue' : balance > 0 ? 'Owing' : 'Cleared',
      lastUpdated
    };
  });
}

export function addCustomer(data: AppData, draft: Pick<Customer, 'name' | 'phone' | 'notes'>): AppData {
  const now = new Date().toISOString();
  const customer: Customer = {
    id: createId('customer'),
    name: draft.name.trim(),
    phone: draft.phone.trim(),
    notes: draft.notes.trim(),
    createdAt: now,
    updatedAt: now
  };
  return { ...data, customers: [customer, ...data.customers] };
}

export function upsertCustomer(data: AppData, customer: Customer): AppData {
  return {
    ...data,
    customers: data.customers.map((item) => item.id === customer.id ? { ...customer, updatedAt: new Date().toISOString() } : item)
  };
}

export function addDebt(data: AppData, draft: {
  customerId: string;
  description: string;
  amount: number;
  dueDate: string | null;
  note: string;
}): AppData {
  const now = new Date().toISOString();
  const debt = normalizeDebt({
    id: createId('debt'),
    customerId: draft.customerId,
    description: draft.description.trim(),
    originalAmount: draft.amount,
    amountPaid: 0,
    balance: draft.amount,
    dueDate: draft.dueDate,
    note: draft.note.trim(),
    status: 'Active',
    createdAt: now,
    updatedAt: now
  });

  return {
    ...data,
    debts: [debt, ...data.debts],
    customers: data.customers.map((customer) => customer.id === draft.customerId ? { ...customer, updatedAt: now } : customer)
  };
}

export function recordPayment(data: AppData, draft: {
  customerId: string;
  debtId: string | null;
  amount: number;
  paymentDate: string;
  note: string;
}): AppData {
  const now = new Date().toISOString();
  let remaining = draft.amount;
  const payment: Payment = {
    id: createId('payment'),
    customerId: draft.customerId,
    debtId: draft.debtId,
    amount: draft.amount,
    paymentDate: draft.paymentDate,
    note: draft.note.trim(),
    createdAt: now
  };

  const sortedDebtIds = data.debts
    .filter((debt) => debt.customerId === draft.customerId && debt.balance > 0)
    .sort((a, b) => (a.dueDate ?? a.createdAt).localeCompare(b.dueDate ?? b.createdAt))
    .map((debt) => debt.id);

  const targetIds = draft.debtId ? [draft.debtId] : sortedDebtIds;
  const debts = data.debts.map((debt) => {
    if (!targetIds.includes(debt.id) || remaining <= 0) return normalizeDebt(debt);
    const paidNow = Math.min(debt.balance, remaining);
    remaining -= paidNow;
    return normalizeDebt({
      ...debt,
      amountPaid: debt.amountPaid + paidNow,
      updatedAt: now
    });
  });

  return {
    ...data,
    debts,
    payments: [payment, ...data.payments],
    customers: data.customers.map((customer) => customer.id === draft.customerId ? { ...customer, updatedAt: now } : customer)
  };
}

export function seedChineduScenario(data: AppData): AppData {
  const existing = data.customers.find((customer) => customer.name.toLowerCase() === 'chinedu');
  const now = new Date().toISOString();
  const customer = existing ?? {
    id: createId('customer'),
    name: 'Chinedu',
    phone: '08012345678',
    notes: 'Test customer',
    createdAt: now,
    updatedAt: now
  };
  const base = existing ? data : { ...data, customers: [customer, ...data.customers] };
  const withRice = addDebt(base, {
    customerId: customer.id,
    description: 'Rice',
    amount: 20000,
    dueDate: addDays(-1),
    note: ''
  });
  const withEggs = addDebt(withRice, {
    customerId: customer.id,
    description: 'Eggs',
    amount: 5000,
    dueDate: addDays(7),
    note: ''
  });
  const rice = withEggs.debts.find((debt) => debt.customerId === customer.id && debt.description === 'Rice' && debt.originalAmount === 20000);
  return recordPayment(withEggs, {
    customerId: customer.id,
    debtId: rice?.id ?? null,
    amount: 7000,
    paymentDate: todayKey(),
    note: 'Part payment'
  });
}
