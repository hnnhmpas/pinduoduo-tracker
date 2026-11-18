import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  TourOverlay, TourWelcome, SampleBadge, TOUR_STEPS,
  TOUR_SAMPLE_ORDER_ID, TOUR_SAMPLE_WISHLIST_ID,
  FIRST_ORDER_ROW_STEP, FIRST_WISHLIST_ROW_STEP
} from './Tour.jsx';
import { BatchPicker, buildBatchInfo } from './BatchPicker.jsx';
import { PhotoReviewModal } from './PhotoReview.jsx';
import { ExportModal } from './ExportModal.jsx';
import {
  PIPELINE, STAGE_SHORT, localDateStr, normalizeHistory, entryDateFor, initialHistory, appendStatusChange,
  historyForEditing, applyHistoryEdits, computeStageStats, computeRemainingStats, computeTotalStats, smartEstimate, fmtDays
} from './statusHistory.js';
import {
  ShoppingBag, LogIn, Search, X, BookOpen, Truck, Archive, ArchiveRestore, Undo2,
  LayoutDashboard, Package, Heart, Pencil, Trash2, Check, ArrowDown, ArrowUp, ArrowRight,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Moon, Sun, Plus, Camera, Sparkles, Download, Clock, Star
} from 'lucide-react';

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyAuh6azovHpGjBKSp0vbeWpWfWK1tYn3qg",
  authDomain: "pinduoduo-tracker.firebaseapp.com",
  projectId: "pinduoduo-tracker",
  storageBucket: "pinduoduo-tracker.firebasestorage.app",
  messagingSenderId: "612068892124",
  appId: "1:612068892124:web:fe0fb3735f397d52330319"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// ASSET URLS
const STRAWBERRY_CAT_URL = "https://i.imgur.com/VS9pglf.png";

// Sentinel meaning "leave this field as it already is" in the batch editor
const KEEP = '__keep__';


/* ---------------------------------------------------------------------
   GLOBAL SEARCH helpers
   A query is split into words; every word must appear somewhere in the entry
   (name, notes, batch, statuses, dates, quantity, prices...). Example: "gifting"
   finds every order whose NOTES mention gifting, even if the item name doesn't.
   --------------------------------------------------------------------- */
const lc = (v) => (v == null ? '' : String(v).toLowerCase());

const orderSearchFields = (o) => [
  ['Name', o.name],
  ['Notes', o.notes],
  ['Batch', o.batch],
  ['Shipping', o.shippingStatus],
  ['Status', o.orderStatus === 'OK ✔' ? 'OK' : o.orderStatus],
  ['Date ordered', o.date],
  ['Delivered on', o.actualDeliveryDate],
  ['Photo review', o.shippingStatus === 'Delivered' ? (o.reviewed ? 'Reviewed' : 'Review pending') : ''],
  ['Est. delivery', o.estDelivery],
  ['Quantity', o.qty],
  ['Cost', o.cost],
  ['Total', (Number(o.qty) || 0) * (Number(o.cost) || 0)],
];

const wishlistSearchFields = (w) => [
  ['Name', w.name],
  ['Quantity', w.qty],
  ['Initial price', w.initialCost],
  ['Latest price', w.latestCost],
];

// -> { match, hits: [[label, value], ...] } where hits are the fields that contain a search word
const matchFields = (fields, tokens) => {
  if (tokens.length === 0) return { match: true, hits: [] };
  const lowered = fields.map(([label, value]) => [label, value, lc(value)]);
  const haystack = lowered.map(f => f[2]).join(' \u0001 ');
  if (!tokens.every(t => haystack.includes(t))) return { match: false, hits: [] };
  return {
    match: true,
    hits: lowered.filter(f => f[2] && tokens.some(t => f[2].includes(t))).map(f => [f[0], f[1]]),
  };
};

// short excerpt around the first matching word
const searchSnippet = (text, tokens) => {
  const t = String(text);
  if (t.length <= 70) return t;
  const lower = t.toLowerCase();
  const at = Math.min(...tokens.map(k => { const i = lower.indexOf(k); return i === -1 ? Infinity : i; }));
  const start = Math.max(0, (Number.isFinite(at) ? at : 0) - 25);
  return `${start > 0 ? '…' : ''}${t.slice(start, start + 70)}${start + 70 < t.length ? '…' : ''}`;
};

