import React, { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { ShoppingBag, Lightbulb } from 'lucide-react';

/* =====================================================================
   ONBOARDING TOUR  —  steps, copy, spotlight overlay and welcome modal
   ---------------------------------------------------------------------
   Each step is DECLARATIVE: it says which part of the UI it needs
   (tab, which modal is open, whether a row is ticked, which sample
   entry must exist). App.jsx applies that desired state whenever the
   step changes, so Next, Back and language switching all behave the
   same way and nothing has to be "undone" by hand.

   Fields:
     id          unique key (also used to find jump targets)
     target      value of the data-tour="..." attribute to spotlight
     part        1 | 2 | 3 | 4 | 5   (shown as a small label in the tooltip)
     tab         'orders' | 'wishlist'  – tab that must be showing
     modal       null | 'order' | 'wishlist' | 'batch' | 'photo-review'
     sample      null | 'order' | 'order-delivered' | 'order-archived' | 'wishlist'
                 – a row must exist (a real entry made during the tour, or a
                 temporary sample; the delivered/archived kinds are always samples)
     checkRow    true → the target order's row checkbox is ticked
     interactive true → the user may click/type inside the spotlight
                 (everything else stays blocked)
   ===================================================================== */

export const TOUR_SAMPLE_ORDER_ID = 'tour-sample-order';
export const TOUR_SAMPLE_WISHLIST_ID = 'tour-sample-wishlist';

export const TOUR_PARTS = {
  1: { en: 'Adding an Order', tl: 'Pag-log ng Order' },
  2: { en: 'Managing Orders & Batch Editing', tl: 'Pag-manage ng Orders at Batch Edit' },
  3: { en: 'Archive & Restore', tl: 'Archive at Restore' },
  4: { en: 'Photo Review', tl: 'Photo Review' },
  5: { en: 'Wishlist & Moving Items', tl: 'Wishlist at Paglipat ng Items' },
};

export const TOUR_STEPS = [
  /* ---------- PART 1: ADDING AN ORDER ---------- */
  {
    id: 'add-order-btn', target: 'add-btn', part: 1, tab: 'orders', modal: null,
    text: {
      en: 'Log your first order here!',
      tl: 'Pindutin para mailista ang iyong unang order!',
    },
  },
  {
    id: 'order-name', target: 'order-name', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: 'Put the name of the order.',
      tl: 'Ilagay ang pangalan ng order.',
    },
  },
  {
    id: 'order-qty', target: 'order-qty', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: 'Enter how many times you checked out an item.',
      tl: 'I-enter kung ilang beses chineckout ang isang item.',
    },
  },
  {
    id: 'order-cost', target: 'order-cost', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: 'Put the exact amount that you paid for the order.',
      tl: 'Ilagay ang eksaktong amount na binayaran sa order.',
    },
  },
  {
    id: 'order-date', target: 'order-date', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: "This automatically fills up today's date, but if you need to adjust it, you can always change it.",
      tl: 'Automatic na nafi-fill up dito ang date ngayon, pero kung kailangan mang i-adjust, pwede mong palitan anytime.',
    },
  },
  {
    id: 'order-batch', target: 'order-batch', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: 'Adjust the batch here. Tap one of your recent batches, press + New for the next batch number, or open More to browse batches that are still open. Finished batches stay tucked away, so the list never gets cluttered.',
      tl: 'Pwede mong i-adjust ang batch dito. Pindutin ang isa sa mga kamakailang batch, pindutin ang + New para sa susunod na batch number, o buksan ang More para makita ang mga batch na bukas pa. Nakatago ang mga tapos na, kaya hindi nagiging magulo ang listahan.',
    },
  },
  {
    id: 'order-shipping', target: 'order-shipping', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: 'You can put the shipping status of your order here. Newly logged orders automatically default to "Ordered"—later when the status changes, you can update it using the Edit button.',
      tl: 'Dito mo ilalagay ang shipping status ng iyong orders. Sa kada order na ilo-log mo, automatic itong naka-set as "Ordered"—pag gumalaw na ang status ng iyong order, pwede mo itong palitan sa Edit button.',
    },
  },
  {
    id: 'order-status', target: 'order-status', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: 'Once you receive the order, or if you encounter an issue with it, you can log it here. For now, you can leave it as is.',
      tl: "Pag na-receive mo na ang order mo, o kung nagkaproblema man, pwede mong i-log 'yan dito. Sa ngayon, pwede mo munang hindi galawin ito.",
    },
  },
  {
    id: 'order-actual', target: 'order-actual', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: 'Once you receive an order, update its actual delivery date here. This helps you track how many calendar days your order took to arrive. For newly added orders, leave this blank for now and edit it later once it arrives.',
      tl: 'Pag dumating na ang iyong order, pwede mong i-update ang actual delivery date nito. Makakatulong ito para ma-track mo kung ilang calendar days ang hinintay mo bago dumating ang iyong order. Sa mga bagong log na orders, pwedeng hindi mo muna ito lagyan—i-edit mo na lang pag dumating na mismo ang order.',
    },
  },
  {
    id: 'order-notes', target: 'order-notes', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: 'You can leave optional notes here.',
      tl: 'Pwede kang maglagay ng optional notes dito.',
    },
  },
  {
    id: 'order-save', target: 'order-save', part: 1, tab: 'orders', modal: 'order', interactive: true,
    text: {
      en: "Don't forget to save your entry!",
      tl: "'Wag kalimutang i-save ang entry mo!",
    },
  },

  /* ---------- PART 2: MANAGING ORDERS & BATCH EDITING ---------- */
  {
    id: 'order-row', target: 'order-row', part: 2, tab: 'orders', modal: null, sample: 'order',
    text: {
      en: 'This is your inputted order entry.',
      tl: 'Ito ang iyong ni-log na order.',
    },
  },
  {
    id: 'order-total', target: 'order-total', part: 2, tab: 'orders', modal: null, sample: 'order',
    text: {
      en: 'Automatically computes the total cost from your logged quantity and unit cost.',
      tl: 'Automatic na naka-compute ang total cost mula sa ni-log na quantity at unit cost.',
    },
  },
  {
    id: 'order-est', target: 'order-est', part: 2, tab: 'orders', modal: null, sample: 'order',
    text: {
      en: 'Shows you an estimated delivery date. Your order could arrive earlier or later than this date.',
      tl: "Dito makikita kung kailan maaaring ma-receive ang order—pwedeng mas mabilis o mas matagal dumating ang order mula sa date na 'to.",
    },
  },
  {
    id: 'order-edit', target: 'order-edit', part: 2, tab: 'orders', modal: null, sample: 'order',
    text: {
      en: 'Edit any information from your order here.',
      tl: 'Pwedeng i-edit ang kahit anong information sa iyong order mula dito.',
    },
  },
  {
    id: 'order-delete', target: 'order-delete', part: 2, tab: 'orders', modal: null, sample: 'order',
    text: {
      en: "Delete any orders that you've logged. Deleted orders are permanently removed!",
      tl: 'Burahin ang orders na ni-log. Ang mga order na dinelete ay permanente nang mawawala sa tracker!',
    },
  },
  {
    id: 'order-check', target: 'order-check', part: 2, tab: 'orders', modal: null, sample: 'order',
    text: {
      en: "Don't want to edit one by one? Select multiple orders here and edit them by batch.",
      tl: 'Maramihan ang kailangang i-edit? Pwedeng i-select ang kahit ilang orders dito at i-batch edit sila.',
    },
  },
  {
    id: 'batch-btn', target: 'batch-btn', part: 2, tab: 'orders', modal: null, sample: 'order', checkRow: true,
    text: {
      en: 'Click here to open the batch editor for your selected orders.',
      tl: 'Pindutin ito para buksan ang batch editor para sa mga piniling orders.',
    },
  },
  {
    id: 'batch-modal', target: 'batch-modal', part: 2, tab: 'orders', modal: 'batch', sample: 'order', checkRow: true,
    text: {
      en: 'Edit what you want to update across all selected orders and click save.',
      tl: 'I-edit ang kailangang palitan at i-click ang save.',
    },
  },

  {
    id: 'batch-filter', target: 'batch-filter', part: 2, tab: 'orders', modal: null, sample: 'order',
    text: {
      en: 'Filter your orders by batch here. Tap a recent batch, or open More to browse the batches that are still open. Finished batches are folded away until you need them.',
      tl: 'Dito mo mafi-filter ang orders ayon sa batch. Pindutin ang isang kamakailang batch, o buksan ang More para makita ang mga batch na bukas pa. Nakatago muna ang mga tapos na hanggang kailanganin mo.',
    },
  },

  /* ---------- PART 3: ARCHIVE & RESTORE ---------- */
  {
    id: 'order-archive', target: 'order-archive', part: 3, tab: 'orders', modal: null, sample: 'order-delivered',
    text: {
      en: 'Once an order is marked Delivered, an Archive button appears on its row. Archiving moves it out of General Orders so your tracker stays tidy.',
      tl: 'Kapag naka-mark na as Delivered ang order, may lalabas na Archive button sa row nito. Kapag ni-archive, aalis ito sa General Orders para hindi magulo ang tracker mo.',
    },
  },
  {
    id: 'archive-bulk', target: 'archive-bulk', part: 3, tab: 'orders', modal: null, sample: 'order-delivered',
    text: {
      en: 'Have lots of delivered orders? Click here to archive all the delivered orders currently shown in one go.',
      tl: 'Maraming delivered orders? Pindutin ito para i-archive nang sabay-sabay ang lahat ng delivered orders na nakikita ngayon.',
    },
  },
  {
    id: 'tab-archive', target: 'tab-archive', part: 3, tab: 'archive', modal: null, sample: 'order-archived',
    text: {
      en: "Archived orders live here. They're no longer counted in your General Orders dashboard, but nothing is deleted.",
      tl: 'Dito makikita ang mga na-archive na orders. Hindi na sila kasama sa dashboard ng General Orders, pero walang nabubura.',
    },
  },
  {
    id: 'archived-restore', target: 'archived-restore', part: 3, tab: 'archive', modal: null, sample: 'order-archived',
    text: {
      en: 'Changed your mind? Click Restore to send the order right back to its original spot in General Orders. Its info is added to the dashboard again.',
      tl: 'Nagbago ang isip? Pindutin ang Restore para bumalik ang order sa dati nitong pwesto sa General Orders. Kasama na ulit ang info nito sa dashboard.',
    },
  },

  /* ---------- PART 4: PHOTO REVIEW ---------- */
  {
    id: 'photo-review-btn', target: 'photo-review-btn', part: 4, tab: 'orders', modal: null, sample: 'order-delivered',
    text: {
      en: 'Delivered orders also get a camera button, in General Orders and in the Archive. Click it to Generate Photo Review: a ready-to-share picture of your order with your star rating.',
      tl: 'Kapag Delivered na ang order, may lalabas ding camera button sa row nito, sa General Orders at sa Archive. Pindutin ito para mag-Generate Photo Review: isang litratong may star rating, handang i-share.',
    },
  },
  {
    id: 'pr-photos', target: 'pr-photos', part: 4, tab: 'orders', modal: 'photo-review', sample: 'order-delivered',
    text: {
      en: 'Upload the actual photo of what you received, then a screenshot of the listing (showing the product picture and its name). Both are centered on the subject automatically. You can drag or zoom to fine-tune.',
      tl: 'I-upload ang actual na litrato ng natanggap mo, at ang screenshot ng listing (kita ang picture at pangalan ng item). Awtomatiko silang nasesentro sa mismong item. Pwede mo ring i-drag o i-zoom para ayusin.',
    },
  },
  {
    id: 'pr-rating', target: 'pr-rating', part: 4, tab: 'orders', modal: 'photo-review', sample: 'order-delivered',
    text: {
      en: 'Rate the order from 1 to 5 stars, just like in your favorite shopping app.',
      tl: 'I-rate ang order mula 1 hanggang 5 stars, parang sa mga shopping app.',
    },
  },
  {
    id: 'pr-generate', target: 'pr-generate', part: 4, tab: 'orders', modal: 'photo-review', sample: 'order-delivered',
    text: {
      en: 'Generate & Download creates the image on your device. Nothing is saved: your photos are discarded right after you download.',
      tl: 'Pindutin ang Generate & Download para magawa at ma-download ang image sa device mo. Walang nase-save: mabubura ang mga photo mo pagkatapos mag-download.',
    },
  },

  /* ---------- PART 5: WISHLIST TAB & MOVING ITEMS ---------- */
  {
    id: 'tab-wishlist', target: 'tab-wishlist', part: 5, tab: 'orders', modal: null, sample: 'order',
    text: {
      en: 'Here you can log items that are on your wishlist. It helps you track how many items you are looking to check out, the cost, and if the items get cheaper.',
      tl: 'Dito, pwede mong ilista ang mga items na nasa wishlist mo. Makikita mo kung ilang items na ang gusto mong i-checkout, kung magkano, at kung mas nagmura ba sila.',
    },
  },
  {
    id: 'add-wishlist-btn', target: 'add-btn', part: 5, tab: 'wishlist', modal: null,
    text: {
      en: 'Click here to add an item to your wishlist.',
      tl: 'Pindutin ito para magdagdag ng item sa iyong wishlist.',
    },
  },
  {
    id: 'wl-name', target: 'wl-name', part: 5, tab: 'wishlist', modal: 'wishlist', interactive: true,
    text: {
      en: 'Put the name of the item here.',
      tl: 'Ilagay ang pangalan ng item dito.',
    },
  },
  {
    id: 'wl-qty', target: 'wl-qty', part: 5, tab: 'wishlist', modal: 'wishlist', interactive: true,
    text: {
      en: 'Put the desired quantity of the item you want to check out.',
      tl: 'Ilagay dito kung ilang quantity ng item ang gusto mong i-checkout.',
    },
  },
  {
    id: 'wl-initial', target: 'wl-initial', part: 5, tab: 'wishlist', modal: 'wishlist', interactive: true,
    text: {
      en: 'Enter the price of the item when you first saw it.',
      tl: 'Ilagay dito kung magkano ang item nung una mo itong nakita.',
    },
  },
  {
    id: 'wl-latest', target: 'wl-latest', part: 5, tab: 'wishlist', modal: 'wishlist', interactive: true,
    text: {
      en: 'Enter the new price of the item after checking again with vouchers or promos applied. This can be left blank if there are no changes to the price.',
      tl: 'Ilagay dito kung magkano na ang item matapos i-check ulit nang may naka-apply na voucher o promo. Maaari itong hindi lagyan kung wala pang changes sa amount.',
    },
  },
  {
    id: 'wl-add', target: 'wl-add', part: 5, tab: 'wishlist', modal: 'wishlist', interactive: true,
    text: {
      en: "Don't forget to add your entry!",
      tl: "'Wag kalimutang i-add ang entry mo!",
    },
  },
  {
    id: 'wl-row', target: 'wl-row', part: 5, tab: 'wishlist', modal: null, sample: 'wishlist',
    text: {
      en: 'This is your inputted wishlist item entry.',
      tl: 'Ito ang iyong ni-log na item.',
    },
  },
  {
    id: 'wl-flag', target: 'wl-flag', part: 5, tab: 'wishlist', modal: null, sample: 'wishlist',
    text: {
      en: 'If there is a change in the price of the item (like a price drop), it will show here.',
      tl: 'Kung may pagbabago sa presyo ng item, lalabas ito dito.',
    },
  },
  {
    id: 'wl-edit', target: 'wl-edit', part: 5, tab: 'wishlist', modal: null, sample: 'wishlist',
    text: {
      en: 'Edit any information from your wishlist item here.',
      tl: 'Pwedeng i-edit ang kahit anong information sa iyong wishlist item mula dito.',
    },
  },
  {
    id: 'wl-move', target: 'wl-move', part: 5, tab: 'wishlist', modal: null, sample: 'wishlist',
    text: {
      en: 'Once a wishlist item gets ordered, click Move to automatically transfer it to the general order tracker. If moved by mistake, click Undo to move it back.',
      tl: 'Pag ang wishlist item ay na-order na, pwedeng pindutin ang Move para malipat ang order mo sa general tracker. Kung namali ng pagkakalipat, pwedeng pindutin ang Undo para mabalik sa wishlist tracker.',
    },
  },
  {
    id: 'wl-delete', target: 'wl-delete', part: 5, tab: 'wishlist', modal: null, sample: 'wishlist',
    text: {
      en: "Delete any items that you've logged. Deleted items are permanently removed!",
      tl: 'Burahin ang items na ni-log. Ang mga item na dinelete ay permanente nang mawawala sa tracker!',
    },
  },
];

