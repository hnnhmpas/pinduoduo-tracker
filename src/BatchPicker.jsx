import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';

/* =====================================================================
   BATCH PICKER  —  replaces the fixed 25-item batch dropdowns
   ---------------------------------------------------------------------
   Layout:   [extras…] [recent batch chips…] [+ New (next #)] [More]
   "More"  opens a small panel:
               - "Go to / create batch #" box (any number)
               - OPEN batches      – still have undelivered orders
               - FINISHED batches  – everything delivered / archived,
                                     folded away until you ask for them
   Batches are never pre-listed: they exist because orders use them, so
   there is no cap and the list only grows with batches that matter.
   ===================================================================== */

const NUM_RE = /^Batch (\d+)$/;
export const batchNum = (name) => {
  const m = NUM_RE.exec(name || '');
  return m ? Number(m[1]) : null;
};

// One entry per batch name found on the user's real orders (archived ones included).
export function buildBatchInfo(orders) {
  const map = new Map();
  orders.forEach((o) => {
    const name = o.batch;
    if (!name) return;
    let b = map.get(name);
    if (!b) {
      b = { name, num: batchNum(name), active: 0, total: 0, open: false, lastId: 0 };
      map.set(name, b);
    }
    b.total += 1;
    if (!o.archived) {
      b.active += 1;
      if (o.shippingStatus !== 'Delivered') b.open = true;
    }
    const idn = Number(o.id);
    if (Number.isFinite(idn) && idn > b.lastId) b.lastId = idn;
  });
  return [...map.values()];
}

export const getNextBatchNumber = (batches) =>
  batches.reduce((m, b) => (b.num != null && b.num > m ? b.num : m), 0) + 1;

const byNumberDesc = (a, b) => (b.num ?? -1) - (a.num ?? -1) || a.name.localeCompare(b.name);

const C = { cream: '#fffdfa', sand: '#fcf6f0', border: '#e6ccb2', brown: '#5c4033', brownSoft: '#7f5539', muted: '#8c7a6b', yellow: '#ffd166', pink: '#ffafcc' };
const PANEL_W = 280;