function Highlight({ text, query }) {
  const t = text == null ? '' : String(text);
  const tokens = (query || '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || t === '') return <>{t}</>;
  const re = new RegExp(`(${tokens.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {t.split(re).map((part, i) => (i % 2 === 1
        ? <mark key={i} style={{ background: 'var(--c-ffd166)', color: 'var(--c-5c4033)', borderRadius: '3px', padding: '0 2px' }}>{part}</mark>
        : part))}
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // AUTHENTICATION STATE LISTENER
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error signing in: ", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };

  // 1. STATE WITH REAL-TIME CLOUD SYNC & PRIVATE USER PATHS
  const [orders, setOrders] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setWishlist([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const ordersColRef = collection(db, "users", user.uid, "pdd_orders");
    const wishlistColRef = collection(db, "users", user.uid, "pdd_wishlist");

    const unsubOrders = onSnapshot(ordersColRef, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setOrders(ordersData);
    });

    const unsubWishlist = onSnapshot(wishlistColRef, (snapshot) => {
      const wishlistData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setWishlist(wishlistData);
      setLoading(false);
    });

    return () => {
      unsubOrders();
      unsubWishlist();
    };
  }, [user]);

  // NAVIGATION TAB STATE ("orders" or "wishlist")
  const [activeTab, setActiveTab] = useState('orders');
  const [selectedBatch, setSelectedBatch] = useState('All Batches');
  const [isBatchDropdownOpen, setIsBatchDropdownOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  
  const dropdownRef = useRef(null);
  const accountMenuRef = useRef(null);

  // MODAL FORM CUSTOM DROPDOWN STATES
  const [modalBatchOpen, setModalBatchOpen] = useState(false);
  const [modalShippingOpen, setModalShippingOpen] = useState(false);
  const [modalOrderStatusOpen, setModalOrderStatusOpen] = useState(false);

  // BATCH EDIT STATES FOR SELECTED ORDERS
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [batchEditTargetBatch, setBatchEditTargetBatch] = useState(KEEP);
  const [batchEditTargetShipping, setBatchEditTargetShipping] = useState(KEEP);
  const [batchEditTargetOrderStatus, setBatchEditTargetOrderStatus] = useState(KEEP);
  const [batchEditTargetActualDelivery, setBatchEditTargetActualDelivery] = useState('');
  const [batchEditChangeDate, setBatchEditChangeDate] = useState('');   // '' = automatic (today / delivery date)
  const [batchHistoryEdits, setBatchHistoryEdits] = useState([]);       // manual status-history edits for all selected orders
  
  const [batchEditBatchDropdownOpen, setBatchEditBatchDropdownOpen] = useState(false);
  const [batchEditShippingDropdownOpen, setBatchEditShippingDropdownOpen] = useState(false);
  const [batchEditOrderStatusDropdownOpen, setBatchEditOrderStatusDropdownOpen] = useState(false);

  // CONFIRMATION DIALOG (used by every delete button)
  const [confirmDialog, setConfirmDialog] = useState(null);

  // WISHLIST SELECTION + MOVE-TO-BATCH STATES
  const [selectedWishlistIds, setSelectedWishlistIds] = useState([]);
  const [wishlistMoveBatch, setWishlistMoveBatch] = useState(null); // null = auto (latest batch used in orders)
  const [wishlistMoveBatchOpen, setWishlistMoveBatchOpen] = useState(false);
  const wishlistMoveRef = useRef(null);

  // UNDO STATE FOR WISHLIST -> ORDERS MOVES
  const [lastMove, setLastMove] = useState(null);

  // Close custom dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsBatchDropdownOpen(false);
      }
      if (wishlistMoveRef.current && !wishlistMoveRef.current.contains(event.target)) {
        setWishlistMoveBatchOpen(false);
      }
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setIsAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // GLOBAL SEARCH STATE
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBoxRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setSearchOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // THEME (light / dark). Defaults to the device setting until the user picks one.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('pdd-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (e) { /* storage unavailable */ }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pdd-theme', theme); } catch (e) { /* storage unavailable */ }
  }, [theme]);

  // PAGINATION STATES FOR ORDERS
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPerPage, setOrdersPerPage] = useState(10);

  // PAGINATION STATES FOR WISHLIST
  const [wishlistPage, setWishlistPage] = useState(1);
  const [wishlistPerPage, setWishlistPerPage] = useState(10);

  // PAGINATION STATES FOR ARCHIVE + UNDO TOAST FOR ARCHIVING
  const [archivePage, setArchivePage] = useState(1);
  const [archiveBatch, setArchiveBatch] = useState('All Batches'); // batch filter for the Archive tab
  const [archiveTabHover, setArchiveTabHover] = useState(false);   // Archive tab is icon-only until hovered / focused
  const [archivePerPage, setArchivePerPage] = useState(10);
  const [lastArchive, setLastArchive] = useState(null);

  // MODAL STATES
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [historyDraft, setHistoryDraft] = useState([]);          // status history shown in the edit form
  const [pendingChangeDate, setPendingChangeDate] = useState(''); // date for the status change being made ('' = automatic)
  const [isExportOpen, setIsExportOpen] = useState(false);
  // "Average Days per Stage" panel: collapsed by default, and it remembers your choice on this device
  const [stageOpen, setStageOpen] = useState(() => { try { return localStorage.getItem('pdd_stage_panel_open') === '1'; } catch { return false; } });
  const toggleStageOpen = () => setStageOpen(prev => {
    const next = !prev;
    try { localStorage.setItem('pdd_stage_panel_open', next ? '1' : '0'); } catch { /* storage unavailable: fine */ }
    return next;
  });

  const [isWishlistModalOpen, setIsWishlistModalOpen] = useState(false);
  const [editingWishlistItem, setEditingWishlistItem] = useState(null);

  // Photo review generator (client-side only; nothing is saved to Firebase)
  const [photoReviewOrder, setPhotoReviewOrder] = useState(null);
  const [photoReviewQueue, setPhotoReviewQueue] = useState([]);   // more delivered orders waiting for a review after this one

  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideActiveStep, setGuideActiveStep] = useState(null);

  // ONBOARDING TOUR STATE
  const [tourPhase, setTourPhase] = useState('off'); // 'off' | 'welcome' | 'running'
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [tourLang, setTourLang] = useState('en');
  const [tourSampleOrder, setTourSampleOrder] = useState(null);       // local state only - never written to Firebase
  const [tourSampleWishlist, setTourSampleWishlist] = useState(null); // local state only - never written to Firebase
  const [tourRealOrderId, setTourRealOrderId] = useState(null);       // a real order the user saved during the tour
  const [tourRealWishlistId, setTourRealWishlistId] = useState(null); // a real wishlist item saved during the tour
  const [tutorialStatusLoaded, setTutorialStatusLoaded] = useState(false);
  const [hasCompletedTutorial, setHasCompletedTutorial] = useState(true);
  const prevTourModalRef = useRef(null);
  const tourViewSnapshotRef = useRef(null);

  // FORM STATES
  const [orderFormData, setOrderFormData] = useState({
    name: '',
    qty: 1,
    cost: '',
    date: new Date().toISOString().split('T')[0],
    batch: 'Batch 1',
    shippingStatus: 'Ordered',
    orderStatus: '',
    notes: '',
    actualDeliveryDate: ''
  });

  const [wishlistFormData, setWishlistFormData] = useState({
    name: '',
    qty: 1,
    initialCost: '',
    latestCost: ''
  });

  const calculateEstDelivery = (orderDateStr) => {
    if (!orderDateStr) return '';
    const date = new Date(orderDateStr);
    date.setMonth(date.getMonth() + 1);
    date.setDate(date.getDate() + 5);
    return date.toISOString().split('T')[0];
  };

  const calculateActualShippingDays = (orderDateStr, actualDeliveryDateStr) => {
    if (!orderDateStr || !actualDeliveryDateStr) return null;
    const start = new Date(orderDateStr);
    const end = new Date(actualDeliveryDateStr);
    const diffTime = end - start;
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 ? diffDays : null;
  };

  const getButtonStyle = (variant = 'default', customBg, customColor) => {
    let bg = customBg || 'var(--c-f2e8cf)';
    let color = customColor || 'var(--c-5c4033)';
    let border = '1px solid var(--c-ffd166)';

    if (variant === 'primary') {
      bg = 'var(--c-ffd166)';
      color = 'var(--c-5c4033)';
      border = '1px solid var(--c-e6ccb2)';
    } else if (variant === 'pink') {
      bg = 'var(--c-ffafcc)';
      color = 'var(--c-5c4033)';
      border = '1px solid var(--c-ffc8dd)';
    } else if (variant === 'blue') {
      bg = 'var(--c-bde0fe)';
      color = 'var(--c-03045e)';
      border = '1px solid var(--c-90e0ef)';
    } else if (variant === 'danger') {
      bg = 'var(--c-ffccd5)';
      color = 'var(--c-780000)';
      border = '1px solid var(--c-ffb3c1)';
    } else if (variant === 'light') {
      bg = 'var(--c-fffdfa)';
      color = 'var(--c-7f5539)';
      border = '1px solid var(--c-e6ccb2)';
    }

    return {
      background: bg,
      color: color,
      border: border,
      padding: '8px 16px',
      borderRadius: '9999px',
      fontWeight: '700',
      fontSize: '12px',
      cursor: 'pointer',
      boxShadow: '0 3px 0 rgba(var(--shadow-btn-rgb), 0.4)',
      transition: 'all 0.1s ease',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      outline: 'none',
      textDecoration: 'none',
      boxSizing: 'border-box'
    };
  };

  // Photo review status of a Delivered order: pending (yellow) or reviewed (green). Click it to flip it by hand.
  const reviewTag = (order) => {
    if (order.shippingStatus !== 'Delivered' || order.isTutorialSample) return null;
    const done = !!order.reviewed;
    return (
      <button
        type="button"
        onClick={() => setOrderReviewed(order, !done)}
        title={done ? `Photo review done${order.reviewedAt ? ` on ${order.reviewedAt}` : ''}. Click to mark it as pending again.` : 'Photo review pending. Click to mark it as done (for example if you posted one elsewhere).'}
        style={{ background: done ? 'var(--c-d4edbc)' : 'var(--c-fcf2cd)', color: done ? 'var(--c-1b4332)' : 'var(--c-5c4033)', border: `1px solid ${done ? 'transparent' : 'var(--c-ffd166)'}`, borderRadius: '9999px', padding: '2px 8px', fontSize: '10px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', fontFamily: 'inherit', marginTop: '5px', whiteSpace: 'nowrap' }}
      >
        {done ? <Check size={10} strokeWidth={3} /> : <Star size={10} strokeWidth={2.5} />}
        {done ? 'Reviewed' : 'Review pending'}
      </button>
    );
  };

  // Shown on any order marked Delivered, in General Orders or the Archive
  const photoReviewButton = (order) => (order.shippingStatus === 'Delivered' ? (
    <button
      type="button"
      {...ttO(order, 'photo-review-btn')}
      onClick={() => { setPhotoReviewQueue([]); setPhotoReviewOrder(order); }}
      style={{ ...getButtonStyle('primary'), padding: '8px 10px' }}
      title="Generate Photo Review"
      aria-label="Generate Photo Review"
    >
      <Camera size={14} />
    </button>
  ) : null);

  const getShippingBadgeStyle = (status) => {
    let bg = 'var(--c-ffffff)';
    let color = 'var(--c-5c4033)';
    
    switch(status) {
      case 'Ordered': bg = 'var(--c-ffffff)'; color = 'var(--c-5c4033)'; break;
      case 'At China Warehouse': bg = 'var(--c-ffcfc9)'; color = 'var(--c-5c4033)'; break;
      case 'Dispatched / China Customs': bg = 'var(--c-c9daf8)'; color = 'var(--c-03045e)'; break;
      case 'In Transit to PH': bg = 'var(--c-fdd6a8)'; color = 'var(--c-5c4033)'; break;
      case 'PH Customs Clearance': bg = 'var(--c-e6cff2)'; color = 'var(--c-3c096c)'; break;
      case 'PH Hub / Out for Local Delivery': bg = 'var(--c-fcf2cd)'; color = 'var(--c-5c4033)'; break;
      case 'Delivered': bg = 'var(--c-d4edbc)'; color = 'var(--c-1b4332)'; break;
      case 'Undelivered': bg = 'var(--c-e37373)'; color = 'var(--c-ffffff)'; break;
      default: bg = 'var(--c-ffffff)'; color = 'var(--c-5c4033)';
    }

    return {
      background: bg,
      color: color,
      padding: '5px 12px',
      borderRadius: '9999px',
      fontSize: '11px',
      fontWeight: 'bold',
      border: '1px solid rgba(0,0,0,0.06)',
      cursor: 'pointer',
      display: 'inline-block',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 0 rgba(0,0,0,0.08)'
    };
  };

  const handleOpenGuideWithStatus = (status) => {
    setGuideActiveStep(status);
    setIsGuideOpen(true);
  };

  const renderPriceFlag = (qty, initialUnitCost, latestUnitCost) => {
    const initialTotal = qty * initialUnitCost;
    const latestTotal = qty * latestUnitCost;
    const diff = initialTotal - latestTotal;

    if (diff > 0) {
      return (
        <span style={{ background: 'var(--c-d8f3dc)', color: 'var(--c-1b4332)', padding: '4px 10px', borderRadius: '9999px', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
          <ArrowDown size={12} strokeWidth={3} style={{ verticalAlign: '-2px', marginRight: '3px' }} />₱{diff.toFixed(2)} SAVED!
        </span>
      );
    } else if (diff < 0) {
      return (
        <span style={{ background: 'var(--c-ffccd5)', color: 'var(--c-780000)', padding: '4px 10px', borderRadius: '9999px', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
          <ArrowUp size={12} strokeWidth={3} style={{ verticalAlign: '-2px', marginRight: '3px' }} />₱{Math.abs(diff).toFixed(2)} INCREASE!
        </span>
      );
    }
    return (
      <span style={{ background: 'var(--c-fcf6f0)', color: 'var(--c-8c7a6b)', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
        SAME
      </span>
    );
  };

  const handleOrderInputChange = (e) => {
    const { name, value } = e.target;
    setOrderFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleWishlistInputChange = (e) => {
    const { name, value } = e.target;
    setWishlistFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleOpenAddOrder = () => {
    setEditingOrder(null);
    setHistoryDraft([]);
    setPendingChangeDate('');
    setOrderFormData({
      name: '',
      qty: 1,
      cost: '',
      date: new Date().toISOString().split('T')[0],
      batch: selectedBatch === 'All Batches' ? getLatestOrderBatch() : selectedBatch,
      shippingStatus: 'Ordered',
      orderStatus: '',
      notes: '',
      actualDeliveryDate: ''
    });
    setIsOrderModalOpen(true);
  };

  const handleOpenEditOrder = (order) => {
    setEditingOrder(order);
    setHistoryDraft(historyForEditing(order));
    setPendingChangeDate('');
    setOrderFormData({
      name: order.name,
      qty: order.qty,
      cost: order.cost,
      date: order.date,
      batch: order.batch || 'Batch 1',
      shippingStatus: order.shippingStatus || 'Ordered',
      orderStatus: order.orderStatus === 'OK ✔' ? 'OK' : (order.orderStatus || ''),
      notes: order.notes || '',
      actualDeliveryDate: order.actualDeliveryDate || ''
    });
    setIsOrderModalOpen(true);
  };

  const handleDeleteOrder = (order) => {
    setConfirmDialog({
      title: 'Delete this order?',
      message: `"${order.name}" will be permanently removed from your tracker. This can't be undone.`,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "users", user.uid, "pdd_orders", String(order.id)));
          setSelectedOrderIds(prev => prev.filter(i => i !== order.id));
        } catch (error) {
          console.error("Error deleting order: ", error);
        }
      }
    });
  };

  const handleSaveOrder = async (e) => {
    e.preventDefault();
    if (!orderFormData.name || !orderFormData.cost) {
      alert('Please enter at least an Item Name and Cost!');
      return;
    }

    const orderId = editingOrder ? String(editingOrder.id) : String(Date.now());

    // Status history: log the change (with its date) whenever the shipping status is different from before
    const todayLocal = localDateStr();
    let statusHistory;
    if (editingOrder) {
      const base = normalizeHistory(historyDraft);
      const oldStatus = editingOrder.shippingStatus || 'Ordered';
      statusHistory = orderFormData.shippingStatus !== oldStatus
        ? appendStatusChange(
            base, oldStatus, orderFormData.shippingStatus,
            pendingChangeDate || entryDateFor(orderFormData.shippingStatus, { actualDeliveryDate: orderFormData.actualDeliveryDate, fallback: todayLocal }),
            orderFormData.date
          )
        : base;
    } else {
      statusHistory = initialHistory(orderFormData.shippingStatus, { orderDate: orderFormData.date, actualDeliveryDate: orderFormData.actualDeliveryDate, fallback: todayLocal });
    }

    const orderPayload = {
      name: orderFormData.name,
      qty: Number(orderFormData.qty),
      cost: Number(orderFormData.cost),
      date: orderFormData.date,
      batch: orderFormData.batch,
      shippingStatus: orderFormData.shippingStatus,
      orderStatus: orderFormData.orderStatus,
      notes: orderFormData.notes,
      actualDeliveryDate: orderFormData.actualDeliveryDate,
      estDelivery: calculateEstDelivery(orderFormData.date),
      statusHistory,
      ...(editingOrder ? { reviewed: !!editingOrder.reviewed, reviewedAt: editingOrder.reviewedAt || '' } : {})
    };

    try {
      await setDoc(doc(db, "users", user.uid, "pdd_orders", orderId), orderPayload);
      if (!editingOrder) onTourRealSave('order', orderId);
    } catch (error) {
      console.error("Error saving order: ", error);
    }

    setIsOrderModalOpen(false);
    setEditingOrder(null);
  };

  // PHOTO REVIEW TAG: saved on the order. Sample (tour) rows are never written to Firebase.
  const setOrderReviewed = async (order, value) => {
    if (!order || order.isTutorialSample) return;
    try {
      await setDoc(doc(db, "users", user.uid, "pdd_orders", String(order.id)), { reviewed: !!value, reviewedAt: value ? localDateStr() : '' }, { merge: true });
    } catch (error) {
      console.error("Error updating review tag: ", error);
    }
  };
  const isPendingReview = (o) => o.shippingStatus === 'Delivered' && !o.reviewed && !o.isTutorialSample;
  // Review queue: the pending delivered orders in the list being shown, one after another
  const startReviewQueue = (list) => {
    const pending = list.filter(isPendingReview);
    if (pending.length === 0) return;
    setPhotoReviewQueue(pending.slice(1));
    setPhotoReviewOrder(pending[0]);
  };

  // OPEN BATCH EDIT: pre-fill with whatever the selected orders already have in common.
  // Anything that differs between the selected orders (or is untouched) is kept as-is.
  const handleOpenBatchEdit = () => {
    const selected = orders.filter(o => selectedOrderIds.includes(o.id));
    const common = (getter, fallback) => {
      if (selected.length === 0) return fallback;
      const first = getter(selected[0]);
      return selected.every(o => getter(o) === first) ? first : fallback;
    };

    setBatchEditTargetBatch(common(o => o.batch || '', KEEP) || KEEP);
    setBatchEditTargetShipping(common(o => o.shippingStatus || 'Ordered', KEEP));
    setBatchEditTargetOrderStatus(common(o => o.orderStatus || '', KEEP));
    setBatchEditTargetActualDelivery(common(o => o.actualDeliveryDate || '', ''));
    setBatchEditChangeDate('');
    setBatchHistoryEdits([]);
    setBatchEditBatchDropdownOpen(false);
    setBatchEditShippingDropdownOpen(false);
    setBatchEditOrderStatusDropdownOpen(false);
    setIsBatchEditOpen(true);
  };

  // BATCH EDIT EXECUTION: only fields you actually chose are written (merge), everything else stays untouched
  const handleExecuteBatchEdit = async () => {
    if (selectedOrderIds.length === 0) return;

    const changes = {};
    if (batchEditTargetBatch !== KEEP) changes.batch = batchEditTargetBatch;
    if (batchEditTargetShipping !== KEEP) changes.shippingStatus = batchEditTargetShipping;
    if (batchEditTargetOrderStatus !== KEEP) changes.orderStatus = batchEditTargetOrderStatus;
    if (batchEditTargetActualDelivery) changes.actualDeliveryDate = batchEditTargetActualDelivery;

    // Manual history edits: 'set' rows need a date, otherwise they are ignored
    const validHistoryEdits = batchHistoryEdits.filter(e => e.status && (e.action === 'remove' || /^\d{4}-\d{2}-\d{2}$/.test(e.date || '')));

    if (Object.keys(changes).length === 0 && validHistoryEdits.length === 0) {
      setIsBatchEditOpen(false);
      return;
    }

    try {
      let updated = 0;
      const todayLocal = localDateStr();
      for (const id of selectedOrderIds) {
        const existing = orders.find(o => String(o.id) === String(id));
        if (existing) {
          const payload = { ...changes };
          const oldStatus = existing.shippingStatus || 'Ordered';

          // 1) your manual history edits
          let hist = validHistoryEdits.length ? applyHistoryEdits(historyForEditing(existing), validHistoryEdits) : null;

          // 2) a different shipping status gets logged too (unless you already set a date for that status above)
          if (changes.shippingStatus && changes.shippingStatus !== oldStatus) {
            const setByHand = validHistoryEdits.some(e => e.action === 'set' && e.status === changes.shippingStatus);
            if (!setByHand) {
              const when = batchEditChangeDate || entryDateFor(changes.shippingStatus, { actualDeliveryDate: changes.actualDeliveryDate || existing.actualDeliveryDate, fallback: todayLocal });
              hist = appendStatusChange(hist || existing.statusHistory, oldStatus, changes.shippingStatus, when, existing.date);
            }
          }
          if (hist) payload.statusHistory = hist;
          await setDoc(doc(db, "users", user.uid, "pdd_orders", String(id)), payload, { merge: true });
          updated++;
        }
      }
      setIsBatchEditOpen(false);
      setSelectedOrderIds([]);
      alert(`Successfully updated ${updated} orders!`);
    } catch (error) {
      console.error("Error batch updating orders: ", error);
      alert('Failed to batch update orders. Check console for details.');
    }
  };

  const handleSelectAllCurrentSlice = (e) => {
    if (e.target.checked) {
      const allIdsInSlice = currentOrdersSlice.map(o => o.id);
      setSelectedOrderIds(prev => Array.from(new Set([...prev, ...allIdsInSlice])));
    } else {
      const sliceIds = new Set(currentOrdersSlice.map(o => o.id));
      setSelectedOrderIds(prev => prev.filter(id => !sliceIds.has(id)));
    }
  };

  const handleToggleSelectOrder = (id) => {
    setSelectedOrderIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleOpenAddWishlist = () => {
    setEditingWishlistItem(null);
    setWishlistFormData({ name: '', qty: 1, initialCost: '', latestCost: '' });
    setIsWishlistModalOpen(true);
  };

  const handleOpenEditWishlist = (item) => {
    setEditingWishlistItem(item);
    setWishlistFormData({
      name: item.name,
      qty: item.qty,
      initialCost: item.initialCost,
      latestCost: item.latestCost
    });
    setIsWishlistModalOpen(true);
  };

  const handleDeleteWishlist = (item) => {
    setConfirmDialog({
      title: 'Delete this wishlist item?',
      message: `"${item.name}" will be permanently removed from your wishlist. This can't be undone.`,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "users", user.uid, "pdd_wishlist", String(item.id)));
          setSelectedWishlistIds(prev => prev.filter(i => i !== item.id));
        } catch (error) {
          console.error("Error deleting wishlist item: ", error);
        }
      }
    });
  };

  const handleSaveWishlist = async (e) => {
    e.preventDefault();
    if (!wishlistFormData.name || !wishlistFormData.initialCost) {
      alert('Please enter at least an Item Name and Initial Cost!');
      return;
    }

    const initial = Number(wishlistFormData.initialCost);
    const latest = wishlistFormData.latestCost !== '' ? Number(wishlistFormData.latestCost) : initial;
    const itemId = editingWishlistItem ? String(editingWishlistItem.id) : String(Date.now());

    const wishlistPayload = {
      name: wishlistFormData.name,
      qty: Number(wishlistFormData.qty),
      initialCost: initial,
      latestCost: latest
    };

    try {
      await setDoc(doc(db, "users", user.uid, "pdd_wishlist", itemId), wishlistPayload);
      if (!editingWishlistItem) onTourRealSave('wishlist', itemId);
    } catch (error) {
      console.error("Error saving wishlist item: ", error);
    }

    setIsWishlistModalOpen(false);
    setEditingWishlistItem(null);
  };

  // ARCHIVE (manual only): flips a flag on the SAME document, so nothing else about the order changes.
  // Because the doc id never changes, a restored order lands in exactly the same spot (same batch, same row order).
  const archiveOrders = async (list) => {
    const targets = list.filter(o => o.shippingStatus === 'Delivered' && !o.archived && !o.isTutorialSample);
    if (targets.length === 0) return;
    try {
      for (const o of targets) {
        await setDoc(doc(db, "users", user.uid, "pdd_orders", String(o.id)), { archived: true }, { merge: true });
      }
      const ids = targets.map(o => String(o.id));
      setSelectedOrderIds(prev => prev.filter(id => !ids.includes(String(id))));
      setLastArchive({ ids });
    } catch (error) {
      console.error("Error archiving orders: ", error);
      alert('Failed to archive. Check console for details.');
    }
  };

  const restoreOrders = async (ids) => {
    try {
      for (const id of ids) {
        await setDoc(doc(db, "users", user.uid, "pdd_orders", String(id)), { archived: false }, { merge: true });
      }
    } catch (error) {
      console.error("Error restoring orders: ", error);
      alert('Failed to restore. Check console for details.');
    }
  };

  const handleUndoArchive = async () => {
    if (!lastArchive) return;
    await restoreOrders(lastArchive.ids);
    setLastArchive(null);
  };

  // SMART BATCH: the batch of the most recently added order (falls back to Batch 1)
  const getLatestOrderBatch = () => {
    let latest = null;
    let latestId = -Infinity;
    orders.forEach(o => {
      const n = Number(o.id);
      const idNum = Number.isFinite(n) ? n : 0;
      if (idNum >= latestId) {
        latestId = idNum;
        latest = o;
      }
    });
    return (latest && latest.batch) || 'Batch 1';
  };

  const latestOrderBatch = getLatestOrderBatch();
  // Every batch that exists on a real order (archived included), with open/finished status
  const batchInfo = buildBatchInfo(orders);
  const archiveBatchInfo = buildBatchInfo(orders.filter(o => o.archived));
  const effectiveMoveBatch = wishlistMoveBatch || latestOrderBatch;

  // Move one or many wishlist items into General Orders (stays on the Wishlist tab)
  const handleMoveItemsToTracker = async (items) => {
    if (!items || items.length === 0) return;

    const today = new Date().toISOString().split('T')[0];
    const targetBatch = effectiveMoveBatch;
    const moved = [];
    let idCounter = Date.now();

    try {
      for (const item of items) {
        const newOrderId = String(idCounter++);
        const { id: wishlistId, ...wishlistData } = item;

        const newOrder = {
          name: item.name,
          qty: item.qty,
          cost: item.latestCost || item.initialCost,
          date: today,
          batch: targetBatch,
          shippingStatus: 'Ordered',
          orderStatus: '',
          notes: 'Transferred from Wishlist',
          actualDeliveryDate: '',
          estDelivery: calculateEstDelivery(today),
          statusHistory: initialHistory('Ordered', { orderDate: today, fallback: today })
        };

        await setDoc(doc(db, "users", user.uid, "pdd_orders", newOrderId), newOrder);
        await deleteDoc(doc(db, "users", user.uid, "pdd_wishlist", String(wishlistId)));
        moved.push({ wishlistId: String(wishlistId), wishlistData, orderId: newOrderId });
      }
    } catch (error) {
      console.error("Error moving item to tracker: ", error);
    }

    if (moved.length > 0) {
      setSelectedWishlistIds(prev => prev.filter(id => !moved.some(m => m.wishlistId === String(id))));
      setLastMove({ items: moved, batch: targetBatch });
    }
  };

  // UNDO: put the moved items back on the wishlist exactly as they were, remove the created orders
  const handleUndoMove = async () => {
    if (!lastMove) return;
    try {
      for (const m of lastMove.items) {
        await setDoc(doc(db, "users", user.uid, "pdd_wishlist", m.wishlistId), m.wishlistData);
        await deleteDoc(doc(db, "users", user.uid, "pdd_orders", m.orderId));
        setSelectedOrderIds(prev => prev.filter(i => String(i) !== m.orderId));
      }
      setLastMove(null);
    } catch (error) {
      console.error("Error undoing move: ", error);
      alert('Failed to undo the move. Check console for details.');
    }
  };

  const handleToggleSelectWishlist = (id) => {
    setSelectedWishlistIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Tour sample rows are merged in for DISPLAY ONLY - they never enter `orders` / `wishlist` or Firebase.
  // Archived orders are kept out of the General Orders table AND its dashboard; they live in the Archive tab.
  const activeOrders = orders.filter(o => !o.archived);
  const archivedOrders = orders.filter(o => o.archived);
  // (a tour sample can be shown as a normal row, a delivered row, or an already-archived row)
  const ordersForView = tourSampleOrder && !tourSampleOrder.archived ? [tourSampleOrder, ...activeOrders] : activeOrders;
  const archivedForView = tourSampleOrder && tourSampleOrder.archived ? [tourSampleOrder, ...archivedOrders] : archivedOrders;
  const wishlistForView = tourSampleWishlist ? [tourSampleWishlist, ...wishlist] : wishlist;

  const query = searchQuery.trim().toLowerCase();

  const batchFilteredOrders = selectedBatch === 'All Batches' 
    ? ordersForView 
    : ordersForView.filter(o => o.batch === selectedBatch);

  // Searching is GLOBAL: while a query is active it looks through every field of every entry
  // (orders, archive and wishlist), and the batch filter doesn't hide matches.
  const searchTokens = query ? query.split(/\s+/).filter(Boolean) : [];
  const orderMatches = (o) => matchFields(orderSearchFields(o), searchTokens).match;

  const finalFilteredOrders = query 
    ? ordersForView.filter(orderMatches)
    : batchFilteredOrders;

  const displayTotalCost = finalFilteredOrders.reduce((acc, item) => acc + (item.qty * item.cost), 0);

  const finalFilteredWishlist = query
    ? wishlistForView.filter(item => matchFields(wishlistSearchFields(item), searchTokens).match)
    : wishlistForView;

  // Results for the search dropdown, across all three sections
  const searchResults = query ? [
    ...activeOrders.map(o => ({ tab: 'orders', type: 'Order', key: `o-${o.id}`, title: o.name, ...matchFields(orderSearchFields(o), searchTokens) })),
    ...archivedOrders.map(o => ({ tab: 'archive', type: 'Archived', key: `a-${o.id}`, title: o.name, ...matchFields(orderSearchFields(o), searchTokens) })),
    ...wishlist.map(w => ({ tab: 'wishlist', type: 'Wishlist', key: `w-${w.id}`, title: w.name, ...matchFields(wishlistSearchFields(w), searchTokens) })),
  ].filter(r => r.match) : [];
  const searchCounts = {
    orders: searchResults.filter(r => r.tab === 'orders').length,
    archive: searchResults.filter(r => r.tab === 'archive').length,
    wishlist: searchResults.filter(r => r.tab === 'wishlist').length,
  };
  // small count bubble on a tab while searching
  const archiveTabExpanded = archiveTabHover || (tourPhase === 'running' && TOUR_STEPS[tourStepIndex].target === 'tab-archive');
  const foundPill = (n) => (query ? (
    <span title={`${n} matching`} style={{ background: n > 0 ? 'var(--c-ffd166)' : 'var(--c-fcf6f0)', color: n > 0 ? 'var(--c-5c4033)' : 'var(--c-b0a499)', borderRadius: '9999px', padding: '1px 7px', fontSize: '10px', fontWeight: 700, marginLeft: '2px' }}>{n}</span>
  ) : null);

  const totalOrdersPages = Math.ceil(finalFilteredOrders.length / ordersPerPage) || 1;
  const currentOrdersSlice = finalFilteredOrders.slice(
    (ordersPage - 1) * ordersPerPage,
    ordersPage * ordersPerPage
  );

  const totalWishlistPages = Math.ceil(finalFilteredWishlist.length / wishlistPerPage) || 1;
  const currentWishlistSlice = finalFilteredWishlist.slice(
    (wishlistPage - 1) * wishlistPerPage,
    wishlistPage * wishlistPerPage
  );

  const finalFilteredArchive = query
    ? archivedForView.filter(orderMatches)
    : (archiveBatch === 'All Batches' ? archivedForView : archivedForView.filter(o => o.batch === archiveBatch));
  const totalArchivePages = Math.ceil(finalFilteredArchive.length / archivePerPage) || 1;
  const currentArchiveSlice = finalFilteredArchive.slice(
    (archivePage - 1) * archivePerPage,
    archivePage * archivePerPage
  );
  const deliveredInView = finalFilteredOrders.filter(o => o.shippingStatus === 'Delivered');

  const wishlistInitialTotal = wishlistForView.reduce((acc, item) => acc + (item.qty * item.initialCost), 0);
  const wishlistLatestTotal = wishlistForView.reduce((acc, item) => acc + (item.qty * item.latestCost), 0);

  const shippingStatusOptions = [
    'Ordered',
    'At China Warehouse',
    'Dispatched / China Customs',
    'In Transit to PH',
    'PH Customs Clearance',
    'PH Hub / Out for Local Delivery',
    'Delivered',
    'Undelivered'
  ];
  const orderStatusOptions = ['-- None --', 'OK', 'Missing', 'Damaged', 'Refunded'];
  // Older orders were saved as 'OK ✔'. Both spellings count as OK, and neither shows a glyph: OK gets a check icon.
  const isOkStatus = (v) => v === 'OK' || v === 'OK ✔';
  const statusLabel = (v) => (isOkStatus(v)
    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Check size={12} strokeWidth={3} /> OK</span>
    : v);

  const totalOrdersCount = batchFilteredOrders.length;
  // Delivered is STANDALONE like the average: every delivered order counts (archived too) and the batch filter is ignored.
  const deliveredCount = [...ordersForView, ...archivedForView].filter(o => o.shippingStatus === 'Delivered').length;
  const totalQuantity = batchFilteredOrders.reduce((acc, o) => acc + (Number(o.qty) || 0), 0);
  const statusStats = (status) => {
    const list = batchFilteredOrders.filter(o => o.shippingStatus === status);
    return { entries: list.length, pcs: list.reduce((acc, o) => acc + (Number(o.qty) || 0), 0) };
  };
  const chinaCustomsStats = statusStats('Dispatched / China Customs');
  const inTransitStats = statusStats('In Transit to PH');
  const phCustomsStats = statusStats('PH Customs Clearance');
  const phHubStats = statusStats('PH Hub / Out for Local Delivery');

  // Average shipping days is STANDALONE: every real order counts (archived ones too) and the batch filter is ignored.
  // It only changes when an order gets its delivery date edited or is permanently deleted.
  const averageDays = (list) => {
    const days = list.map(o => calculateActualShippingDays(o.date, o.actualDeliveryDate)).filter(d => d !== null);
    return days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : '-';
  };
  const avgShippingDays = averageDays(orders);

  // Real timing learned from status history (all real orders, archived included)
  const todayStr = localDateStr();
  const stageStats = computeStageStats(orders);
  const remainingStats = computeRemainingStats(orders);
  const totalStats = computeTotalStats(orders);
  const smartEstFor = (o) => (o.isTutorialSample ? null : smartEstimate(o, remainingStats, totalStats, todayStr));

  // Archive dashboard (archived orders only; includes the tour's sample row while the tour shows it)
  const archiveBatchView = archiveBatch === 'All Batches' ? archivedForView : archivedForView.filter(o => o.batch === archiveBatch);
  const archiveTotalOrders = archiveBatchView.length;
  const archiveTotalQty = archiveBatchView.reduce((acc, o) => acc + (Number(o.qty) || 0), 0);
  const archiveTotalSpent = archiveBatchView.reduce((acc, o) => acc + (Number(o.qty) || 0) * (Number(o.cost) || 0), 0);
  const archiveAvgDays = averageDays(archivedForView);
  const money = (n) => `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Soft pastel tints (theme-aware, defined in index.css) so the dashboard boxes stay light and easy to read
  // Status boxes reuse the exact shipping-badge colors; everything else uses one soft rose. No border lines.
  const STATUS_BOX_BG = { warehouse: 'var(--c-ffcfc9)', customs: 'var(--c-c9daf8)', transit: 'var(--c-fdd6a8)', phcustoms: 'var(--c-e6cff2)', hub: 'var(--c-fcf2cd)', delivered: 'var(--c-d4edbc)' };
  const tintBox = (tint = 'rose') => ({ background: STATUS_BOX_BG[tint] || `var(--tint-${tint})`, padding: '10px', borderRadius: '10px', border: 'none' });
  const statCard = (label, value, color, sub, title, tint) => (
    <div key={label} title={title} style={tintBox(tint)}>
      <span style={{ fontSize: '10px', color: 'var(--c-7f5539)', display: 'block', fontWeight: '700' }}>{label}</span>
      <strong style={{ fontSize: '16px', color }}>{value}</strong>
      {sub != null && <span style={{ fontSize: '10px', color: 'var(--c-7f5539)', display: 'block', marginTop: '2px' }}>{sub}</span>}
    </div>
  );

  const renderPagination = (currentPage, totalPages, setPage, perPage, setPerPage) => {
    const pageNumbers = [];
    for (let i = 1; i <= totalPages; i++) {
      pageNumbers.push(i);
    }

    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '18px', flexWrap: 'wrap', gap: '10px', fontSize: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {[10, 25, 50, 100].map((num) => (
            <button
              key={num}
              onClick={() => { setPerPage(num); setPage(1); }}
              style={getButtonStyle(perPage === num ? 'primary' : 'light')}
            >
              {num}
            </button>
          ))}
          <span style={{ color: 'var(--c-8c7a6b)', marginLeft: '5px' }}>records per page</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => setPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            style={{
              ...getButtonStyle('light'),
              opacity: currentPage === 1 ? 0.5 : 1,
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
            }}
          >
            <ChevronLeft size={15} />
          </button>

          {pageNumbers.map(num => (
            <button
              key={num}
              onClick={() => setPage(num)}
              style={getButtonStyle(currentPage === num ? 'primary' : 'light')}
            >
              {num}
            </button>
          ))}

          <button
            onClick={() => setPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            style={{
              ...getButtonStyle('light'),
              opacity: currentPage === totalPages ? 0.5 : 1,
              cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
            }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    );
  };


  // =====================================================================
  // ONBOARDING TOUR LOGIC
  // =====================================================================
  // Keep page numbers valid when archiving / restoring shrinks or grows a list
  useEffect(() => { if (ordersPage > totalOrdersPages) setOrdersPage(totalOrdersPages); }, [ordersPage, totalOrdersPages]);
  useEffect(() => { if (archivePage > totalArchivePages) setArchivePage(totalArchivePages); }, [archivePage, totalArchivePages]);
  // if the last order of the chosen archive batch gets restored/deleted, fall back to All Batches
  useEffect(() => {
    if (archiveBatch !== 'All Batches' && !archivedOrders.some(o => o.batch === archiveBatch)) setArchiveBatch('All Batches');
  }, [archiveBatch, archivedOrders]);

  const resetTourDropdowns = () => {
    setModalBatchOpen(false);
    setModalShippingOpen(false);
    setModalOrderStatusOpen(false);
    setBatchEditBatchDropdownOpen(false);
    setBatchEditShippingDropdownOpen(false);
    setBatchEditOrderStatusDropdownOpen(false);
    setIsBatchDropdownOpen(false);
    setWishlistMoveBatchOpen(false);
    setIsAccountMenuOpen(false);
  };

  const closeTourModals = () => {
    setIsOrderModalOpen(false);
    setEditingOrder(null);
    setIsWishlistModalOpen(false);
    setEditingWishlistItem(null);
    setIsBatchEditOpen(false);
    resetTourDropdowns();
  };

  // 1) Read the "has seen the tutorial" flag from Firestore when the user signs in
  useEffect(() => {
    if (!user) {
      setTutorialStatusLoaded(false);
      setHasCompletedTutorial(true);
      setTourPhase('off');
      return;
    }
    let cancelled = false;
    setTutorialStatusLoaded(false);
    (async () => {
      let completed = true; // if the read fails, don't nag the user with the tour on every login
      try {
        const snap = await getDoc(doc(db, "users", user.uid, "pdd_settings", "profile"));
        completed = snap.exists() && snap.data().hasCompletedTutorial === true;
      } catch (error) {
        console.error("Error loading tutorial status: ", error);
      }
      if (!cancelled) {
        setHasCompletedTutorial(completed);
        setTutorialStatusLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // 2) Auto-start once for anyone who hasn't completed or skipped it (new and existing users)
  useEffect(() => {
    if (user && !loading && tutorialStatusLoaded && !hasCompletedTutorial && tourPhase === 'off') {
      setTourPhase('welcome');
    }
  }, [user, loading, tutorialStatusLoaded, hasCompletedTutorial, tourPhase]);

  const markTutorialComplete = async () => {
    setHasCompletedTutorial(true);
    if (!user) return;
    try {
      await setDoc(doc(db, "users", user.uid, "pdd_settings", "profile"), { hasCompletedTutorial: true }, { merge: true });
    } catch (error) {
      console.error("Error saving tutorial status: ", error);
    }
  };

  // "How to Use?" button
  const openTour = () => {
    setIsAccountMenuOpen(false);
    setIsGuideOpen(false);
    setConfirmDialog(null);
    setIsBatchDropdownOpen(false);
    setTourPhase('welcome');
  };

  // Language picked in the welcome prompt -> remember the user's current view, then start the spotlight steps
  const startTourSteps = (lang) => {
    tourViewSnapshotRef.current = { activeTab, selectedBatch, archiveBatch, searchQuery, ordersPage, wishlistPage, selectedOrderIds, selectedWishlistIds };
    prevTourModalRef.current = null;
    setTourLang(lang);
    setSearchQuery('');
    setSelectedBatch('All Batches');
    setArchiveBatch('All Batches');
    setOrdersPage(1);
    setWishlistPage(1);
    setSelectedOrderIds([]);
    setSelectedWishlistIds([]);
    setTourRealOrderId(null);
    setTourRealWishlistId(null);
    setTourStepIndex(0);
    setTourPhase('running');
  };

  // Finish AND Skip both land here: remove samples, restore the user's view, save the flag
  const finishTour = () => {
    setTourPhase('off');
    setTourSampleOrder(null);
    setTourSampleWishlist(null);
    setTourRealOrderId(null);
    setTourRealWishlistId(null);
    closeTourModals();
    prevTourModalRef.current = null;
    const snap = tourViewSnapshotRef.current;
    if (snap) {
      setActiveTab(snap.activeTab);
      setSelectedBatch(snap.selectedBatch);
      setArchiveBatch(snap.archiveBatch);
      setSearchQuery(snap.searchQuery);
      setOrdersPage(snap.ordersPage);
      setWishlistPage(snap.wishlistPage);
      setSelectedOrderIds(snap.selectedOrderIds);
      setSelectedWishlistIds(snap.selectedWishlistIds);
      tourViewSnapshotRef.current = null;
    }
    markTutorialComplete();
  };

  const tourNext = () => {
    if (tourStepIndex >= TOUR_STEPS.length - 1) finishTour();
    else setTourStepIndex(i => i + 1);
  };
  const tourBack = () => setTourStepIndex(i => Math.max(0, i - 1));

  // If the user really saves an entry while a tour form is open, keep that entry and jump to its row steps
  const onTourRealSave = (kind, id) => {
    if (tourPhase !== 'running') return;
    const step = TOUR_STEPS[tourStepIndex];
    if (kind === 'order' && step.modal === 'order') {
      setTourRealOrderId(id);
      setTourStepIndex(FIRST_ORDER_ROW_STEP);
    }
    if (kind === 'wishlist' && step.modal === 'wishlist') {
      setTourRealWishlistId(id);
      setTourStepIndex(FIRST_WISHLIST_ROW_STEP);
    }
  };

  // Which row do the row-level steps point at? A real entry made during the tour, else the sample.
  const realTourOrderExists = !!tourRealOrderId && orders.some(o => o.id === tourRealOrderId);
  const realTourWishlistExists = !!tourRealWishlistId && wishlist.some(w => w.id === tourRealWishlistId);
  const tourStepSample = tourPhase === 'running' ? TOUR_STEPS[tourStepIndex].sample : null;
  // The delivered/archived demo steps always use the sample; plain row steps prefer a real order made in the tour.
  const tourOrderTargetId = tourPhase === 'running'
    ? ((tourStepSample === 'order' && realTourOrderExists) ? tourRealOrderId : (tourSampleOrder ? tourSampleOrder.id : null))
    : null;
  const tourWishlistTargetId = tourPhase === 'running'
    ? (realTourWishlistExists ? tourRealWishlistId : (tourSampleWishlist ? tourSampleWishlist.id : null))
    : null;
  const ttO = (order, name) => (tourOrderTargetId && order.id === tourOrderTargetId ? { 'data-tour': name } : {});
  const ttS = (order, name) => (tourPhase === 'running' && order.isTutorialSample ? { 'data-tour': name } : {});
  const ttW = (item, name) => (tourWishlistTargetId && item.id === tourWishlistTargetId ? { 'data-tour': name } : {});

  // 3) Inject / remove the temporary sample rows (local state only)
  useEffect(() => {
    if (tourPhase !== 'running') {
      setTourSampleOrder(null);
      setTourSampleWishlist(null);
      return;
    }
    const step = TOUR_STEPS[tourStepIndex];
    const today = new Date().toISOString().split('T')[0];

    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; };
    const orderKind = step.sample && step.sample.startsWith('order') ? step.sample : null;
    const showOrderSample = orderKind && (orderKind !== 'order' || !realTourOrderExists);

    setTourSampleOrder(prev => {
      if (!showOrderSample) return null;
      if (prev && prev.kind === orderKind) return prev;
      const base = {
        id: TOUR_SAMPLE_ORDER_ID, kind: orderKind, name: 'Sample: Minimalist Rug', qty: 2, cost: 150,
        batch: 'Batch 1', notes: 'Tutorial sample', isTutorialSample: true
      };
      if (orderKind === 'order') {
        return { ...base, date: today, shippingStatus: 'Ordered', orderStatus: '', actualDeliveryDate: '', estDelivery: calculateEstDelivery(today) };
      }
      const ordered = daysAgo(30);
      return {
        ...base, date: ordered, shippingStatus: 'Delivered', orderStatus: 'OK', actualDeliveryDate: daysAgo(2),
        estDelivery: calculateEstDelivery(ordered), archived: orderKind === 'order-archived'
      };
    });

    setTourSampleWishlist(prev => (step.sample === 'wishlist' && !realTourWishlistExists)
      ? (prev || {
          id: TOUR_SAMPLE_WISHLIST_ID, name: 'Sample: Cute Makeup Organizer', qty: 1,
          initialCost: 45, latestCost: 38, isTutorialSample: true
        })
      : null);
  }, [tourPhase, tourStepIndex, realTourOrderExists, realTourWishlistExists]);

  // 4) Put the UI into the state the current step asks for (tab, modals, ticked row, visible page)
  useEffect(() => {
    if (tourPhase !== 'running') return;
    const step = TOUR_STEPS[tourStepIndex];

    setActiveTab(step.tab);
    resetTourDropdowns();

    // Open a modal fresh only when we arrive at it, so typing survives moving between its steps
    const prevModal = prevTourModalRef.current;
    if (step.modal === 'order') { if (prevModal !== 'order') handleOpenAddOrder(); }
    else setIsOrderModalOpen(false);

    if (step.modal === 'wishlist') { if (prevModal !== 'wishlist') handleOpenAddWishlist(); }
    else setIsWishlistModalOpen(false);

    if (step.modal === 'batch') {
      if (prevModal !== 'batch') {
        setBatchEditTargetBatch(KEEP);
        setBatchEditTargetShipping(KEEP);
        setBatchEditTargetOrderStatus(KEEP);
        setBatchEditTargetActualDelivery('');
        setBatchEditChangeDate('');
        setBatchHistoryEdits([]);
      }
      setIsBatchEditOpen(true);
    } else {
      setIsBatchEditOpen(false);
    }
    prevTourModalRef.current = step.modal;

    // Tick the target row's checkbox so the Batch Edit button appears (and untick it afterwards)
    const orderTargetId = (step.sample === 'order' && realTourOrderExists) ? tourRealOrderId : TOUR_SAMPLE_ORDER_ID;
    setSelectedOrderIds(step.checkRow ? [orderTargetId] : []);
    setSelectedWishlistIds([]);

    // Make sure the target row is on the page being shown (sample rows are always first)
    if (step.sample === 'order') {
      const idx = realTourOrderExists ? finalFilteredOrders.findIndex(o => o.id === tourRealOrderId) : 0;
      setOrdersPage(idx >= 0 ? Math.floor(idx / ordersPerPage) + 1 : 1);
    }
    if (step.sample === 'order-delivered') setOrdersPage(1);
    if (step.sample === 'order-archived') setArchivePage(1);
    if (step.sample === 'wishlist') {
      const idx = realTourWishlistExists ? finalFilteredWishlist.findIndex(w => w.id === tourRealWishlistId) : 0;
      setWishlistPage(idx >= 0 ? Math.floor(idx / wishlistPerPage) + 1 : 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourPhase, tourStepIndex, realTourOrderExists, realTourWishlistExists]);

  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--c-fdfbf7)', color: 'var(--c-7f5539)', fontFamily: "'Segoe UI', Roboto, sans-serif", fontSize: '16px', fontWeight: 'bold' }}>
        <ShoppingBag size={22} style={{ marginRight: '10px' }} /> Loading your cozy space...
      </div>
    );
  }

  // --- COZY LOGIN SCREEN ---
  if (!user) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        width: '100vw',
        background: 'var(--c-fdfbf7)',
        fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        boxSizing: 'border-box',
        padding: '20px',
        position: 'absolute',
        top: 0,
        left: 0
      }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          
          <div style={{
            background: 'var(--c-fffdfa)',
            padding: '35px 30px 30px 30px',
            borderRadius: '20px',
            boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.4)',
            borderTop: '6px solid var(--c-ffd166)',
            border: '1px solid var(--c-e6ccb2)',
            width: '100%',
            textAlign: 'center',
            boxSizing: 'border-box'
          }}>
            <h1 style={{ margin: '0 0 10px 0', color: 'var(--c-7f5539)', fontSize: '24px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <ShoppingBag size={26} /> Pinduoduo Tracker
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--c-8c7a6b)', marginBottom: '25px', lineHeight: '1.5' }}>
              Sign in with your Google account to access your private order tracker and real-time cloud syncing!
            </p>
            <button
              onClick={handleLogin}
              style={{
                ...getButtonStyle('primary'),
                width: '100%',
                padding: '12px',
                fontSize: '14px',
                justifyContent: 'center'
              }}
            >
              <LogIn size={16} /> Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--c-fdfbf7)', color: 'var(--c-7f5539)', fontFamily: "'Segoe UI', Roboto, sans-serif", fontSize: '16px', fontWeight: 'bold' }}>
        <ShoppingBag size={22} style={{ marginRight: '10px' }} /> Connecting to Cloud Sync...
      </div>
    );
  }

  return (
    <div style={{ 
      margin: 0, 
      padding: '20px', 
      fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif", 
      background: 'var(--c-fdfbf7)', 
      minHeight: '100vh', 
      width: '100vw', 
      maxWidth: '100vw',
      boxSizing: 'border-box', 
      overflowX: 'hidden',
      position: 'absolute',
      top: 0,
      left: 0
    }}>
      
      {/* HEADER */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: '15px', background: 'var(--c-fffdfa)', padding: '22px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(var(--shadow-rgb), 0.35)', marginBottom: '22px', borderTop: '4px solid var(--c-ffd166)', width: '100%', boxSizing: 'border-box', border: '1px solid var(--c-f0e6df)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', width: '100%' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <h1 
              onClick={() => {
                setActiveTab('orders');
                setSelectedBatch('All Batches');
                setSearchQuery('');
                setOrdersPage(1);
              }}
              style={{ margin: 0, color: 'var(--c-7f5539)', fontSize: '22px', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '700', cursor: 'pointer' }}
              title="Click to go to Home / General Orders"
            >
              <ShoppingBag size={22} /> Pinduoduo Tracker
            </h1>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            
            <div style={{ position: 'relative' }} ref={searchBoxRef}>
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '9999px', padding: '6px 14px', width: '250px', boxSizing: 'border-box', boxShadow: '0 2px 0 rgba(var(--shadow-btn-rgb), 0.2)' }}>
                <Search size={14} style={{ marginRight: '8px', flexShrink: 0, color: 'var(--c-7f5539)' }} />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setOrdersPage(1); setWishlistPage(1); setArchivePage(1); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); }}
                  placeholder="Search all entries & notes..." 
                  style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '12px', width: '100%', color: 'var(--c-5c4033)' }}
                />
                {searchQuery && (
                  <button 
                    onClick={() => { setSearchQuery(''); setSearchOpen(false); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--c-b0a499)', padding: 0 }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {searchOpen && query && (
                <div style={{ position: 'absolute', top: '100%', left: 0, width: '340px', maxWidth: '88vw', background: 'var(--c-fffdfa)', borderRadius: '12px', boxShadow: '0 8px 24px rgba(var(--shadow-rgb), 0.5)', border: '1px solid var(--c-e6ccb2)', marginTop: '6px', zIndex: 2000, overflow: 'hidden', textAlign: 'left' }}>
                  <div style={{ padding: '7px 12px', fontSize: '10px', background: 'var(--c-ffccd5)', color: 'var(--c-5c4033)', fontWeight: '700', letterSpacing: '0.4px' }}>
                    {searchResults.length} {searchResults.length === 1 ? 'RESULT' : 'RESULTS'} FOR "{searchQuery.toUpperCase()}"
                  </div>
                  <div style={{ display: 'flex', gap: '6px', padding: '8px 10px', flexWrap: 'wrap', borderBottom: '1px solid var(--c-fcf6f0)' }}>
                    {[['orders', 'General Orders'], ['archive', 'Archive'], ['wishlist', 'Wishlist']].map(([tab, label]) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => { setActiveTab(tab); setSearchOpen(false); }}
                        style={{ background: activeTab === tab ? 'var(--c-ffd166)' : 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', border: '1px solid var(--c-e6ccb2)', borderRadius: '9999px', padding: '3px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        {label} · {searchCounts[tab]}
                      </button>
                    ))}
                  </div>
                  {searchResults.length === 0 && (
                    <div style={{ padding: '14px 12px', fontSize: '12px', color: 'var(--c-8c7a6b)' }}>Nothing found in names, notes, batches, statuses or dates.</div>
                  )}
                  <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                    {searchResults.slice(0, 8).map((r) => {
                      const other = r.hits.find(h => h[0] !== 'Name');
                      return (
                        <div
                          key={r.key}
                          onClick={() => { setActiveTab(r.tab); setSearchOpen(false); setOrdersPage(1); setWishlistPage(1); setArchivePage(1); }}
                          style={{ padding: '8px 12px', fontSize: '12px', cursor: 'pointer', borderBottom: '1px solid var(--c-fcf6f0)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c-fcf6f0)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: 'var(--c-5c4033)', fontWeight: '600', wordBreak: 'break-word' }}><Highlight text={r.title} query={query} /></span>
                            <span style={{ fontSize: '10px', background: r.tab === 'orders' ? 'var(--c-bde0fe)' : r.tab === 'archive' ? 'var(--c-d8f3dc)' : 'var(--c-ffccd5)', color: r.tab === 'orders' ? 'var(--c-03045e)' : r.tab === 'archive' ? 'var(--c-1b4332)' : 'var(--c-780000)', padding: '2px 7px', borderRadius: '9999px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {r.type}
                            </span>
                          </div>
                          {other && (
                            <div style={{ fontSize: '11px', color: 'var(--c-8c7a6b)', marginTop: '3px', wordBreak: 'break-word' }}>
                              <span style={{ fontWeight: 700 }}>{other[0]}:</span> <Highlight text={searchSnippet(other[1], searchTokens)} query={query} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {searchResults.length > 8 && (
                      <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--c-8c7a6b)' }}>+ {searchResults.length - 8} more shown in the tables</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
              style={getButtonStyle('light')}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <button
              data-tour="help-btn"
              onClick={openTour}
              style={getButtonStyle('light')}
              title="Take the guided tour again"
            >
              <BookOpen size={14} /> How to Use?
            </button>
            <button 
              onClick={() => { setGuideActiveStep(null); setIsGuideOpen(true); }}
              style={getButtonStyle('blue')}
            >
              <Truck size={14} /> Shipping Guide
            </button>
            <button
              onClick={() => setIsExportOpen(true)}
              style={getButtonStyle('light')}
              title="Download your data as CSV (backup / spreadsheet)"
            >
              <Download size={14} /> Export
            </button>

            {/* STRAWBERRY CAT ACCOUNT / SIGNOUT POPUP BUTTON */}
            <div style={{ position: 'relative' }} ref={accountMenuRef}>
              <button
                onClick={() => setIsAccountMenuOpen(prev => !prev)}
                style={{
                  background: 'var(--c-ffd166)',
                  border: '1.5px solid var(--c-ffd166)',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  padding: 0,
                  cursor: 'pointer',
                  boxShadow: '0 3px 0 rgba(var(--shadow-btn-rgb), 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  outline: 'none'
                }}
                title="Account & Sign Out"
              >
                <img 
                  src={STRAWBERRY_CAT_URL} 
                  alt="Strawberry Cat" 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </button>

              {isAccountMenuOpen && (
                <div style={{
                  position: 'absolute',
                  top: '120%',
                  right: 0,
                  width: '300px',
                  background: 'var(--c-fffdfa)',
                  border: '1px solid var(--c-e6ccb2)',
                  borderRadius: '16px',
                  boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.5)',
                  zIndex: 300,
                  padding: '18px',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '-10px' }}>
                    <button 
                      onClick={() => setIsAccountMenuOpen(false)}
                      style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '28px', height: '28px', fontSize: '12px', cursor: 'pointer', color: 'var(--c-7f5539)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <X size={14} style={{ display: 'block', margin: '0 auto' }} />
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ width: '50px', height: '50px', borderRadius: '50%', overflow: 'hidden', border: '1.5px solid var(--c-ffd166)', background: 'var(--c-ffd166)', flexShrink: '0' }}>
                      <img src={STRAWBERRY_CAT_URL} alt="Strawberry Cat" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', textAlign: 'left', gap: '2px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--c-5c4033)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {user.displayName || 'Pinduoduo User'}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--c-8c7a6b)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {user.email}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleLogout}
                    style={{
                      ...getButtonStyle('primary'),
                      width: '100%',
                      justifyContent: 'center',
                      padding: '10px',
                      fontSize: '13px'
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', background: 'var(--c-fcf6f0)', padding: '12px 18px', borderRadius: '12px', border: '1px solid var(--c-e6ccb2)', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveTab('orders')}
              style={getButtonStyle(activeTab === 'orders' ? 'primary' : 'light')}
            >
              <Package size={14} /> General Orders ({activeOrders.length}){foundPill(searchCounts.orders)}
            </button>
            <button
              data-tour="tab-wishlist"
              onClick={() => setActiveTab('wishlist')}
              style={getButtonStyle(activeTab === 'wishlist' ? 'primary' : 'light')}
            >
              <Heart size={14} /> Wishlist ({wishlist.length}){foundPill(searchCounts.wishlist)}
            </button>
            {/* Archive tab: icon only until hovered/focused (and while the tour is pointing at it) */}
            <button
              data-tour="tab-archive"
              onClick={() => setActiveTab('archive')}
              onMouseEnter={() => setArchiveTabHover(true)}
              onMouseLeave={() => setArchiveTabHover(false)}
              onFocus={() => setArchiveTabHover(true)}
              onBlur={() => setArchiveTabHover(false)}
              title="Archive"
              aria-label={`Archive (${archivedOrders.length})`}
              style={{ ...getButtonStyle(activeTab === 'archive' ? 'primary' : 'light'), gap: 0, padding: '8px 12px', position: 'relative' }}
            >
              <Archive size={14} />
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
                  maxWidth: archiveTabExpanded ? '170px' : '0px', opacity: archiveTabExpanded ? 1 : 0,
                  marginLeft: archiveTabExpanded ? '6px' : '0px',
                  transition: 'max-width 0.28s ease, opacity 0.2s ease, margin-left 0.28s ease',
                }}
              >
                Archive ({archivedOrders.length}){foundPill(searchCounts.archive)}
              </span>
              {query && !archiveTabExpanded && (
                <span style={{ position: 'absolute', top: '-7px', right: '-7px', minWidth: '16px', height: '16px', boxSizing: 'border-box', padding: '0 4px', borderRadius: '9999px', background: searchCounts.archive > 0 ? 'var(--c-ffd166)' : 'var(--c-fcf6f0)', color: searchCounts.archive > 0 ? 'var(--c-5c4033)' : 'var(--c-b0a499)', border: '1px solid var(--c-e6ccb2)', fontSize: '9px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {searchCounts.archive}
                </span>
              )}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '18px', alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {(activeTab === 'orders' || activeTab === 'archive') && (
              <div data-tour="batch-filter">
                <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)', display: 'block', fontWeight: '700', letterSpacing: '0.5px', marginBottom: '4px', textAlign: 'left' }}>BATCH FILTER</span>
                {activeTab === 'archive' ? (
                  <BatchPicker
                    value={archiveBatch}
                    onChange={(b) => { setArchiveBatch(b); setArchivePage(1); }}
                    batches={archiveBatchInfo}
                    extras={[{ value: 'All Batches', label: 'All Batches' }]}
                    allowCreate={false}
                    mode="archive"
                  />
                ) : (
                  <BatchPicker
                    value={selectedBatch}
                    onChange={(b) => { setSelectedBatch(b); setOrdersPage(1); }}
                    batches={batchInfo}
                    extras={[{ value: 'All Batches', label: 'All Batches' }]}
                    allowCreate={false}
                  />
                )}
              </div>
            )}

            {activeTab === 'wishlist' && (
              <div>
                <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)', display: 'block', fontWeight: '700', letterSpacing: '0.5px', marginBottom: '4px', textAlign: 'left' }}>MOVE TO BATCH</span>
                <BatchPicker
                  value={wishlistMoveBatch}
                  onChange={setWishlistMoveBatch}
                  batches={batchInfo}
                  extras={[{ value: null, label: `Auto (${latestOrderBatch})` }]}
                  compact
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* --- TAB 1: ORDERS --- */}
      {activeTab === 'orders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', boxSizing: 'border-box' }}>
          
          <div style={{ background: 'var(--c-fffdfa)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(var(--shadow-rgb), 0.25)', border: '1px solid var(--c-f0e6df)', boxSizing: 'border-box', width: '100%' }}>
            <div style={{ background: 'var(--c-fcf6f0)', borderRadius: '12px', padding: '15px', border: '1px solid var(--c-e6ccb2)', width: '100%', boxSizing: 'border-box' }}>
              <h3 style={{ fontSize: '12px', margin: '0 0 10px 0', textAlign: 'center', color: 'var(--c-7f5539)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>
                <LayoutDashboard size={13} style={{ verticalAlign: '-2px', marginRight: '6px' }} />General Order Dashboard ({selectedBatch})
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '15px', textAlign: 'center' }}>
                {statCard('TOTAL ORDERS', totalOrdersCount, 'var(--c-5c4033)', undefined, undefined, 'rose')}
                {statCard('TOTAL QUANTITY (PCS)', totalQuantity, 'var(--c-5c4033)', undefined, undefined, 'rose')}
                {statCard('TOTAL SPENT', money(displayTotalCost), 'var(--c-bc6c25)', undefined, undefined, 'rose')}
                {statCard('IN CHINA CUSTOMS', chinaCustomsStats.entries, 'var(--c-03045e)', `${chinaCustomsStats.pcs} pcs`, undefined, 'customs')}
                {statCard('IN TRANSIT TO PH', inTransitStats.entries, 'var(--c-5c4033)', `${inTransitStats.pcs} pcs`, undefined, 'transit')}
                {statCard('IN PH CUSTOMS', phCustomsStats.entries, 'var(--c-3c096c)', `${phCustomsStats.pcs} pcs`, undefined, 'phcustoms')}
                {statCard('PH HUB / OUT FOR DELIVERY', phHubStats.entries, 'var(--c-5c4033)', `${phHubStats.pcs} pcs`, undefined, 'hub')}
                {statCard('DELIVERED', deliveredCount, 'var(--c-1b4332)', 'all orders, incl. archived', 'Standalone: counts every delivered order (archived too) and ignores the batch filter.', 'delivered')}
                {statCard('AVG SHIPPING DAYS', avgShippingDays !== '-' ? `${avgShippingDays} days` : '-', 'var(--c-7f5539)', 'all orders, incl. archived', 'Standalone: counts every order (archived too) and ignores the batch filter. Only permanently deleting an order removes it from this average.', 'rose')}
              </div>

              {/* Average days per stage: one line when collapsed, a stage bar when opened */}
              {(() => {
                const withData = PIPELINE.filter(st => stageStats[st].avg != null);
                const rule = { borderTop: '1px dashed var(--c-e6ccb2)', marginTop: '16px', paddingTop: '12px' };
                if (withData.length === 0) {
                  return (
                    <div style={rule}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', color: 'var(--c-8c7a6b)' }}>
                        <Clock size={14} style={{ flexShrink: 0 }} />
                        <span><b style={{ color: 'var(--c-7f5539)' }}>Average days per stage</b> will appear here once you change an order's shipping status (Edit or Batch Edit).</span>
                      </div>
                    </div>
                  );
                }
                const LOOK = {
                  'Ordered': ['var(--tint-sand)', 'var(--c-5c4033)'],
                  'At China Warehouse': ['var(--c-ffcfc9)', 'var(--c-5c4033)'],
                  'Dispatched / China Customs': ['var(--c-c9daf8)', 'var(--c-03045e)'],
                  'In Transit to PH': ['var(--c-fdd6a8)', 'var(--c-5c4033)'],
                  'PH Customs Clearance': ['var(--c-e6cff2)', 'var(--c-3c096c)'],
                  'PH Hub / Out for Local Delivery': ['var(--c-fcf2cd)', 'var(--c-5c4033)'],
                };
                const slowest = withData.reduce((a, b) => (stageStats[b].avg > stageStats[a].avg ? b : a));
                const nOrders = (st) => `from ${stageStats[st].n} order${stageStats[st].n === 1 ? '' : 's'}`;
                return (
                  <div style={rule}>
                    <button
                      type="button"
                      onClick={toggleStageOpen}
                      aria-expanded={stageOpen}
                      title={stageOpen ? 'Hide average days per stage' : 'Show average days per stage'}
                      style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px 14px', flexWrap: 'wrap', fontFamily: 'inherit', textAlign: 'left' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, color: 'var(--c-7f5539)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                        <Clock size={14} /> Average Days per Stage
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', fontSize: '11.5px', color: 'var(--c-5c4033)', fontWeight: 600 }}>
                        {avgShippingDays !== '-' && <span>{avgShippingDays} days overall</span>}
                        {avgShippingDays !== '-' && <span style={{ color: 'var(--c-c9b8a8)' }}>|</span>}
                        <span>Slowest: <span style={{ background: LOOK[slowest][0], color: LOOK[slowest][1], padding: '2px 8px', borderRadius: '9999px', fontWeight: 700 }}>{STAGE_SHORT[slowest]} {fmtDays(stageStats[slowest].avg)}d</span></span>
                        <span style={{ color: 'var(--c-7f5539)', display: 'flex', background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '26px', height: '26px', alignItems: 'center', justifyContent: 'center' }}>
                          {stageOpen ? <ChevronUp size={16} strokeWidth={2.5} /> : <ChevronDown size={16} strokeWidth={2.5} />}
                        </span>
                      </span>
                    </button>

                    {stageOpen && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ display: 'flex', borderRadius: '9px', overflow: 'hidden', border: '1px solid var(--c-e6ccb2)' }}>
                          {withData.map(st => (
                            <div
                              key={st}
                              title={`${STAGE_SHORT[st]}: ${fmtDays(stageStats[st].avg)} days on average, ${nOrders(st)}`}
                              style={{ flex: Math.max(stageStats[st].avg, 0.8), minWidth: '28px', background: LOOK[st][0], color: LOOK[st][1], height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, borderRight: '2px solid var(--c-fcf6f0)', boxShadow: st === slowest ? 'inset 0 0 0 2px rgba(188,108,37,0.55)' : 'none' }}
                            >
                              {fmtDays(stageStats[st].avg)}d
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: '10px' }}>
                          {PIPELINE.map(st => (
                            <span key={st} title={stageStats[st].n > 0 ? nOrders(st) : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--c-5c4033)' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: LOOK[st][0], border: '1px solid var(--c-e6ccb2)' }} />
                              <b>{STAGE_SHORT[st]}</b>
                              <span style={{ color: 'var(--c-8c7a6b)' }}>{stageStats[st].avg != null ? `${fmtDays(stageStats[st].avg)} days` : 'no data yet'}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          <div style={{ background: 'var(--c-fffdfa)', padding: '22px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(var(--shadow-rgb), 0.25)', marginBottom: '25px', width: '100%', boxSizing: 'border-box', overflowX: 'auto', border: '1px solid var(--c-f0e6df)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--c-fcf6f0)', paddingBottom: '10px', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ textAlign: 'left' }}>
                <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--c-7f5539)', fontWeight: '700' }}>
                  <Package size={17} style={{ verticalAlign: '-3px', marginRight: '8px' }} />General Order Tracker — {query ? 'All Batches' : selectedBatch} {query && `(Filtered by "${searchQuery}")`}
                </h2>
                <span style={{ fontSize: '11px', color: 'var(--c-8c7a6b)', fontWeight: '600', display: 'block', marginTop: '3px' }}>
                  Showing {finalFilteredOrders.length} orders found
                </span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {selectedOrderIds.length > 0 && (
                  <button
                    data-tour="batch-btn"
                    onClick={handleOpenBatchEdit}
                    style={getButtonStyle('pink')}
                  >
                    <Pencil size={14} /> Batch Edit Selected ({selectedOrderIds.length})
                  </button>
                )}
                {finalFilteredOrders.some(isPendingReview) && (
                  <button
                    onClick={() => startReviewQueue(finalFilteredOrders)}
                    style={getButtonStyle('primary')}
                    title="Make photo reviews for your delivered orders one after another"
                  >
                    <Camera size={14} /> Reviews Pending ({finalFilteredOrders.filter(isPendingReview).length})
                  </button>
                )}
                {deliveredInView.length > 0 && (
                  <button
                    data-tour="archive-bulk"
                    onClick={() => archiveOrders(deliveredInView)}
                    style={getButtonStyle('blue')}
                    title="Move every delivered order shown here into the Archive"
                  >
                    <Archive size={14} /> Archive Delivered ({deliveredInView.length})
                  </button>
                )}
                <button
                  data-tour="add-btn"
                  onClick={handleOpenAddOrder}
                  style={getButtonStyle('pink')}
                >
                  <Plus size={14} strokeWidth={3} /> Add Order
                </button>
              </div>
            </div>

            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'center', minWidth: '1500px' }}>
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: 'var(--c-fcf6f0)', color: 'var(--c-7f5539)' }}>
                  <th style={{ padding: '10px', borderRadius: '8px 0 0 8px', fontWeight: 'bold' }}>
                    {/* CUSTOM COZY CHECKBOX FOR SELECT ALL */}
                    <div 
                      onClick={() => {
                        const allSelected = currentOrdersSlice.length > 0 && currentOrdersSlice.every(o => selectedOrderIds.includes(o.id));
                        if (allSelected) {
                          const sliceIds = new Set(currentOrdersSlice.map(o => o.id));
                          setSelectedOrderIds(prev => prev.filter(id => !sliceIds.has(id)));
                        } else {
                          const allIdsInSlice = currentOrdersSlice.map(o => o.id);
                          setSelectedOrderIds(prev => Array.from(new Set([...prev, ...allIdsInSlice])));
                        }
                      }}
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '4px',
                        border: '1.5px solid var(--c-e6ccb2)',
                        background: (currentOrdersSlice.length > 0 && currentOrdersSlice.every(o => selectedOrderIds.includes(o.id))) ? 'var(--c-ffd166)' : 'var(--c-fffdfa)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontSize: '10px',
                        color: 'var(--c-5c4033)',
                        fontWeight: 'bold',
                        margin: '0 auto',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                      }}
                      title="Select all on this page"
                    >
                      {(currentOrdersSlice.length > 0 && currentOrdersSlice.every(o => selectedOrderIds.includes(o.id))) ? <Check size={12} strokeWidth={3} /> : ''}
                    </div>
                  </th>
                  <th style={{ fontWeight: 'bold' }}>Item Name</th>
                  <th style={{ fontWeight: 'bold' }}>Quantity</th>
                  <th style={{ fontWeight: 'bold' }}>Cost</th>
                  <th style={{ fontWeight: 'bold' }}>Total Cost</th>
                  <th style={{ fontWeight: 'bold' }}>Date Ordered</th>
                  <th style={{ fontWeight: 'bold' }}>Batch</th>
                  <th style={{ fontWeight: 'bold' }}>Shipping Status</th>
                  <th style={{ fontWeight: 'bold' }}>Order Status</th>
                  <th style={{ fontWeight: 'bold' }}>Notes/Comments</th>
                  <th style={{ fontWeight: 'bold' }}>Estimated Delivery</th>
                  <th style={{ fontWeight: 'bold' }}>Actual Delivery</th>
                  <th style={{ fontWeight: 'bold' }}>Actual Shipping Days</th>
                  <th style={{ borderRadius: '0 8px 8px 0', fontWeight: 'bold' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentOrdersSlice.length === 0 ? (
                  <tr>
                    <td colSpan="14" style={{ textAlign: 'center', padding: '35px', color: 'var(--c-b0a499)' }}>
                      No matching orders found.
                    </td>
                  </tr>
                ) : (
                  currentOrdersSlice.map((order) => {
                    const actualDays = calculateActualShippingDays(order.date, order.actualDeliveryDate);
                    const isSelected = selectedOrderIds.includes(order.id);
                    return (
                      <tr key={order.id} {...ttO(order, 'order-row')} style={{ borderBottom: '1px solid var(--c-fcf6f0)', background: isSelected ? 'var(--c-fff5f7)' : 'transparent' }}>
                        <td style={{ padding: '12px 6px' }}>
                          {/* CUSTOM COZY CHECKBOX FOR ROW */}
                          <div 
                            {...ttO(order, 'order-check')}
                            onClick={() => handleToggleSelectOrder(order.id)}
                            style={{
                              width: '16px',
                              height: '16px',
                              borderRadius: '4px',
                              border: '1.5px solid var(--c-e6ccb2)',
                              background: isSelected ? 'var(--c-ffd166)' : 'var(--c-fffdfa)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              fontSize: '10px',
                              color: 'var(--c-5c4033)',
                              fontWeight: 'bold',
                              margin: '0 auto',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                            }}
                          >
                            {isSelected ? <Check size={12} strokeWidth={3} /> : ''}
                          </div>
                        </td>
                        <td style={{ padding: '12px 8px', fontWeight: 'normal', color: 'var(--c-5c4033)', wordBreak: 'break-word' }}><Highlight text={order.name} query={query} />{order.isTutorialSample && <SampleBadge />}</td>
                        <td>{order.qty}</td>
                        <td>₱{Number(order.cost).toFixed(2)}</td>
                        <td {...ttO(order, 'order-total')} style={{ color: 'var(--c-bc6c25)', fontWeight: 'bold' }}>₱{(order.qty * order.cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td>{order.date}</td>
                        <td>
                          <span style={{ background: 'var(--c-ffd166)', color: 'var(--c-5c4033)', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
                            {order.batch || 'Unassigned'}
                          </span>
                        </td>
                        <td>
                          <span 
                            style={getShippingBadgeStyle(order.shippingStatus)}
                            onClick={() => handleOpenGuideWithStatus(order.shippingStatus)}
                            title="Click to view in Shipping Guide!"
                          >
                            {order.shippingStatus}
                          </span>
                          {reviewTag(order) && <div>{reviewTag(order)}</div>}
                        </td>
                        <td>
                          {order.orderStatus ? (
                            <span style={{ background: isOkStatus(order.orderStatus) ? 'var(--c-d8f3dc)' : 'var(--c-ffccd5)', color: isOkStatus(order.orderStatus) ? 'var(--c-1b4332)' : 'var(--c-780000)', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
                              {statusLabel(order.orderStatus)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--c-b0a499)', fontSize: '11px' }}>-</span>
                          )}
                        </td>
                        <td style={{ color: 'var(--c-8c7a6b)', wordBreak: 'break-word' }}>{order.notes ? <Highlight text={order.notes} query={query} /> : '-'}</td>
                        <td {...ttO(order, 'order-est')} style={{ color: 'var(--c-8c7a6b)' }}>
                          {(() => {
                            const se = smartEstFor(order);
                            if (!se) return order.estDelivery;
                            const why = se.method === 'stage'
                              ? `Smart estimate: from the day this order reached its current stage, your past deliveries took about ${fmtDays(se.avg)} more days (based on ${se.n} orders).`
                              : `Smart estimate: order date plus your average shipping time of ${fmtDays(se.avg)} days (based on ${se.n} deliveries).`;
                            return (
                              <span title={`${why} Standard estimate: ${order.estDelivery}.`} style={{ color: 'var(--c-5c4033)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'help' }}>
                                <Sparkles size={11} style={{ color: 'var(--c-bc6c25)', flexShrink: 0 }} />{se.date}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ color: order.actualDeliveryDate ? 'var(--c-5c4033)' : 'var(--c-b0a499)' }}>
                          {order.actualDeliveryDate || '-'}
                        </td>
                        <td>
                          <span style={{ background: actualDays !== null ? 'var(--c-d8f3dc)' : 'var(--c-fcf6f0)', color: actualDays !== null ? 'var(--c-1b4332)' : 'var(--c-b0a499)', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
                            {actualDays !== null ? `${actualDays} days` : '-'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button 
                              style={getButtonStyle('pink')}
                              {...ttO(order, 'order-edit')}
                              onClick={() => handleOpenEditOrder(order)}
                            >
                              Edit
                            </button>
                            {order.shippingStatus === 'Delivered' && (
                              <button
                                {...ttO(order, 'order-archive')}
                                style={getButtonStyle('blue')}
                                onClick={() => archiveOrders([order])}
                                title="Move this delivered order to the Archive"
                              >
                                <Archive size={13} /> Archive
                              </button>
                            )}
                            {photoReviewButton(order)}
                            <button 
                              style={getButtonStyle('danger')}
                              {...ttO(order, 'order-delete')}
                              onClick={() => handleDeleteOrder(order)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {renderPagination(ordersPage, totalOrdersPages, setOrdersPage, ordersPerPage, setOrdersPerPage)}
          </div>
        </div>
      )}

      {/* --- TAB 3: ARCHIVE --- */}
      {activeTab === 'archive' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ background: 'var(--c-fffdfa)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(var(--shadow-rgb), 0.25)', border: '1px solid var(--c-f0e6df)', boxSizing: 'border-box', width: '100%' }}>
            <div style={{ background: 'var(--c-fcf6f0)', borderRadius: '12px', padding: '15px', border: '1px solid var(--c-e6ccb2)', width: '100%', boxSizing: 'border-box' }}>
              <h3 style={{ fontSize: '12px', margin: '0 0 10px 0', textAlign: 'center', color: 'var(--c-7f5539)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>
                <LayoutDashboard size={13} style={{ verticalAlign: '-2px', marginRight: '6px' }} />Archives Dashboard ({archiveBatch})
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '15px', textAlign: 'center' }}>
                {statCard('TOTAL ORDERS', archiveTotalOrders, 'var(--c-5c4033)', undefined, undefined, 'rose')}
                {statCard('TOTAL QUANTITY (PCS)', archiveTotalQty, 'var(--c-5c4033)', undefined, undefined, 'rose')}
                {statCard('TOTAL SPENT', money(archiveTotalSpent), 'var(--c-bc6c25)', undefined, undefined, 'rose')}
                {statCard('AVG SHIPPING DAYS', archiveAvgDays !== '-' ? `${archiveAvgDays} days` : '-', 'var(--c-7f5539)', 'all archived orders', undefined, 'rose')}
              </div>
            </div>
          </div>

        <div style={{ background: 'var(--c-fffdfa)', padding: '22px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(var(--shadow-rgb), 0.25)', width: '100%', boxSizing: 'border-box', overflowX: 'auto', border: '1px solid var(--c-f0e6df)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--c-fcf6f0)', paddingBottom: '10px', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ textAlign: 'left' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--c-7f5539)', fontWeight: '700' }}>
                <Archive size={17} style={{ verticalAlign: '-3px', marginRight: '8px' }} />Archived Orders — {query ? 'All Batches' : archiveBatch} {query && `(Filtered by "${searchQuery}")`}
              </h2>
              <span style={{ fontSize: '11px', color: 'var(--c-8c7a6b)', fontWeight: '600', display: 'block', marginTop: '3px' }}>
                {finalFilteredArchive.length} archived · not counted in the General Orders dashboard
              </span>
            </div>
            {finalFilteredArchive.some(isPendingReview) && (
              <button
                onClick={() => startReviewQueue(finalFilteredArchive)}
                style={getButtonStyle('primary')}
                title="Make photo reviews for your archived orders one after another"
              >
                <Camera size={14} /> Reviews Pending ({finalFilteredArchive.filter(isPendingReview).length})
              </button>
            )}
          </div>

          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'center', minWidth: '1400px' }}>
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'var(--c-fcf6f0)', color: 'var(--c-7f5539)' }}>
                <th style={{ padding: '10px', borderRadius: '8px 0 0 8px', fontWeight: 'bold' }}>Item Name</th>
                <th style={{ fontWeight: 'bold' }}>Quantity</th>
                <th style={{ fontWeight: 'bold' }}>Cost</th>
                <th style={{ fontWeight: 'bold' }}>Total Cost</th>
                <th style={{ fontWeight: 'bold' }}>Date Ordered</th>
                <th style={{ fontWeight: 'bold' }}>Batch</th>
                <th style={{ fontWeight: 'bold' }}>Order Status</th>
                <th style={{ fontWeight: 'bold' }}>Notes/Comments</th>
                <th style={{ fontWeight: 'bold' }}>Actual Delivery</th>
                <th style={{ fontWeight: 'bold' }}>Shipping Days</th>
                <th style={{ borderRadius: '0 8px 8px 0', fontWeight: 'bold' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentArchiveSlice.length === 0 ? (
                <tr>
                  <td colSpan="11" style={{ textAlign: 'center', padding: '35px', color: 'var(--c-b0a499)' }}>
                    {archivedOrders.length === 0 ? 'Nothing archived yet. Delivered orders can be archived from General Orders.' : 'No matching archived orders found.'}
                  </td>
                </tr>
              ) : (
                currentArchiveSlice.map((order) => {
                  const actualDays = calculateActualShippingDays(order.date, order.actualDeliveryDate);
                  return (
                    <tr key={order.id} style={{ borderBottom: '1px solid var(--c-fcf6f0)' }}>
                      <td style={{ padding: '12px 8px', color: 'var(--c-5c4033)', wordBreak: 'break-word' }}><Highlight text={order.name} query={query} />{order.isTutorialSample && <SampleBadge />}{reviewTag(order) && <div>{reviewTag(order)}</div>}</td>
                      <td>{order.qty}</td>
                      <td>₱{Number(order.cost).toFixed(2)}</td>
                      <td style={{ color: 'var(--c-bc6c25)', fontWeight: 'bold' }}>₱{(order.qty * order.cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td>{order.date}</td>
                      <td>
                        <span style={{ background: 'var(--c-ffd166)', color: 'var(--c-5c4033)', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
                          {order.batch || 'Unassigned'}
                        </span>
                      </td>
                      <td>
                        {order.orderStatus ? (
                          <span style={{ background: isOkStatus(order.orderStatus) ? 'var(--c-d8f3dc)' : 'var(--c-ffccd5)', color: isOkStatus(order.orderStatus) ? 'var(--c-1b4332)' : 'var(--c-780000)', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 'bold' }}>
                            {statusLabel(order.orderStatus)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--c-b0a499)', fontSize: '11px' }}>-</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--c-8c7a6b)', wordBreak: 'break-word' }}>{order.notes ? <Highlight text={order.notes} query={query} /> : '-'}</td>
                      <td style={{ color: order.actualDeliveryDate ? 'var(--c-5c4033)' : 'var(--c-b0a499)' }}>{order.actualDeliveryDate || '-'}</td>
                      <td>
                        <span style={{ background: actualDays !== null ? 'var(--c-d8f3dc)' : 'var(--c-fcf6f0)', color: actualDays !== null ? 'var(--c-1b4332)' : 'var(--c-b0a499)', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px' }}>
                          {actualDays !== null ? `${actualDays} days` : '-'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          {photoReviewButton(order)}
                          <button {...ttS(order, 'archived-restore')} style={getButtonStyle('light')} onClick={() => restoreOrders([order.id])} title="Put this order back in General Orders exactly where it was">
                            <ArchiveRestore size={13} /> Restore
                          </button>
                          <button style={getButtonStyle('danger')} onClick={() => handleDeleteOrder(order)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {renderPagination(archivePage, totalArchivePages, setArchivePage, archivePerPage, setArchivePerPage)}
        </div>
        </div>
      )}

      {/* --- TAB 2: WISHLIST --- */}
      {activeTab === 'wishlist' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', boxSizing: 'border-box' }}>
          
          <div style={{ background: 'var(--c-fffdfa)', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(var(--shadow-rgb), 0.25)', border: '1px solid var(--c-f0e6df)', boxSizing: 'border-box', width: '100%' }}>
            <div style={{ background: 'var(--c-fcf6f0)', borderRadius: '12px', padding: '15px', border: '1px solid var(--c-e6ccb2)', width: '100%', boxSizing: 'border-box' }}>
              <h3 style={{ fontSize: '12px', margin: '0 0 10px 0', textAlign: 'center', color: 'var(--c-7f5539)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>
                <LayoutDashboard size={13} style={{ verticalAlign: '-2px', marginRight: '6px' }} />Wishlist Dashboard
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '15px', textAlign: 'center' }}>
                <div style={tintBox('butter')}>
                  <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)', display: 'block', fontWeight: '700' }}>INITIAL TOTAL</span>
                  <strong style={{ fontSize: '14px', color: 'var(--c-5c4033)' }}>₱{wishlistInitialTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </div>
                <div style={tintBox('rose')}>
                  <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)', display: 'block', fontWeight: '700' }}>LATEST TOTAL</span>
                  <strong style={{ fontSize: '14px', color: 'var(--c-bc6c25)' }}>₱{wishlistLatestTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </div>
                <div style={tintBox('sky')}>
                  <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)', display: 'block', fontWeight: '700', marginBottom: '4px' }}>PRICE FLAG</span>
                  {renderPriceFlag(1, wishlistInitialTotal, wishlistLatestTotal)}
                </div>
                <div style={tintBox('mint')}>
                  <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)', display: 'block', fontWeight: '700' }}>ITEMS SAVED</span>
                  <strong style={{ fontSize: '14px', color: 'var(--c-7f5539)' }}>{wishlist.length}</strong>
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--c-fffdfa)', padding: '22px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(var(--shadow-rgb), 0.25)', width: '100%', boxSizing: 'border-box', overflowX: 'auto', border: '1px solid var(--c-f0e6df)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--c-fcf6f0)', paddingBottom: '10px', marginBottom: '15px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--c-7f5539)', fontWeight: '700' }}>
                <Heart size={17} style={{ verticalAlign: '-3px', marginRight: '8px' }} />Wishlist Tracker & Price Monitor {query && `(Filtered by "${searchQuery}")`}
              </h2>
            
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {selectedWishlistIds.length > 0 && (
                  <button
                    onClick={() => handleMoveItemsToTracker(wishlist.filter(w => selectedWishlistIds.includes(w.id)))}
                    style={getButtonStyle('pink')}
                  >
                    <ArrowRight size={14} /> Move Selected to Orders ({selectedWishlistIds.length})
                  </button>
                )}
                <button
                  data-tour="add-btn"
                  onClick={handleOpenAddWishlist}
                  style={getButtonStyle('pink')}
                >
                  <Plus size={14} strokeWidth={3} /> Add Wishlist Item
                </button>
              </div>
            </div>

            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'center', minWidth: '1100px' }}>
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: 'var(--c-fcf6f0)', color: 'var(--c-7f5539)' }}>
                  <th style={{ padding: '10px', borderRadius: '8px 0 0 8px', fontWeight: 'bold' }}>
                    <div
                      onClick={() => {
                        const allSelected = currentWishlistSlice.length > 0 && currentWishlistSlice.every(w => selectedWishlistIds.includes(w.id));
                        if (allSelected) {
                          const sliceIds = new Set(currentWishlistSlice.map(w => w.id));
                          setSelectedWishlistIds(prev => prev.filter(id => !sliceIds.has(id)));
                        } else {
                          const allIdsInSlice = currentWishlistSlice.map(w => w.id);
                          setSelectedWishlistIds(prev => Array.from(new Set([...prev, ...allIdsInSlice])));
                        }
                      }}
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '4px',
                        border: '1.5px solid var(--c-e6ccb2)',
                        background: (currentWishlistSlice.length > 0 && currentWishlistSlice.every(w => selectedWishlistIds.includes(w.id))) ? 'var(--c-ffd166)' : 'var(--c-fffdfa)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontSize: '10px',
                        color: 'var(--c-5c4033)',
                        fontWeight: 'bold',
                        margin: '0 auto',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                      }}
                      title="Select all on this page"
                    >
                      {(currentWishlistSlice.length > 0 && currentWishlistSlice.every(w => selectedWishlistIds.includes(w.id))) ? <Check size={12} strokeWidth={3} /> : ''}
                    </div>
                  </th>
                  <th style={{ fontWeight: 'bold' }}>Item Name</th>
                  <th style={{ fontWeight: 'bold' }}>Quantity</th>
                  <th style={{ fontWeight: 'bold' }}>Initial Cost</th>
                  <th style={{ fontWeight: 'bold' }}>Initial Total Cost</th>
                  <th style={{ fontWeight: 'bold' }}>Latest Cost</th>
                  <th style={{ fontWeight: 'bold' }}>Price Flag</th>
                  <th style={{ borderRadius: '0 8px 8px 0', fontWeight: 'bold' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentWishlistSlice.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '30px', color: 'var(--c-b0a499)' }}>
                      No matching wishlist items found.
                    </td>
                  </tr>
                ) : (
                  currentWishlistSlice.map((item) => (
                    <tr key={item.id} {...ttW(item, 'wl-row')} style={{ borderBottom: '1px solid var(--c-fcf6f0)', background: selectedWishlistIds.includes(item.id) ? 'var(--c-fff5f7)' : 'transparent' }}>
                      <td style={{ padding: '12px 6px' }}>
                        <div
                          onClick={() => handleToggleSelectWishlist(item.id)}
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '4px',
                            border: '1.5px solid var(--c-e6ccb2)',
                            background: selectedWishlistIds.includes(item.id) ? 'var(--c-ffd166)' : 'var(--c-fffdfa)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            fontSize: '10px',
                            color: 'var(--c-5c4033)',
                            fontWeight: 'bold',
                            margin: '0 auto',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                          }}
                        >
                          {selectedWishlistIds.includes(item.id) ? <Check size={12} strokeWidth={3} /> : ''}
                        </div>
                      </td>
                      <td style={{ padding: '12px 10px', fontWeight: 'normal', color: 'var(--c-5c4033)', wordBreak: 'break-word' }}><Highlight text={item.name} query={query} />{item.isTutorialSample && <SampleBadge />}</td>
                      <td>{item.qty}</td>
                      <td>₱{Number(item.initialCost).toFixed(2)}</td>
                      <td style={{ color: 'var(--c-5c4033)', fontWeight: '500' }}>₱{(item.qty * item.initialCost).toFixed(2)}</td>
                      <td style={{ color: 'var(--c-bc6c25)', fontWeight: 'bold' }}>₱{Number(item.latestCost).toFixed(2)}</td>
                      <td {...ttW(item, 'wl-flag')}>{renderPriceFlag(item.qty, item.initialCost, item.latestCost)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button 
                            style={getButtonStyle('pink')}
                            {...ttW(item, 'wl-edit')}
                            onClick={() => handleOpenEditWishlist(item)}
                          >
                            Edit
                          </button>
                          <button 
                            style={getButtonStyle('primary')}
                            {...ttW(item, 'wl-move')}
                            onClick={() => handleMoveItemsToTracker([item])}
                          >
                            Move
                          </button>
                          <button 
                            style={getButtonStyle('danger')}
                            {...ttW(item, 'wl-delete')}
                            onClick={() => handleDeleteWishlist(item)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {renderPagination(wishlistPage, totalWishlistPages, setWishlistPage, wishlistPerPage, setWishlistPerPage)}
          </div>

        </div>
      )}

      {/* --- SHIPPING GUIDE MODAL --- */}
      {isGuideOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '15px', boxSizing: 'border-box' }}>
          <div style={{ background: 'var(--c-fffdfa)', borderRadius: '20px', padding: '25px', maxWidth: '650px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 15px 40px rgba(var(--shadow-rgb), 0.5)', borderTop: '6px solid var(--c-ffd166)', boxSizing: 'border-box', border: '1px solid var(--c-e6ccb2)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid var(--c-fcf6f0)', paddingBottom: '12px' }}>
              <div style={{ width: '32px' }}></div>
              <h2 style={{ fontSize: '18px', margin: 0, color: 'var(--c-7f5539)', fontWeight: '700', textAlign: 'center', flex: 1 }}>
                Pinduoduo Shipping Adventure Guide
              </h2>
              <button 
                onClick={() => setIsGuideOpen(false)} 
                style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '32px', height: '32px', fontSize: '14px', cursor: 'pointer', color: 'var(--c-7f5539)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} style={{ display: 'block', margin: '0 auto' }} />
              </button>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--c-8c7a6b)', marginBottom: '20px', textAlign: 'center', lineHeight: '1.5' }}>
              Follow your order's step-by-step process from the China warehouse all the way to your doorstep!
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { title: 'Ordered', statusKey: 'Ordered', desc: 'Your order is placed and awaiting consolidation at the warehouse.', isStep: true },
                { title: 'At China Warehouse', statusKey: 'At China Warehouse', desc: 'Package arrived at the China consolidation hub and is getting prepped.', isStep: true },
                { title: 'Dispatched & China Customs', statusKey: 'Dispatched / China Customs', desc: 'Dispatched from Zhongshan/warehouse. Important: the 21–24 business day countdown officially starts here (Weekends excluded).', isStep: true },
                { title: 'In Transit to PH', statusKey: 'In Transit to PH', desc: 'Cruising across international waters or flying over to the Philippines.', isStep: true },
                { title: 'PH Customs Clearance', statusKey: 'PH Customs Clearance', desc: 'Arrived at the port, clearing customs check, and heading to local sorting.', isStep: true },
                { title: 'PH Hub / Out for Local Delivery', statusKey: 'PH Hub / Out for Local Delivery', desc: 'Received by J&T or local courier. Almost at your doorstep!', isStep: true },
                { title: 'Delivered', statusKey: 'Delivered', desc: 'Successfully delivered! Time to unpack your loot!', isStep: true },
                { title: 'Undelivered', statusKey: 'Undelivered', desc: 'Delivery attempt failed or encountered a courier issue. Check with support.', isStep: false }
              ].map((step, idx) => {
                const badgeStyle = getShippingBadgeStyle(step.statusKey);
                const isHighlighted = guideActiveStep === step.statusKey;

                return (
                  <div 
                    key={idx}
                    onClick={() => setGuideActiveStep(step.statusKey)}
                    style={{
                      background: isHighlighted ? 'var(--c-fff5f7)' : 'var(--c-fcf6f0)',
                      padding: '12px 18px',
                      borderRadius: '12px',
                      border: isHighlighted ? '2px solid var(--c-ffafcc)' : '1px solid var(--c-e6ccb2)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: isHighlighted ? '0 4px 15px rgba(255, 175, 204, 0.4)' : 'none',
                      transform: isHighlighted ? 'scale(1.01)' : 'scale(1)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '15px'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left', flex: 1 }}>
                      <strong style={{ fontSize: '13px', color: 'var(--c-5c4033)' }}>
                        {step.isStep ? `Step ${idx}: ${step.title}` : step.title}
                      </strong>
                      <p style={{ fontSize: '11px', color: 'var(--c-7f5539)', margin: 0, lineHeight: '1.4' }}>
                        {step.desc}
                      </p>
                    </div>
                    <div>
                      <span style={{ ...badgeStyle, pointerEvents: 'none' }}>
                        {step.statusKey}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <button 
                onClick={() => setIsGuideOpen(false)}
                style={getButtonStyle('primary')}
              >
                Got it, let's track!
              </button>
            </div>

          </div>
        </div>
      )}

      {/* --- ADD / EDIT ORDER MODAL --- */}
      {isOrderModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.3)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '15px', boxSizing: 'border-box' }}>
          <div style={{ background: 'var(--c-fffdfa)', borderRadius: '16px', padding: '25px', maxWidth: '480px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.4)', borderTop: '5px solid var(--c-ffafcc)', boxSizing: 'border-box', border: '1px solid var(--c-e6ccb2)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid var(--c-fcf6f0)', paddingBottom: '10px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--c-7f5539)', fontWeight: '700' }}>
                {editingOrder ? 'Edit Order' : 'Add New Order'}
              </h2>
              <button 
                onClick={() => setIsOrderModalOpen(false)} 
                style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '28px', height: '28px', fontSize: '12px', cursor: 'pointer', color: 'var(--c-7f5539)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} style={{ display: 'block', margin: '0 auto' }} />
              </button>
            </div>

            <form onSubmit={handleSaveOrder} style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div data-tour="order-name">
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Item Name*</label>
                <input type="text" name="name" value={orderFormData.name} onChange={handleOrderInputChange} placeholder="e.g. Minimalist Rug" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div data-tour="order-qty">
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Quantity</label>
                  <input type="number" name="qty" min="1" value={orderFormData.qty} onChange={handleOrderInputChange} style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} />
                </div>
                <div data-tour="order-cost">
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Cost (Unit) (₱)*</label>
                  <input type="number" name="cost" value={orderFormData.cost} onChange={handleOrderInputChange} placeholder="250" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} required />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.4fr', gap: '10px', alignItems: 'start' }}>
                <div data-tour="order-date">
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Date Ordered</label>
                  <input type="date" name="date" value={orderFormData.date} onChange={handleOrderInputChange} style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} />
                </div>

                <div data-tour="order-batch">
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Batch</label>
                  <BatchPicker
                    value={orderFormData.batch}
                    onChange={(b) => setOrderFormData(prev => ({ ...prev, batch: b }))}
                    batches={batchInfo}
                    compact
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div data-tour="order-shipping" style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Shipping Status</label>
                  <div 
                    onClick={() => setModalShippingOpen(!modalShippingOpen)}
                    style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{orderFormData.shippingStatus || 'Ordered'}</span>
                    <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)', marginLeft: '4px' }}>{modalShippingOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                  </div>
                  {modalShippingOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '160px', overflowY: 'auto', background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderRadius: '8px', boxShadow: '0 6px 20px rgba(var(--shadow-rgb), 0.4)', zIndex: 300, padding: '4px', boxSizing: 'border-box' }}>
                      {shippingStatusOptions.map(st => (
                        <div 
                          key={st}
                          onClick={() => { setOrderFormData(prev => ({ ...prev, shippingStatus: st })); setPendingChangeDate(''); setModalShippingOpen(false); }}
                          style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', background: orderFormData.shippingStatus === st ? 'var(--c-ffd166)' : 'transparent', fontWeight: orderFormData.shippingStatus === st ? 'bold' : 'normal', color: 'var(--c-5c4033)' }}
                        >
                          {st}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div data-tour="order-status" style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Order Status</label>
                  <div 
                    onClick={() => setModalOrderStatusOpen(!modalOrderStatusOpen)}
                    style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span>{orderFormData.orderStatus ? statusLabel(orderFormData.orderStatus) : '-- Select Status --'}</span>
                    <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)' }}>{modalOrderStatusOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                  </div>
                  {modalOrderStatusOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '140px', overflowY: 'auto', background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderRadius: '8px', boxShadow: '0 6px 20px rgba(var(--shadow-rgb), 0.4)', zIndex: 300, padding: '4px', boxSizing: 'border-box' }}>
                      {orderStatusOptions.map(ost => (
                        <div 
                          key={ost}
                          onClick={() => { setOrderFormData(prev => ({ ...prev, orderStatus: ost === '-- None --' ? '' : ost })); setModalOrderStatusOpen(false); }}
                          style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', background: orderFormData.orderStatus === ost ? 'var(--c-ffd166)' : 'transparent', fontWeight: orderFormData.orderStatus === ost ? 'bold' : 'normal', color: 'var(--c-5c4033)' }}
                        >
                          {statusLabel(ost)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div data-tour="order-actual">
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Actual Delivery Date</label>
                  <input type="date" name="actualDeliveryDate" value={orderFormData.actualDeliveryDate} onChange={handleOrderInputChange} style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} />
                </div>
                <div data-tour="order-notes">
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Notes/Comments</label>
                  <input type="text" name="notes" value={orderFormData.notes} onChange={handleOrderInputChange} placeholder="Optional notes..." style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} />
                </div>
              </div>

              {editingOrder && (() => {
                const origStatus = editingOrder.shippingStatus || 'Ordered';
                const pending = orderFormData.shippingStatus !== origStatus ? orderFormData.shippingStatus : null;
                const pendingAuto = pending ? entryDateFor(pending, { actualDeliveryDate: orderFormData.actualDeliveryDate, fallback: todayStr }) : '';
                const fld = { padding: '7px 8px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '11.5px', background: 'var(--c-fffdfa)', color: 'var(--c-5c4033)', fontFamily: 'inherit' };
                return (
                  <div style={{ marginTop: '4px', background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '12px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--c-7f5539)', fontSize: '12px' }}>
                      <Clock size={13} /> Status History
                    </div>
                    <div style={{ fontSize: '10.5px', color: 'var(--c-8c7a6b)', margin: '3px 0 9px', lineHeight: 1.4 }}>
                      A new entry is logged when you change the shipping status. Fix any date here if you updated late.
                    </div>
                    {historyDraft.length === 0 && !pending && (
                      <div style={{ fontSize: '11px', color: 'var(--c-8c7a6b)', marginBottom: '8px' }}>No history yet for this order. It starts logging from the next status change.</div>
                    )}
                    {historyDraft.map((h, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                        <select value={h.status} onChange={(e) => setHistoryDraft(prev => prev.map((r, k) => (k === idx ? { ...r, status: e.target.value } : r)))} style={{ ...fld, flex: 1, minWidth: 0 }}>
                          {shippingStatusOptions.map(st => <option key={st} value={st}>{st}</option>)}
                        </select>
                        <input type="date" value={h.date} max={todayStr} onChange={(e) => setHistoryDraft(prev => prev.map((r, k) => (k === idx ? { ...r, date: e.target.value } : r)))} style={{ ...fld, width: '128px' }} />
                        <button type="button" aria-label="Remove history entry" onClick={() => setHistoryDraft(prev => prev.filter((_, k) => k !== idx))} style={{ background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', color: 'var(--c-7f5539)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <X size={11} strokeWidth={3} />
                        </button>
                      </div>
                    ))}
                    {pending && (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ ...fld, flex: 1, minWidth: 0, background: 'var(--c-fcf2cd)', borderColor: 'var(--c-ffd166)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pending} <span style={{ fontWeight: 600, color: 'var(--c-8c7a6b)' }}>(new)</span></span>
                        <input type="date" value={pendingChangeDate || pendingAuto} max={todayStr} onChange={(e) => setPendingChangeDate(e.target.value)} style={{ ...fld, width: '128px', borderColor: 'var(--c-ffd166)' }} />
                        <span style={{ width: '24px', flexShrink: 0 }} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setHistoryDraft(prev => {
                        const last = prev[prev.length - 1];
                        const at = last ? PIPELINE.indexOf(last.status) : -1;
                        const next = last ? (at >= 0 && at < PIPELINE.length - 1 ? PIPELINE[at + 1] : 'Delivered') : 'Ordered';
                        return [...prev, { status: next, date: todayStr }];
                      })}
                      style={{ background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderRadius: '9999px', padding: '5px 12px', fontSize: '11px', fontWeight: 700, color: 'var(--c-7f5539)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'inherit' }}
                    >
                      <Plus size={12} strokeWidth={3} /> Add past entry
                    </button>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px' }}>
                <button type="button" onClick={() => setIsOrderModalOpen(false)} style={getButtonStyle('light')}>Cancel</button>
                <button data-tour="order-save" type="submit" style={getButtonStyle('primary')}>
                  {editingOrder ? 'Update Order' : 'Save Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- BATCH EDIT MODAL FOR SELECTED ORDERS --- */}
      {isBatchEditOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.3)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '15px', boxSizing: 'border-box' }}>
          <div data-tour="batch-modal" style={{ background: 'var(--c-fffdfa)', borderRadius: '16px', padding: '25px', maxWidth: '460px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.4)', borderTop: '5px solid var(--c-ffafcc)', boxSizing: 'border-box', border: '1px solid var(--c-e6ccb2)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid var(--c-fcf6f0)', paddingBottom: '10px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--c-7f5539)', fontWeight: '700' }}>
                <Pencil size={16} style={{ verticalAlign: '-2px', marginRight: '8px' }} />Batch Edit Selected Orders ({selectedOrderIds.length})
              </h2>
              <button 
                onClick={() => setIsBatchEditOpen(false)} 
                style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '28px', height: '28px', fontSize: '12px', cursor: 'pointer', color: 'var(--c-7f5539)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} style={{ display: 'block', margin: '0 auto' }} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '12px' }}>
              <p style={{ color: 'var(--c-8c7a6b)', margin: 0, lineHeight: '1.4' }}>
                Fields that are already filled in stay as they are. Only change what you want to update for all {selectedOrderIds.length} selected items!
              </p>

              {/* Target Batch Selection */}
              <div>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '4px', color: 'var(--c-7f5539)' }}>Batch</label>
                <BatchPicker
                  value={batchEditTargetBatch}
                  onChange={setBatchEditTargetBatch}
                  batches={batchInfo}
                  extras={[{ value: KEEP, label: 'Keep current' }]}
                  compact
                />
              </div>

              {/* Target Shipping Status Selection */}
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Shipping Status</label>
                <div 
                  onClick={() => setBatchEditShippingDropdownOpen(!batchEditShippingDropdownOpen)}
                  style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>{batchEditTargetShipping === KEEP ? '-- Keep current --' : batchEditTargetShipping}</span>
                  <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)' }}>{batchEditShippingDropdownOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                </div>
                {batchEditShippingDropdownOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '160px', overflowY: 'auto', background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderRadius: '8px', boxShadow: '0 6px 20px rgba(var(--shadow-rgb), 0.4)', zIndex: 300, padding: '4px', boxSizing: 'border-box' }}>
                    {[KEEP, ...shippingStatusOptions].map(st => (
                      <div 
                        key={st}
                        onClick={() => { setBatchEditTargetShipping(st); setBatchEditShippingDropdownOpen(false); }}
                        style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', background: batchEditTargetShipping === st ? 'var(--c-ffd166)' : 'transparent', fontWeight: batchEditTargetShipping === st ? 'bold' : 'normal', color: 'var(--c-5c4033)' }}
                      >
                        {st === KEEP ? '-- Keep current --' : st}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Target Order Status Selection */}
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Order Status</label>
                <div 
                  onClick={() => setBatchEditOrderStatusDropdownOpen(!batchEditOrderStatusDropdownOpen)}
                  style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>{batchEditTargetOrderStatus === KEEP ? '-- Keep current --' : (batchEditTargetOrderStatus ? statusLabel(batchEditTargetOrderStatus) : '-- None --')}</span>
                  <span style={{ fontSize: '10px', color: 'var(--c-8c7a6b)' }}>{batchEditOrderStatusDropdownOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                </div>
                {batchEditOrderStatusDropdownOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '140px', overflowY: 'auto', background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderRadius: '8px', boxShadow: '0 6px 20px rgba(var(--shadow-rgb), 0.4)', zIndex: 300, padding: '4px', boxSizing: 'border-box' }}>
                    {[KEEP, ...orderStatusOptions].map(ost => (
                      <div 
                        key={ost}
                        onClick={() => { setBatchEditTargetOrderStatus(ost === '-- None --' ? '' : ost); setBatchEditOrderStatusDropdownOpen(false); }}
                        style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', background: batchEditTargetOrderStatus === ost ? 'var(--c-ffd166)' : 'transparent', fontWeight: batchEditTargetOrderStatus === ost ? 'bold' : 'normal', color: 'var(--c-5c4033)' }}
                      >
                        {ost === KEEP ? '-- Keep current --' : statusLabel(ost)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {batchEditTargetShipping !== KEEP && (
                <div>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Status change date (leave empty for today)</label>
                  <input
                    type="date"
                    value={batchEditChangeDate}
                    max={todayStr}
                    onChange={(e) => setBatchEditChangeDate(e.target.value)}
                    style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)' }}
                  />
                  {batchEditTargetShipping === 'Delivered' && <div style={{ fontSize: '10.5px', color: 'var(--c-8c7a6b)', marginTop: '3px' }}>For Delivered, the actual delivery date is used if you set one below.</div>}
                </div>
              )}

              {/* Target Actual Delivery Date */}
              <div>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Actual Delivery Date (leave empty to keep current)</label>
                <input 
                  type="date" 
                  value={batchEditTargetActualDelivery} 
                  onChange={(e) => setBatchEditTargetActualDelivery(e.target.value)} 
                  style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} 
                />
              </div>

              {/* Manual status history edits for every selected order */}
              <div style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '12px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--c-7f5539)', fontSize: '12px' }}>
                  <Clock size={13} /> Status History (optional)
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--c-8c7a6b)', margin: '3px 0 8px', lineHeight: 1.4 }}>
                  Applied to all {selectedOrderIds.length} selected orders. "Set date" fixes the date of a status, or adds it if an order doesn't have it yet.
                </div>
                {batchHistoryEdits.map((ed, idx) => {
                  const fld = { padding: '7px 8px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '11.5px', background: 'var(--c-fffdfa)', color: 'var(--c-5c4033)', fontFamily: 'inherit' };
                  const upd = (patch) => setBatchHistoryEdits(prev => prev.map((r, k) => (k === idx ? { ...r, ...patch } : r)));
                  return (
                    <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <select value={ed.action} onChange={(e) => upd({ action: e.target.value })} style={{ ...fld, width: '96px' }}>
                        <option value="set">Set date</option>
                        <option value="remove">Remove</option>
                      </select>
                      <select value={ed.status} onChange={(e) => upd({ status: e.target.value })} style={{ ...fld, flex: 1, minWidth: '120px' }}>
                        {shippingStatusOptions.map(st => <option key={st} value={st}>{st}</option>)}
                      </select>
                      {ed.action === 'set' && (
                        <input type="date" value={ed.date} max={todayStr} onChange={(e) => upd({ date: e.target.value })} style={{ ...fld, width: '128px', borderColor: ed.date ? 'var(--c-e6ccb2)' : 'var(--c-ffd166)' }} aria-label="Date for this status" />
                      )}
                      <button type="button" aria-label="Remove this history edit" onClick={() => setBatchHistoryEdits(prev => prev.filter((_, k) => k !== idx))} style={{ background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', color: 'var(--c-7f5539)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <X size={11} strokeWidth={3} />
                      </button>
                    </div>
                  );
                })}
                {batchHistoryEdits.some(e => e.action === 'set' && !e.date) && (
                  <div style={{ fontSize: '10.5px', color: 'var(--c-bc6c25)', marginBottom: '6px' }}>Rows without a date are skipped.</div>
                )}
                <button
                  type="button"
                  onClick={() => setBatchHistoryEdits(prev => [...prev, { action: 'set', status: batchEditTargetShipping !== KEEP ? batchEditTargetShipping : 'Ordered', date: '' }])}
                  style={{ background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderRadius: '9999px', padding: '5px 12px', fontSize: '11px', fontWeight: 700, color: 'var(--c-7f5539)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'inherit' }}
                >
                  <Plus size={12} strokeWidth={3} /> Add history edit
                </button>
              </div>

              {/* Cancel left, Action right */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px' }}>
                <button type="button" onClick={() => setIsBatchEditOpen(false)} style={getButtonStyle('light')}>Cancel</button>
                <button type="button" onClick={handleExecuteBatchEdit} style={getButtonStyle('primary')}>
                  Apply to {selectedOrderIds.length} Orders
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* --- UNDO TOAST (after moving wishlist items to orders) --- */}
      {lastMove && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 1500, background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderTop: '4px solid var(--c-bde0fe)', borderRadius: '16px', padding: '12px 16px', boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.6)', display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '92vw', boxSizing: 'border-box', fontSize: '12px', color: 'var(--c-5c4033)', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ArrowRight size={14} /> Moved {lastMove.items.length} {lastMove.items.length === 1 ? 'item' : 'items'} to <strong>{lastMove.batch}</strong> in General Orders.
          </span>
          <button onClick={handleUndoMove} style={getButtonStyle('blue')}><Undo2 size={13} /> Undo</button>
          <button
            onClick={() => setLastMove(null)}
            style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '26px', height: '26px', fontSize: '11px', cursor: 'pointer', color: 'var(--c-7f5539)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Dismiss"
          >
            <X size={14} style={{ display: 'block', margin: '0 auto' }} />
          </button>
        </div>
      )}

      {/* --- UNDO TOAST (after archiving delivered orders) --- */}
      {lastArchive && (
        <div style={{ position: 'fixed', bottom: lastMove ? '88px' : '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 1500, background: 'var(--c-fffdfa)', border: '1px solid var(--c-e6ccb2)', borderTop: '4px solid var(--c-bde0fe)', borderRadius: '16px', padding: '12px 16px', boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.6)', display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '92vw', boxSizing: 'border-box', fontSize: '12px', color: 'var(--c-5c4033)', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Archive size={14} /> Archived {lastArchive.ids.length} {lastArchive.ids.length === 1 ? 'order' : 'orders'}.</span>
          <button onClick={handleUndoArchive} style={getButtonStyle('blue')}><Undo2 size={13} /> Undo</button>
          <button
            onClick={() => setLastArchive(null)}
            style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '26px', height: '26px', fontSize: '11px', cursor: 'pointer', color: 'var(--c-7f5539)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Dismiss"
          >
            <X size={14} style={{ display: 'block', margin: '0 auto' }} />
          </button>
        </div>
      )}

      {/* --- DELETE CONFIRMATION DIALOG --- */}
      {confirmDialog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000, padding: '15px', boxSizing: 'border-box' }}>
          <div style={{ background: 'var(--c-fffdfa)', borderRadius: '16px', padding: '25px', maxWidth: '380px', width: '100%', boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.5)', borderTop: '5px solid var(--c-ffccd5)', boxSizing: 'border-box', border: '1px solid var(--c-e6ccb2)', textAlign: 'center' }}>
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center', color: 'var(--c-780000)' }}><Trash2 size={30} /></div>
            <h2 style={{ fontSize: '16px', margin: '0 0 8px 0', color: 'var(--c-7f5539)', fontWeight: '700' }}>{confirmDialog.title}</h2>
            <p style={{ fontSize: '12px', color: 'var(--c-8c7a6b)', margin: '0 0 20px 0', lineHeight: '1.5', wordBreak: 'break-word' }}>{confirmDialog.message}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" onClick={() => setConfirmDialog(null)} style={getButtonStyle('light')}>Cancel</button>
              <button
                type="button"
                onClick={async () => {
                  const run = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  await run();
                }}
                style={getButtonStyle('danger')}
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- ADD / EDIT WISHLIST MODAL --- */}
      {isExportOpen && (
        <ExportModal orders={activeOrders} archived={archivedOrders} wishlist={wishlist} onClose={() => setIsExportOpen(false)} />
      )}

      {/* During the tour the modal is driven by the step (using the sample order); otherwise by the Photo Review button */}
      {(() => {
        const shown = tourPhase === 'running'
          ? (TOUR_STEPS[tourStepIndex].modal === 'photo-review' ? tourSampleOrder : null)
          : photoReviewOrder;
        return shown ? (
          <PhotoReviewModal
            key={shown.id}
            order={shown}
            queue={tourPhase === 'running' ? [] : photoReviewQueue}
            onGenerated={(o) => setOrderReviewed(o, true)}
            onClose={() => { setPhotoReviewOrder(null); setPhotoReviewQueue([]); }}
          />
        ) : null;
      })()}

      {isWishlistModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.3)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '15px', boxSizing: 'border-box' }}>
          <div style={{ background: 'var(--c-fffdfa)', borderRadius: '16px', padding: '25px', maxWidth: '440px', width: '100%', boxShadow: '0 10px 30px rgba(var(--shadow-rgb), 0.4)', borderTop: '5px solid var(--c-ffafcc)', boxSizing: 'border-box', border: '1px solid var(--c-e6ccb2)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid var(--c-fcf6f0)', paddingBottom: '10px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: 'var(--c-7f5539)', fontWeight: '700' }}>
                {editingWishlistItem ? 'Edit Wishlist Item' : 'Add Wishlist Item'}
              </h2>
              <button 
                onClick={() => setIsWishlistModalOpen(false)} 
                style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '50%', width: '28px', height: '28px', fontSize: '12px', cursor: 'pointer', color: 'var(--c-7f5539)', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={14} style={{ display: 'block', margin: '0 auto' }} />
              </button>
            </div>

            <form onSubmit={handleSaveWishlist} style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div data-tour="wl-name">
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Item Name*</label>
                <input type="text" name="name" value={wishlistFormData.name} onChange={handleWishlistInputChange} placeholder="e.g. Cute Makeup Organizer" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} required />
              </div>

              <div data-tour="wl-qty">
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Quantity</label>
                <input type="number" name="qty" min="1" value={wishlistFormData.qty} onChange={handleWishlistInputChange} style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div data-tour="wl-initial">
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Initial Cost (Unit ₱)*</label>
                  <input type="number" step="0.01" name="initialCost" value={wishlistFormData.initialCost} onChange={handleWishlistInputChange} placeholder="45.00" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} required />
                </div>
                <div data-tour="wl-latest">
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: 'var(--c-7f5539)' }}>Latest Cost (Unit ₱)</label>
                  <input type="number" step="0.01" name="latestCost" value={wishlistFormData.latestCost} onChange={handleWishlistInputChange} placeholder="Leave empty if same" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid var(--c-e6ccb2)', fontSize: '12px', background: 'var(--c-fcf6f0)', color: 'var(--c-5c4033)', outline: 'none' }} />
                </div>
              </div>

              {/* LIVE COMPUTATION PREVIEW BOX (FOR BOTH ADD & EDIT) */}
              <div style={{ background: 'var(--c-fcf6f0)', border: '1px solid var(--c-e6ccb2)', borderRadius: '10px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--c-7f5539)' }}>
                  <span>Initial Total: <strong>₱{(Number(wishlistFormData.qty || 1) * Number(wishlistFormData.initialCost || 0)).toFixed(2)}</strong></span>
                  <span>Latest Total: <strong>₱{(Number(wishlistFormData.qty || 1) * (wishlistFormData.latestCost !== '' ? Number(wishlistFormData.latestCost) : Number(wishlistFormData.initialCost || 0))).toFixed(2)}</strong></span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2px', borderTop: '1px dashed var(--c-e6ccb2)' }}>
                  {renderPriceFlag(
                    Number(wishlistFormData.qty || 1), 
                    Number(wishlistFormData.initialCost || 0), 
                    wishlistFormData.latestCost !== '' ? Number(wishlistFormData.latestCost) : Number(wishlistFormData.initialCost || 0)
                  )}
                </div>
              </div>

              {/* Cancel left, Action right */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px' }}>
                <button type="button" onClick={() => setIsWishlistModalOpen(false)} style={getButtonStyle('light')}>Cancel</button>
                <button data-tour="wl-add" type="submit" style={getButtonStyle('primary')}>
                  {editingWishlistItem ? 'Update Item' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- ONBOARDING TOUR --- */}
      {tourPhase === 'welcome' && (
        <TourWelcome onPick={startTourSteps} onSkip={finishTour} />
      )}
      {tourPhase === 'running' && (
        <TourOverlay
          stepIndex={tourStepIndex}
          lang={tourLang}
          onLang={setTourLang}
          onNext={tourNext}
          onBack={tourBack}
          onSkip={finishTour}
        />
      )}

    </div>
  );
}