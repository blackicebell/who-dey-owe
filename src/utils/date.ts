export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return todayKey(date);
}

export function formatShortDate(value: string | null) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-NG', { month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

export function daysBetween(dateKey: string, referenceKey = todayKey()) {
  const first = new Date(`${dateKey}T12:00:00`).getTime();
  const second = new Date(`${referenceKey}T12:00:00`).getTime();
  return Math.round((first - second) / 86400000);
}

export function isOverdue(dateKey: string | null, balance: number) {
  return Boolean(dateKey && balance > 0 && daysBetween(dateKey) < 0);
}

export function isDueToday(dateKey: string | null, balance: number) {
  return Boolean(dateKey && balance > 0 && daysBetween(dateKey) === 0);
}

export function isDueThisWeek(dateKey: string | null, balance: number) {
  const diff = dateKey ? daysBetween(dateKey) : 999;
  return balance > 0 && diff >= 0 && diff <= 7;
}
