import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts
} from '@expo-google-fonts/plus-jakarta-sans';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button } from './src/components/Button';
import { Card } from './src/components/Card';
import { FieldRow } from './src/components/FieldRow';
import { defaultSettings } from './src/data/defaults';
import {
  addCustomer,
  addDebt,
  getCustomerSummaries,
  normalizeDebt,
  recordPayment,
  seedChineduScenario,
  upsertCustomer
} from './src/logic/debts';
import { clearStoredData, loadData, migrateDatabase, saveData } from './src/storage/database';
import { colors, fonts, radius, shadows, spacing } from './src/theme';
import { AppData, Customer, CustomerSummary, Debt, Tab } from './src/types';
import { addDays, daysBetween, formatShortDate, isDueThisWeek, isDueToday, todayKey } from './src/utils/date';
import { formatNaira, parseMoney } from './src/utils/money';
import { openWhatsAppMessage, openWhatsAppReminder } from './src/utils/reminders';

type CustomerDraft = {
  name: string;
  phone: string;
  notes: string;
};

type DebtDraft = {
  customerId: string;
  description: string;
  amount: string;
  dueDate: string;
  note: string;
};

type PaymentDraft = {
  customerId: string;
  debtId: string;
  amount: string;
  paymentDate: string;
  note: string;
};

type ReceiptPreview = {
  customer: CustomerSummary;
  message: string;
};

const emptyCustomerDraft: CustomerDraft = { name: '', phone: '', notes: '' };
const emptyDebtDraft: DebtDraft = {
  customerId: '',
  description: '',
  amount: '',
  dueDate: '',
  note: ''
};
const emptyPaymentDraft: PaymentDraft = {
  customerId: '',
  debtId: '',
  amount: '',
  paymentDate: todayKey(),
  note: ''
};

const tabs: { key: Tab; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { key: 'Home', icon: 'home', label: 'Home' },
  { key: 'Customers', icon: 'people', label: 'Customers' },
  { key: 'Overdue', icon: 'alert-circle', label: 'Overdue' },
  { key: 'Reports', icon: 'bar-chart', label: 'Reports' },
  { key: 'Settings', icon: 'settings', label: 'Settings' }
];

function hashPin(pin: string) {
  let hash = 5381;
  for (let index = 0; index < pin.length; index += 1) {
    hash = ((hash << 5) + hash) ^ pin.charCodeAt(index);
  }
  return String(hash >>> 0);
}

function getBackupPayload(data: AppData) {
  return JSON.stringify({
    app: 'Who Dey Owe?',
    version: 1,
    exportedAt: new Date().toISOString(),
    data
  }, null, 2);
}

function parseBackupPayload(raw: string): AppData {
  const parsed = JSON.parse(raw) as AppData | { data?: AppData };
  const data = 'data' in parsed && parsed.data ? parsed.data : parsed as AppData;
  if (!Array.isArray(data.customers) || !Array.isArray(data.debts) || !Array.isArray(data.payments)) {
    throw new Error('Invalid backup');
  }

  const customerIds = new Set(data.customers.map((customer) => customer.id));
  const debtIds = new Set(data.debts.map((debt) => debt.id));
  const hasBadDebt = data.debts.some((debt) => !customerIds.has(debt.customerId));
  const hasBadPayment = data.payments.some((payment) => !customerIds.has(payment.customerId) || (payment.debtId && !debtIds.has(payment.debtId)));
  if (hasBadDebt || hasBadPayment) {
    throw new Error('Backup has broken customer or debt links');
  }

  return {
    settings: { ...defaultSettings, ...data.settings, onboardingComplete: true },
    customers: data.customers,
    debts: data.debts,
    payments: data.payments
  };
}

export default function App() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold
  });
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AppData>({ settings: defaultSettings, customers: [], debts: [], payments: [] });
  const [appLocked, setAppLocked] = useState(false);

  useEffect(() => {
    migrateDatabase();
    const storedData = loadData();
    setData(storedData);
    setAppLocked(storedData.settings.appLockEnabled);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!loading) saveData(data);
  }, [data, loading]);

  if (loading || !fontsLoaded) {
    return (
      <SafeAreaProvider>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.green} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {appLocked ? (
        <LockScreen settings={data.settings} onUnlock={() => setAppLocked(false)} />
      ) : data.settings.onboardingComplete ? (
        <MainApp data={data} setData={setData} />
      ) : (
        <Onboarding
          onComplete={(settings) => setData((current) => ({ ...current, settings }))}
        />
      )}
    </SafeAreaProvider>
  );
}

