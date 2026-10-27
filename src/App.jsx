import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

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

  // BATCH EDIT MODAL / DROPDOWN STATES FOR SELECTED ORDERS
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [batchEditTargetBatch, setBatchEditTargetBatch] = useState('Batch 1');
  const [batchEditTargetShipping, setBatchEditTargetShipping] = useState('Ordered');
  const [batchEditBatchDropdownOpen, setBatchEditBatchDropdownOpen] = useState(false);
  const [batchEditShippingDropdownOpen, setBatchEditShippingDropdownOpen] = useState(false);

  // Close custom dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsBatchDropdownOpen(false);
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

  // PAGINATION STATES FOR ORDERS
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPerPage, setOrdersPerPage] = useState(10);

  // PAGINATION STATES FOR WISHLIST
  const [wishlistPage, setWishlistPage] = useState(1);
  const [wishlistPerPage, setWishlistPerPage] = useState(10);

  // MODAL STATES
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);

  const [isWishlistModalOpen, setIsWishlistModalOpen] = useState(false);
  const [editingWishlistItem, setEditingWishlistItem] = useState(null);

  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideActiveStep, setGuideActiveStep] = useState(null);

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
    let bg = customBg || '#f2e8cf';
    let color = customColor || '#5c4033';
    let border = '1px solid #ffd166';

    if (variant === 'primary') {
      bg = '#ffd166';
      color = '#5c4033';
      border = '1px solid #e6ccb2';
    } else if (variant === 'pink') {
      bg = '#ffafcc';
      color = '#5c4033';
      border = '1px solid #ffc8dd';
    } else if (variant === 'blue') {
      bg = '#bde0fe';
      color = '#03045e';
      border = '1px solid #90e0ef';
    } else if (variant === 'danger') {
      bg = '#ffccd5';
      color = '#780000';
      border = '1px solid #ffb3c1';
    } else if (variant === 'light') {
      bg = '#fffdfa';
      color = '#7f5539';
      border = '1px solid #e6ccb2';
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
      boxShadow: '0 3px 0 rgba(199, 175, 150, 0.4)',
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

  const getShippingBadgeStyle = (status) => {
    let bg = '#ffffff';
    let color = '#5c4033';
    
    switch(status) {
      case 'Ordered': bg = '#ffffff'; color = '#5c4033'; break;
      case 'At China Warehouse': bg = '#ffcfc9'; color = '#5c4033'; break;
      case 'Dispatched / China Customs': bg = '#c9daf8'; color = '#03045e'; break;
      case 'In Transit to PH': bg = '#fdd6a8'; color = '#5c4033'; break;
      case 'PH Customs Clearance': bg = '#e6cff2'; color = '#3c096c'; break;
      case 'PH Hub / Out for Local Delivery': bg = '#fcf2cd'; color = '#5c4033'; break;
      case 'Delivered': bg = '#d4edbc'; color = '#1b4332'; break;
      case 'Undelivered': bg = '#e37373'; color = '#ffffff'; break;
      default: bg = '#ffffff'; color = '#5c4033';
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
        <span style={{ background: '#d8f3dc', color: '#1b4332', padding: '4px 10px', borderRadius: '9999px', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
          ↓ ₱{diff.toFixed(2)} SAVED!
        </span>
      );
    } else if (diff < 0) {
      return (
        <span style={{ background: '#ffccd5', color: '#780000', padding: '4px 10px', borderRadius: '9999px', fontWeight: 'bold', fontSize: '11px', whiteSpace: 'nowrap', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
          ↑ ₱{Math.abs(diff).toFixed(2)} INCREASE!
        </span>
      );
    }
    return (
      <span style={{ background: '#fcf6f0', color: '#8c7a6b', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
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
    setOrderFormData({
      name: '',
      qty: 1,
      cost: '',
      date: new Date().toISOString().split('T')[0],
      batch: selectedBatch === 'All Batches' ? 'Batch 1' : selectedBatch,
      shippingStatus: 'Ordered',
      orderStatus: '',
      notes: '',
      actualDeliveryDate: ''
    });
    setIsOrderModalOpen(true);
  };

  const handleOpenEditOrder = (order) => {
    setEditingOrder(order);
    setOrderFormData({
      name: order.name,
      qty: order.qty,
      cost: order.cost,
      date: order.date,
      batch: order.batch || 'Batch 1',
      shippingStatus: order.shippingStatus || 'Ordered',
      orderStatus: order.orderStatus || '',
      notes: order.notes || '',
      actualDeliveryDate: order.actualDeliveryDate || ''
    });
    setIsOrderModalOpen(true);
  };

  const handleDeleteOrder = async (id) => {
    if (window.confirm('Are you sure you want to delete this order?')) {
      try {
        await deleteDoc(doc(db, "users", user.uid, "pdd_orders", String(id)));
        setSelectedOrderIds(prev => prev.filter(i => i !== id));
      } catch (error) {
        console.error("Error deleting order: ", error);
      }
    }
  };

  const handleSaveOrder = async (e) => {
    e.preventDefault();
    if (!orderFormData.name || !orderFormData.cost) {
      alert('Please enter at least an Item Name and Cost!');
      return;
    }

    const orderId = editingOrder ? String(editingOrder.id) : String(Date.now());
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
      estDelivery: calculateEstDelivery(orderFormData.date)
    };

    try {
      await setDoc(doc(db, "users", user.uid, "pdd_orders", orderId), orderPayload);
    } catch (error) {
      console.error("Error saving order: ", error);
    }

    setIsOrderModalOpen(false);
    setEditingOrder(null);
  };

  // BATCH EDIT EXECUTION FOR SELECTED ORDERS
  const handleExecuteBatchEdit = async () => {
    if (selectedOrderIds.length === 0) return;

    try {
      for (const id of selectedOrderIds) {
        const orderToUpdate = orders.find(o => String(o.id) === String(id));
        if (orderToUpdate) {
          const updatedPayload = {
            ...orderToUpdate,
            batch: batchEditTargetBatch,
            shippingStatus: batchEditTargetShipping
          };
          await setDoc(doc(db, "users", user.uid, "pdd_orders", String(id)), updatedPayload);
        }
      }
      setIsBatchEditOpen(false);
      setSelectedOrderIds([]);
      alert(`Successfully updated ${selectedOrderIds.length} orders! ✨`);
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

  const handleDeleteWishlist = async (id) => {
    if (window.confirm('Are you sure you want to delete this item from your wishlist?')) {
      try {
        await deleteDoc(doc(db, "users", user.uid, "pdd_wishlist", String(id)));
      } catch (error) {
        console.error("Error deleting wishlist item: ", error);
      }
    }
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
    } catch (error) {
      console.error("Error saving wishlist item: ", error);
    }

    setIsWishlistModalOpen(false);
    setEditingWishlistItem(null);
  };

  const handleMoveToTracker = async (itemToMove) => {
    const today = new Date().toISOString().split('T')[0];
    const newOrderId = String(Date.now());
    const newOrder = {
      name: itemToMove.name,
      qty: itemToMove.qty,
      cost: itemToMove.latestCost || itemToMove.initialCost,
      date: today,
      batch: 'Batch 1',
      shippingStatus: 'Ordered',
      orderStatus: '',
      notes: 'Transferred from Wishlist',
      actualDeliveryDate: '',
      estDelivery: calculateEstDelivery(today)
    };

    try {
      await setDoc(doc(db, "users", user.uid, "pdd_orders", newOrderId), newOrder);
      await deleteDoc(doc(db, "users", user.uid, "pdd_wishlist", String(itemToMove.id)));
      setActiveTab('orders');
    } catch (error) {
      console.error("Error moving item to tracker: ", error);
    }
  };

  const query = searchQuery.trim().toLowerCase();

  const batchFilteredOrders = selectedBatch === 'All Batches' 
    ? orders 
    : orders.filter(o => o.batch === selectedBatch);

  const finalFilteredOrders = query 
    ? batchFilteredOrders.filter(o => o.name.toLowerCase().includes(query))
    : batchFilteredOrders;

  const displayTotalCost = finalFilteredOrders.reduce((acc, item) => acc + (item.qty * item.cost), 0);

  const finalFilteredWishlist = query
    ? wishlist.filter(item => item.name.toLowerCase().includes(query))
    : wishlist;

  const allEntries = [
    ...orders.map(o => ({ name: o.name, type: 'Order', tab: 'orders' })),
    ...wishlist.map(w => ({ name: w.name, type: 'Wishlist', tab: 'wishlist' }))
  ];

  const suggestions = query 
    ? allEntries.filter(entry => entry.name.toLowerCase().startsWith(query)).slice(0, 5)
    : [];

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

  const wishlistInitialTotal = wishlist.reduce((acc, item) => acc + (item.qty * item.initialCost), 0);
  const wishlistLatestTotal = wishlist.reduce((acc, item) => acc + (item.qty * item.latestCost), 0);

  const batchOptions = ['All Batches', ...Array.from({ length: 25 }, (_, i) => `Batch ${i + 1}`)];
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
  const orderStatusOptions = ['-- None --', 'OK ✔', 'Missing', 'Damaged', 'Refunded'];

  const totalOrdersCount = batchFilteredOrders.length;
  const deliveredCount = batchFilteredOrders.filter(o => o.shippingStatus === 'Delivered').length;
  const missingRefundedCount = batchFilteredOrders.filter(o => o.orderStatus === 'Missing' || o.orderStatus === 'Damaged' || o.orderStatus === 'Refunded').length;

  const shippingDaysList = batchFilteredOrders.map(o => calculateActualShippingDays(o.date, o.actualDeliveryDate)).filter(d => d !== null);
  const avgShippingDays = shippingDaysList.length > 0 
    ? Math.round(shippingDaysList.reduce((a, b) => a + b, 0) / shippingDaysList.length) 
    : '-';

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
          <span style={{ color: '#8c7a6b', marginLeft: '5px' }}>records per page</span>
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
            ◀
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
            ▶
          </button>
        </div>
      </div>
    );
  };

  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#fdfbf7', color: '#7f5539', fontFamily: "'Segoe UI', Roboto, sans-serif", fontSize: '16px', fontWeight: 'bold' }}>
        🧀 Loading your cozy space... ✨
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
        background: '#fdfbf7',
        fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        boxSizing: 'border-box',
        padding: '20px',
        position: 'absolute',
        top: 0,
        left: 0
      }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          
          <div style={{
            background: '#fffdfa',
            padding: '35px 30px 30px 30px',
            borderRadius: '20px',
            boxShadow: '0 10px 30px rgba(230, 204, 178, 0.4)',
            borderTop: '6px solid #ffd166',
            border: '1px solid #e6ccb2',
            width: '100%',
            textAlign: 'center',
            boxSizing: 'border-box'
          }}>
            <h1 style={{ margin: '0 0 10px 0', color: '#7f5539', fontSize: '24px', fontWeight: '700' }}>
              🧀 Pinduoduo Tracker
            </h1>
            <p style={{ fontSize: '12px', color: '#8c7a6b', marginBottom: '25px', lineHeight: '1.5' }}>
              Sign in with your Google account to access your private order tracker and real-time cloud syncing! ✨
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
              Sign in with Google ✨
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#fdfbf7', color: '#7f5539', fontFamily: "'Segoe UI', Roboto, sans-serif", fontSize: '16px', fontWeight: 'bold' }}>
        🧀 Connecting to Cloud Sync... ✨
      </div>
    );
  }

  return (
    <div style={{ 
      margin: 0, 
      padding: '20px', 
      fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif", 
      background: '#fdfbf7', 
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
      <header style={{ display: 'flex', flexDirection: 'column', gap: '15px', background: '#fffdfa', padding: '22px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(230, 204, 178, 0.35)', marginBottom: '22px', borderTop: '4px solid #ffd166', width: '100%', boxSizing: 'border-box', border: '1px solid #f0e6df' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', width: '100%' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <h1 
              onClick={() => {
                setActiveTab('orders');
                setSelectedBatch('All Batches');
                setSearchQuery('');
                setOrdersPage(1);
              }}
              style={{ margin: 0, color: '#7f5539', fontSize: '22px', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '700', cursor: 'pointer' }}
              title="Click to go to Home / General Orders"
            >
              🧀 Pinduoduo Tracker
            </h1>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', background: '#fcf6f0', border: '1px solid #e6ccb2', borderRadius: '9999px', padding: '6px 14px', width: '250px', boxSizing: 'border-box', boxShadow: '0 2px 0 rgba(199, 175, 150, 0.2)' }}>
                <span style={{ marginRight: '8px', fontSize: '12px', color: '#7f5539' }}>🔍</span>
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setOrdersPage(1); setWishlistPage(1); }}
                  placeholder="Search tracker..." 
                  style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '12px', width: '100%', color: '#5c4033' }}
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#b0a499', padding: 0 }}
                  >
                    ✖
                  </button>
                )}
              </div>

              {suggestions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', borderRadius: '12px', boxShadow: '0 6px 20px rgba(230, 204, 178, 0.4)', border: '1px solid #e6ccb2', marginTop: '6px', zIndex: 100, overflow: 'hidden' }}>
                  <div style={{ padding: '6px 10px', fontSize: '10px', background: '#ffccd5', color: '#5c4033', fontWeight: '700' }}>
                    SUGGESTED ITEMS FOR "{searchQuery.toUpperCase()}"
                  </div>
                  {suggestions.map((item, idx) => (
                    <div 
                      key={idx}
                      onClick={() => {
                        setSearchQuery(item.name);
                        setActiveTab(item.tab === 'wishlist' ? 'wishlist' : 'orders');
                        setOrdersPage(1);
                        setWishlistPage(1);
                      }}
                      style={{ padding: '8px 12px', fontSize: '12px', cursor: 'pointer', borderBottom: '1px solid #fcf6f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#fcf6f0'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                    >
                      <span style={{ color: '#5c4033', fontWeight: '500' }}>{item.name}</span>
                      <span style={{ fontSize: '10px', background: item.tab === 'orders' ? '#bde0fe' : '#ffccd5', color: item.tab === 'orders' ? '#03045e' : '#5c4033', padding: '2px 6px', borderRadius: '4px' }}>
                        {item.type}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button 
              onClick={() => { setGuideActiveStep(null); setIsGuideOpen(true); }}
              style={getButtonStyle('blue')}
            >
              Shipping Guide ✨
            </button>
            <button 
              onClick={activeTab === 'wishlist' ? handleOpenAddWishlist : handleOpenAddOrder}
              style={getButtonStyle('pink')}
            >
              {activeTab === 'wishlist' ? 'Add Wishlist Item' : 'Add Order'}
            </button>

            {/* STRAWBERRY CAT ACCOUNT / SIGNOUT POPUP BUTTON */}
            <div style={{ position: 'relative' }} ref={accountMenuRef}>
              <button
                onClick={() => setIsAccountMenuOpen(prev => !prev)}
                style={{
                  background: '#ffd166',
                  border: '1.5px solid #ffd166',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  padding: 0,
                  cursor: 'pointer',
                  boxShadow: '0 3px 0 rgba(199, 175, 150, 0.4)',
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
                  background: '#fffdfa',
                  border: '1px solid #e6ccb2',
                  borderRadius: '16px',
                  boxShadow: '0 10px 30px rgba(230, 204, 178, 0.5)',
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
                      style={{ background: '#fcf6f0', border: '1px solid #e6ccb2', borderRadius: '50%', width: '28px', height: '28px', fontSize: '12px', cursor: 'pointer', color: '#7f5539', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      ✕
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ width: '50px', height: '50px', borderRadius: '50%', overflow: 'hidden', border: '1.5px solid #ffd166', background: '#ffd166', flexShrink: '0' }}>
                      <img src={STRAWBERRY_CAT_URL} alt="Strawberry Cat" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', textAlign: 'left', gap: '2px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#5c4033', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {user.displayName || 'Pinduoduo User'}
                      </span>
                      <span style={{ fontSize: '11px', color: '#8c7a6b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', background: '#fcf6f0', padding: '12px 18px', borderRadius: '12px', border: '1px solid #e6ccb2', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveTab('orders')}
              style={getButtonStyle(activeTab === 'orders' ? 'primary' : 'light')}
            >
              General Orders ({orders.length})
            </button>
            <button
              onClick={() => setActiveTab('wishlist')}
              style={getButtonStyle(activeTab === 'wishlist' ? 'primary' : 'light')}
            >
              Wishlist ({wishlist.length})
            </button>
          </div>

          {activeTab === 'orders' && (
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative' }} ref={dropdownRef}>
                <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700', letterSpacing: '0.5px', marginBottom: '2px' }}>BATCH FILTER</span>
                
                <button
                  onClick={() => setIsBatchDropdownOpen(prev => !prev)}
                  style={getButtonStyle('light')}
                >
                  {selectedBatch}
                  <span style={{ fontSize: '10px', color: '#8c7a6b', marginLeft: '4px' }}>{isBatchDropdownOpen ? '▲' : '▼'}</span>
                </button>

                {isBatchDropdownOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '105%',
                    right: 0,
                    width: '170px',
                    maxHeight: '220px',
                    overflowY: 'auto',
                    background: '#fffdfa',
                    border: '1px solid #e6ccb2',
                    borderRadius: '14px',
                    boxShadow: '0 8px 25px rgba(230, 204, 178, 0.5)',
                    zIndex: 200,
                    padding: '6px',
                    boxSizing: 'border-box'
                  }}>
                    {batchOptions.map((batch) => {
                      const isSelected = selectedBatch === batch;
                      return (
                        <div
                          key={batch}
                          onClick={() => {
                            setSelectedBatch(batch);
                            setOrdersPage(1);
                            setIsBatchDropdownOpen(false);
                          }}
                          style={{
                            padding: '8px 10px',
                            fontSize: '12px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: isSelected ? '700' : '500',
                            color: isSelected ? '#5c4033' : '#7f5539',
                            background: isSelected ? '#ffd166' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '2px',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = '#fcf6f0';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <span>{batch === 'All Batches' ? 'All Batches' : `${batch}`}</span>
                          {isSelected && <span style={{ fontSize: '10px' }}>✔</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* --- TAB 1: ORDERS --- */}
      {activeTab === 'orders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', boxSizing: 'border-box' }}>
          
          <div style={{ background: '#fffdfa', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(230, 204, 178, 0.25)', border: '1px solid #f0e6df', boxSizing: 'border-box', width: '100%' }}>
            <div style={{ background: '#fcf6f0', borderRadius: '12px', padding: '15px', border: '1px solid #e6ccb2', width: '100%', boxSizing: 'border-box' }}>
              <h3 style={{ fontSize: '12px', margin: '0 0 10px 0', textAlign: 'center', color: '#7f5539', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>
                ✦ Orders At A Glance ({selectedBatch}) ✦
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '15px', textAlign: 'center' }}>
                <div style={{ background: '#fffdfa', padding: '10px', borderRadius: '10px', border: '1px solid #e6ccb2' }}>
                  <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700' }}>TOTAL ORDERS</span>
                  <strong style={{ fontSize: '16px', color: '#5c4033' }}>{totalOrdersCount}</strong>
                </div>
                <div style={{ background: '#fffdfa', padding: '10px', borderRadius: '10px', border: '1px solid #e6ccb2' }}>
                  <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700' }}>TOTAL SPENT</span>
                  <strong style={{ fontSize: '16px', color: '#bc6c25' }}>₱{displayTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </div>
                <div style={{ background: '#fffdfa', padding: '10px', borderRadius: '10px', border: '1px solid #e6ccb2' }}>
                  <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700' }}>DELIVERED</span>
                  <strong style={{ fontSize: '16px', color: '#2d6a4f' }}>{deliveredCount}</strong>
                </div>
                <div style={{ background: '#fffdfa', padding: '10px', borderRadius: '10px', border: '1px solid #e6ccb2' }}>
                  <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700' }}>MISSING / REFUNDED</span>
                  <strong style={{ fontSize: '16px', color: '#780000' }}>{missingRefundedCount}</strong>
                </div>
                <div style={{ background: '#fffdfa', padding: '10px', borderRadius: '10px', border: '1px solid #e6ccb2' }}>
                  <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700' }}>AVG SHIPPING DAYS</span>
                  <strong style={{ fontSize: '16px', color: '#7f5539' }}>{avgShippingDays !== '-' ? `${avgShippingDays} days` : '-'}</strong>
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: '#fffdfa', padding: '22px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(230, 204, 178, 0.25)', marginBottom: '25px', width: '100%', boxSizing: 'border-box', overflowX: 'auto', border: '1px solid #f0e6df' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #fcf6f0', paddingBottom: '10px', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: '#7f5539', fontWeight: '700' }}>
                📦 General Order Tracker — {selectedBatch} {query && `(Filtered by "${searchQuery}")`}
              </h2>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {selectedOrderIds.length > 0 && (
                  <button
                    onClick={() => setIsBatchEditOpen(true)}
                    style={getButtonStyle('pink')}
                  >
                    ✏️ Batch Edit Selected ({selectedOrderIds.length})
                  </button>
                )}
                <span style={{ fontSize: '11px', color: '#8c7a6b', fontWeight: '600' }}>Showing {finalFilteredOrders.length} orders found</span>
              </div>
            </div>

            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'center', minWidth: '1350px' }}>
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
                <col style={{ width: '7%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#fcf6f0', color: '#7f5539' }}>
                  <th style={{ padding: '10px', borderRadius: '8px 0 0 8px', fontWeight: 'bold' }}>
                    <input 
                      type="checkbox"
                      onChange={handleSelectAllCurrentSlice}
                      checked={currentOrdersSlice.length > 0 && currentOrdersSlice.every(o => selectedOrderIds.includes(o.id))}
                      title="Select all on this page"
                      style={{ cursor: 'pointer' }}
                    />
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
                    <td colSpan="14" style={{ textAlign: 'center', padding: '35px', color: '#b0a499' }}>
                      No matching orders found.
                    </td>
                  </tr>
                ) : (
                  currentOrdersSlice.map((order) => {
                    const actualDays = calculateActualShippingDays(order.date, order.actualDeliveryDate);
                    const isSelected = selectedOrderIds.includes(order.id);
                    return (
                      <tr key={order.id} style={{ borderBottom: '1px solid #fcf6f0', background: isSelected ? '#fff5f7' : 'transparent' }}>
                        <td style={{ padding: '12px 6px' }}>
                          <input 
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectOrder(order.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '12px 8px', fontWeight: 'normal', color: '#5c4033', wordBreak: 'break-word' }}>{order.name}</td>
                        <td>{order.qty}</td>
                        <td>₱{Number(order.cost).toFixed(2)}</td>
                        <td style={{ color: '#bc6c25', fontWeight: 'bold' }}>₱{(order.qty * order.cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td>{order.date}</td>
                        <td>
                          <span style={{ background: '#ffd166', color: '#5c4033', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
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
                        </td>
                        <td>
                          {order.orderStatus ? (
                            <span style={{ background: order.orderStatus === 'OK ✔' ? '#d8f3dc' : '#ffccd5', color: order.orderStatus === 'OK ✔' ? '#1b4332' : '#780000', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
                              {order.orderStatus}
                            </span>
                          ) : (
                            <span style={{ color: '#b0a499', fontSize: '11px' }}>-</span>
                          )}
                        </td>
                        <td style={{ color: '#8c7a6b', wordBreak: 'break-word' }}>{order.notes || '-'}</td>
                        <td style={{ color: '#8c7a6b' }}>{order.estDelivery}</td>
                        <td style={{ color: order.actualDeliveryDate ? '#5c4033' : '#b0a499' }}>
                          {order.actualDeliveryDate || '-'}
                        </td>
                        <td>
                          <span style={{ background: actualDays !== null ? '#d8f3dc' : '#fcf6f0', color: actualDays !== null ? '#1b4332' : '#b0a499', padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', boxShadow: '0 2px 0 rgba(0,0,0,0.05)' }}>
                            {actualDays !== null ? `${actualDays} days` : '-'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button 
                              style={getButtonStyle('pink')}
                              onClick={() => handleOpenEditOrder(order)}
                            >
                              Edit
                            </button>
                            <button 
                              style={getButtonStyle('danger')}
                              onClick={() => handleDeleteOrder(order.id)}
                            >
                              🗑️
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

      {/* --- TAB 2: WISHLIST --- */}
      {activeTab === 'wishlist' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', boxSizing: 'border-box' }}>
          
          <div style={{ background: '#fffdfa', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(230, 204, 178, 0.25)', border: '1px solid #f0e6df', boxSizing: 'border-box', width: '100%' }}>
            <div style={{ background: '#fcf6f0', borderRadius: '12px', padding: '15px', border: '1px solid #e6ccb2', width: '100%', boxSizing: 'border-box' }}>
              <h3 style={{ fontSize: '12px', margin: '0 0 10px 0', textAlign: 'center', color: '#7f5539', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>
                ✦ Wishlist Dashboard ✦
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '15px', textAlign: 'center' }}>
                <div style={{ background: '#fffdfa', padding: '10px', borderRadius: '10px', border: '1px solid #e6ccb2' }}>
                  <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700' }}>INITIAL TOTAL</span>
                  <strong style={{ fontSize: '14px', color: '#5c4033' }}>₱{wishlistInitialTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </div>
                <div style={{ background: '#fffdfa', padding: '10px', borderRadius: '10px', border: '1px solid #e6ccb2' }}>
                  <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700' }}>LATEST TOTAL</span>
                  <strong style={{ fontSize: '14px', color: '#bc6c25' }}>₱{wishlistLatestTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </div>
                <div style={{ background: '#fffdfa', padding: '10px', borderRadius: '10px', border: '1px solid #e6ccb2' }}>
                  <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700', marginBottom: '4px' }}>PRICE FLAG</span>
                  {renderPriceFlag(1, wishlistInitialTotal, wishlistLatestTotal)}
                </div>
                <div style={{ background: '#fffdfa', padding: '10px', borderRadius: '10px', border: '1px solid #e6ccb2' }}>
                  <span style={{ fontSize: '10px', color: '#8c7a6b', display: 'block', fontWeight: '700' }}>ITEMS SAVED</span>
                  <strong style={{ fontSize: '14px', color: '#7f5539' }}>{wishlist.length}</strong>
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: '#fffdfa', padding: '22px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(230, 204, 178, 0.25)', width: '100%', boxSizing: 'border-box', overflowX: 'auto', border: '1px solid #f0e6df' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #fcf6f0', paddingBottom: '10px', marginBottom: '15px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: '#7f5539', fontWeight: '700' }}>
                ✨ Wishlist Tracker & Price Monitor {query && `(Filtered by "${searchQuery}")`}
              </h2>
            </div>

            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'center', minWidth: '1000px' }}>
              <colgroup>
                <col style={{ width: '25%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#fcf6f0', color: '#7f5539' }}>
                  <th style={{ padding: '10px', borderRadius: '8px 0 0 8px', fontWeight: 'bold' }}>Item Name</th>
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
                    <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: '#b0a499' }}>
                      No matching wishlist items found.
                    </td>
                  </tr>
                ) : (
                  currentWishlistSlice.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #fcf6f0' }}>
                      <td style={{ padding: '12px 10px', fontWeight: 'normal', color: '#5c4033', wordBreak: 'break-word' }}>{item.name}</td>
                      <td>{item.qty}</td>
                      <td>₱{Number(item.initialCost).toFixed(2)}</td>
                      <td style={{ color: '#5c4033', fontWeight: '500' }}>₱{(item.qty * item.initialCost).toFixed(2)}</td>
                      <td style={{ color: '#bc6c25', fontWeight: 'bold' }}>₱{Number(item.latestCost).toFixed(2)}</td>
                      <td>{renderPriceFlag(item.qty, item.initialCost, item.latestCost)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button 
                            style={getButtonStyle('pink')}
                            onClick={() => handleOpenEditWishlist(item)}
                          >
                            Edit
                          </button>
                          <button 
                            style={getButtonStyle('primary')}
                            onClick={() => handleMoveToTracker(item)}
                          >
                            Move
                          </button>
                          <button 
                            style={getButtonStyle('danger')}
                            onClick={() => handleDeleteWishlist(item.id)}
                          >
                            🗑️
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
          <div style={{ background: '#fffdfa', borderRadius: '20px', padding: '25px', maxWidth: '650px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 15px 40px rgba(230, 204, 178, 0.5)', borderTop: '6px solid #ffd166', boxSizing: 'border-box', border: '1px solid #e6ccb2' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #fcf6f0', paddingBottom: '12px' }}>
              <div style={{ width: '32px' }}></div>
              <h2 style={{ fontSize: '18px', margin: 0, color: '#7f5539', fontWeight: '700', textAlign: 'center', flex: 1 }}>
                Pinduoduo Shipping Adventure Guide
              </h2>
              <button 
                onClick={() => setIsGuideOpen(false)} 
                style={{ background: '#fcf6f0', border: '1px solid #e6ccb2', borderRadius: '50%', width: '32px', height: '32px', fontSize: '14px', cursor: 'pointer', color: '#7f5539', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '12px', color: '#8c7a6b', marginBottom: '20px', textAlign: 'center', lineHeight: '1.5' }}>
              Follow your order's step-by-step process from the China warehouse all the way to your doorstep!
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { title: 'Ordered', statusKey: 'Ordered', desc: 'Your order is placed and awaiting consolidation at the warehouse.', isStep: true },
                { title: 'At China Warehouse', statusKey: 'At China Warehouse', desc: 'Package arrived at the China consolidation hub and is getting prepped.', isStep: true },
                { title: 'Dispatched & China Customs', statusKey: 'Dispatched / China Customs', desc: 'Dispatched from Zhongshan/warehouse. ⚠️ 21–24 business day countdown officially starts here (Weekends excluded).', isStep: true },
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
                      background: isHighlighted ? '#fff5f7' : '#fcf6f0',
                      padding: '12px 18px',
                      borderRadius: '12px',
                      border: isHighlighted ? '2px solid #ffafcc' : '1px solid #e6ccb2',
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
                      <strong style={{ fontSize: '13px', color: '#5c4033' }}>
                        {step.isStep ? `Step ${idx}: ${step.title}` : step.title}
                      </strong>
                      <p style={{ fontSize: '11px', color: '#7f5539', margin: 0, lineHeight: '1.4' }}>
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
                Got it, let's track! ✨
              </button>
            </div>

          </div>
        </div>
      )}

      {/* --- ADD / EDIT ORDER MODAL --- */}
      {isOrderModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.3)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '15px', boxSizing: 'border-box' }}>
          <div style={{ background: '#fffdfa', borderRadius: '16px', padding: '25px', maxWidth: '480px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 30px rgba(230, 204, 178, 0.4)', borderTop: '5px solid #ffafcc', boxSizing: 'border-box', border: '1px solid #e6ccb2' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #fcf6f0', paddingBottom: '10px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: '#7f5539', fontWeight: '700' }}>
                {editingOrder ? 'Edit Order' : 'Add New Order'}
              </h2>
              <button 
                onClick={() => setIsOrderModalOpen(false)} 
                style={{ background: '#fcf6f0', border: '1px solid #e6ccb2', borderRadius: '50%', width: '28px', height: '28px', fontSize: '12px', cursor: 'pointer', color: '#7f5539', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveOrder} style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Item Name*</label>
                <input type="text" name="name" value={orderFormData.name} onChange={handleOrderInputChange} placeholder="e.g. Minimalist Rug" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Quantity</label>
                  <input type="number" name="qty" min="1" value={orderFormData.qty} onChange={handleOrderInputChange} style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Cost (Unit) (₱)*</label>
                  <input type="number" name="cost" value={orderFormData.cost} onChange={handleOrderInputChange} placeholder="250" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} required />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Date Ordered</label>
                  <input type="date" name="date" value={orderFormData.date} onChange={handleOrderInputChange} style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} />
                </div>

                <div style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Batch</label>
                  <div 
                    onClick={() => setModalBatchOpen(!modalBatchOpen)}
                    style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span>{orderFormData.batch || 'Batch 1'}</span>
                    <span style={{ fontSize: '10px', color: '#8c7a6b' }}>{modalBatchOpen ? '▲' : '▼'}</span>
                  </div>
                  {modalBatchOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '150px', overflowY: 'auto', background: '#fffdfa', border: '1px solid #e6ccb2', borderRadius: '8px', boxShadow: '0 6px 20px rgba(230, 204, 178, 0.4)', zIndex: 300, padding: '4px', boxSizing: 'border-box' }}>
                      {Array.from({ length: 25 }, (_, i) => `Batch ${i + 1}`).map(b => (
                        <div 
                          key={b}
                          onClick={() => { setOrderFormData(prev => ({ ...prev, batch: b })); setModalBatchOpen(false); }}
                          style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', background: orderFormData.batch === b ? '#ffd166' : 'transparent', fontWeight: orderFormData.batch === b ? 'bold' : 'normal', color: '#5c4033' }}
                        >
                          {b}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Shipping Status</label>
                  <div 
                    onClick={() => setModalShippingOpen(!modalShippingOpen)}
                    style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{orderFormData.shippingStatus || 'Ordered'}</span>
                    <span style={{ fontSize: '10px', color: '#8c7a6b', marginLeft: '4px' }}>{modalShippingOpen ? '▲' : '▼'}</span>
                  </div>
                  {modalShippingOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '160px', overflowY: 'auto', background: '#fffdfa', border: '1px solid #e6ccb2', borderRadius: '8px', boxShadow: '0 6px 20px rgba(230, 204, 178, 0.4)', zIndex: 300, padding: '4px', boxSizing: 'border-box' }}>
                      {shippingStatusOptions.map(st => (
                        <div 
                          key={st}
                          onClick={() => { setOrderFormData(prev => ({ ...prev, shippingStatus: st })); setModalShippingOpen(false); }}
                          style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', background: orderFormData.shippingStatus === st ? '#ffd166' : 'transparent', fontWeight: orderFormData.shippingStatus === st ? 'bold' : 'normal', color: '#5c4033' }}
                        >
                          {st}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Order Status</label>
                  <div 
                    onClick={() => setModalOrderStatusOpen(!modalOrderStatusOpen)}
                    style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span>{orderFormData.orderStatus || '-- Select Status --'}</span>
                    <span style={{ fontSize: '10px', color: '#8c7a6b' }}>{modalOrderStatusOpen ? '▲' : '▼'}</span>
                  </div>
                  {modalOrderStatusOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '140px', overflowY: 'auto', background: '#fffdfa', border: '1px solid #e6ccb2', borderRadius: '8px', boxShadow: '0 6px 20px rgba(230, 204, 178, 0.4)', zIndex: 300, padding: '4px', boxSizing: 'border-box' }}>
                      {orderStatusOptions.map(ost => (
                        <div 
                          key={ost}
                          onClick={() => { setOrderFormData(prev => ({ ...prev, orderStatus: ost === '-- None --' ? '' : ost })); setModalOrderStatusOpen(false); }}
                          style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', background: orderFormData.orderStatus === ost ? '#ffd166' : 'transparent', fontWeight: orderFormData.orderStatus === ost ? 'bold' : 'normal', color: '#5c4033' }}
                        >
                          {ost}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Actual Delivery Date</label>
                  <input type="date" name="actualDeliveryDate" value={orderFormData.actualDeliveryDate} onChange={handleOrderInputChange} style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Notes/Comments</label>
                  <input type="text" name="notes" value={orderFormData.notes} onChange={handleOrderInputChange} placeholder="Optional notes..." style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px' }}>
                <button type="button" onClick={() => setIsOrderModalOpen(false)} style={getButtonStyle('light')}>Cancel</button>
                <button type="submit" style={getButtonStyle('primary')}>
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
          <div style={{ background: '#fffdfa', borderRadius: '16px', padding: '25px', maxWidth: '420px', width: '100%', boxShadow: '0 10px 30px rgba(230, 204, 178, 0.4)', borderTop: '5px solid #ffafcc', boxSizing: 'border-box', border: '1px solid #e6ccb2' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #fcf6f0', paddingBottom: '10px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: '#7f5539', fontWeight: '700' }}>
                ✏️ Batch Edit Selected Orders ({selectedOrderIds.length})
              </h2>
              <button 
                onClick={() => setIsBatchEditOpen(false)} 
                style={{ background: '#fcf6f0', border: '1px solid #e6ccb2', borderRadius: '50%', width: '28px', height: '28px', fontSize: '12px', cursor: 'pointer', color: '#7f5539', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '12px' }}>
              <p style={{ color: '#8c7a6b', margin: 0, lineHeight: '1.4' }}>
                Update the batch and shipping status for all {selectedOrderIds.length} selected items simultaneously!
              </p>

              {/* Target Batch Selection */}
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>New Batch</label>
                <div 
                  onClick={() => setBatchEditBatchDropdownOpen(!batchEditBatchDropdownOpen)}
                  style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>{batchEditTargetBatch}</span>
                  <span style={{ fontSize: '10px', color: '#8c7a6b' }}>{batchEditBatchDropdownOpen ? '▲' : '▼'}</span>
                </div>
                {batchEditBatchDropdownOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '150px', overflowY: 'auto', background: '#fffdfa', border: '1px solid #e6ccb2', borderRadius: '8px', boxShadow: '0 6px 20px rgba(230, 204, 178, 0.4)', zIndex: 300, padding: '4px', boxSizing: 'border-box' }}>
                    {Array.from({ length: 25 }, (_, i) => `Batch ${i + 1}`).map(b => (
                      <div 
                        key={b}
                        onClick={() => { setBatchEditTargetBatch(b); setBatchEditBatchDropdownOpen(false); }}
                        style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', background: batchEditTargetBatch === b ? '#ffd166' : 'transparent', fontWeight: batchEditTargetBatch === b ? 'bold' : 'normal', color: '#5c4033' }}
                      >
                        {b}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Target Shipping Status Selection */}
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>New Shipping Status</label>
                <div 
                  onClick={() => setBatchEditShippingDropdownOpen(!batchEditShippingDropdownOpen)}
                  style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <span>{batchEditTargetShipping}</span>
                  <span style={{ fontSize: '10px', color: '#8c7a6b' }}>{batchEditShippingDropdownOpen ? '▲' : '▼'}</span>
                </div>
                {batchEditShippingDropdownOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '160px', overflowY: 'auto', background: '#fffdfa', border: '1px solid #e6ccb2', borderRadius: '8px', boxShadow: '0 6px 20px rgba(230, 204, 178, 0.4)', zIndex: 300, padding: '4px', boxSizing: 'border-box' }}>
                    {shippingStatusOptions.map(st => (
                      <div 
                        key={st}
                        onClick={() => { setBatchEditTargetShipping(st); setBatchEditShippingDropdownOpen(false); }}
                        style={{ padding: '6px 8px', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', background: batchEditTargetShipping === st ? '#ffd166' : 'transparent', fontWeight: batchEditTargetShipping === st ? 'bold' : 'normal', color: '#5c4033' }}
                      >
                        {st}
                      </div>
                    ))}
                  </div>
                )}
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

      {/* --- ADD / EDIT WISHLIST MODAL --- */}
      {isWishlistModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.3)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '15px', boxSizing: 'border-box' }}>
          <div style={{ background: '#fffdfa', borderRadius: '16px', padding: '25px', maxWidth: '440px', width: '100%', boxShadow: '0 10px 30px rgba(230, 204, 178, 0.4)', borderTop: '5px solid #ffafcc', boxSizing: 'border-box', border: '1px solid #e6ccb2' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #fcf6f0', paddingBottom: '10px' }}>
              <h2 style={{ fontSize: '16px', margin: 0, color: '#7f5539', fontWeight: '700' }}>
                {editingWishlistItem ? 'Edit Wishlist Item' : 'Add Wishlist Item'}
              </h2>
              <button 
                onClick={() => setIsWishlistModalOpen(false)} 
                style={{ background: '#fcf6f0', border: '1px solid #e6ccb2', borderRadius: '50%', width: '28px', height: '28px', fontSize: '12px', cursor: 'pointer', color: '#7f5539', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveWishlist} style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Item Name*</label>
                <input type="text" name="name" value={wishlistFormData.name} onChange={handleWishlistInputChange} placeholder="e.g. Cute Makeup Organizer" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} required />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Quantity</label>
                <input type="number" name="qty" min="1" value={wishlistFormData.qty} onChange={handleWishlistInputChange} style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Initial Cost (Unit ₱)*</label>
                  <input type="number" step="0.01" name="initialCost" value={wishlistFormData.initialCost} onChange={handleWishlistInputChange} placeholder="45.00" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '3px', color: '#7f5539' }}>Latest Cost (Unit ₱)</label>
                  <input type="number" step="0.01" name="latestCost" value={wishlistFormData.latestCost} onChange={handleWishlistInputChange} placeholder="Leave empty if same" style={{ width: '100%', padding: '9px', boxSizing: 'border-box', borderRadius: '8px', border: '1px solid #e6ccb2', fontSize: '12px', background: '#fcf6f0', color: '#5c4033', outline: 'none' }} />
                </div>
              </div>

              {/* LIVE COMPUTATION PREVIEW BOX (FOR BOTH ADD & EDIT) */}
              <div style={{ background: '#fcf6f0', border: '1px solid #e6ccb2', borderRadius: '10px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#7f5539' }}>
                  <span>Initial Total: <strong>₱{(Number(wishlistFormData.qty || 1) * Number(wishlistFormData.initialCost || 0)).toFixed(2)}</strong></span>
                  <span>Latest Total: <strong>₱{(Number(wishlistFormData.qty || 1) * (wishlistFormData.latestCost !== '' ? Number(wishlistFormData.latestCost) : Number(wishlistFormData.initialCost || 0))).toFixed(2)}</strong></span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2px', borderTop: '1px dashed #e6ccb2' }}>
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
                <button type="submit" style={getButtonStyle('primary')}>
                  {editingWishlistItem ? 'Update Item' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}