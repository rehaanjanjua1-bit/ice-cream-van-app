const SUPABASE_URL  = 'https://wwgovmkzxrtobklxxija.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Z292bWt6eHJ0b2JrbHh4aWphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUyMjksImV4cCI6MjA5ODA3MTIyOX0.zdad6bvjSNALfZSmcC8t-N13fDZceYWdqFuNdKPsTM4';
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/3cIeVceHV03Y1sy6aQejK00';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
let map, userSession, userRole, userVanId, isLive = false;
let vanMarkers = {};
let locationWatchId = null;
let googleMapsReady = false;
let pendingMapInit = false;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('show'); s.style.display = 'none'; });
  const el = document.getElementById(id);
  el.style.display = 'block';
  el.classList.add('show');
  if (id === 's-app') setMapSize();
}

function setMapSize() {
  const mapEl = document.getElementById('map');
  const driverPanel = document.getElementById('driver-panel');
  const driverVisible = driverPanel && driverPanel.style.display !== 'none';
  const topOffset = 52 + (driverVisible ? 52 : 0);
  mapEl.style.top = topOffset + 'px';
}

function toast(msg, dur = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

function setType(type) {
  const isDriver = type === 'driver';
  document.getElementById('van-field').style.display = isDriver ? 'block' : 'none';
  document.getElementById('driver-price-box').style.display = isDriver ? 'block' : 'none';
  document.getElementById('su-sub').textContent = isDriver ? 'Put your van on the map for £1.99/month.' : 'Free forever — find vans near you.';
  document.getElementById('tt-c').className = 'ttab' + (isDriver ? '' : ' active');
  document.getElementById('tt-d').className = 'ttab' + (isDriver ? ' active' : '');
  window._signupType = type;
}

function showVanNameInput() {
  document.getElementById('van-name-box').style.display = 'block';
}

async function setGoogleRole(role) {
  const user = userSession.user;
  const vanName = role === 'driver' ? document.getElementById('inp-google-van').value.trim() : null;
  if (role === 'driver' && !vanName) { toast('Please enter your van name.'); return; }
  await sb.from('profiles').upsert({ id: user.id, role, van_name: vanName, subscribed: false });
  userRole = role;
  if (role === 'driver') {
    showScreen('s-stripe');
  } else {
    const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();
    openApp(user, profile);
  }
}

async function signUpEmail() {
  const email = document.getElementById('inp-email').value.trim();
  const pass = document.getElementById('inp-pass').value;
  const vanName = document.getElementById('inp-van').value.trim();
  const type = window._signupType || 'customer';
  if (!email || !pass) { toast('Please enter email and password.'); return; }
  if (type === 'driver' && !vanName) { toast('Please enter your van name.'); return; }
  const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { role: type, van_name: vanName || null }, emailRedirectTo: window.location.origin } });
  if (error) { toast('Error: ' + error.message); return; }
  document.getElementById('confirm-email-addr').textContent = email;
  showScreen('s-confirm');
  if (type === 'driver' && data.user) {
    await sb.from('profiles').upsert({ id: data.user.id, role: 'driver', van_name: vanName, subscribed: false });
  }
}

async function logInEmail() {
  const email = document.getElementById('inp-login-email').value.trim();
  const pass = document.getElementById('inp-login-pass').value;
  if (!email || !pass) { toast('Please enter email and password.'); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) { toast('Error: ' + error.message); }
}

async function signInGoogle() {
  // Store the intended role before redirecting to Google
  const type = window._signupType || 'customer';
  localStorage.setItem('scoop_intended_role', type);
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) toast('Google sign-in error: ' + error.message);
}

async function doLogout() {
  if (isLive) await goOffline();
  await sb.auth.signOut();
  localStorage.removeItem('scoop_intended_role');
  showScreen('s-splash');
}