export function BatchPicker({
  value,              // current batch name (or an extra's value, e.g. 'All Batches', KEEP, null)
  onChange,           // (value) => void
  batches,            // buildBatchInfo(orders)
  extras = [],        // [{ value, label }] shown first, e.g. All Batches / Keep current / Auto
  allowCreate = true, // false for filters: only existing batches can be chosen
  compact = false,    // chips show just the number (for tight spaces like the Add Order modal)
  maxRecent = 3,
}) {
  const [open, setOpen] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const [typed, setTyped] = useState('');
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const moreRef = useRef(null);

  const nextNum = getNextBatchNumber(batches);
  const byName = new Map(batches.map((b) => [b.name, b]));
  const recent = [...batches].sort((a, b) => b.lastId - a.lastId).slice(0, maxRecent);
  const label = (name) => {
    const n = batchNum(name);
    return compact && n != null ? String(n) : name;
  };

  // ---- chips ----------------------------------------------------------
  const chips = [
    ...extras.map((e) => ({ key: `x:${e.label}`, value: e.value, text: e.label })),
    ...recent.map((b) => ({ key: b.name, value: b.name, text: label(b.name) })),
  ];
  if (value != null && !chips.some((c) => c.value === value)) {
    // A batch picked via "More" (or a brand-new one) – show it as a chip so the choice is always visible
    const isNew = !byName.has(value);
    chips.splice(extras.length, 0, { key: `sel:${value}`, value, text: isNew ? <>{label(value)}<span style={{ marginLeft: '5px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', opacity: 0.75 }}>new</span></> : label(value) });
  }

  const chipStyle = (selected, kind) => ({
    background: selected ? C.yellow : kind === 'more' ? '#bde0fe' : kind === 'new' ? '#fff5f7' : C.sand,
    color: kind === 'more' ? '#03045e' : C.brown,
    border: kind === 'new' ? `1.5px dashed ${C.pink}` : kind === 'more' ? '1px solid #90e0ef' : `1px solid ${C.border}`,
    borderRadius: '9999px',
    padding: compact ? '4px 10px' : '5px 12px',
    fontSize: compact ? '11px' : '12px',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: 'normal',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    boxShadow: selected ? '0 2px 0 rgba(199, 175, 150, 0.4)' : 'none',
  });

  // ---- panel placement (fixed, so modals / table containers never clip it) ----
  const place = () => {
    if (!moreRef.current) return;
    const r = moreRef.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - PANEL_W - 8));
    const below = vh - r.bottom;
    if (below >= 240 || below >= r.top) {
      setPos({ left, top: r.bottom + 6, maxHeight: Math.min(340, below - 14) });
    } else {
      setPos({ left, bottom: vh - r.top + 6, maxHeight: Math.min(340, r.top - 14) });
    }
  };

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showFinished]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onMove = () => place();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleOpen = () => {
    if (!open) {
      const sel = value != null ? byName.get(value) : null;
      setShowFinished(!!sel && !sel.open); // reveal the current choice if it's a finished batch
      setTyped('');
    }
    setOpen((o) => !o);
  };

  const pick = (v) => { onChange(v); setOpen(false); };

  // ---- "go to / create" box --------------------------------------------
  const n = Number(typed);
  const validNum = typed !== '' && Number.isInteger(n) && n >= 1 && n <= 9999;
  const typedName = `Batch ${n}`;
  const typedExists = validNum && byName.has(typedName);
  const canUseTyped = validNum && (allowCreate || typedExists);
  const submitTyped = () => { if (canUseTyped) pick(typedName); };

  const openList = batches.filter((b) => b.open).sort(byNumberDesc);
  const finishedList = batches.filter((b) => !b.open).sort(byNumberDesc);

  const row = (b, isOpen) => {
    const selected = value === b.name;
    return (
      <button
        type="button"
        key={b.name}
        onClick={() => pick(b.name)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
          padding: '7px 9px', fontSize: '12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
          background: selected ? C.yellow : 'transparent', color: C.brown, fontWeight: selected ? 700 : 500,
          fontFamily: 'inherit', textAlign: 'left', letterSpacing: 'normal',
        }}
        onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = C.sand; }}
        onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
      >
        <span>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: isOpen ? '#7bc47f' : '#c9b8a8', marginRight: '8px' }} />
          {b.name}
        </span>
        <span style={{ fontSize: '10px', color: C.muted, fontWeight: 600 }}>
          {isOpen ? b.active : b.total} {(isOpen ? b.active : b.total) === 1 ? 'order' : 'orders'}
        </span>
      </button>
    );
  };

  const secLabel = { fontSize: '10px', fontWeight: 700, color: C.muted, letterSpacing: '0.5px', padding: '8px 9px 3px', textTransform: 'uppercase' };

  return (
    <div ref={rootRef} style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', textAlign: 'left' }}>
      {chips.map((c) => (
        <button type="button" key={c.key} onClick={() => onChange(c.value)} aria-pressed={value === c.value} style={chipStyle(value === c.value, 'chip')}>
          {c.text}
        </button>
      ))}

      {allowCreate && (
        <button type="button" onClick={() => onChange(`Batch ${nextNum}`)} title={`Start a new batch: Batch ${nextNum}`} style={chipStyle(false, 'new')}>
          <Plus size={12} strokeWidth={3} /> New ({nextNum})
        </button>
      )}

      <button ref={moreRef} type="button" onClick={toggleOpen} aria-expanded={open} style={chipStyle(false, 'more')}>
        More {open ? <ChevronUp size={12} strokeWidth={3} /> : <ChevronDown size={12} strokeWidth={3} />}
      </button>

      {open && pos && (
        <div
          role="listbox"
          style={{
            position: 'fixed', zIndex: 2500, width: PANEL_W, boxSizing: 'border-box', overflowY: 'auto',
            background: C.cream, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '8px',
            boxShadow: '0 10px 30px rgba(230, 204, 178, 0.65)', textAlign: 'left',
            left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight,
          }}
        >
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="number"
              min="1"
              max="9999"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submitTyped(); } }}
              placeholder={allowCreate ? 'Go to / create batch #' : 'Go to batch #'}
              style={{ flex: 1, minWidth: 0, padding: '7px 9px', borderRadius: '8px', border: `1px solid ${C.border}`, background: C.sand, fontSize: '12px', color: C.brown, outline: 'none', fontFamily: 'inherit' }}
            />
            <button
              type="button"
              onClick={submitTyped}
              disabled={!canUseTyped}
              style={{ ...chipStyle(false, 'chip'), background: C.yellow, opacity: canUseTyped ? 1 : 0.45, cursor: canUseTyped ? 'pointer' : 'not-allowed' }}
            >
              Go
            </button>
          </div>
          {typed !== '' && (
            <div style={{ fontSize: '10.5px', color: C.muted, padding: '4px 4px 0' }}>
              {!validNum ? 'Enter a whole number from 1 to 9999.'
                : typedExists ? `${typedName} exists.`
                : allowCreate ? `${typedName} doesn't exist yet – Go will start it.`
                : `${typedName} has no orders.`}
            </div>
          )}

          <div style={secLabel}>Open · still has undelivered orders</div>
          {openList.length === 0 && <div style={{ fontSize: '11px', color: C.muted, padding: '2px 9px 4px' }}>No open batches right now.</div>}
          {openList.map((b) => row(b, true))}

          {finishedList.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowFinished((s) => !s)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', textAlign: 'left', marginTop: '6px', padding: '7px 9px', borderRadius: '8px', border: 'none', background: 'transparent', color: C.muted, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 'normal' }}
              >
                {showFinished ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {showFinished ? 'Hide' : 'Show'} {finishedList.length} finished {finishedList.length === 1 ? 'batch' : 'batches'}…
              </button>
              {showFinished && finishedList.map((b) => row(b, false))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