export const TOUR_TOTAL = TOUR_STEPS.length;
// Where the tour jumps to if the user submits a REAL entry while a form is open.
export const FIRST_ORDER_ROW_STEP = TOUR_STEPS.findIndex(s => s.id === 'order-row');
export const FIRST_WISHLIST_ROW_STEP = TOUR_STEPS.findIndex(s => s.id === 'wl-row');

/* ---------------------------------------------------------------------
   Small bits of UI copy (everything that is NOT a tour step)
   --------------------------------------------------------------------- */
const UI = {
  en: {
    step: (n, t) => `Step ${n} of ${t}`,
    tryIt: 'Feel free to type here — or just press Next to keep going.',
  },
  tl: {
    step: (n, t) => `Step ${n} of ${t}`,
    tryIt: 'Pwede kang mag-type dito — o pindutin lang ang Next para magpatuloy.',
  },
};

const C = {
  cream: 'var(--c-fffdfa)', sand: 'var(--c-fcf6f0)', border: 'var(--c-e6ccb2)', brown: 'var(--c-5c4033)',
  brownSoft: 'var(--c-7f5539)', muted: 'var(--c-8c7a6b)', yellow: 'var(--c-ffd166)', pink: 'var(--c-ffafcc)', pinkSoft: 'var(--c-ffc8dd)',
};

