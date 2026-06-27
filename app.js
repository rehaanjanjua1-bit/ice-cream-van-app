// ═══════════════════════════════════════════════════════
// SCOOP — app.js
// ═══════════════════════════════════════════════════════

// ── Config ──────────────────────────────────────────────
const SUPABASE_URL  = 'https://wwgovmkzxrtobklxxija.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Z292bWt6eHJ0b2JrbHh4aWphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUyMjksImV4cCI6MjA5ODA3MTIyOX0.zdad6bvjSNALfZSmcC8t-N13fDZceYWdqFuNdKPsTM4';

// ⬇ Paste your Stripe publishable key here (starts with pk_live_ or pk_test_)
const STRIPE_PK = 'pk_test_REPLACE_WITH_YOUR_STRIPE_PUBLISHABLE_KEY';

// ⬇ Paste your Stripe Payment Link URL here (for £1.99/mo driver subscription)
//   Create one in Stripe Dashboard → Payment Links → + New
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/REPLACE_WITH_YOUR_PAYMENT_LINK';

// ── Init ────────────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
let map, userSession, userRole, userVanId, isLive = false;
let vanMarkers = {};   // vanId → Leaflet marker
let locationWatchId = null;
let pendingDriverUserId = null;

// ── Utility ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('show');
    s.style.display = 'none';
  });
  const el = document.getElementById(id);
  el.style.display = 'flex';
  el.classList.add('show');
}

function toast(msg, dur = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

function setType(type) {
  const isDriver = type === 'driver';
  document.getElementById('van-field').style.display        = isDriver ? 'block' : 'none';
  document.getElementById('driver-price-box').style.display = isDriver ? 'block' : 'none';
  document.getElementById('email-confirm-notice').style.display = 'block';
  document.getElementById('su-sub').textContent = isDriver
    ? 'Put your van on the map for £1.99/month.'
    : 'Free forever — find vans near you.';
  document.getElementById('tt-c').className = 'ttab' + (isDriver ? '' : ' active-c');
  document.getElementById('tt-d').className = 'ttab' + (isDriver ? ' active-d' : '');
  window._signupType = type;
}

// ── Auth ─────────────────────────────────────────────────
async function signUpEmail() {
  const email   = document.getElementById('inp-email').value.trim();
  const pass    = document.getElementById('inp-pass').value;
  const vanName = document.getElementById('inp-van').value.trim();
  const type    = window._signupType || 'customer';

  if (!email || !pass) { toast('Please enter email and password.'); return; }
  if (type === 'driver' && !vanName) { toast('Please enter your van name.'); return; }

  const { data, error } = await sb.auth.signUp({
    email,
    password: pass,
    options: {
      data: { role: type, van_name: vanName || null },
      emailRedirectTo: window.location.origin
    }
  });

  if (error) { toast('Error: ' + error.message); return; }

  // Show email confirmation screen
  document.getElementById('confirm-email-addr').textContent = email;
  showScreen('s-confirm');

  // If driver, stash their user id so we redirect to Stripe after they confirm
  if (type === 'driver' && data.user) {
    pendingDriverUserId = data.user.id;
    // Save van name to profiles table
    await sb.from('profiles').upsert({
      id: data.user.id,
      role: 'driver',
      van_name: vanName,
      subscribed: false
    });
  }
}

async function logInEmail() {
  const email = document.getElementById('inp-login-email').value.trim();
  const pass  = document.getElementById('inp-login-pass').value;
  if (!email || !pass) { toast('Please enter email and password.'); return; }

  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) { toast('Error: ' + error.message); }
  // onAuthStateChange handles the rest
}

async function signInGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) toast('Google sign-in error: ' + error.message);
}

async function doLogout() {
  if (isLive) await goOffline();
  await sb.auth.signOut();
  showScreen('s-splash');
}

