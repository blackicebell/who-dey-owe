export function formatNaira(amount = 0): string {
  return `₦${Math.max(0, Math.round(amount)).toLocaleString('en-NG')}`;
}

export function parseMoney(raw: string): number {
  const normalized = raw
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/₦/g, '')
    .replace(/ngn/g, '')
    .trim();

  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(k|m|thousand|million)?/i);
  if (!match) return 0;

  const value = Number(match[1]);
  const unit = match[2];
  if (Number.isNaN(value)) return 0;
  if (unit === 'k' || unit === 'thousand') return value * 1000;
  if (unit === 'm' || unit === 'million') return value * 1000000;
  return value;
}