const pillBtn = (variant = 'light', disabled = false) => {
  const base = {
    light: { bg: C.cream, color: C.brownSoft, border: `1px solid ${C.border}` },
    primary: { bg: C.yellow, color: C.brown, border: `1px solid ${C.border}` },
    pink: { bg: C.pink, color: C.brown, border: `1px solid ${C.pinkSoft}` },
  }[variant];
  return {
    background: base.bg, color: base.color, border: base.border,
    padding: '8px 16px', borderRadius: '9999px', fontWeight: 700, fontSize: '12px',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
    boxShadow: '0 3px 0 rgba(var(--shadow-btn-rgb), 0.4)', outline: 'none', boxSizing: 'border-box',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    fontFamily: 'inherit', letterSpacing: 'normal', lineHeight: 1.2,
  };
};

/* ---------------------------------------------------------------------
   Geometry helpers
   --------------------------------------------------------------------- */
const PAD = 6; // breathing room around the spotlight

// Rect of the target in viewport coordinates. For interactive steps the rect
// also grows to cover open dropdown lists (absolutely positioned children),
// otherwise the dim layer would swallow clicks on the options.
function measureTarget(el, interactive) {
  const r = el.getBoundingClientRect();
  let top = r.top, left = r.left, right = r.right, bottom = r.bottom;

  // Don't highlight past the edge of a scrolling/clipping container
  // (e.g. table columns that are scrolled out of view horizontally).
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) {
      const pr = p.getBoundingClientRect();
      top = Math.max(top, pr.top);
      left = Math.max(left, pr.left);
      right = Math.min(right, pr.right);
      bottom = Math.min(bottom, pr.bottom);
    }
    p = p.parentElement;
  }

  // Interactive steps also cover open dropdown panels (absolute/fixed children), otherwise the
  // dim layer would swallow clicks on the options. These are NOT clipped by the ancestors above.
  if (interactive) {
    el.querySelectorAll('*').forEach(child => {
      const cr = child.getBoundingClientRect();
      if (cr.width === 0 && cr.height === 0) return;
      top = Math.min(top, cr.top);
      left = Math.min(left, cr.left);
      right = Math.max(right, cr.right);
      bottom = Math.max(bottom, cr.bottom);
    });
  }

  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  top = Math.max(0, top - PAD);
  left = Math.max(0, left - PAD);
  right = Math.min(vw, right + PAD);
  bottom = Math.min(vh, bottom + PAD);

  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return { top: Math.round(top), left: Math.round(left), width: Math.round(width), height: Math.round(height) };
}