sb.auth.onAuthStateChange(async (event, session) => {
  userSession = session;
  if (!session) { showScreen('s-splash'); return; }

  const user = session.user;
  let { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();

  if (!profile) {
    // Check if they came from the driver signup flow
    const intendedRole = localStorage.getItem('scoop_intended_role');
    if (intendedRole === 'driver') {
      // Show role picker with driver pre-selected
      showScreen('s-role');
      // Pre-expand the van name box
      setTimeout(() => showVanNameInput(), 100);
      return;
    }
    // New user with no intent — show role picker
    showScreen('s-role');
    return;
  }

  localStorage.removeItem('scoop_intended_role');
  userRole = profile.role;
  userVanId = user.id;

  if (userRole === 'driver' && !profile.subscribed) {
    showScreen('s-stripe');
    return;
  }

  openApp(user, profile);
});

function redirectToStripe() {
  window.location.href = STRIPE_PAYMENT_LINK + '?client_reference_id=' + userSession.user.id;
}

async function openApp(user, profile) {
  const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
  document.getElementById('app-username').textContent = name;

  if (profile.role === 'driver') {
    document.getElementById('driver-badge').style.display = 'inline-block';
    document.getElementById('driver-panel').style.display = 'block';
    document.getElementById('customer-panel').style.display = 'none';
    document.getElementById('van-display-name').textContent = profile.van_name || 'Your van';
  } else {
    document.getElementById('driver-panel').style.display = 'none';
    document.getElementById('customer-panel').style.display = 'flex';
    document.getElementById('become-driver-btn').style.display = 'block';
  }

  showScreen('s-app');

  if (googleMapsReady) {
    initMap(profile.role);
  } else {
    pendingMapInit = true;
    window._pendingRole = profile.role;
  }
}

function initMapWhenReady() {
  googleMapsReady = true;
  if (pendingMapInit) {
    pendingMapInit = false;
    initMap(window._pendingRole);
  }
}

function initMap(role) {
  setMapSize();
  if (map) { google.maps.event.trigger(map, 'resize'); return; }

  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 52.5, lng: -1.5 },
    zoom: 6,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
  });

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      map.setZoom(13);
    });
  }

  if (role !== 'driver') {
    loadVans();
    setInterval(loadVans, 5000);
  }
}

async function loadVans() {
  const { data: vans, error } = await sb.from('van_locations').select('*').eq('is_live', true);
  if (error) { console.error(error); return; }
  Object.values(vanMarkers).forEach(m => m.setMap(null));
  vanMarkers = {};
  vans.forEach(v => {
    const marker = new google.maps.Marker({
      position: { lat: v.lat, lng: v.lng },
      map,
      label: { text: '🍦', fontSize: '24px' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 }
    });
    const info = new google.maps.InfoWindow({ content: `<strong>Ice Cream Van</strong><br/><span style="color:#22c55e">● Live now</span>` });
    marker.addListener('click', () => info.open(map, marker));
    vanMarkers[v.id] = marker;
  });
  const label = document.getElementById('van-count-label');
  if (label) label.textContent = vans.length === 0 ? 'No vans live right now — check back soon!' : `${vans.length} van${vans.length > 1 ? 's' : ''} live near you 🍦`;
}

function refreshMap() { loadVans(); toast('Map refreshed!'); }

async function toggleLive() { if (isLive) { await goOffline(); } else { await goLive(); } }

async function goLive() {
  if (!navigator.geolocation) { toast('Location not supported.'); return; }
  toast('Getting your location…');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    const { error } = await sb.from('van_locations').upsert({ id: userVanId, lat, lng, is_live: true, updated_at: new Date().toISOString() });
    if (error) { toast('Error: ' + error.message); return; }
    isLive = true;
    updateLiveUI(true);
    locationWatchId = setInterval(async () => {
      navigator.geolocation.getCurrentPosition(async (p) => {
        await sb.from('van_locations').update({ lat: p.coords.latitude, lng: p.coords.longitude, updated_at: new Date().toISOString() }).eq('id', userVanId);
        if (vanMarkers[userVanId]) vanMarkers[userVanId].setPosition({ lat: p.coords.latitude, lng: p.coords.longitude });
      });
    }, 15000);
    if (vanMarkers[userVanId]) vanMarkers[userVanId].setMap(null);
    const marker = new google.maps.Marker({ position: { lat, lng }, map, label: { text: '🚐', fontSize: '24px' }, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 } });
    vanMarkers[userVanId] = marker;
    map.setCenter({ lat, lng });
    map.setZoom(14);
    toast('You\'re live! 🚐');
  }, () => { toast('Could not get location.'); });
}

async function goOffline() {
  if (locationWatchId) { clearInterval(locationWatchId); locationWatchId = null; }
  await sb.from('van_locations').update({ is_live: false }).eq('id', userVanId);
  if (vanMarkers[userVanId]) { vanMarkers[userVanId].setMap(null); delete vanMarkers[userVanId]; }
  isLive = false;
  updateLiveUI(false);
  toast('You\'re offline. 👋');
}

function updateLiveUI(live) {
  document.getElementById('live-status').className = 'status-dot ' + (live ? 'online' : 'offline');
  document.getElementById('live-label').textContent = live ? 'Live' : 'Offline';
  document.getElementById('go-live-btn').textContent = live ? 'Go Offline 🔴' : 'Go Live 🟢';
}

window._signupType = 'customer';

function showDriverSignup() {
  showScreen('s-role');
  setTimeout(() => showVanNameInput(), 100);
}
