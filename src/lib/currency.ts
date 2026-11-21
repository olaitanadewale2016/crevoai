export const CURRENCIES = [
  { value: 'USD', label: '$ - USD', symbol: '$' },
  { value: 'EUR', label: '€ - EUR', symbol: '€' },
  { value: 'GBP', label: '£ - GBP', symbol: '£' },
  { value: 'NGN', label: '₦ - NGN', symbol: '₦' },
  { value: 'GHS', label: 'GH₵ - GHS', symbol: 'GH₵' },
  { value: 'ZAR', label: 'R - ZAR', symbol: 'R' },
  { value: 'KES', label: 'KSh - KES', symbol: 'KSh' },
  { value: 'INR', label: '₹ - INR', symbol: '₹' },
  { value: 'JPY', label: '¥ - JPY', symbol: '¥' },
  { value: 'KRW', label: '₩ - KRW', symbol: '₩' },
  { value: 'CNY', label: '¥ - CNY', symbol: '¥' },
  { value: 'CAD', label: 'CA$ - CAD', symbol: 'CA$' },
  { value: 'AUD', label: 'A$ - AUD', symbol: 'A$' },
  { value: 'BRL', label: 'R$ - BRL', symbol: 'R$' },
  { value: 'MXN', label: 'MX$ - MXN', symbol: 'MX$' },
  { value: 'CHF', label: 'CHF - CHF', symbol: 'CHF' },
  { value: 'SEK', label: 'kr - SEK', symbol: 'kr' },
  { value: 'NOK', label: 'kr - NOK', symbol: 'kr' },
  { value: 'DKK', label: 'kr - DKK', symbol: 'kr' },
  { value: 'PLN', label: 'zł - PLN', symbol: 'zł' },
  { value: 'THB', label: '฿ - THB', symbol: '฿' },
  { value: 'SGD', label: 'S$ - SGD', symbol: 'S$' },
  { value: 'HKD', label: 'HK$ - HKD', symbol: 'HK$' },
  { value: 'MYR', label: 'RM - MYR', symbol: 'RM' },
  { value: 'PHP', label: '₱ - PHP', symbol: '₱' },
  { value: 'IDR', label: 'Rp - IDR', symbol: 'Rp' },
  { value: 'VND', label: '₫ - VND', symbol: '₫' },
  { value: 'AED', label: 'د.إ - AED', symbol: 'د.إ' },
  { value: 'SAR', label: '﷼ - SAR', symbol: '﷼' },
  { value: 'TRY', label: '₺ - TRY', symbol: '₺' },
  { value: 'RUB', label: '₽ - RUB', symbol: '₽' },
  { value: 'NZD', label: 'NZ$ - NZD', symbol: 'NZ$' },
  { value: 'TWD', label: 'NT$ - TWD', symbol: 'NT$' },
  { value: 'ILS', label: '₪ - ILS', symbol: '₪' },
  { value: 'CZK', label: 'Kč - CZK', symbol: 'Kč' },
  { value: 'HUF', label: 'Ft - HUF', symbol: 'Ft' },
  { value: 'RON', label: 'lei - RON', symbol: 'lei' },
  { value: 'BGN', label: 'лв - BGN', symbol: 'лв' },
  { value: 'CLP', label: 'CLP$ - CLP', symbol: 'CLP$' },
  { value: 'COP', label: 'COL$ - COP', symbol: 'COL$' },
  { value: 'PEN', label: 'S/ - PEN', symbol: 'S/' },
  { value: 'ARS', label: 'ARS$ - ARS', symbol: 'ARS$' },
];

export const CURRENCY_SYMBOLS: Record<string, string> = Object.fromEntries(
  CURRENCIES.map((c) => [c.value, c.symbol])
);