// Finds the target every animation frame, so it keeps up with smooth scrolling,
// modals that mount a moment after the step changes, and open dropdowns.
function useTargetRect(targetName, interactive, stepKey) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    let raf;
    let scrolled = false;
    let lastKey = '';

    const tick = () => {
      const el = targetName ? document.querySelector(`[data-tour="${targetName}"]`) : null;
      if (el) {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
        const r = measureTarget(el, interactive);
        const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
        if (key !== lastKey) { lastKey = key; setRect(r); }
      } else if (lastKey !== 'none') {
        lastKey = 'none';
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(raf);
  }, [targetName, interactive, stepKey]);

  return rect;
}

function placeTooltip(rect, W, H, vw, vh) {
  const GAP = 14;
  const M = 12;
  if (!rect) {
    return { top: Math.max(M, (vh - H) / 2), left: Math.max(M, (vw - W) / 2) };
  }
  const clampX = x => Math.max(M, Math.min(x, vw - W - M));
  const clampY = y => Math.max(M, Math.min(y, vh - H - M));
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;

  if (bottom + GAP + H + M <= vh) return { top: bottom + GAP, left: clampX(cx - W / 2) };
  if (rect.top - GAP - H - M >= 0) return { top: rect.top - GAP - H, left: clampX(cx - W / 2) };
  if (vw - right - GAP - W - M >= 0) return { top: clampY(cy - H / 2), left: right + GAP };
  if (rect.left - GAP - W - M >= 0) return { top: clampY(cy - H / 2), left: rect.left - GAP - W };
  // Target is huge: park the card on whichever edge is farther from it.
  return { top: cy > vh / 2 ? M : vh - H - M, left: clampX((vw - W) / 2) };
}

