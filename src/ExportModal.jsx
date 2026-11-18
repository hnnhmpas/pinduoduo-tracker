import React, { useEffect, useState } from 'react';
import { X, Download, FileSpreadsheet, Check } from 'lucide-react';
import { ordersToCsv, wishlistToCsv } from './csvExport.js';
import { localDateStr } from './statusHistory.js';

/* Backup & Export: builds CSV files in the browser and downloads them. Nothing is uploaded anywhere. */

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ExportModal({ orders, archived, wishlist, onClose }) {
  const [done, setDone] = useState({});
  const stamp = localDateStr();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = [
    { key: 'orders', title: 'General Orders', note: 'Every active order with its full status history', count: orders.length, file: `pdd-general-orders-${stamp}.csv`, build: () => ordersToCsv(orders) },
    { key: 'archive', title: 'Archived Orders', note: 'Delivered orders you moved to the Archive', count: archived.length, file: `pdd-archived-orders-${stamp}.csv`, build: () => ordersToCsv(archived) },
    { key: 'wishlist', title: 'Wishlist', note: 'Items with initial and latest prices', count: wishlist.length, file: `pdd-wishlist-${stamp}.csv`, build: () => wishlistToCsv(wishlist) },
  ];

  const run = (r) => {
    downloadCsv(r.file, r.build());
    setDone((d) => ({ ...d, [r.key]: true }));
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '15px', boxSizing: 'border-box' }}
    >
      <div role="dialog" aria-modal="true" aria-label="Backup and Export" style={{ background: 'var(--c-fffdfa)', borderRadius: '16px', padding: '24px', maxWidth: '480px', width: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.4)', borderTop: '5px solid var(--c-bde0fe)', border: '1px solid var(--c-f0e6df)', boxSizing: 'border-box', textAlign: 'left' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '2px solid var(--c-fcf6f0)', paddingBottom: '10px' }}>
          <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--c-7f5539)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={17} /> Backup &amp; Export
          </h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '28px', height: '28px', cursor: 'pointer', color: 'var(--c-7f5539)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={14} />
          </button>
        </div>

        <p style={{ fontSize: '12px', color: 'var(--c-8c7a6b)', lineHeight: 1.5, margin: '0 0 14px' }}>
          Download your data as CSV files that open in Excel or Google Sheets. Exports always include every entry, no matter which filters are on.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {rows.map((r) => (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '12px', padding: '12px 14px' }}>
              <span style={{ color: 'var(--c-7f5539)', display: 'flex' }}><FileSpreadsheet size={22} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--c-5c4033)' }}>{r.title} <span style={{ fontWeight: 600, color: 'var(--c-8c7a6b)' }}>({r.count})</span></div>
                <div style={{ fontSize: '11px', color: 'var(--c-8c7a6b)', marginTop: '2px' }}>{r.note}</div>
              </div>
              <button
                type="button"
                onClick={() => run(r)}
                disabled={r.count === 0}
                style={{ background: done[r.key] ? 'var(--c-d4edbc)' : 'var(--c-ffd166)', color: done[r.key] ? 'var(--c-1b4332)' : 'var(--c-5c4033)', border: '1px solid var(--c-e6ccb2)', borderRadius: '9999px', padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: r.count === 0 ? 'not-allowed' : 'pointer', opacity: r.count === 0 ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'inherit', flexShrink: 0 }}
              >
                {done[r.key] ? <><Check size={13} strokeWidth={3} /> Saved</> : <><Download size={13} /> CSV</>}
              </button>
            </div>
          ))}
        </div>

        <p style={{ fontSize: '10.5px', color: 'var(--c-8c7a6b)', lineHeight: 1.5, margin: '14px 0 0' }}>
          The files are created on your device and are not uploaded anywhere. They keep every field (including IDs), so they can be re-imported later.
        </p>
      </div>
    </div>
  );
}
