/* =====================================================================
   STATUS HISTORY
   ---------------------------------------------------------------------
   Every order keeps  statusHistory: [{ status, date: 'YYYY-MM-DD' }, ...]
   (oldest first). A new entry is logged whenever the shipping status
   changes. From that history we learn how long orders REALLY spend in
   each stage, and use it to give smarter delivery estimates.
   Pure functions only: no React, no Firebase.
   ===================================================================== */

// Stages an order passes through on the way to Delivered (Undelivered is a dead end, never timed)
export const PIPELINE = [
  'Ordered',
  'At China Warehouse',
  'Dispatched / China Customs',
  'In Transit to PH',
  'PH Customs Clearance',
  'PH Hub / Out for Local Delivery',
];

// Short names for the dashboard
export const STAGE_SHORT = {
  'Ordered': 'Ordered',
  'At China Warehouse': 'China Warehouse',
  'Dispatched / China Customs': 'China Customs',
  'In Transit to PH': 'In Transit',
  'PH Customs Clearance': 'PH Customs',
  'PH Hub / Out for Local Delivery': 'PH Hub',
};

export const MIN_STAGE_SAMPLES = 2;   // deliveries needed before a stage-based estimate is trusted
export const MIN_TOTAL_SAMPLES = 3;   // deliveries needed before the overall-average estimate is trusted

const DAY = 86400000;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

// Today in the user's own timezone (toISOString would give the UTC day, a day behind in the early morning in PH)
export const localDateStr = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
export const addDays = (s, n) => new Date(parse(s) + Math.round(n) * DAY).toISOString().slice(0, 10);

// Clean + sort (oldest first; entries on the same day keep the order they were logged in)
export function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e && typeof e.status === 'string' && e.status && isDate(e.date))
    .sort((a, b) => (a.e.date === b.e.date ? a.i - b.i : a.e.date < b.e.date ? -1 : 1))
    .map(({ e }) => ({ status: e.status, date: e.date }));
}

// Which date goes on a new entry? Delivered uses the real delivery date when there is one.
export const entryDateFor = (status, { actualDeliveryDate, fallback }) =>
  (status === 'Delivered' && isDate(actualDeliveryDate) ? actualDeliveryDate : fallback);

// History for a brand-new order. "Ordered" starts on the order date; anything else starts on `fallback`.
export function initialHistory(status, { orderDate, actualDeliveryDate, fallback }) {
  if (!status) return [];
  if (status === 'Ordered') return [{ status, date: isDate(orderDate) ? orderDate : fallback }];
  return [{ status, date: entryDateFor(status, { actualDeliveryDate, fallback }) }];
}

// Log a status change. Older orders have no history: if they were still "Ordered" we can safely start
// the history on their order date; otherwise we only start recording from this change (no guessing).
export function appendStatusChange(history, oldStatus, newStatus, date, orderDate) {
  let h = normalizeHistory(history);
  if (!newStatus || oldStatus === newStatus) return h;
  if (h.length === 0 && oldStatus === 'Ordered' && isDate(orderDate)) h = [{ status: 'Ordered', date: orderDate }];
  const last = h[h.length - 1];
  if (last && last.status === newStatus) return h;
  return [...h, { status: newStatus, date }];
}

// Manual edits applied to many orders at once (Batch Edit).
//   { action: 'set', status, date }  -> correct that status's date, or add the status if the order doesn't have it
//   { action: 'remove', status }     -> drop that status from the history
export function applyHistoryEdits(history, edits) {
  let h = normalizeHistory(history);
  for (const e of edits || []) {
    if (!e || !e.status) continue;
    if (e.action === 'remove') {
      h = h.filter((x) => x.status !== e.status);
    } else if (e.action === 'set' && isDate(e.date)) {
      let idx = -1;
      h.forEach((x, i) => { if (x.status === e.status) idx = i; });
      h = idx >= 0 ? h.map((x, i) => (i === idx ? { ...x, date: e.date } : x)) : [...h, { status: e.status, date: e.date }];
      h = normalizeHistory(h);
    }
  }
  return h;
}