function Onboarding({ onComplete }: { onComplete: (settings: AppData['settings']) => void }) {
  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const slides = [
    {
      title: 'Who Dey Owe?',
      body: 'Keep every customer balance in one clear place, even when the shop is busy.',
      icon: 'receipt'
    },
    {
      title: 'Add what they owe',
      body: 'Save the customer, amount, item, and due date together so nothing gets lost later.',
      icon: 'flash'
    },
    {
      title: 'Follow up with care',
      body: 'Prepare WhatsApp reminders and payment receipts with the details already filled in.',
      icon: 'logo-whatsapp'
    }
  ] as const;

  function finish() {
    onComplete({
      ...defaultSettings,
      onboardingComplete: true,
      businessName: businessName.trim(),
      ownerName: ownerName.trim()
    });
  }

  const slide = slides[step];
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.onboardingContent}>
        <View style={styles.brandMark}>
          <Text style={styles.brandInitial}>W</Text>
        </View>
        <View style={styles.onboardingHero}>
          <View style={styles.heroIcon}>
            <Ionicons name={slide.icon} size={34} color={colors.amber} />
          </View>
          <Text style={styles.onboardingTitle}>{slide.title}</Text>
          <Text style={styles.onboardingBody}>{slide.body}</Text>
        </View>

        {step === 2 ? (
          <Card style={styles.formCard}>
            <FieldRow label="Business name" value={businessName} onChangeText={setBusinessName} placeholder="Mama Ada Store" />
            <FieldRow label="Your name" value={ownerName} onChangeText={setOwnerName} placeholder="Ada" />
            <Text style={styles.formHint}>You can skip this and update it later in Settings.</Text>
          </Card>
        ) : (
          <Card style={styles.promiseCard}>
            <Text style={styles.promiseTitle}>Made for everyday credit sales</Text>
            <Text style={styles.promiseText}>Works offline, opens fast, and keeps the focus on who still needs to pay.</Text>
          </Card>
        )}

        <View style={styles.footer}>
          <View style={styles.progressDots}>
            {slides.map((item, index) => (
              <View key={item.title} style={[styles.progressDot, index === step && styles.progressDotActive]} />
            ))}
          </View>
          <Button
            label={step === slides.length - 1 ? 'Start Tracking' : 'Continue'}
            onPress={step === slides.length - 1 ? finish : () => setStep((current) => current + 1)}
          />
          {step > 0 ? <Button label="Back" variant="ghost" onPress={() => setStep((current) => current - 1)} /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LockScreen({ settings, onUnlock }: { settings: AppData['settings']; onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  function unlock() {
    if (hashPin(pin) === settings.appLockPinHash) {
      setError('');
      setPin('');
      onUnlock();
      return;
    }
    setError('Wrong PIN. Try again.');
  }

  return (
    <SafeAreaView style={styles.lockScreen}>
      <View style={styles.brandMark}>
        <Text style={styles.brandInitial}>W</Text>
      </View>
      <Text style={styles.lockTitle}>Who Dey Owe?</Text>
      <Text style={styles.lockBody}>Enter your PIN to open your debt records.</Text>
      <TextInput
        value={pin}
        onChangeText={(value) => {
          setError('');
          setPin(value.replace(/\D/g, '').slice(0, 6));
        }}
        placeholder="PIN"
        placeholderTextColor={colors.mutedText}
        secureTextEntry
        keyboardType="number-pad"
        style={styles.lockInput}
        onSubmitEditing={unlock}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Button label="Unlock" icon="lock-open" onPress={unlock} disabled={pin.length < 4} />
    </SafeAreaView>
  );
}

function MainApp({ data, setData }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData>> }) {
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreview | null>(null);
  const [toast, setToast] = useState('');

  const summaries = useMemo(() => getCustomerSummaries(data), [data]);
  const selectedCustomer = summaries.find((customer) => customer.id === selectedCustomerId) ?? null;
  const editingCustomer = summaries.find((customer) => customer.id === editingCustomerId) ?? null;
  const activeDebts = data.debts.map(normalizeDebt).filter((debt) => debt.balance > 0);
  const totalOwed = activeDebts.reduce((sum, debt) => sum + debt.balance, 0);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 1800);
  }

  function updateData(next: AppData, message?: string) {
    setData(next);
    if (message) showToast(message);
  }

  function openAddDebt(customerId?: string) {
    setSelectedCustomerId(customerId ?? null);
    setDebtModalOpen(true);
  }

  function openAddCustomer() {
    setEditingCustomerId(null);
    setCustomerModalOpen(true);
  }

  function openPayment(customerId?: string) {
    setSelectedCustomerId(customerId ?? null);
    setPaymentModalOpen(true);
  }

  function updateDebt(nextDebt: Debt) {
    const normalized = normalizeDebt(nextDebt);
    const now = new Date().toISOString();
    updateData({
      ...data,
      debts: data.debts.map((debt) => debt.id === normalized.id ? { ...normalized, updatedAt: now } : debt),
      customers: data.customers.map((customer) => customer.id === normalized.customerId ? { ...customer, updatedAt: now } : customer)
    }, 'Debt updated.');
    setEditingDebt(null);
  }

  function confirmDeleteDebt(debt: Debt) {
    const linkedPayments = data.payments.filter((payment) => payment.debtId === debt.id);
    const message = linkedPayments.length
      ? `This will remove "${debt.description}" and ${linkedPayments.length} linked payment record${linkedPayments.length === 1 ? '' : 's'}.`
      : `This will remove "${debt.description}" from this customer.`;

    Alert.alert('Delete this debt?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const now = new Date().toISOString();
          updateData({
            ...data,
            debts: data.debts.filter((item) => item.id !== debt.id),
            payments: data.payments.filter((payment) => payment.debtId !== debt.id),
            customers: data.customers.map((customer) => customer.id === debt.customerId ? { ...customer, updatedAt: now } : customer)
          }, 'Debt deleted.');
        }
      }
    ]);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.appWrap}>
        {activeTab === 'Home' && (
          <HomeScreen
            data={data}
            summaries={summaries}
            totalOwed={totalOwed}
            onAddDebt={() => openAddDebt()}
            onAddCustomer={openAddCustomer}
            onCustomerPress={(id) => {
              setSelectedCustomerId(id);
              setActiveTab('Customers');
            }}
          />
        )}
        {activeTab === 'Customers' && (
          selectedCustomer ? (
            <CustomerDetail
              data={data}
              customer={selectedCustomer}
              onBack={() => setSelectedCustomerId(null)}
              onAddDebt={() => openAddDebt(selectedCustomer.id)}
              onPayment={() => openPayment(selectedCustomer.id)}
              onEdit={() => {
                setEditingCustomerId(selectedCustomer.id);
                setCustomerModalOpen(true);
              }}
              onEditDebt={setEditingDebt}
              onDeleteDebt={confirmDeleteDebt}
            />
          ) : (
            <CustomersScreen
              summaries={summaries}
              onAddCustomer={openAddCustomer}
              onCustomerPress={setSelectedCustomerId}
            />
          )
        )}
        {activeTab === 'Overdue' && (
          <OverdueScreen
            data={data}
            summaries={summaries}
            onCustomerPress={(id) => {
              setSelectedCustomerId(id);
              setActiveTab('Customers');
            }}
          />
        )}
        {activeTab === 'Reports' && <ReportsScreen data={data} summaries={summaries} />}
        {activeTab === 'Settings' && (
          <SettingsScreen
            data={data}
            setData={setData}
            showToast={showToast}
          />
        )}
      </View>

      <BottomTabs activeTab={activeTab} setActiveTab={(tab) => {
        setSelectedCustomerId(null);
        setActiveTab(tab);
      }} />

      <CustomerModal
        open={customerModalOpen}
        customer={editingCustomer}
        onClose={() => {
          setCustomerModalOpen(false);
          setEditingCustomerId(null);
        }}
        onSave={(draft, editingCustomer, addDebtNext) => {
          const next = editingCustomer
            ? upsertCustomer(data, { ...editingCustomer, ...draft })
            : addCustomer(data, draft);
          updateData(next, editingCustomer ? 'Customer updated.' : 'Customer saved.');
          setCustomerModalOpen(false);
          setEditingCustomerId(null);
          if (addDebtNext) {
            const customerId = editingCustomer?.id ?? next.customers[0]?.id;
            setSelectedCustomerId(customerId ?? null);
            setDebtModalOpen(true);
          }
        }}
      />
      <DebtModal
        open={debtModalOpen}
        data={data}
        selectedCustomerId={selectedCustomerId}
        onClose={() => setDebtModalOpen(false)}
        onSave={(next) => {
          updateData(next, 'Debt added.');
          setDebtModalOpen(false);
        }}
      />
      <PaymentModal
        open={paymentModalOpen}
        data={data}
        selectedCustomerId={selectedCustomerId}
        onClose={() => setPaymentModalOpen(false)}
        onSave={(next, preview) => {
          updateData(next, 'Payment recorded.');
          setPaymentModalOpen(false);
          if (preview) setReceiptPreview(preview);
        }}
      />
      <EditDebtModal
        debt={editingDebt}
        onClose={() => setEditingDebt(null)}
        onSave={updateDebt}
      />
      <ReceiptPreviewModal
        preview={receiptPreview}
        onClose={() => setReceiptPreview(null)}
        onSend={async () => {
          if (!receiptPreview) return;
          await openWhatsAppMessage(receiptPreview.customer.phone, receiptPreview.message);
          setReceiptPreview(null);
        }}
      />
      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function HomeScreen({
  data,
  summaries,
  totalOwed,
  onAddDebt,
  onAddCustomer,
  onCustomerPress
}: {
  data: AppData;
  summaries: CustomerSummary[];
  totalOwed: number;
  onAddDebt: () => void;
  onAddCustomer: () => void;
  onCustomerPress: (id: string) => void;
}) {
  const activeDebts = data.debts.map(normalizeDebt).filter((debt) => debt.balance > 0);
  const dueToday = activeDebts.filter((debt) => isDueToday(debt.dueDate, debt.balance));
  const overdue = activeDebts.filter((debt) => debt.status === 'Overdue');
  const recent = [...data.payments, ...data.debts]
    .sort((a, b) => ('createdAt' in b ? b.createdAt : '').localeCompare('createdAt' in a ? a.createdAt : ''))
    .slice(0, 4);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.kicker}>Today's Debt Summary</Text>
          <Text style={styles.title}>Who owes you?</Text>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="wallet" size={24} color={colors.amber} />
        </View>
      </View>

      <Card style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total Owed</Text>
        <Text style={styles.totalValue}>{formatNaira(totalOwed)}</Text>
        <View style={styles.statRow}>
          <Stat label="Customers owing" value={summaries.filter((item) => item.balance > 0).length.toString()} />
          <Stat label="Due today" value={dueToday.length.toString()} />
          <Stat label="Overdue" value={overdue.length.toString()} danger />
        </View>
      </Card>

      <View style={styles.actionRow}>
        <Button label="Add Debt" icon="add" onPress={onAddDebt} style={styles.flexButton} />
        <Button label="Add Customer" icon="person-add" variant="secondary" onPress={onAddCustomer} style={styles.flexButton} />
      </View>

      {data.debts.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No debts yet</Text>
          <Text style={styles.emptyBody}>When customers buy on credit, add them here so you don't forget.</Text>
          <Button label="Add First Debt" icon="add" onPress={onAddDebt} />
        </Card>
      ) : null}

      <SectionTitle title="Due Today" />
      {dueToday.length ? dueToday.slice(0, 3).map((debt) => {
        const customer = summaries.find((item) => item.id === debt.customerId);
        if (!customer) return null;
        return (
          <DebtRow
            key={debt.id}
            debt={debt}
            customer={customer}
            onPress={() => onCustomerPress(customer.id)}
            onReminder={() => openWhatsAppReminder(customer, data.settings)}
          />
        );
      }) : <EmptyInline title="No one due today" body="No wahala, your follow-up list is calm." />}

      <SectionTitle title="Recently Updated" />
      {recent.length ? recent.map((item) => {
        const isPayment = 'paymentDate' in item;
        const customer = summaries.find((summary) => summary.id === item.customerId);
        if (!customer) return null;
        return (
          <Pressable key={item.id} onPress={() => onCustomerPress(customer.id)} style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}>
            <View style={[styles.smallIcon, isPayment && styles.smallIconSuccess]}>
              <Ionicons name={isPayment ? 'cash' : 'receipt'} size={18} color={isPayment ? colors.green : colors.amber} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{isPayment ? 'Payment recorded' : (item as Debt).description}</Text>
              <Text style={styles.rowMeta}>{customer?.name ?? 'Customer'} · {isPayment ? formatNaira(item.amount) : formatNaira((item as Debt).balance)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
          </Pressable>
        );
      }) : <EmptyInline title="Nothing recent" body="Your latest debts and payments will show here." />}
    </ScrollView>
  );
}