/* ---------------------------------------------------------------------
   Step 0 — language prompt
   --------------------------------------------------------------------- */
export function TourWelcome({ onPick, onSkip }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(60, 40, 30, 0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px', boxSizing: 'border-box' }}>
      <div role="dialog" aria-modal="true" style={{ background: C.cream, borderRadius: '20px', padding: '28px 26px 24px', maxWidth: '420px', width: '100%', boxShadow: '0 15px 40px rgba(var(--shadow-rgb), 0.6)', borderTop: `6px solid ${C.yellow}`, border: `1px solid ${C.border}`, boxSizing: 'border-box', textAlign: 'center', fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif", letterSpacing: 'normal' }}>
        <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center', color: C.brownSoft }}><ShoppingBag size={34} /></div>
        <div style={{ fontSize: '19px', fontWeight: 700, color: C.brownSoft, marginBottom: '6px' }}>
          Welcome! / Maligayang pagdating!
        </div>
        <div style={{ fontSize: '13px', color: C.muted, lineHeight: 1.55, marginBottom: '20px' }}>
          Want a quick tour of the tracker? Choose your language to begin.
          <br />
          Gusto mo ba ng mabilis na tour? Piliin ang iyong wika para magsimula.
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
          <button type="button" onClick={() => onPick('en')} style={{ ...pillBtn('primary'), padding: '11px 22px', fontSize: '13px' }}>English</button>
          <button type="button" onClick={() => onPick('tl')} style={{ ...pillBtn('pink'), padding: '11px 22px', fontSize: '13px' }}>Tagalog</button>
        </div>

        <button type="button" onClick={onSkip} style={{ background: 'none', border: 'none', color: C.muted, fontSize: '12px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
          Skip Tutorial
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   Spotlight + tooltip
   --------------------------------------------------------------------- */
export function TourOverlay({ stepIndex, lang, onLang, onNext, onBack, onSkip }) {
  const step = TOUR_STEPS[stepIndex];
  const rect = useTargetRect(step.target, !!step.interactive, `${stepIndex}`);
  const [, forceRender] = useReducer(x => x + 1, 0);
  const tipRef = useRef(null);
  const [tipH, setTipH] = useState(230);

  useEffect(() => {
    window.addEventListener('resize', forceRender);
    return () => window.removeEventListener('resize', forceRender);
  }, []);

  useLayoutEffect(() => {
    if (tipRef.current) {
      const h = tipRef.current.offsetHeight;
      if (h && h !== tipH) setTipH(h);
    }
  });

  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const W = Math.min(380, vw - 24);
  const pos = placeTooltip(rect, W, tipH, vw, vh);
  const isLast = stepIndex === TOUR_STEPS.length - 1;
  const ui = UI[lang];

  const dim = { position: 'fixed', background: 'rgba(60, 40, 30, 0.58)', zIndex: 4000 };

  return (
    <>
      {/* Dim layer: four panels around the cutout so clicks inside the cutout reach the real UI */}
      {rect ? (
        <>
          <div style={{ ...dim, top: 0, left: 0, right: 0, height: rect.top }} />
          <div style={{ ...dim, top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} />
          <div style={{ ...dim, top: rect.top, left: 0, width: rect.left, height: rect.height }} />
          <div style={{ ...dim, top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }} />

          {/* Glowing ring around the target */}
          <div style={{ position: 'fixed', zIndex: 4001, pointerEvents: 'none', top: rect.top, left: rect.left, width: rect.width, height: rect.height, boxSizing: 'border-box', borderRadius: '12px', border: `2.5px solid ${C.pink}`, boxShadow: '0 0 0 3px rgba(255, 209, 102, 0.6), 0 0 22px rgba(255, 175, 204, 0.85)' }} />

          {/* Non-interactive steps: swallow clicks on the highlighted element too */}
          {!step.interactive && (
            <div style={{ position: 'fixed', zIndex: 4002, top: rect.top, left: rect.left, width: rect.width, height: rect.height, cursor: 'default' }} />
          )}
        </>
      ) : (
        <div style={{ ...dim, inset: 0 }} />
      )}

      {/* Tooltip card */}
      <div
        ref={tipRef}
        role="dialog"
        aria-live="polite"
        style={{
          position: 'fixed', zIndex: 4010, top: pos.top, left: pos.left, width: W,
          background: C.cream, borderRadius: '16px', padding: '16px 18px 14px', boxSizing: 'border-box',
          border: `1px solid ${C.border}`, borderTop: `5px solid ${C.yellow}`,
          boxShadow: '0 12px 34px rgba(92, 64, 51, 0.35)', textAlign: 'left',
          fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif", letterSpacing: 'normal',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ background: C.pink, color: C.brown, fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '9999px', whiteSpace: 'nowrap' }}>
            {ui.step(stepIndex + 1, TOUR_STEPS.length)}
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[['en', 'EN'], ['tl', 'TL']].map(([code, label]) => (
              <button
                key={code}
                type="button"
                onClick={() => onLang(code)}
                aria-pressed={lang === code}
                style={{ background: lang === code ? C.yellow : C.sand, color: C.brown, border: `1px solid ${C.border}`, borderRadius: '9999px', fontSize: '10px', fontWeight: 700, padding: '3px 9px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: C.muted, marginBottom: '6px' }}>
          Part {step.part} · {TOUR_PARTS[step.part][lang]}
        </div>

        <div style={{ height: '4px', background: C.sand, borderRadius: '9999px', overflow: 'hidden', marginBottom: '10px' }}>
          <div style={{ height: '100%', width: `${((stepIndex + 1) / TOUR_STEPS.length) * 100}%`, background: C.pink, transition: 'width 0.2s ease' }} />
        </div>

        <div style={{ fontSize: '13.5px', lineHeight: 1.55, color: C.brown }}>{step.text[lang]}</div>

        {step.interactive && (
          <div style={{ fontSize: '11px', color: C.muted, marginTop: '8px', lineHeight: 1.45, display: 'flex', gap: '6px', alignItems: 'flex-start' }}><Lightbulb size={13} style={{ flexShrink: 0, marginTop: '1px' }} /><span>{ui.tryIt}</span></div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', gap: '8px' }}>
          <button type="button" onClick={onSkip} style={{ background: 'none', border: 'none', color: C.muted, fontSize: '12px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: '4px', fontFamily: 'inherit' }}>
            Skip
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={onBack} disabled={stepIndex === 0} style={pillBtn('light', stepIndex === 0)}>Back</button>
            <button type="button" onClick={onNext} style={pillBtn('primary')}>{isLast ? 'Finish' : 'Next'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* Small pill shown next to the temporary tutorial sample rows */
export function SampleBadge() {
  return (
    <span style={{ marginLeft: '6px', background: C.sand, color: C.brownSoft, border: `1px dashed ${C.border}`, borderRadius: '9999px', fontSize: '9px', fontWeight: 700, padding: '2px 7px', verticalAlign: 'middle', whiteSpace: 'nowrap', letterSpacing: '0.4px' }}>
      SAMPLE
    </span>
  );
}
