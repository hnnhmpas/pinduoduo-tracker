/* =====================================================================
   CSV EXPORT  (Excel / Google Sheets friendly)
   - UTF-8 with a BOM so peso signs and Filipino characters open correctly in Excel
   - CRLF line endings, quotes doubled, fields with commas/quotes/newlines wrapped in quotes
   - Text that starts with = + @ - is prefixed with ' so a spreadsheet never runs it as a formula
   ===================================================================== */
import { normalizeHistory } from './statusHistory.js';

const needsQuote = (s) => /[",\r\n]/.test(s) || /^\s|\s$/.test(s);

export function csvCell(value, { text = false } = {}) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (text && /^[=+@-]/.test(s)) s = `'${s}`;
  return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  const head = headers.map((h) => csvCell(h)).join(',');
  const body = rows.map((r) => r.map((c) => (c && typeof c === 'object' && 'text' in c ? csvCell(c.text, { text: true }) : csvCell(c))).join(','));
  return '\ufeff' + [head, ...body].join('\r\n') + '\r\n';
}

const t = (v) => ({ text: v == null ? '' : v });
const daysBetween = (a, b) => {
  if (!a || !b) return '';
  const d = Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  return d >= 0 ? d : '';
};
const okLabel = (v) => (v === 'OK ✔' ? 'OK' : (v || ''));

export function ordersToCsv(orders) {
  const headers = ['ID', 'Item Name', 'Quantity', 'Unit Cost', 'Total Cost', 'Date Ordered', 'Batch', 'Shipping Status', 'Order Status',
    'Notes', 'Est. Delivery', 'Actual Delivery Date', 'Shipping Days', 'Archived', 'Photo Review', 'Reviewed On', 'Status History'];
  const rows = orders.map((o) => [
    o.id,
    t(o.name),
    o.qty,
    o.cost,
    (Number(o.qty) || 0) * (Number(o.cost) || 0),
    o.date || '',
    t(o.batch),
    o.shippingStatus || '',
    okLabel(o.orderStatus),
    t(o.notes),
    o.estDelivery || '',
    o.actualDeliveryDate || '',
    daysBetween(o.date, o.actualDeliveryDate),
    o.archived ? 'Yes' : 'No',
    o.shippingStatus === 'Delivered' ? (o.reviewed ? 'Reviewed' : 'Pending') : '',
    o.reviewedAt || '',
    normalizeHistory(o.statusHistory).map((e) => `${e.status}: ${e.date}`).join(' | '),
  ]);
  return toCsv(headers, rows);
}

export function wishlistToCsv(items) {
  const headers = ['ID', 'Item Name', 'Quantity', 'Initial Price', 'Latest Price', 'Price Change per Item', 'Initial Total', 'Latest Total'];
  const rows = items.map((w) => {
    const init = Number(w.initialCost) || 0;
    const latest = w.latestCost === '' || w.latestCost == null ? null : Number(w.latestCost);
    return [
      w.id, t(w.name), w.qty, w.initialCost, w.latestCost == null ? '' : w.latestCost,
      latest === null ? '' : latest - init,
      (Number(w.qty) || 0) * init,
      latest === null ? '' : (Number(w.qty) || 0) * latest,
    ];
  });
  return toCsv(headers, rows);
}