export const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', NGN: 'Nigerian Naira',
  GHS: 'Ghanaian Cedi', ZAR: 'South African Rand', KES: 'Kenyan Shilling', INR: 'Indian Rupee',
  JPY: 'Japanese Yen', KRW: 'South Korean Won', CNY: 'Chinese Yuan', CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar', BRL: 'Brazilian Real', MXN: 'Mexican Peso', CHF: 'Swiss Franc',
  SEK: 'Swedish Krona', NOK: 'Norwegian Krone', DKK: 'Danish Krone', PLN: 'Polish Zloty',
  THB: 'Thai Baht', SGD: 'Singapore Dollar', HKD: 'Hong Kong Dollar', MYR: 'Malaysian Ringgit',
  PHP: 'Philippine Peso', IDR: 'Indonesian Rupiah', VND: 'Vietnamese Dong', AED: 'UAE Dirham',
  SAR: 'Saudi Riyal', TRY: 'Turkish Lira', RUB: 'Russian Ruble', NZD: 'New Zealand Dollar',
  TWD: 'Taiwan Dollar', ILS: 'Israeli Shekel', CZK: 'Czech Koruna', HUF: 'Hungarian Forint',
  RON: 'Romanian Leu', BGN: 'Bulgarian Lev', CLP: 'Chilean Peso', COP: 'Colombian Peso',
  PEN: 'Peruvian Sol', ARS: 'Argentine Peso',
};

export const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

export function getSupportedCurrencies(): string[] {
  return CURRENCIES.map((c) => c.value);
}

export function getCurrencyOptions() {
  return CURRENCIES.map((c) => ({
    code: c.value,
    symbol: c.symbol,
    name: CURRENCY_NAMES[c.value] || c.value,
  }));
}

export function getCurrencyInfo(code: string) {
  return CURRENCIES.find((c) => c.value === (code || '').toUpperCase());
}

export function isZeroDecimalCurrency(currency: string = 'USD'): boolean {
  return ZERO_DECIMAL_CURRENCIES.has((currency || 'USD').toUpperCase());
}

export function getDecimalPlaces(currency: string = 'USD'): number {
  return isZeroDecimalCurrency(currency) ? 0 : 2;
}

export function getCurrencySymbol(currency: string = 'USD'): string {
  const upper = (currency || 'USD').toUpperCase();
  return CURRENCY_SYMBOLS[upper] || `${upper} `;
}

export function formatCurrency(amount: number, currency: string = 'USD', locale: string = 'en-US'): string {
  const decimals = getDecimalPlaces(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: (currency || 'USD').toUpperCase(),
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    return formatCurrencyAmount(amount, currency);
  }
}

export function formatCurrencyAmount(amount: number, code = 'USD', showCode = false): string {
  const upper = (code || 'USD').toUpperCase();
  const symbol = getCurrencySymbol(upper);
  const decimals = getDecimalPlaces(upper);
  const formatted = Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return showCode ? `${symbol}${formatted} ${upper}` : `${symbol}${formatted}`;
}

export function toSmallestUnit(amount: number, currency: string = 'USD'): number {
  return isZeroDecimalCurrency(currency) ? Math.round(amount) : Math.round(amount * 100);
}

export function fromSmallestUnit(amount: number, currency: string = 'USD'): number {
  return isZeroDecimalCurrency(currency) ? amount : amount / 100;
}

export function formatDateWithSettings(
  date: Date | string | null | undefined,
  format = 'Y-m-d',
  timezone = 'UTC',
  includeTime = false
): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(d);

    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    const year = get('year');
    const monthNum = get('month');
    const day = get('day');
    const dayUnpadded = String(Number(day));
    const longMonth = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', month: 'long' }).format(d);
    const shortMonth = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', month: 'short' }).format(d);

    let out: string;
    switch (format) {
      case 'd/m/Y':
        out = `${day}/${monthNum}/${year}`;
        break;
      case 'm/d/Y':
        out = `${monthNum}/${day}/${year}`;
        break;
      case 'F j, Y':
        out = `${longMonth} ${dayUnpadded}, ${year}`;
        break;
      case 'M j, Y':
        out = `${shortMonth} ${dayUnpadded}, ${year}`;
        break;
      case 'Y-m-d':
      default:
        out = `${year}-${monthNum}-${day}`;
        break;
    }

    if (includeTime) {
      out += ` ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
    }
    return out;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
