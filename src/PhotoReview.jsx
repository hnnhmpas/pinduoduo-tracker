import React, { useEffect, useRef, useState } from 'react';
import { X, Upload, Star, Download, Camera, Crosshair, Check } from 'lucide-react';

/* =====================================================================
   PHOTO REVIEW GENERATOR
   ---------------------------------------------------------------------
   Builds the "Rate: ★★★★★ / made by" review picture from two photos.
   100% client-side: photos are read into memory, drawn on a <canvas>,
   downloaded as a PNG and then thrown away. Nothing is sent to Firebase
   or any server, and nothing is written to localStorage.
   ===================================================================== */

// Template geometry (measured from the reference template, 940 x 788)
const W = 940;
const H = 788;
const PHOTO_H = 700;                                   // photo area; white footer below
const REF = { x: 626, y: 78, w: 268, h: 402, r: 22 };  // reference-photo frame
const STAR_COLOR = '#FFDE59';
const STAR_OFF = '#E4E1DC';
const SITE_URL = 'https://pinduoduo-tracker.vercel.app/';
const OUT_SCALE = 2;                                   // exported PNG is 1880 x 1576
const MAX_FILE_MB = 30;
const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/* ---------- framing maths ---------- */

// "Cover" fit: the photo fills the frame; zoom >= 1 magnifies further.
function coverSize(img, fw, fh, zoom) {
  const k = Math.max(fw / img.naturalWidth, fh / img.naturalHeight) * zoom;
  return { dw: img.naturalWidth * k, dh: img.naturalHeight * k };
}

// focus (fx, fy) = the point of the photo (0..1) that should sit in the middle of the frame.
// It is clamped so the frame never shows empty space.
function clampFocus(img, fw, fh, zoom, fx, fy) {
  const { dw, dh } = coverSize(img, fw, fh, zoom);
  const hx = Math.min(0.5, fw / 2 / dw);
  const hy = Math.min(0.5, fh / 2 / dh);
  return { fx: Math.min(1 - hx, Math.max(hx, fx)), fy: Math.min(1 - hy, Math.max(hy, fy)) };
}

/* ---------- "smart" centering ----------
   A small saliency map: local contrast + colourfulness, softly biased to the middle,
   so busy edges and plain backgrounds don't pull the crop away from the subject. */
function saliencyMap(img) {
  const k = 96 / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.max(8, Math.round(img.naturalWidth * k));
  const h = Math.max(8, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  const sat = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  }
  const wt = new Float32Array(w * h);
  const R = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let yy = Math.max(0, y - R); yy <= Math.min(h - 1, y + R); yy++) {
        for (let xx = Math.max(0, x - R); xx <= Math.min(w - 1, x + R); xx++) { sum += lum[yy * w + xx]; n++; }
      }
      const contrast = Math.abs(lum[y * w + x] - sum / n) / 255;
      const dx = x / w - 0.5, dy = y / h - 0.5;
      const centerBias = Math.exp(-(dx * dx + dy * dy) / (2 * 0.5 * 0.5));
      wt[y * w + x] = Math.pow(contrast + 0.35 * sat[y * w + x] + 0.01, 1.5) * (0.4 + 0.6 * centerBias);
    }
  }
  return { w, h, wt };
}

// Best window start along one axis: the slice that holds the most "content".
function bestWindow(profile, win) {
  const n = profile.length;
  win = Math.max(1, Math.min(n, Math.round(win)));
  let cur = 0;
  for (let i = 0; i < win; i++) cur += profile[i];
  let best = cur, bestStart = 0;
  for (let s = 1; s + win <= n; s++) {
    cur += profile[s + win - 1] - profile[s - 1];
    if (cur > best) { best = cur; bestStart = s; }
  }
  return (bestStart + win / 2) / n;
}

// mode 'subject'  -> centre on the weighted centre of interest (the actual photo)
// mode 'content'  -> keep as much of the content as possible in view (a product screenshot:
//                    product picture + its name/price), instead of cutting through the middle.
export function autoFocus(img, fw, fh, zoom, mode) {
  const { w, h, wt } = saliencyMap(img);
  let fx = 0.5, fy = 0.5;
  if (mode === 'content') {
    const { dw, dh } = coverSize(img, fw, fh, zoom);
    const visX = Math.min(1, fw / dw), visY = Math.min(1, fh / dh);
    if (visY < 0.999) {
      const rows = new Float32Array(h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows[y] += wt[y * w + x];
      fy = bestWindow(rows, visY * h);
    }
    if (visX < 0.999) {
      const cols = new Float32Array(w);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cols[x] += wt[y * w + x];
      fx = bestWindow(cols, visX * w);
    }
  } else {
    let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = wt[y * w + x];
      sx += v * (x + 0.5); sy += v * (y + 0.5); sw += v;
    }
    if (sw > 0) { fx = sx / sw / w; fy = sy / sw / h; }
  }
  return clampFocus(img, fw, fh, zoom, fx, fy);
}

