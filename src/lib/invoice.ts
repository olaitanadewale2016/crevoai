import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { getSettingGroup } from './settings';
import { EMAIL_THEME_PALETTES } from './email';
import { r2GetBuffer } from './r2';
import { formatCurrencyAmount, formatDateWithSettings } from './currency';
import { formatInvoiceNumber, ITransaction, ISubscription, IPlan } from '@/models/Billing';
import { IUser } from '@/models/User';
import { Language } from '@/models/System';
import { translateServer } from './i18n';

/**
 * Generates an exact branded PDF Invoice matching Laravel's InvoiceService + invoice.blade.php.
 * Fetches the site branding logo directly from Cloudflare R2 (never local public_path),
 * respects the 8 color_theme palettes, formats all 42 currencies, and supports RTL/Arabic layout.
 */
export async function generateInvoicePdf(params: {
  transaction: ITransaction;
  user: IUser | null;
  subscription?: ISubscription | null;
  plan?: IPlan | null;
}): Promise<{ buffer: Buffer; filename: string }> {
  const { transaction, user, subscription, plan } = params;
  const general = await getSettingGroup('general');
  const email = await getSettingGroup('email');

  const locale = user?.locale || general.default_locale || 'en';
  const langDoc = await Language.findOne({ code: locale }).lean().catch(() => null);
  const isRtl = Boolean(langDoc?.is_rtl ?? locale === 'ar');

  const colorTheme = general.color_theme || 'neutral';
  const palette = EMAIL_THEME_PALETTES[colorTheme] || EMAIL_THEME_PALETTES.neutral;
  const siteName = general.site_name || process.env.APP_NAME || 'Crevo';
  const siteTagline = general.site_tagline || '';
  const supportEmail = general.support_email || email.mail_from_address || '';
  const tz = general.timezone || 'UTC';
  const df = general.date_format || 'Y-m-d';

  const invoiceNumber = formatInvoiceNumber(transaction);
  const cleanFileNum = invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `invoice-${cleanFileNum}.pdf`;

  // Fetch branding logo bytes from Cloudflare R2 if configured (only PNG/JPEG supported by PDFKit)
  let logoBuffer: Buffer | null = null;
  if (general.site_logo && /\.(png|jpe?g)$/i.test(general.site_logo)) {
    try {
      logoBuffer = await r2GetBuffer('public', general.site_logo);
    } catch {
      logoBuffer = null;
    }
  }

  const t = (key: string) => translateServer(locale, key);
  const currency = transaction.currency || general.default_currency || 'USD';
  const amountFormatted = formatCurrencyAmount(transaction.amount, currency);
  const dateFormatted = formatDateWithSettings(transaction.transaction_date || transaction.created_at, df, tz);
  const generatedFormatted = formatDateWithSettings(new Date(), df, tz);

  const lineItemLabel = plan
    ? `${plan.name} (${plan.billing_period})`
    : transaction.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const regularFont = path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans.ttf');
  const boldFont = path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans-Bold.ttf');
  if (fs.existsSync(regularFont)) {
    doc.registerFont('DejaVu', regularFont);
    doc.font('DejaVu');
  }
  if (fs.existsSync(boldFont)) {
    doc.registerFont('DejaVu-Bold', boldFont);
  }
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width - 96;
  const alignStart = isRtl ? 'right' : 'left';
  const alignEnd = isRtl ? 'left' : 'right';

  // Header bar
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, isRtl ? doc.page.width - 148 : 48, 44, { fit: [100, 36] });
    } catch {
      doc.fontSize(20).fillColor(palette.primary).text(siteName, 48, 48, { width: pageWidth, align: alignStart });
    }
  } else {
    doc.fontSize(22).fillColor(palette.primary).text(siteName, 48, 48, { width: pageWidth, align: alignStart });
  }

  doc.fontSize(22).fillColor('#111827').text(t('INVOICE'), 48, 48, { width: pageWidth, align: alignEnd });
  doc.fontSize(10).fillColor('#6b7280').text(invoiceNumber, 48, 74, { width: pageWidth, align: alignEnd });

  if (siteTagline) {
    doc.fontSize(9).fillColor('#6b7280').text(siteTagline, 48, 76, { width: pageWidth / 2, align: alignStart });
  }
  if (supportEmail) {
    doc.fontSize(9).fillColor('#6b7280').text(supportEmail, 48, 90, { width: pageWidth / 2, align: alignStart });
  }

  // Divider
  doc.moveTo(48, 118).lineTo(48 + pageWidth, 118).strokeColor(palette.primary).lineWidth(1.5).stroke();

  // Bill To & Metadata Grid
  const metaY = 136;
  doc.fontSize(9).fillColor('#6b7280').text(t('BILL TO'), 48, metaY, { width: pageWidth / 2, align: alignStart });
  doc.fontSize(11).fillColor('#111827').text(user?.name || 'Customer', 48, metaY + 14, { width: pageWidth / 2, align: alignStart });
  doc.fontSize(10).fillColor('#4b5563').text(user?.email || '', 48, metaY + 30, { width: pageWidth / 2, align: alignStart });

  const rightX = 48 + pageWidth / 2;
  const metaRows = [
    [t('Invoice Number'), invoiceNumber],
    [t('Date'), dateFormatted],
    [t('Payment Method'), transaction.payment_method || '-'],
    [t('Status'), transaction.status.toUpperCase()],
  ];
  metaRows.forEach(([k, v], i) => {
    doc.fontSize(9).fillColor('#6b7280').text(`${k}: `, rightX, metaY + i * 16, { width: pageWidth / 2, align: alignEnd, continued: true });
    doc.fillColor('#111827').text(v);
  });

  // Table Header
  const tableTop = 225;
  doc.rect(48, tableTop, pageWidth, 28).fill(palette.primary);
  doc.fontSize(10).fillColor(palette.primaryForeground);
  if (isRtl) {
    doc.text(t('Amount'), 56, tableTop + 9, { width: 140, align: 'left' });
    doc.text(t('Description'), 200, tableTop + 9, { width: pageWidth - 160, align: 'right' });
  } else {
    doc.text(t('Description'), 56, tableTop + 9, { width: pageWidth - 160, align: 'left' });
    doc.text(t('Amount'), 48 + pageWidth - 148, tableTop + 9, { width: 140, align: 'right' });
  }

  // Table Row
  const rowY = tableTop + 38;
  doc.fontSize(10).fillColor('#111827');
  if (isRtl) {
    doc.text(amountFormatted, 56, rowY, { width: 140, align: 'left' });
    doc.text(lineItemLabel, 200, rowY, { width: pageWidth - 160, align: 'right' });
  } else {
    doc.text(lineItemLabel, 56, rowY, { width: pageWidth - 160, align: 'left' });
    doc.text(amountFormatted, 48 + pageWidth - 148, rowY, { width: 140, align: 'right' });
  }
  if (subscription?.starts_at && subscription?.renewal_at) {
    const periodText = `${formatDateWithSettings(subscription.starts_at, df, tz)} - ${formatDateWithSettings(subscription.renewal_at, df, tz)}`;
    doc.fontSize(8.5).fillColor('#6b7280').text(periodText, isRtl ? 200 : 56, rowY + 15, {
      width: pageWidth - 160,
      align: alignStart,
    });
  }

  doc.moveTo(48, rowY + 38).lineTo(48 + pageWidth, rowY + 38).strokeColor('#e5e7eb').lineWidth(1).stroke();

  // Totals
  const totY = rowY + 54;
  doc.fontSize(10).fillColor('#6b7280').text(`${t('Subtotal')}: ${amountFormatted}`, 48, totY, {
    width: pageWidth,
    align: alignEnd,
  });
  doc.fontSize(13).fillColor('#111827').text(`${t('Total')}: ${amountFormatted} ${currency}`, 48, totY + 20, {
    width: pageWidth,
    align: alignEnd,
  });

  // Paid Banner
  if (transaction.status === 'completed') {
    const boxY = totY + 60;
    doc.roundedRect(48, boxY, pageWidth, 44, 6).fill('#f0fdf4').stroke('#bbf7d0');
    doc.fontSize(10).fillColor('#166534').text(t('Thank you for your business! This invoice has been paid in full.'), 60, boxY + 16, {
      width: pageWidth - 24,
      align: 'center',
    });
  }

  // Footer
  doc.fontSize(8.5).fillColor('#9ca3af').text(
    `${siteName} • ${t('Generated on')} ${generatedFormatted}`,
    48,
    doc.page.height - 64,
    { width: pageWidth, align: 'center' }
  );

  doc.end();
  const buffer = await done;
  return { buffer, filename };
}