// ── Auth state listener ──────────────────────────────────
sb.auth.onAuthStateChange(async (event, session) => {
  userSession = session;

  if (!session) {
    showScreen('s-splash');
    return;
  }

  const user = session.user;

  // Load profile
  let { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();

  // First-time Google sign-in — create profile as customer
  if (!profile) {
    await sb.from('profiles').insert({
      id: user.id,
      role: 'customer',
      van_name: null,
      subscribed: false
    });
    profile = { role: 'customer', van_name: null, subscribed: false };
  }

  userRole = profile.role;
  userVanId = user.id;  // Use user ID as the van identifier

  // Driver who hasn't subscribed yet — push to Stripe
  if (userRole === 'driver' && !profile.subscribed) {
    showScreen('s-stripe');
    return;
  }

  // All good — open the app
  openApp(user, profile);
});

// ── Stripe redirect ──────────────────────────────────────
function redirectToStripe() {
  // Append the user's ID so Stripe webhook can match them
  const url = STRIPE_PAYMENT_LINK + '?client_reference_id=' + userSession.user.id;
  window.location.href = url;
}

// ── Main app ─────────────────────────────────────────────
async function openApp(user, profile) {
  showScreen('s-app');

  // Set header info
  const name = user.user_metadata?.full_name || user.email.split('@')[0];
  document.getElementById('app-username').textContent = name;

  if (profile.role === 'driver') {
    document.getElementById('driver-badge').style.display = 'inline-block';
    document.getElementById('driver-panel').style.display = 'block';
    document.getElementById('customer-panel').style.display = 'none';
    document.getElementById('van-display-name').textContent = profile.van_name || 'Your van';
    initMap(true);
  } else {
    document.getElementById('driver-panel').style.display = 'none';
    document.getElementById('customer-panel').style.display = 'flex';
    initMap(false);
    loadVans();
    // Refresh every 30 seconds
    setInterval(loadVans, 30000);
  }
}

// ── Leaflet map ──────────────────────────────────────────
function initMap(isDriver) {
  if (map) return; // already initialised

  // Default centre: UK
  map = L.map('map').setView([52.5, -1.5], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);

  // Try to centre on user
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 13);
    });
  }
}

function makeVanIcon() {
  return L.divIcon({
    html: '<div class="van-marker">🚐</div>',
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
}

// ── Load live vans (customer view) ───────────────────────
async function loadVans() {
  const { data: vans, error } = await sb
    .from('van_locations')
    .select('*, profiles(van_name)')
    .eq('is_live', true);

  if (error) { console.error(error); return; }

  // Remove old markers
  Object.values(vanMarkers).forEach(m => m.remove());
  vanMarkers = {};

  vans.forEach(v => {
    const marker = L.marker([v.lat, v.lng], { icon: makeVanIcon() })
      .addTo(map)
      .bindPopup(`<strong>${v.profiles?.van_name || 'Ice Cream Van'}</strong><br/>Live now 🍦`);
    vanMarkers[v.id] = marker;
  });

  const label = document.getElementById('van-count-label');
  label.textContent = vans.length === 0
    ? 'No vans live right now — check back soon!'
    : `${vans.length} van${vans.length > 1 ? 's' : ''} live near you 🍦`;
}

function refreshMap() {
  loadVans();
  toast('Map refreshed!');
}

// ── Driver: go live ──────────────────────────────────────
async function toggleLive() {
  if (isLive) {
    await goOffline();
  } else {
    await goLive();
  }
}

async function goLive() {
  if (!navigator.geolocation) {
    toast('Location not supported on this device.');
    return;
  }

  toast('Getting your location…');

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { lat, lng } = { lat: pos.coords.latitude, lng: pos.coords.longitude };

    const { error } = await sb.from('van_locations').upsert({
      id: userVanId,
      lat,
      lng,
      is_live: true,
      updated_at: new Date().toISOString()
    });

    if (error) { toast('Error going live: ' + error.message); return; }

    isLive = true;
    updateLiveUI(true);

    // Keep updating location every 15s while live
    locationWatchId = setInterval(async () => {
      navigator.geolocation.getCurrentPosition(async (p) => {
        await sb.from('van_locations').update({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          updated_at: new Date().toISOString()
        }).eq('id', userVanId);
      });
    }, 15000);

    // Show van on map
    if (vanMarkers[userVanId]) vanMarkers[userVanId].remove();
    const marker = L.marker([lat, lng], { icon: makeVanIcon() })
      .addTo(map)
      .bindPopup('You are live! 🍦')
      .openPopup();
    vanMarkers[userVanId] = marker;
    map.setView([lat, lng], 14);

    toast('You\'re live! Customers can see you 🚐');
  }, () => {
    toast('Could not get location. Check permissions.');
  });
}

async function goOffline() {
  if (locationWatchId) { clearInterval(locationWatchId); locationWatchId = null; }

  await sb.from('van_locations').update({ is_live: false }).eq('id', userVanId);

  if (vanMarkers[userVanId]) { vanMarkers[userVanId].remove(); delete vanMarkers[userVanId]; }
  isLive = false;
  updateLiveUI(false);
  toast('You\'re offline. See you next time! 👋');
}

function updateLiveUI(live) {
  document.getElementById('live-status').className = 'status-dot ' + (live ? 'online' : 'offline');
  document.getElementById('live-label').textContent = live ? 'Live' : 'Offline';
  document.getElementById('go-live-btn').textContent = live ? 'Go Offline 🔴' : 'Go Live 🟢';
}

// ── Init default type ────────────────────────────────────
window._signupType = 'customer';