/* ---------- drawing ---------- */

function drawPhoto(ctx, slot, x, y, fw, fh, placeholder) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, fw, fh);
  ctx.clip();
  if (slot) {
    const { dw, dh } = coverSize(slot.img, fw, fh, slot.zoom);
    const f = clampFocus(slot.img, fw, fh, slot.zoom, slot.fx, slot.fy);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(slot.img, x + fw / 2 - f.fx * dw, y + fh / 2 - f.fy * dh, dw, dh);
  } else if (placeholder) {
    const g = ctx.createLinearGradient(0, y, 0, y + fh);
    g.addColorStop(0, '#cdeafd'); g.addColorStop(1, '#eefaff');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, fw, fh);
    ctx.fillStyle = '#6b7b86';
    ctx.textAlign = 'center';
    ctx.font = `500 ${placeholder.size}px ${FONT}`;
    const lines = placeholder.text.split('\n');
    lines.forEach((ln, i) => ctx.fillText(ln, x + fw / 2, y + fh / 2 + (i - (lines.length - 1) / 2) * placeholder.size * 1.3));
  }
  ctx.restore();
}

function starPath(ctx, cx, cy, R) {
  const r = R * 0.382;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + rad * Math.cos(a), py = cy + rad * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawReview(ctx, { actual, reference, rating }, { placeholders = false } = {}) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  drawPhoto(ctx, actual, 0, 0, W, PHOTO_H, placeholders && { text: 'Actual photo goes\nin this section', size: 30 });

  // reference photo frame (rounded, soft shadow so it lifts off busy photos)
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, REF.x, REF.y, REF.w, REF.h, REF.r);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, REF.x, REF.y, REF.w, REF.h, REF.r);
  ctx.clip();
  drawPhoto(ctx, reference, REF.x, REF.y, REF.w, REF.h, placeholders && { text: 'Reference photo\ngoes in this section', size: 21 });
  ctx.restore();

  // footer: "Rate:" + five stars on the left, "made by" on the right
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 29px ${FONT}`;
  ctx.fillText('Rate:', 36, 755);
  for (let i = 0; i < 5; i++) {
    starPath(ctx, 140.5 + i * 56.5, 747, 20);
    ctx.fillStyle = i < rating ? STAR_COLOR : STAR_OFF;
    ctx.fill();
  }
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  let size = 17;
  ctx.font = `400 ${size}px ${FONT}`;
  while (ctx.measureText(SITE_URL).width > 262 && size > 10) { size -= 0.5; ctx.font = `400 ${size}px ${FONT}`; }
  ctx.fillText(SITE_URL, 780, 761);
  ctx.font = `400 ${Math.round(size * 0.95)}px ${FONT}`;
  ctx.fillText('made by:', 780, 741);
}

/* ---------- file helpers ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) { reject(new Error('Please choose an image file (JPG, PNG, WebP...).')); return; }
    if (file.size > MAX_FILE_MB * 1024 * 1024) { reject(new Error(`That image is over ${MAX_FILE_MB} MB. Try a smaller one.`)); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ img, name: file.name }); };  // drop the blob URL right away
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

const releaseSlot = (slot) => { if (slot && slot.img) slot.img.src = ''; };
const slug = (s) => (s || 'order').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'order';

/* ---------- UI ---------- */

const label = { display: 'block', fontWeight: 700, marginBottom: '5px', color: 'var(--c-7f5539)', fontSize: '12px' };
const smallBtn = { background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '9999px', padding: '5px 11px', fontSize: '11px', fontWeight: 700, color: 'var(--c-7f5539)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'inherit' };

function PhotoSlot({ title, hint, slot, onFile, onClear, onZoom, onAuto, error }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const pick = (file) => { if (file) onFile(file); if (inputRef.current) inputRef.current.value = ''; };
  return (
    <div>
      <span style={label}>{title}</span>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files && e.target.files[0])} />
      {!slot ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current && inputRef.current.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current && inputRef.current.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files && e.dataTransfer.files[0]); }}
          style={{ border: `1.5px dashed ${over ? 'var(--c-ffd166)' : 'var(--c-e6ccb2)'}`, background: over ? 'var(--c-fcf2cd)' : 'var(--c-fcf6f0)', borderRadius: '12px', padding: '14px', textAlign: 'center', cursor: 'pointer', color: 'var(--c-7f5539)' }}
        >
          <Upload size={20} style={{ display: 'block', margin: '0 auto 6px' }} />
          <div style={{ fontSize: '12px', fontWeight: 700 }}>Upload or drop a photo</div>
          <div style={{ fontSize: '10.5px', color: 'var(--c-8c7a6b)', marginTop: '3px' }}>{hint}</div>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--c-e6ccb2)', background: 'var(--c-fcf6f0)', borderRadius: '12px', padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--c-5c4033)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Check size={13} strokeWidth={3} style={{ color: 'var(--c-2d6a4f)', flexShrink: 0 }} />{slot.name}
            </span>
            <span style={{ display: 'inline-flex', gap: '5px', flexShrink: 0 }}>
              <button type="button" style={smallBtn} onClick={() => inputRef.current && inputRef.current.click()}>Replace</button>
              <button type="button" style={smallBtn} onClick={onClear} aria-label={`Remove ${title}`}><X size={12} strokeWidth={3} /></button>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '9px' }}>
            <span style={{ fontSize: '10.5px', color: 'var(--c-8c7a6b)', fontWeight: 700 }}>ZOOM</span>
            <input type="range" min="1" max="3" step="0.02" value={slot.zoom} onChange={(e) => onZoom(Number(e.target.value))} style={{ flex: 1, accentColor: '#e0a82e' }} aria-label={`${title} zoom`} />
            <button type="button" style={smallBtn} onClick={onAuto} title="Re-center on the subject automatically"><Crosshair size={12} /> Auto-center</button>
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: '11px', color: 'var(--c-780000)', marginTop: '5px' }}>{error}</div>}
    </div>
  );
}

export function PhotoReviewModal({ order, queue = [], onGenerated, onClose }) {
  // A review queue: `order` first, then the orders in `queue`, one after another
  const [current, setCurrent] = useState(order);
  const [rest, setRest] = useState(queue);
  const total = useRef(1 + queue.length).current;
  const position = total - rest.length;
  const [actual, setActual] = useState(null);       // { img, name, zoom, fx, fy }
  const [reference, setReference] = useState(null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [errors, setErrors] = useState({});
  const [stage, setStage] = useState('edit');       // 'edit' | 'done'
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState('');
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const liveRef = useRef({});
  liveRef.current = { actual, reference };

  // free the photos from memory whenever the modal goes away
  useEffect(() => () => { releaseSlot(liveRef.current.actual); releaseSlot(liveRef.current.reference); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // live preview
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    drawReview(ctx, { actual, reference, rating }, { placeholders: true });
  }, [actual, reference, rating, stage]);

  const frameOf = (which) => (which === 'actual' ? { w: W, h: PHOTO_H } : { w: REF.w, h: REF.h });

  const handleFile = async (which, file) => {
    setErrors((e) => ({ ...e, [which]: '' }));
    try {
      const { img, name } = await loadImage(file);
      const fr = frameOf(which);
      const f = autoFocus(img, fr.w, fr.h, 1, which === 'actual' ? 'subject' : 'content');
      const slot = { img, name, zoom: 1, fx: f.fx, fy: f.fy };
      if (which === 'actual') setActual((old) => { releaseSlot(old); return slot; });
      else setReference((old) => { releaseSlot(old); return slot; });
    } catch (err) {
      setErrors((e) => ({ ...e, [which]: err.message }));
    }
  };
  const setSlot = (which) => (which === 'actual' ? setActual : setReference);
  const clearSlot = (which) => setSlot(which)((old) => { releaseSlot(old); return null; });
  const zoomSlot = (which, zoom) => setSlot(which)((s) => {
    if (!s) return s;
    const fr = frameOf(which);
    const f = clampFocus(s.img, fr.w, fr.h, zoom, s.fx, s.fy);
    return { ...s, zoom, fx: f.fx, fy: f.fy };
  });
  const autoSlot = (which) => setSlot(which)((s) => {
    if (!s) return s;
    const fr = frameOf(which);
    const f = autoFocus(s.img, fr.w, fr.h, s.zoom, which === 'actual' ? 'subject' : 'content');
    return { ...s, fx: f.fx, fy: f.fy };
  });

  // drag a photo on the preview to reposition it
  const toDesign = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const onPointerDown = (e) => {
    const p = toDesign(e);
    const inRef = p.x >= REF.x && p.x <= REF.x + REF.w && p.y >= REF.y && p.y <= REF.y + REF.h;
    const which = inRef ? 'reference' : p.y <= PHOTO_H ? 'actual' : null;
    const slot = which === 'actual' ? actual : which === 'reference' ? reference : null;
    if (!slot) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { which, last: p };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toDesign(e);
    const dx = p.x - d.last.x, dy = p.y - d.last.y;
    d.last = p;
    const fr = frameOf(d.which);
    setSlot(d.which)((s) => {
      if (!s) return s;
      const { dw, dh } = coverSize(s.img, fr.w, fr.h, s.zoom);
      const f = clampFocus(s.img, fr.w, fr.h, s.zoom, s.fx - dx / dw, s.fy - dy / dh);
      return { ...s, fx: f.fx, fy: f.fy };
    });
  };
  const endDrag = () => { dragRef.current = null; };

  const ready = !!actual && !!reference && rating > 0;
  const missing = [!actual && 'actual photo', !reference && 'reference photo', rating === 0 && 'star rating'].filter(Boolean);

  const generate = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setGenError('');
    try {
      const out = document.createElement('canvas');
      out.width = W * OUT_SCALE; out.height = H * OUT_SCALE;
      const ctx = out.getContext('2d');
      ctx.scale(OUT_SCALE, OUT_SCALE);
      drawReview(ctx, { actual, reference, rating });
      const blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image.'))), 'image/png'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photo-review-${slug(current.name)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      out.width = 0; out.height = 0;
      // nothing is kept: discard the uploaded photos right after the download starts
      releaseSlot(actual); releaseSlot(reference);
      setActual(null); setReference(null); setRating(0); setHover(0);
      setStage('done');
      if (onGenerated) onGenerated(current);   // the order gets its "Reviewed" tag
    } catch (err) {
      setGenError(err.message || 'Something went wrong while generating the image.');
    } finally {
      setBusy(false);
    }
  };

  const shown = hover || rating;

  // Move on to the next order in the queue (photos and rating start fresh)
  const goNext = () => {
    if (rest.length === 0) { onClose(); return; }
    releaseSlot(actual); releaseSlot(reference);
    setActual(null); setReference(null); setRating(0); setHover(0); setErrors({}); setGenError('');
    setCurrent(rest[0]);
    setRest(rest.slice(1));
    setStage('edit');
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '15px', boxSizing: 'border-box' }}
    >
      <div role="dialog" aria-modal="true" aria-label="Generate Photo Review" style={{ background: 'var(--c-fffdfa)', borderRadius: '16px', padding: '22px', maxWidth: '940px', width: '100%', maxHeight: '94vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.4)', borderTop: '5px solid var(--c-ffd166)', border: '1px solid var(--c-f0e6df)', boxSizing: 'border-box', textAlign: 'left' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '14px', borderBottom: '2px solid var(--c-fcf6f0)', paddingBottom: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--c-7f5539)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Camera size={17} /> Generate Photo Review
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--c-5c4033)', fontWeight: 600, marginTop: '4px', wordBreak: 'break-word' }}>
              {total > 1 && <span style={{ background: 'var(--c-fcf2cd)', border: '1px solid var(--c-ffd166)', borderRadius: '9999px', padding: '1px 8px', fontSize: '10.5px', fontWeight: 700, marginRight: '8px', whiteSpace: 'nowrap' }}>Review {position} of {total}</span>}
              {current.name}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '28px', height: '28px', cursor: 'pointer', color: 'var(--c-7f5539)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>

        {stage === 'done' ? (
          <div style={{ textAlign: 'center', padding: '34px 10px 26px' }}>
            <div style={{ width: '46px', height: '46px', borderRadius: '50%', background: 'var(--c-d4edbc)', color: 'var(--c-1b4332)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={24} strokeWidth={3} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--c-7f5539)', marginTop: '12px' }}>Your photo review is downloading</div>
            <div style={{ fontSize: '12px', color: 'var(--c-8c7a6b)', marginTop: '6px', maxWidth: '420px', marginInline: 'auto', lineHeight: 1.5 }}>
              The photos you uploaded were discarded. Nothing was saved or sent anywhere. This order is now tagged Reviewed.
            </div>
            {rest.length > 0 && (
              <div style={{ fontSize: '12px', color: 'var(--c-5c4033)', marginTop: '10px', fontWeight: 600, wordBreak: 'break-word' }}>Up next: {rest[0].name}</div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '18px', flexWrap: 'wrap' }}>
              {rest.length > 0 ? (
                <>
                  <button type="button" onClick={onClose} style={{ ...smallBtn, padding: '9px 16px', fontSize: '12px' }}>Done for now</button>
                  <button type="button" onClick={goNext} style={{ background: 'var(--c-ffd166)', border: '1px solid var(--c-e6ccb2)', borderRadius: '9999px', padding: '9px 20px', fontSize: '12px', fontWeight: 700, color: 'var(--c-5c4033)', cursor: 'pointer', fontFamily: 'inherit', maxWidth: '100%' }}>Next review ({rest.length} left)</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setStage('edit')} style={{ ...smallBtn, padding: '9px 16px', fontSize: '12px' }}>Make another</button>
                  <button type="button" onClick={onClose} style={{ background: 'var(--c-ffd166)', border: '1px solid var(--c-e6ccb2)', borderRadius: '9999px', padding: '9px 20px', fontSize: '12px', fontWeight: 700, color: 'var(--c-5c4033)', cursor: 'pointer', fontFamily: 'inherit' }}>Done</button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 440px', minWidth: 0 }}>
              <canvas
                ref={canvasRef}
                width={W}
                height={H}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '12px', border: '1px solid var(--c-e6ccb2)', touchAction: 'none', cursor: actual || reference ? 'grab' : 'default', background: '#fff' }}
              />
              <div style={{ fontSize: '10.5px', color: 'var(--c-8c7a6b)', marginTop: '6px' }}>Live preview. Drag a photo to reposition it.</div>
            </div>

            <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12px' }}>
              <div data-tour="pr-photos" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <PhotoSlot title="Actual photo" hint="The photo of what you received" slot={actual} error={errors.actual}
                onFile={(f) => handleFile('actual', f)} onClear={() => clearSlot('actual')} onZoom={(z) => zoomSlot('actual', z)} onAuto={() => autoSlot('actual')} />
              <PhotoSlot title="Reference photo" hint="Screenshot of the listing (picture + name)" slot={reference} error={errors.reference}
                onFile={(f) => handleFile('reference', f)} onClear={() => clearSlot('reference')} onZoom={(z) => zoomSlot('reference', z)} onAuto={() => autoSlot('reference')} />
              </div>

              <div data-tour="pr-rating">
                <span style={label}>How would you rate this order?</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }} onMouseLeave={() => setHover(0)}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      onMouseEnter={() => setHover(n)}
                      onFocus={() => setHover(n)}
                      onBlur={() => setHover(0)}
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                      aria-pressed={rating === n}
                      style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', lineHeight: 0 }}
                    >
                      <Star size={34} strokeWidth={1.6} fill={n <= shown ? STAR_COLOR : 'none'} stroke={n <= shown ? '#E3B02B' : 'var(--c-c9b8a8)'} />
                    </button>
                  ))}
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--c-7f5539)', marginLeft: '8px', minWidth: '70px' }}>{RATING_LABELS[shown]}</span>
                </div>
              </div>

              <div data-tour="pr-generate">
                <button
                  type="button"
                  onClick={generate}
                  disabled={!ready || busy}
                  style={{ width: '100%', background: 'var(--c-ffd166)', color: 'var(--c-5c4033)', border: '1px solid var(--c-e6ccb2)', borderRadius: '9999px', padding: '11px 16px', fontSize: '13px', fontWeight: 700, cursor: ready && !busy ? 'pointer' : 'not-allowed', opacity: ready && !busy ? 1 : 0.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px', boxShadow: '0 3px 0 rgba(var(--shadow-btn-rgb), 0.4)', fontFamily: 'inherit' }}
                >
                  <Download size={15} /> {busy ? 'Generating...' : 'Generate & Download'}
                </button>
                {!ready && <div style={{ fontSize: '10.5px', color: 'var(--c-8c7a6b)', marginTop: '6px', textAlign: 'center' }}>Still needed: {missing.join(', ')}</div>}
                {genError && <div style={{ fontSize: '11px', color: 'var(--c-780000)', marginTop: '6px', textAlign: 'center' }}>{genError}</div>}
                {rest.length > 0 && (
                  <div style={{ textAlign: 'center', marginTop: '8px' }}>
                    <button type="button" onClick={goNext} style={{ ...smallBtn, padding: '6px 14px' }}>Skip this one ({rest.length} left)</button>
                  </div>
                )}
                <div style={{ fontSize: '10.5px', color: 'var(--c-8c7a6b)', marginTop: '8px', textAlign: 'center', lineHeight: 1.4 }}>Photos stay in your browser and are discarded right after you download.</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