// History an edit form should start from (adds the safe "Ordered" seed for untouched legacy orders)
export function historyForEditing(order) {
  const h = normalizeHistory(order.statusHistory);
  if (h.length === 0 && order.shippingStatus === 'Ordered' && isDate(order.date)) return [{ status: 'Ordered', date: order.date }];
  return h;
}

/* ---------- learning from the history ---------- */

// Average days spent IN each stage. Only clean, adjacent steps count (e.g. China Customs -> In Transit),
// so a skipped status never inflates the stage before it.
export function computeStageStats(orders) {
  const acc = {};
  PIPELINE.forEach((s) => { acc[s] = { total: 0, n: 0 }; });
  for (const o of orders) {
    const h = normalizeHistory(o.statusHistory);
    for (let i = 0; i < h.length - 1; i++) {
      const a = PIPELINE.indexOf(h[i].status);
      if (a < 0) continue;
      const b = h[i + 1].status === 'Delivered' ? PIPELINE.length : PIPELINE.indexOf(h[i + 1].status);
      if (b !== a + 1) continue;
      const d = daysBetween(h[i].date, h[i + 1].date);
      if (d < 0) continue;
      acc[h[i].status].total += d;
      acc[h[i].status].n += 1;
    }
  }
  const out = {};
  PIPELINE.forEach((s) => { out[s] = { n: acc[s].n, avg: acc[s].n ? acc[s].total / acc[s].n : null }; });
  return out;
}

// Average days still to go, measured from the day an order ENTERED each stage until it was delivered.
// Works even when some statuses were skipped.
export function computeRemainingStats(orders) {
  const acc = {};
  PIPELINE.forEach((s) => { acc[s] = { total: 0, n: 0 }; });
  for (const o of orders) {
    const h = normalizeHistory(o.statusHistory);
    const deliveredAt = (h.find((e) => e.status === 'Delivered') || {}).date;
    if (!deliveredAt) continue;
    const seen = new Set();
    for (const e of h) {
      if (e.status === 'Delivered') break;
      if (!PIPELINE.includes(e.status) || seen.has(e.status)) continue;
      const d = daysBetween(e.date, deliveredAt);
      if (d < 0) continue;
      seen.add(e.status);
      acc[e.status].total += d;
      acc[e.status].n += 1;
    }
  }
  const out = {};
  PIPELINE.forEach((s) => { out[s] = { n: acc[s].n, avg: acc[s].n ? acc[s].total / acc[s].n : null }; });
  return out;
}

// Average order-date -> delivery-date over every order that has both
export function computeTotalStats(orders) {
  const days = orders
    .filter((o) => isDate(o.date) && isDate(o.actualDeliveryDate))
    .map((o) => daysBetween(o.date, o.actualDeliveryDate))
    .filter((d) => d >= 0);
  return { n: days.length, avg: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null };
}

/* ---------- smarter delivery estimate ----------
   1) 'stage'   : the day the order entered its current stage + how long your past orders took from that stage to delivery
   2) 'average' : the order date + your average total shipping time
   3) null      : not enough data yet -> keep the standard estimate
   An estimate is never in the past: if an order is already later than usual, it shows "tomorrow". */
export function smartEstimate(order, remaining, total, today) {
  const st = order.shippingStatus;
  if (!st || st === 'Delivered' || st === 'Undelivered') return null;

  const h = normalizeHistory(order.statusHistory);
  const entered = [...h].reverse().find((e) => e.status === st);
  const r = remaining && remaining[st];
  if (entered && r && r.n >= MIN_STAGE_SAMPLES) {
    const eta = addDays(entered.date, r.avg);
    return { date: eta < today ? addDays(today, 1) : eta, method: 'stage', n: r.n, avg: r.avg };
  }
  if (total && total.n >= MIN_TOTAL_SAMPLES && isDate(order.date)) {
    const eta = addDays(order.date, total.avg);
    return { date: eta < today ? addDays(today, 1) : eta, method: 'average', n: total.n, avg: total.avg };
  }
  return null;
}

// Averages are shown as whole days (no decimals). Anything under half a day shows as "<1".
export const fmtDays = (n) => {
  if (n == null) return '-';
  const r = Math.round(n);
  return r === 0 && n > 0 ? '<1' : String(r);
};
