import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '../data/defaults';
import { AppData } from '../types';
import { addCustomer, addDebt, getCustomerSummaries, recordPayment, seedChineduScenario } from './debts';
import { addDays, todayKey } from '../utils/date';

function emptyAppData(): AppData {
  return {
    settings: defaultSettings,
    customers: [],
    debts: [],
    payments: []
  };
}

test('Chinedu scenario keeps balances and overdue amount correct', () => {
  const data = seedChineduScenario(emptyAppData());
  const chinedu = getCustomerSummaries(data).find((customer) => customer.name === 'Chinedu');
  assert.ok(chinedu);
  assert.equal(chinedu.balance, 18000);
  assert.equal(chinedu.status, 'Overdue');
  assert.equal(chinedu.overdueBalance, 13000);

  const rice = data.debts.find((debt) => debt.description === 'Rice');
  const eggs = data.debts.find((debt) => debt.description === 'Eggs');
  assert.equal(rice?.balance, 13000);
  assert.equal(rice?.status, 'Overdue');
  assert.equal(eggs?.balance, 5000);
});

test('general payment applies to oldest active debt first', () => {
  let data = addCustomer(emptyAppData(), { name: 'Ada', phone: '', notes: '' });
  const customerId = data.customers[0].id;
  data = addDebt(data, {
    customerId,
    description: 'Older rice',
    amount: 10000,
    dueDate: addDays(-2),
    note: ''
  });
  data = addDebt(data, {
    customerId,
    description: 'New eggs',
    amount: 7000,
    dueDate: addDays(3),
    note: ''
  });

  data = recordPayment(data, {
    customerId,
    debtId: null,
    amount: 12000,
    paymentDate: todayKey(),
    note: ''
  });

  const older = data.debts.find((debt) => debt.description === 'Older rice');
  const newer = data.debts.find((debt) => debt.description === 'New eggs');
  assert.equal(older?.balance, 0);
  assert.equal(older?.status, 'Cleared');
  assert.equal(newer?.balance, 5000);
});