function CustomersScreen({
  summaries,
  onAddCustomer,
  onCustomerPress
}: {
  summaries: CustomerSummary[];
  onAddCustomer: () => void;
  onCustomerPress: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'All' | 'Owing' | 'Cleared'>('All');
  const [sort, setSort] = useState<'Highest Balance' | 'Recently Updated' | 'A-Z'>('Highest Balance');
  const filtered = summaries
    .filter((customer) => {
      const matchesSearch = [customer.name, customer.phone].join(' ').toLowerCase().includes(query.toLowerCase());
      const matchesFilter = filter === 'All' || (filter === 'Owing' ? customer.balance > 0 : customer.balance === 0);
      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => {
      if (sort === 'A-Z') return a.name.localeCompare(b.name);
      if (sort === 'Recently Updated') return b.lastUpdated.localeCompare(a.lastUpdated);
      return b.balance - a.balance;
    });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.kicker}>Customer Book</Text>
          <Text style={styles.title}>All customers</Text>
        </View>
        <Pressable onPress={onAddCustomer} style={styles.roundButton}>
          <Ionicons name="person-add" size={22} color={colors.white} />
        </Pressable>
      </View>
      <SearchBox value={query} onChangeText={setQuery} placeholder="Search name or phone" />
      <ChipRow values={['All', 'Owing', 'Cleared']} active={filter} onChange={(value) => setFilter(value as typeof filter)} />
      <ChipRow values={['Highest Balance', 'Recently Updated', 'A-Z']} active={sort} onChange={(value) => setSort(value as typeof sort)} />
      <View style={styles.list}>
        {filtered.length ? filtered.map((customer) => (
          <CustomerRow key={customer.id} customer={customer} onPress={() => onCustomerPress(customer.id)} />
        )) : <EmptyInline title="No customer found" body="Try another search or add a new customer." />}
      </View>
    </ScrollView>
  );
}

