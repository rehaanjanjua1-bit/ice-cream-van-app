// ═══════════════════════════════════════════════════════
// SCOOP — app.js (Google Maps version)
// ═══════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://wwgovmkzxrtobklxxija.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Z292bWt6eHJ0b2JrbHh4aWphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUyMjksImV4cCI6MjA5ODA3MTIyOX0.zdad6bvjSNALfZSmcC8t-N13fDZceYWdqFuNdKPsTM4';
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/REPLACE_WITH_YOUR_PAYMENT_LINK';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
let map, userSession, userRole, userVanId, isLive = false;
let vanMarkers = {};
let locationWatchId = null;

// ── Utility ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('show');
    s.style.display = 'none';
  });
  const el = document.getElementById(id);
  el.style.display = 'block';
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
    email, password: pass,
    options: { data: { role: type, van_name: vanName || null }, emailRedirectTo: window.location.origin }
  });

  if (error) { toast('Error: ' + error.message); return; }

  document.getElementById('confirm-email-addr').textContent = email;
  showScreen('s-confirm');

  if (type === 'driver' && data.user) {
    await sb.from('profiles').upsert({ id: data.user.id, role: 'driver', van_name: vanName, subscribed: false });
  }
}

async function logInEmail() {
  const email = document.getElementById('inp-login-email').value.trim();
  const pass  = document.getElementById('inp-login-pass').value;
  if (!email || !pass) { toast('Please enter email and password.'); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) { toast('Error: ' + error.message); }
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

// ── Auth state ───────────────────────────────────────────
sb.auth.onAuthStateChange(async (event, session) => {
  userSession = session;
  if (!session) { showScreen('s-splash'); return; }

  const user = session.user;
  let { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();

  if (!profile) {
    await sb.from('profiles').insert({ id: user.id, role: 'customer', van_name: null, subscribed: false });
    profile = { role: 'customer', van_name: null, subscribed: false };
  }

  userRole = profile.role;
  userVanId = user.id;

  if (userRole === 'driver' && !profile.subscribed) { showScreen('s-stripe'); return; }

  openApp(user, profile);
});

function redirectToStripe() {
  window.location.href = STRIPE_PAYMENT_LINK + '?client_reference_id=' + userSession.user.id;
}

// ── Main app ─────────────────────────────────────────────
async function openApp(user, profile) {
  showScreen('s-app');
  const name = user.user_metadata?.full_name || user.email.split('@')[0];
  document.getElementById('app-username').textContent = name;

  if (profile.role === 'driver') {
    document.getElementById('driver-badge').style.display = 'inline-block';
    document.getElementById('driver-panel').style.display = 'block';
    document.getElementById('customer-panel').style.display = 'none';
    document.getElementById('van-display-name').textContent = profile.van_name || 'Your van';
  } else {
    document.getElementById('driver-panel').style.display = 'none';
    document.getElementById('customer-panel').style.display = 'flex';
  }

  initMap(profile.role === 'driver');
}

// ── Google Maps ──────────────────────────────────────────
function initMap(isDriver) {
  if (map) {
    google.maps.event.trigger(map, 'resize');
    return;
  }

  const mapEl = document.getElementById("map");
  mapEl.style.position = "fixed";
  mapEl.style.top = "52px";
  mapEl.style.bottom = "46px";
  mapEl.style.left = "0";
  mapEl.style.right = "0";
  mapEl.style.zIndex = "1";

  map = new google.maps.Map(mapEl, {
    center: { lat: 52.5, lng: -1.5 },
    zoom: 6,
    mapTypeId: 'roadmap',
    disableDefaultUI: false,
    zoomControl: true,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }
    ]
  });

  // Centre on user location
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      map.setZoom(13);
    });
  }

  if (!isDriver) {
    loadVans();
    setInterval(loadVans, 30000);
  }
}

// ── Load live vans ───────────────────────────────────────
async function loadVans() {
  const { data: vans, error } = await sb
    .from('van_locations')
    .select('*, profiles(van_name)')
    .eq('is_live', true);

  if (error) { console.error(error); return; }

  // Remove old markers
  Object.values(vanMarkers).forEach(m => m.setMap(null));
  vanMarkers = {};

  vans.forEach(v => {
    const marker = new google.maps.Marker({
      position: { lat: v.lat, lng: v.lng },
      map,
      title: v.profiles?.van_name || 'Ice Cream Van',
      label: { text: '🍦', fontSize: '24px' },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 0,
      }
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `<div style="font-family:sans-serif;padding:4px">
        <strong>${v.profiles?.van_name || 'Ice Cream Van'}</strong><br/>
        <span style="color:#22c55e">● Live now</span>
      </div>`
    });

    marker.addListener('click', () => infoWindow.open(map, marker));
    vanMarkers[v.id] = marker;
  });

  const label = document.getElementById('van-count-label');
  if (label) {
    label.textContent = vans.length === 0
      ? 'No vans live right now — check back soon!'
      : `${vans.length} van${vans.length > 1 ? 's' : ''} live near you 🍦`;
  }
}

function refreshMap() {
  loadVans();
  toast('Map refreshed!');
}

// ── Driver: go live ──────────────────────────────────────
async function toggleLive() {
  if (isLive) { await goOffline(); } else { await goLive(); }
}

async function goLive() {
  if (!navigator.geolocation) { toast('Location not supported.'); return; }
  toast('Getting your location…');

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    const { error } = await sb.from('van_locations').upsert({
      id: userVanId, lat, lng, is_live: true, updated_at: new Date().toISOString()
    });

    if (error) { toast('Error: ' + error.message); return; }

    isLive = true;
    updateLiveUI(true);

    locationWatchId = setInterval(async () => {
      navigator.geolocation.getCurrentPosition(async (p) => {
        await sb.from('van_locations').update({
          lat: p.coords.latitude, lng: p.coords.longitude, updated_at: new Date().toISOString()
        }).eq('id', userVanId);

        if (vanMarkers[userVanId]) {
          vanMarkers[userVanId].setPosition({ lat: p.coords.latitude, lng: p.coords.longitude });
        }
      });
    }, 15000);

    if (vanMarkers[userVanId]) vanMarkers[userVanId].setMap(null);
    const marker = new google.maps.Marker({
      position: { lat, lng },
      map,
      title: 'You are live!',
      label: { text: '🚐', fontSize: '24px' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 }
    });
    vanMarkers[userVanId] = marker;
    map.setCenter({ lat, lng });
    map.setZoom(14);

    toast('You\'re live! Customers can see you 🚐');
  }, () => { toast('Could not get location. Check permissions.'); });
}

async function goOffline() {
  if (locationWatchId) { clearInterval(locationWatchId); locationWatchId = null; }
  await sb.from('van_locations').update({ is_live: false }).eq('id', userVanId);
  if (vanMarkers[userVanId]) { vanMarkers[userVanId].setMap(null); delete vanMarkers[userVanId]; }
  isLive = false;
  updateLiveUI(false);
  toast('You\'re offline. See you next time! 👋');
}

function updateLiveUI(live) {
  document.getElementById('live-status').className = 'status-dot ' + (live ? 'online' : 'offline');
  document.getElementById('live-label').textContent = live ? 'Live' : 'Offline';
  document.getElementById('go-live-btn').textContent = live ? 'Go Offline 🔴' : 'Go Live 🟢';
}

window._signupType = 'customer';