function CustomerDetail({
  data,
  customer,
  onBack,
  onAddDebt,
  onPayment,
  onEdit,
  onEditDebt,
  onDeleteDebt
}: {
  data: AppData;
  customer: CustomerSummary;
  onBack: () => void;
  onAddDebt: () => void;
  onPayment: () => void;
  onEdit: () => void;
  onEditDebt: (debt: Debt) => void;
  onDeleteDebt: (debt: Debt) => void;
}) {
  const [detailTab, setDetailTab] = useState<'Debts' | 'Payments'>('Debts');
  const debts = data.debts.filter((debt) => debt.customerId === customer.id).map(normalizeDebt);
  const payments = data.payments.filter((payment) => payment.customerId === customer.id);
  const lastPayment = payments[0]?.paymentDate ? formatShortDate(payments[0].paymentDate) : 'No payment yet';

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={21} color={colors.green} />
        </Pressable>
        <View style={styles.detailTitleWrap}>
          <Text style={styles.kicker}>{customer.phone || 'No phone saved'}</Text>
          <Text style={styles.title}>{customer.name}</Text>
        </View>
        <Pressable onPress={onEdit} style={styles.iconButton}>
          <Ionicons name="create" size={20} color={colors.green} />
        </Pressable>
      </View>

      <Card style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total Balance</Text>
        <Text style={styles.totalValue}>{formatNaira(customer.balance)}</Text>
        <View style={styles.statRow}>
          <Stat label="Total paid" value={formatNaira(customer.totalPaid)} />
          <Stat label="Last payment" value={lastPayment} />
        </View>
      </Card>

      <View style={styles.actionGrid}>
        <Button label="Add Debt" icon="add" onPress={onAddDebt} style={styles.gridButton} />
        <Button label="Record Payment" icon="cash" variant="secondary" onPress={onPayment} style={styles.gridButton} />
        <Button label="Send WhatsApp Reminder" icon="logo-whatsapp" variant="ghost" onPress={() => openWhatsAppReminder(customer, data.settings)} style={styles.gridButton} />
      </View>

      <View style={styles.detailTabs}>
        {(['Debts', 'Payments'] as const).map((tab) => {
          const active = detailTab === tab;
          const count = tab === 'Debts' ? debts.length : payments.length;
          return (
            <Pressable key={tab} onPress={() => setDetailTab(tab)} style={[styles.detailTab, active && styles.detailTabActive]}>
              <Text style={[styles.detailTabText, active && styles.detailTabTextActive]}>{tab}</Text>
              <View style={[styles.detailTabCount, active && styles.detailTabCountActive]}>
                <Text style={[styles.detailTabCountText, active && styles.detailTabCountTextActive]}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {detailTab === 'Debts' ? (
      <>
      {debts.length ? debts.map((debt) => (
        <DebtDetailCard
          key={debt.id}
          debt={debt}
          onEdit={() => onEditDebt(debt)}
          onDelete={() => onDeleteDebt(debt)}
        />
      )) : <EmptyInline title="No debt yet" body="Add what this customer owes and it will appear here." />}
      </>
      ) : null}

      {detailTab === 'Payments' ? (
      <>
      {payments.length ? payments.map((payment) => {
        const debt = data.debts.find((item) => item.id === payment.debtId);
        return (
          <Card key={payment.id} style={styles.paymentRow}>
            <Text style={styles.rowTitle}>{formatNaira(payment.amount)}</Text>
            <Text style={styles.rowMeta}>{formatShortDate(payment.paymentDate)} · {debt?.description ?? 'General payment'}</Text>
            {payment.note ? <Text style={styles.noteText}>{payment.note}</Text> : null}
          </Card>
        );
      }) : <EmptyInline title="No payment yet" body="Partial and full payments will show here." />}
      </>
      ) : null}
    </ScrollView>
  );
}

function OverdueScreen({
  data,
  summaries,
  onCustomerPress
}: {
  data: AppData;
  summaries: CustomerSummary[];
  onCustomerPress: (id: string) => void;
}) {
  const [view, setView] = useState<'Overdue' | 'Due Today' | 'Due This Week'>('Overdue');
  const debts = data.debts.map(normalizeDebt).filter((debt) => {
    if (view === 'Overdue') return debt.status === 'Overdue';
    if (view === 'Due Today') return isDueToday(debt.dueDate, debt.balance);
    return isDueThisWeek(debt.dueDate, debt.balance);
  });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>Follow Up</Text>
      <Text style={styles.title}>Who needs reminding?</Text>
      <ChipRow values={['Overdue', 'Due Today', 'Due This Week']} active={view} onChange={(value) => setView(value as typeof view)} />
      {debts.length ? debts.map((debt) => {
        const customer = summaries.find((item) => item.id === debt.customerId);
        if (!customer) return null;
        const lateBy = debt.dueDate ? Math.abs(daysBetween(debt.dueDate)) : 0;
        return (
          <DebtRow
            key={debt.id}
            debt={debt}
            customer={customer}
            helper={view === 'Overdue' ? `${lateBy} day${lateBy === 1 ? '' : 's'} overdue` : formatShortDate(debt.dueDate)}
            onPress={() => onCustomerPress(customer.id)}
            onReminder={() => openWhatsAppReminder(customer, data.settings)}
          />
        );
      }) : <EmptyState title="Nothing overdue" body="You're all caught up. No wahala." icon="checkmark-circle" />}
    </ScrollView>
  );
}

function ReportsScreen({ data, summaries }: { data: AppData; summaries: CustomerSummary[] }) {
  const [period, setPeriod] = useState<'Today' | 'This Week' | 'This Month' | 'All'>('This Month');
  const now = new Date();
  const inRange = (dateValue: string) => {
    if (period === 'All') return true;
    const date = new Date(dateValue);
    if (period === 'Today') return date.toDateString() === now.toDateString();
    const days = Math.round((now.getTime() - date.getTime()) / 86400000);
    if (period === 'This Week') return days <= 7;
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  };
  const debts = data.debts.map(normalizeDebt);
  const creditGiven = debts.filter((debt) => inRange(debt.createdAt)).reduce((sum, debt) => sum + debt.originalAmount, 0);
  const collected = data.payments.filter((payment) => inRange(payment.paymentDate)).reduce((sum, payment) => sum + payment.amount, 0);
  const stillOwed = debts.reduce((sum, debt) => sum + debt.balance, 0);
  const overdueAmount = debts.filter((debt) => debt.status === 'Overdue').reduce((sum, debt) => sum + debt.balance, 0);
  const topOwing = [...summaries].filter((customer) => customer.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>Simple Reports</Text>
      <Text style={styles.title}>Money picture</Text>
      <ChipRow values={['Today', 'This Week', 'This Month', 'All']} active={period} onChange={(value) => setPeriod(value as typeof period)} />
      <View style={styles.reportGrid}>
        <ReportTile label="Credit Given" value={formatNaira(creditGiven)} />
        <ReportTile label="Money Collected" value={formatNaira(collected)} success />
        <ReportTile label="Still Owed" value={formatNaira(stillOwed)} />
        <ReportTile label="Overdue Amount" value={formatNaira(overdueAmount)} danger />
      </View>
      <SectionTitle title="Top Owing Customers" />
      {topOwing.length ? topOwing.map((customer) => <CustomerRow key={customer.id} customer={customer} onPress={() => undefined} />) : <EmptyInline title="No one owing" body="When balances appear, your top owing customers will show here." />}
    </ScrollView>
  );
}

function SettingsScreen({
  data,
  setData,
  showToast
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  showToast: (message: string) => void;
}) {
  const [businessName, setBusinessName] = useState(data.settings.businessName);
  const [ownerName, setOwnerName] = useState(data.settings.ownerName);
  const [template, setTemplate] = useState(data.settings.reminderTemplate);
  const [pinDraft, setPinDraft] = useState('');
  const backupText = getBackupPayload(data);

  function saveSettings() {
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        businessName,
        ownerName,
        reminderTemplate: template
      }
    }));
    showToast('Settings saved.');
  }

  async function exportBackup() {
    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(backupText);
      showToast('Backup copied.');
      return;
    }
    const uri = `${FileSystem.documentDirectory ?? ''}who-dey-owe-backup.json`;
    await FileSystem.writeAsStringAsync(uri, backupText);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri);
    } else {
      await Share.share({ message: backupText });
    }
  }

  async function importFromClipboard() {
    try {
      const raw = await Clipboard.getStringAsync();
      const nextData = parseBackupPayload(raw);
      Alert.alert(
        'Import this backup?',
        `Customers: ${nextData.customers.length}\nDebts: ${nextData.debts.length}\nPayments: ${nextData.payments.length}\n\nThis will replace the records on this device.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            onPress: () => {
              setData(nextData);
              showToast('Backup imported.');
            }
          }
        ]
      );
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : 'Copy a valid Who Dey Owe backup JSON first, then try again.');
    }
  }

  function savePinLock() {
    if (pinDraft.length < 4) {
      Alert.alert('PIN too short', 'Use at least 4 digits.');
      return;
    }
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        appLockEnabled: true,
        appLockPinHash: hashPin(pinDraft)
      }
    }));
    setPinDraft('');
    showToast('PIN lock enabled.');
  }

  function disablePinLock() {
    Alert.alert('Turn off PIN lock?', 'The app will open without asking for a PIN on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn Off',
        style: 'destructive',
        onPress: () => {
          setData((current) => ({
            ...current,
            settings: {
              ...current.settings,
              appLockEnabled: false,
              appLockPinHash: ''
            }
          }));
          setPinDraft('');
          showToast('PIN lock turned off.');
        }
      }
    ]);
  }

  function clearAll() {
    Alert.alert('Clear all data?', 'This removes every customer, debt, and payment saved on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          clearStoredData();
          setData({ settings: { ...defaultSettings, onboardingComplete: true }, customers: [], debts: [], payments: [] });
          showToast('Data cleared.');
        }
      }
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>Settings</Text>
      <Text style={styles.title}>Keep it yours</Text>
      <Card style={styles.formCard}>
        <Text style={styles.cardTitle}>Business Info</Text>
        <FieldRow label="Business name" value={businessName} onChangeText={setBusinessName} placeholder="Your shop name" />
        <FieldRow label="Owner name" value={ownerName} onChangeText={setOwnerName} placeholder="Your name" />
      </Card>
      <Card style={styles.formCard}>
        <Text style={styles.cardTitle}>Reminder Message</Text>
        <FieldRow
          label="WhatsApp template"
          value={template}
          onChangeText={setTemplate}
          multiline
          placeholder="Hello {customerName}, your balance is {balance}."
        />
        <Text style={styles.formHint}>Use {'{customerName}'} and {'{balance}'} where you want the app to fill details.</Text>
        <Button label="Save Settings" icon="save" onPress={saveSettings} />
      </Card>
      <Card style={styles.formCard}>
        <Text style={styles.cardTitle}>Data</Text>
        <Button label="Export Backup" icon="share" onPress={exportBackup} />
        <Button label="Import Backup" icon="clipboard" variant="secondary" onPress={importFromClipboard} />
        <Button label="Load Chinedu Test" icon="flask" variant="ghost" onPress={() => {
          setData((current) => seedChineduScenario(current));
          showToast('Test scenario added.');
        }} />
        <Button label="Clear All Data" icon="trash" variant="danger" onPress={clearAll} />
      </Card>
      <Card style={styles.formCard}>
        <Text style={styles.cardTitle}>Privacy</Text>
        <Text style={styles.formHint}>
          {data.settings.appLockEnabled ? 'PIN lock is on for this device.' : 'Add a PIN so casual users cannot open your debt list.'}
        </Text>
        <FieldRow
          label={data.settings.appLockEnabled ? 'New PIN' : 'PIN'}
          value={pinDraft}
          onChangeText={(value) => setPinDraft(value.replace(/\D/g, '').slice(0, 6))}
          placeholder="4-6 digits"
          secureTextEntry
          keyboardType="number-pad"
        />
        <Button label={data.settings.appLockEnabled ? 'Change PIN' : 'Turn On PIN Lock'} icon="lock-closed" onPress={savePinLock} />
        {data.settings.appLockEnabled ? <Button label="Turn Off PIN Lock" icon="lock-open" variant="danger" onPress={disablePinLock} /> : null}
      </Card>
      <Card style={styles.formCard}>
        <Text style={styles.cardTitle}>About</Text>
        <Text style={styles.rowMeta}>Who Dey Owe? v1.0</Text>
        <Text style={styles.formHint}>Offline debt tracking for Nigerian small business owners.</Text>
      </Card>
    </ScrollView>
  );
}

function CustomerModal({
  open,
  customer,
  onClose,
  onSave
}: {
  open: boolean;
  customer: CustomerSummary | null;
  onClose: () => void;
  onSave: (draft: CustomerDraft, customer: Customer | null, addDebtNext: boolean) => void;
}) {
  const [draft, setDraft] = useState<CustomerDraft>(emptyCustomerDraft);
  const [addDebtNext, setAddDebtNext] = useState(true);

  useEffect(() => {
    setDraft(customer ? { name: customer.name, phone: customer.phone, notes: customer.notes } : emptyCustomerDraft);
    setAddDebtNext(!customer);
  }, [customer, open]);

  return (
    <Sheet open={open} title={customer ? 'Edit Customer' : 'Add Customer'} onClose={onClose}>
      <FieldRow label="Customer name" value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} placeholder="Chinedu" />
      <FieldRow label="Phone number" value={draft.phone} onChangeText={(phone) => setDraft((current) => ({ ...current, phone }))} placeholder="080..." keyboardType="phone-pad" />
      <FieldRow label="Notes" value={draft.notes} onChangeText={(notes) => setDraft((current) => ({ ...current, notes }))} placeholder="Optional" multiline />
      <Pressable onPress={() => setAddDebtNext((current) => !current)} style={styles.optionRow}>
        <View style={[styles.checkbox, addDebtNext && styles.checkboxActive]}>
          {addDebtNext ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.optionTitle}>Add what this customer owes next</Text>
          <Text style={styles.optionMeta}>Most new customers are added because there is a debt to record.</Text>
        </View>
      </Pressable>
      <Button
        label={addDebtNext ? 'Save and Add Debt' : 'Save Customer'}
        icon={addDebtNext ? 'add-circle' : 'checkmark'}
        disabled={!draft.name.trim()}
        onPress={() => onSave(draft, customer, addDebtNext)}
      />
    </Sheet>
  );
}

function DebtModal({
  open,
  data,
  selectedCustomerId,
  onClose,
  onSave
}: {
  open: boolean;
  data: AppData;
  selectedCustomerId: string | null;
  onClose: () => void;
  onSave: (data: AppData) => void;
}) {
  const [draft, setDraft] = useState<DebtDraft>({ ...emptyDebtDraft, customerId: selectedCustomerId ?? '' });
  const [showDueDatePicker, setShowDueDatePicker] = useState(false);

  useEffect(() => {
    setDraft({ ...emptyDebtDraft, customerId: selectedCustomerId ?? '' });
    setShowDueDatePicker(false);
  }, [open, selectedCustomerId]);

  function saveDebt() {
    let nextData = data;
    let customerId = draft.customerId;
    if (!customerId) return;
    onSave(addDebt(nextData, {
      customerId,
      description: draft.description,
      amount: parseMoney(draft.amount),
      dueDate: draft.dueDate || null,
      note: draft.note
    }));
  }

  const amount = parseMoney(draft.amount);
  const canSave = Boolean(draft.customerId) && draft.description.trim().length > 0 && amount > 0;

  return (
    <Sheet open={open} title="Add Debt" onClose={onClose}>
      <CustomerDropdown
        customers={data.customers}
        selectedCustomerId={draft.customerId}
        onSelect={(customerId) => setDraft((current) => ({ ...current, customerId }))}
        emptyText="Add a customer first, then record what they owe."
      />
      <FieldRow label="Description" value={draft.description} onChangeText={(description) => setDraft((current) => ({ ...current, description }))} placeholder="Rice, POS withdrawal, Hair appointment" />
      <FieldRow label="Amount" value={draft.amount} onChangeText={(amountValue) => setDraft((current) => ({ ...current, amount: amountValue }))} placeholder="20000" keyboardType="numeric" />
      <Text style={styles.fieldLabel}>Due date</Text>
      <ChipRow
        values={['None', 'Today', 'Tomorrow', '7 days', 'Custom']}
        active={quickDateLabel(draft.dueDate)}
        onChange={(value) => {
          if (value === 'Custom') {
            setShowDueDatePicker(true);
            setDraft((current) => ({ ...current, dueDate: current.dueDate || todayKey() }));
            return;
          }
          setShowDueDatePicker(false);
          setDraft((current) => ({ ...current, dueDate: dateFromQuickLabel(value) }));
        }}
      />
      {draft.dueDate ? (
        <Pressable onPress={() => setShowDueDatePicker(true)} style={styles.dateSummary}>
          <Ionicons name="calendar" size={18} color={colors.green} />
          <Text style={styles.dateSummaryText}>Due {formatShortDate(draft.dueDate)}</Text>
          <Text style={styles.dateSummaryAction}>Change</Text>
        </Pressable>
      ) : null}
      {showDueDatePicker ? (
        <DateTimePicker
          value={draft.dueDate ? new Date(`${draft.dueDate}T12:00:00`) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, selectedDate) => {
            if (Platform.OS !== 'ios') setShowDueDatePicker(false);
            if (!selectedDate) return;
            setDraft((current) => ({ ...current, dueDate: todayKey(selectedDate) }));
          }}
        />
      ) : null}
      <FieldRow label="Private note" value={draft.note} onChangeText={(note) => setDraft((current) => ({ ...current, note }))} placeholder="Only you will see this" multiline />
      <Button label="Save Debt" icon="checkmark" disabled={!canSave} onPress={saveDebt} />
    </Sheet>
  );
}

function PaymentModal({
  open,
  data,
  selectedCustomerId,
  onClose,
  onSave
}: {
  open: boolean;
  data: AppData;
  selectedCustomerId: string | null;
  onClose: () => void;
  onSave: (data: AppData, receiptPreview?: ReceiptPreview) => void;
}) {
  const [draft, setDraft] = useState<PaymentDraft>({ ...emptyPaymentDraft, customerId: selectedCustomerId ?? '' });
  const customerDebts = data.debts.filter((debt) => debt.customerId === draft.customerId && debt.balance > 0).map(normalizeDebt);
  const selectedDebt = draft.debtId ? customerDebts.find((debt) => debt.id === draft.debtId) ?? null : customerDebts[0] ?? null;
  const debtOptions = customerDebts.map((debt) => ({
    id: debt.id,
    label: `${debt.description} · ${formatNaira(debt.balance)}`
  }));
  const activeDebtLabel = draft.debtId
    ? debtOptions.find((option) => option.id === draft.debtId)?.label ?? 'Oldest debt'
    : 'Oldest debt';
  const amount = parseMoney(draft.amount);

  useEffect(() => {
    setDraft({ ...emptyPaymentDraft, customerId: selectedCustomerId ?? '' });
  }, [open, selectedCustomerId]);

  return (
    <Sheet open={open} title="Record Payment" onClose={onClose}>
      <CustomerDropdown
        customers={data.customers}
        selectedCustomerId={draft.customerId}
        onSelect={(customerId) => setDraft((current) => ({ ...current, customerId, debtId: '' }))}
        emptyText="Add a customer before recording a payment."
      />
      <Text style={styles.fieldLabel}>Apply to</Text>
      <ChipRow values={['Oldest debt', ...debtOptions.map((option) => option.label)]} active={activeDebtLabel} onChange={(value) => {
        const debt = debtOptions.find((item) => item.label === value);
        setDraft((current) => ({ ...current, debtId: debt?.id ?? '' }));
      }} />
      {selectedDebt ? (
        <Card style={styles.debtContextCard}>
          <View style={styles.headerRowTight}>
            <View style={styles.rowCopy}>
              <Text style={styles.contextTitle}>{draft.debtId ? selectedDebt.description : 'Oldest active debt'}</Text>
              <Text style={styles.rowMeta}>{selectedDebt.description} was recorded {formatShortDate(selectedDebt.createdAt.slice(0, 10))}</Text>
            </View>
            <Text style={styles.contextAmount}>{formatNaira(selectedDebt.balance)}</Text>
          </View>
        </Card>
      ) : null}
      <FieldRow label="Payment amount" value={draft.amount} onChangeText={(amountValue) => setDraft((current) => ({ ...current, amount: amountValue }))} placeholder="7000" keyboardType="numeric" />
      <FieldRow label="Payment date" value={draft.paymentDate} onChangeText={(paymentDate) => setDraft((current) => ({ ...current, paymentDate }))} placeholder="YYYY-MM-DD" />
      <FieldRow label="Private note" value={draft.note} onChangeText={(note) => setDraft((current) => ({ ...current, note }))} placeholder="Only you will see this. It will not be sent." multiline />
      <Card style={styles.receiptHintCard}>
        <Ionicons name="logo-whatsapp" size={20} color={colors.green} />
        <View style={styles.rowCopy}>
          <Text style={styles.optionTitle}>Preview WhatsApp receipt after saving</Text>
          <Text style={styles.optionMeta}>Your private note will not be included in the receipt.</Text>
        </View>
      </Card>
      <Button
        label="Save Payment"
        icon="checkmark"
        disabled={!draft.customerId || amount <= 0}
        onPress={() => {
          const next = recordPayment(data, {
            customerId: draft.customerId,
            debtId: draft.debtId || null,
            amount,
            paymentDate: draft.paymentDate || todayKey(),
            note: draft.note
          });
          const customer = getCustomerSummaries(next).find((item) => item.id === draft.customerId);
          const receiptDebt = draft.debtId ? data.debts.find((debt) => debt.id === draft.debtId) : selectedDebt;
          onSave(next, customer ? {
            customer,
            message: buildPaymentReceiptMessage({
              customerName: customer.name,
              businessName: data.settings.businessName,
              amount,
              paymentDate: draft.paymentDate || todayKey(),
              debtDescription: receiptDebt?.description,
              remainingBalance: customer.balance
            })
          } : undefined);
        }}
      />
    </Sheet>
  );
}

function EditDebtModal({
  debt,
  onClose,
  onSave
}: {
  debt: Debt | null;
  onClose: () => void;
  onSave: (debt: Debt) => void;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [showDueDatePicker, setShowDueDatePicker] = useState(false);

  useEffect(() => {
    setDescription(debt?.description ?? '');
    setAmount(debt ? String(debt.originalAmount) : '');
    setDueDate(debt?.dueDate ?? '');
    setNote(debt?.note ?? '');
    setShowDueDatePicker(false);
  }, [debt]);

  if (!debt) return null;

  const currentDebt = debt;
  const nextAmount = parseMoney(amount);
  const canSave = description.trim().length > 0 && nextAmount > 0;

  function save() {
    if (!canSave) return;
    const clampedPaid = Math.min(currentDebt.amountPaid, nextAmount);
    onSave(normalizeDebt({
      ...currentDebt,
      description: description.trim(),
      originalAmount: nextAmount,
      amountPaid: clampedPaid,
      balance: Math.max(0, nextAmount - clampedPaid),
      dueDate: dueDate || null,
      note: note.trim()
    }));
  }

  return (
    <Sheet open={Boolean(debt)} title="Edit Debt" onClose={onClose}>
      <FieldRow label="Description" value={description} onChangeText={setDescription} placeholder="Rice, POS withdrawal, Hair appointment" />
      <FieldRow label="Original amount" value={amount} onChangeText={setAmount} placeholder="20000" keyboardType="numeric" />
      {debt.amountPaid > 0 ? (
        <Card style={styles.editWarningCard}>
          <Ionicons name="information-circle" size={20} color={colors.amber} />
          <View style={styles.rowCopy}>
            <Text style={styles.optionTitle}>Payment already recorded</Text>
            <Text style={styles.optionMeta}>
              This debt has {formatNaira(debt.amountPaid)} paid. If you reduce the original amount below that, the debt will be marked cleared.
            </Text>
          </View>
        </Card>
      ) : null}
      <Text style={styles.fieldLabel}>Due date</Text>
      <ChipRow
        values={['None', 'Today', 'Tomorrow', '7 days', 'Custom']}
        active={quickDateLabel(dueDate)}
        onChange={(value) => {
          if (value === 'Custom') {
            setShowDueDatePicker(true);
            setDueDate((current) => current || todayKey());
            return;
          }
          setShowDueDatePicker(false);
          setDueDate(dateFromQuickLabel(value));
        }}
      />
      {dueDate ? (
        <Pressable onPress={() => setShowDueDatePicker(true)} style={styles.dateSummary}>
          <Ionicons name="calendar" size={18} color={colors.green} />
          <Text style={styles.dateSummaryText}>Due {formatShortDate(dueDate)}</Text>
          <Text style={styles.dateSummaryAction}>Change</Text>
        </Pressable>
      ) : null}
      {showDueDatePicker ? (
        <DateTimePicker
          value={dueDate ? new Date(`${dueDate}T12:00:00`) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_, selectedDate) => {
            if (Platform.OS !== 'ios') setShowDueDatePicker(false);
            if (!selectedDate) return;
            setDueDate(todayKey(selectedDate));
          }}
        />
      ) : null}
      <FieldRow label="Private note" value={note} onChangeText={setNote} placeholder="Only you will see this" multiline />
      <Button label="Save Changes" icon="checkmark" disabled={!canSave} onPress={save} />
    </Sheet>
  );
}

function Sheet({ open, title, onClose, children }: React.PropsWithChildren<{ open: boolean; title: string; onClose: () => void }>) {
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} style={styles.iconButton}>
            <Ionicons name="close" size={22} color={colors.green} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ReceiptPreviewModal({
  preview,
  onClose,
  onSend
}: {
  preview: ReceiptPreview | null;
  onClose: () => void;
  onSend: () => void;
}) {
  return (
    <Modal visible={Boolean(preview)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.previewOverlay}>
        <Card style={styles.previewCard}>
          <View style={styles.headerRowTight}>
            <View style={styles.rowCopy}>
              <Text style={styles.cardTitle}>Send payment receipt?</Text>
              <Text style={styles.rowMeta}>Preview the WhatsApp message before it opens.</Text>
            </View>
            <Pressable onPress={onClose} style={styles.iconButton}>
              <Ionicons name="close" size={20} color={colors.green} />
            </Pressable>
          </View>
          <View style={styles.messagePreview}>
            <Text style={styles.messagePreviewText}>{preview?.message}</Text>
          </View>
          <Text style={styles.formHint}>Private notes are not included. The app will open WhatsApp with this receipt ready for you to send.</Text>
          <Button label="Open WhatsApp Receipt" icon="logo-whatsapp" onPress={onSend} />
          <Button label="Not Now" variant="ghost" onPress={onClose} />
        </Card>
      </View>
    </Modal>
  );
}

function buildPaymentReceiptMessage({
  customerName,
  businessName,
  amount,
  paymentDate,
  debtDescription,
  remainingBalance
}: {
  customerName: string;
  businessName: string;
  amount: number;
  paymentDate: string;
  debtDescription?: string;
  remainingBalance: number;
}) {
  const shop = businessName?.trim() || 'Who Dey Owe?';
  const forLine = debtDescription ? ` for ${debtDescription}` : '';
  return [
    `Hello ${customerName}, payment received${forLine}: ${formatNaira(amount)}.`,
    `Date: ${formatShortDate(paymentDate)}.`,
    `Remaining balance: ${formatNaira(remainingBalance)}.`,
    `Thank you. ${shop}`
  ].join('\n');
}

function BottomTabs({ activeTab, setActiveTab }: { activeTab: Tab; setActiveTab: (tab: Tab) => void }) {
  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={styles.navItem}>
            <View style={[styles.navIconWrap, active && styles.navIconActive]}>
              <Ionicons name={tab.icon} size={20} color={active ? colors.white : colors.muted} />
            </View>
            <Text style={[styles.navLabel, active && styles.navLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CustomerRow({ customer, onPress }: { customer: CustomerSummary; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.customerRow, pressed && styles.pressed]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{customer.name.trim().charAt(0).toUpperCase() || '?'}</Text>
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{customer.name}</Text>
        <Text style={styles.rowMeta}>{customer.phone || 'No phone'} · {customer.debtCount} active debt{customer.debtCount === 1 ? '' : 's'}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.balanceText, customer.status === 'Overdue' && styles.dangerText]}>{formatNaira(customer.balance)}</Text>
        <StatusChip status={customer.status} />
      </View>
    </Pressable>
  );
}

function DebtRow({
  debt,
  customer,
  helper,
  onPress,
  onReminder
}: {
  debt: Debt;
  customer: CustomerSummary;
  helper?: string;
  onPress: () => void;
  onReminder: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.debtRow, pressed && styles.pressed]}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{customer.name}</Text>
        <Text style={styles.rowMeta}>{debt.description} · {helper ?? formatShortDate(debt.dueDate)}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.balanceText}>{formatNaira(debt.balance)}</Text>
        <Pressable onPress={onReminder} style={styles.whatsappButton}>
          <Ionicons name="logo-whatsapp" size={18} color={colors.white} />
          <Text style={styles.whatsappButtonText}>Remind</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function DebtDetailCard({ debt, onEdit, onDelete }: { debt: Debt; onEdit: () => void; onDelete: () => void }) {
  return (
    <Card style={styles.debtDetail}>
      <View style={styles.headerRowTight}>
        <View style={styles.rowCopy}>
          <Text style={styles.cardTitle}>{debt.description}</Text>
          <Text style={styles.rowMeta}>Due {formatShortDate(debt.dueDate)}</Text>
        </View>
        <StatusChip status={debt.status} />
      </View>
      <View style={styles.debtStats}>
        <MiniStat label="Original" value={formatNaira(debt.originalAmount)} />
        <MiniStat label="Paid" value={formatNaira(debt.amountPaid)} />
        <MiniStat label="Balance" value={formatNaira(debt.balance)} danger={debt.status === 'Overdue'} />
      </View>
      {debt.note ? <Text style={styles.noteText}>{debt.note}</Text> : null}
      <View style={styles.debtActionRow}>
        <Pressable onPress={onEdit} style={styles.debtActionButton}>
          <Ionicons name="create" size={16} color={colors.green} />
          <Text style={styles.debtActionText}>Edit</Text>
        </Pressable>
        <Pressable onPress={onDelete} style={[styles.debtActionButton, styles.debtDeleteButton]}>
          <Ionicons name="trash" size={16} color={colors.danger} />
          <Text style={[styles.debtActionText, styles.debtDeleteText]}>Delete</Text>
        </Pressable>
      </View>
    </Card>
  );
}

function StatusChip({ status }: { status: string }) {
  const danger = status === 'Overdue';
  const cleared = status === 'Cleared';
  return (
    <View style={[styles.statusChip, danger && styles.statusDanger, cleared && styles.statusCleared]}>
      <Text style={[styles.statusText, danger && styles.statusDangerText, cleared && styles.statusClearedText]}>{status}</Text>
    </View>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={[styles.statLabel, danger && styles.dangerText]}>{label}</Text>
    </View>
  );
}

function MiniStat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.miniStat}>
      <Text style={[styles.miniStatValue, danger && styles.dangerText]}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

function ReportTile({ label, value, success, danger }: { label: string; value: string; success?: boolean; danger?: boolean }) {
  return (
    <Card style={styles.reportTile}>
      <Text style={styles.reportLabel}>{label}</Text>
      <Text style={[styles.reportValue, success && styles.successText, danger && styles.dangerText]}>{value}</Text>
    </Card>
  );
}

function SearchBox({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) {
  return (
    <View style={styles.searchBox}>
      <Ionicons name="search" size={19} color={colors.muted} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.mutedText} style={styles.searchInput} />
    </View>
  );
}

function CustomerDropdown({
  customers,
  selectedCustomerId,
  onSelect,
  emptyText
}: {
  customers: Customer[];
  selectedCustomerId: string;
  onSelect: (customerId: string) => void;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
  const filteredCustomers = customers.filter((customer) =>
    [customer.name, customer.phone].join(' ').toLowerCase().includes(query.trim().toLowerCase())
  );

  useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [selectedCustomerId]);

  if (!customers.length) {
    return <EmptyInline title="No customer yet" body={emptyText} />;
  }

  return (
    <View style={styles.dropdownWrap}>
      <Text style={styles.fieldLabel}>Customer</Text>
      <Pressable onPress={() => setOpen((current) => !current)} style={styles.dropdownButton}>
        <View style={styles.rowCopy}>
          <Text style={[styles.dropdownTitle, !selectedCustomer && styles.dropdownPlaceholder]}>
            {selectedCustomer?.name ?? 'Choose customer'}
          </Text>
          <Text style={styles.dropdownMeta}>{selectedCustomer?.phone || 'Search by name or phone'}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.green} />
      </Pressable>

      {open ? (
        <Card style={styles.dropdownPanel}>
          <SearchBox value={query} onChangeText={setQuery} placeholder="Search customers" />
          <View style={styles.dropdownList}>
            {filteredCustomers.length ? filteredCustomers.slice(0, 8).map((customer) => (
              <Pressable
                key={customer.id}
                onPress={() => onSelect(customer.id)}
                style={[styles.dropdownOption, customer.id === selectedCustomerId && styles.dropdownOptionActive]}
              >
                <View style={styles.rowCopy}>
                  <Text style={styles.dropdownOptionTitle}>{customer.name}</Text>
                  <Text style={styles.dropdownOptionMeta}>{customer.phone || 'No phone saved'}</Text>
                </View>
                {customer.id === selectedCustomerId ? <Ionicons name="checkmark" size={18} color={colors.green} /> : null}
              </Pressable>
            )) : <EmptyInline title="No match" body="Try another name or phone number." />}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

function ChipRow({ values, active, onChange }: { values: string[] | readonly string[]; active: string; onChange: (value: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {values.map((value) => {
        const isActive = value === active;
        return (
          <Pressable key={value} onPress={() => onChange(value)} style={[styles.chip, isActive && styles.chipActive]}>
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{value}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function EmptyInline({ title, body }: { title: string; body: string }) {
  return (
    <Card style={styles.emptyInline}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

function EmptyState({ title, body, icon }: { title: string; body: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <Card style={styles.emptyState}>
      <Ionicons name={icon} size={46} color={colors.green} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

function quickDateLabel(date: string) {
  if (!date) return 'None';
  if (date === todayKey()) return 'Today';
  if (date === addDays(1)) return 'Tomorrow';
  if (date === addDays(7)) return '7 days';
  return 'Custom';
}

function dateFromQuickLabel(label: string) {
  if (label === 'Today') return todayKey();
  if (label === 'Tomorrow') return addDays(1);
  if (label === '7 days') return addDays(7);
  return '';
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center'
  },
  lockScreen: {
    flex: 1,
    backgroundColor: colors.cream,
    padding: spacing.lg,
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 14
  },
  lockTitle: {
    color: colors.charcoal,
    fontSize: 34,
    lineHeight: 41,
    textAlign: 'center',
    fontFamily: fonts.extraBold
  },
  lockBody: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    fontFamily: fonts.medium
  },
  lockInput: {
    minHeight: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    color: colors.charcoal,
    fontSize: 20,
    letterSpacing: 4,
    textAlign: 'center',
    fontFamily: fonts.extraBold
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
    fontSize: 13,
    fontFamily: fonts.extraBold
  },
  screen: {
    flex: 1,
    backgroundColor: colors.cream
  },
  appWrap: {
    flex: 1,
    paddingBottom: 92
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 118,
    gap: 16
  },
  onboardingContent: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingTop: 44,
    gap: 22
  },
  brandMark: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card
  },
  brandInitial: {
    color: colors.amber,
    fontSize: 30,
    fontFamily: fonts.extraBold
  },
  onboardingHero: {
    minHeight: 330,
    borderRadius: radius.hero,
    backgroundColor: colors.green,
    padding: 22,
    justifyContent: 'flex-end',
    gap: 14,
    ...shadows.card
  },
  heroIcon: {
    width: 66,
    height: 66,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  onboardingTitle: {
    color: colors.white,
    fontSize: 38,
    lineHeight: 44,
    fontFamily: fonts.extraBold
  },
  onboardingBody: {
    color: colors.ledgerCream,
    fontSize: 17,
    lineHeight: 26,
    fontFamily: fonts.medium
  },
  promiseCard: {
    gap: 8,
    backgroundColor: colors.ledgerCream
  },
  promiseTitle: {
    color: colors.green,
    fontSize: 18,
    fontFamily: fonts.extraBold
  },
  promiseText: {
    color: colors.charcoal,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: fonts.semibold
  },
  footer: {
    marginTop: 'auto',
    gap: 10
  },
  progressDots: {
    minHeight: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8
  },
  progressDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.line
  },
  progressDotActive: {
    width: 24,
    backgroundColor: colors.green
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14
  },
  headerRowTight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  detailTitleWrap: {
    flex: 1
  },
  kicker: {
    color: colors.amber,
    fontSize: 13,
    fontFamily: fonts.extraBold
  },
  title: {
    color: colors.charcoal,
    fontSize: 30,
    lineHeight: 37,
    fontFamily: fonts.extraBold
  },
  headerIcon: {
    width: 52,
    height: 52,
    borderRadius: 20,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center'
  },
  roundButton: {
    width: 52,
    height: 52,
    borderRadius: 20,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card
  },
  totalCard: {
    backgroundColor: colors.green,
    borderColor: colors.green,
    gap: 12
  },
  totalLabel: {
    color: colors.ledgerCream,
    fontSize: 14,
    fontFamily: fonts.bold
  },
  totalValue: {
    color: colors.white,
    fontSize: 44,
    lineHeight: 52,
    fontFamily: fonts.extraBold
  },
  statRow: {
    flexDirection: 'row',
    gap: 10
  },
  stat: {
    flex: 1,
    minHeight: 70,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
    padding: 10,
    justifyContent: 'center'
  },
  statValue: {
    color: colors.white,
    fontSize: 17,
    fontFamily: fonts.extraBold
  },
  statLabel: {
    color: colors.ledgerCream,
    fontSize: 11,
    marginTop: 3,
    fontFamily: fonts.bold
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10
  },
  flexButton: {
    flex: 1
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  gridButton: {
    flexGrow: 1,
    flexBasis: '45%'
  },
  detailTabs: {
    minHeight: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 5,
    flexDirection: 'row',
    gap: 6,
    ...shadows.card
  },
  detailTab: {
    flex: 1,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 10
  },
  detailTabActive: {
    backgroundColor: colors.green
  },
  detailTabText: {
    color: colors.charcoal,
    fontSize: 14,
    fontFamily: fonts.extraBold
  },
  detailTabTextActive: {
    color: colors.white
  },
  detailTabCount: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.greenMist,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8
  },
  detailTabCountActive: {
    backgroundColor: 'rgba(255,255,255,0.18)'
  },
  detailTabCountText: {
    color: colors.green,
    fontSize: 12,
    fontFamily: fonts.extraBold
  },
  detailTabCountTextActive: {
    color: colors.white
  },
  emptyCard: {
    gap: 12,
    backgroundColor: colors.ledgerCream
  },
  emptyTitle: {
    color: colors.charcoal,
    fontSize: 18,
    fontFamily: fonts.extraBold
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.medium
  },
  sectionTitle: {
    color: colors.charcoal,
    fontSize: 19,
    fontFamily: fonts.extraBold,
    marginTop: 8
  },
  emptyInline: {
    gap: 4,
    backgroundColor: colors.paper
  },
  emptyState: {
    minHeight: 250,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10
  },
  debtRow: {
    minHeight: 86,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...shadows.card
  },
  recentRow: {
    minHeight: 74,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...shadows.card
  },
  rowCopy: {
    flex: 1,
    gap: 3
  },
  rowTitle: {
    color: colors.charcoal,
    fontSize: 16,
    fontFamily: fonts.extraBold
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.medium
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 7
  },
  balanceText: {
    color: colors.green,
    fontSize: 15,
    fontFamily: fonts.extraBold
  },
  dangerText: {
    color: colors.danger
  },
  successText: {
    color: colors.green
  },
  whatsappButton: {
    minWidth: 86,
    height: 38,
    borderRadius: 15,
    backgroundColor: colors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10
  },
  whatsappButtonText: {
    color: colors.white,
    fontSize: 12,
    fontFamily: fonts.extraBold
  },
  smallIcon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: colors.amberSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  smallIconSuccess: {
    backgroundColor: colors.successSoft
  },
  list: {
    gap: 12
  },
  customerRow: {
    minHeight: 96,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...shadows.card
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: colors.greenMist,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: {
    color: colors.green,
    fontSize: 18,
    fontFamily: fonts.extraBold
  },
  statusChip: {
    minHeight: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.amberSoft,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  statusDanger: {
    backgroundColor: colors.dangerSoft
  },
  statusCleared: {
    backgroundColor: colors.successSoft
  },
  statusText: {
    color: colors.amber,
    fontSize: 11,
    fontFamily: fonts.extraBold
  },
  statusDangerText: {
    color: colors.danger
  },
  statusClearedText: {
    color: colors.green
  },
  searchBox: {
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.card
  },
  searchInput: {
    flex: 1,
    color: colors.charcoal,
    fontSize: 15,
    fontFamily: fonts.semibold
  },
  dropdownWrap: {
    gap: 8
  },
  dropdownButton: {
    minHeight: 62,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  dropdownTitle: {
    color: colors.charcoal,
    fontSize: 16,
    fontFamily: fonts.extraBold
  },
  dropdownPlaceholder: {
    color: colors.mutedText
  },
  dropdownMeta: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: fonts.medium
  },
  dropdownPanel: {
    gap: 10,
    padding: 10
  },
  dropdownList: {
    gap: 6
  },
  dropdownOption: {
    minHeight: 58,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  dropdownOptionActive: {
    backgroundColor: colors.greenMist
  },
  dropdownOptionTitle: {
    color: colors.charcoal,
    fontSize: 14,
    fontFamily: fonts.extraBold
  },
  dropdownOptionMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
    fontFamily: fonts.medium
  },
  chipRow: {
    gap: 8,
    paddingRight: 24
  },
  chip: {
    minHeight: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  chipActive: {
    backgroundColor: colors.green,
    borderColor: colors.green
  },
  chipText: {
    color: colors.charcoal,
    fontSize: 13,
    fontFamily: fonts.bold
  },
  chipTextActive: {
    color: colors.white
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card
  },
  debtDetail: {
    gap: 14
  },
  cardTitle: {
    color: colors.charcoal,
    fontSize: 18,
    fontFamily: fonts.extraBold
  },
  debtStats: {
    flexDirection: 'row',
    gap: 10
  },
  debtActionRow: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12
  },
  debtActionButton: {
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.greenMist,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  debtDeleteButton: {
    backgroundColor: colors.dangerSoft
  },
  debtActionText: {
    color: colors.green,
    fontSize: 13,
    fontFamily: fonts.extraBold
  },
  debtDeleteText: {
    color: colors.danger
  },
  miniStat: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.md,
    backgroundColor: colors.paper,
    padding: 10,
    justifyContent: 'center'
  },
  miniStatValue: {
    color: colors.green,
    fontSize: 14,
    fontFamily: fonts.extraBold
  },
  miniStatLabel: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 3,
    fontFamily: fonts.bold
  },
  paymentRow: {
    gap: 4
  },
  noteText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fonts.medium
  },
  reportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  reportTile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 92,
    justifyContent: 'center',
    gap: 6
  },
  reportLabel: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: fonts.bold
  },
  reportValue: {
    color: colors.charcoal,
    fontSize: 20,
    fontFamily: fonts.extraBold
  },
  formCard: {
    gap: 14
  },
  formHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fonts.medium
  },
  optionRow: {
    minHeight: 78,
    borderRadius: radius.lg,
    backgroundColor: colors.greenMist,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white
  },
  checkboxActive: {
    backgroundColor: colors.green
  },
  optionTitle: {
    color: colors.charcoal,
    fontSize: 14,
    fontFamily: fonts.extraBold
  },
  optionMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.medium
  },
  dateSummary: {
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.greenMist,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  dateSummaryText: {
    flex: 1,
    color: colors.charcoal,
    fontSize: 15,
    fontFamily: fonts.extraBold
  },
  dateSummaryAction: {
    color: colors.green,
    fontSize: 13,
    fontFamily: fonts.extraBold
  },
  debtContextCard: {
    backgroundColor: colors.ledgerCream,
    gap: 6
  },
  contextTitle: {
    color: colors.charcoal,
    fontSize: 15,
    fontFamily: fonts.extraBold
  },
  contextAmount: {
    color: colors.green,
    fontSize: 18,
    fontFamily: fonts.extraBold
  },
  receiptHintCard: {
    backgroundColor: colors.greenMist,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12
  },
  editWarningCard: {
    backgroundColor: colors.amberSoft,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12
  },
  fieldLabel: {
    color: colors.charcoal,
    fontSize: 14,
    fontFamily: fonts.extraBold
  },
  input: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.charcoal
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.cream
  },
  sheetHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  sheetTitle: {
    color: colors.charcoal,
    fontSize: 27,
    fontFamily: fonts.extraBold
  },
  sheetContent: {
    padding: spacing.lg,
    paddingTop: 8,
    gap: 14
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.34)',
    padding: spacing.lg,
    justifyContent: 'center'
  },
  previewCard: {
    gap: 14
  },
  messagePreview: {
    borderRadius: radius.md,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14
  },
  messagePreviewText: {
    color: colors.charcoal,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: fonts.semibold
  },
  bottomNav: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    minHeight: 74,
    borderRadius: 26,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    ...shadows.card
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4
  },
  navIconWrap: {
    width: 42,
    height: 34,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center'
  },
  navIconActive: {
    backgroundColor: colors.green
  },
  navLabel: {
    color: colors.muted,
    fontSize: 10,
    fontFamily: fonts.bold
  },
  navLabelActive: {
    color: colors.green
  },
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 102,
    minHeight: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    ...shadows.card
  },
  toastText: {
    color: colors.white,
    fontSize: 14,
    fontFamily: fonts.extraBold
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }]
  }
});
