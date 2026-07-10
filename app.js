const SUPABASE_URL  = 'https://wwgovmkzxrtobklxxija.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Z292bWt6eHJ0b2JrbHh4aWphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUyMjksImV4cCI6MjA5ODA3MTIyOX0.zdad6bvjSNALfZSmcC8t-N13fDZceYWdqFuNdKPsTM4';
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/3cIeVceHV03Y1sy6aQejK00';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage
  }
});
let map, userSession, userRole, userVanId, isLive = false;
let vanMarkers = {}, requestMarkers = {};
let myRequestMarker = null, hasActiveRequest = false;
let locationWatchId = null;
let googleMapsReady = false;
let myLat = null, myLng = null;
const NEARBY_RADIUS_KM = 30; // vans/requests further than this are hidden from the map
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
  document.getElementById('su-sub').textContent = isDriver ? '£1.99/month — your van live on the map, ratings, and your own profile page.' : 'Find ice cream vans near you.';
  document.getElementById('tt-c').className = 'ttab' + (isDriver ? '' : ' active');
  document.getElementById('tt-d').className = 'ttab' + (isDriver ? ' active' : '');
  window._signupType = type;
}

function showVanNameInput() {
  document.getElementById('van-name-box').style.display = 'block';
}

function showDriverSignup() {
  showScreen('s-role');
  setTimeout(() => showVanNameInput(), 100);
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
  const btn = document.getElementById('signup-btn');
  if (btn.disabled) return; // already in progress, ignore extra clicks

  const email = document.getElementById('inp-email').value.trim();
  const pass = document.getElementById('inp-pass').value;
  const vanName = document.getElementById('inp-van').value.trim();
  const type = window._signupType || 'customer';
  if (!email || !pass) { toast('Please enter email and password.'); return; }
  if (type === 'driver' && !vanName) { toast('Please enter your van name.'); return; }

  btn.disabled = true;
  btn.textContent = 'Creating account…';

  const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { role: type, van_name: vanName || null }, emailRedirectTo: window.location.origin } });

  if (error) {
    toast('Error: ' + error.message);
    btn.disabled = false;
    btn.textContent = 'Create account';
    return;
  }

  if (data.user) {
    await sb.from('profiles').upsert({
      id: data.user.id,
      role: type,
      van_name: type === 'driver' ? vanName : null,
      subscribed: false
    });
  }

  if (data.session) {
    // Email confirmation is off — they're already logged in.
    // We drive the next screen ourselves here (rather than leaving it to
    // the auth listener) since the profile row above is now guaranteed
    // to exist by this point, avoiding a timing race.
    toast('Account created! Welcome to Scoop 🍦');
    if (type === 'driver') {
      showScreen('s-stripe');
    } else {
      const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).single();
      openApp(data.user, profile);
    }
  } else {
    // Email confirmation is required — show the "check your email" screen.
    document.getElementById('confirm-email-addr').textContent = email;
    showScreen('s-confirm');
  }

  btn.disabled = false;
  btn.textContent = 'Create account';
}

async function logInEmail() {
  const btn = document.getElementById('login-btn');
  if (btn.disabled) return;

  const email = document.getElementById('inp-login-email').value.trim();
  const pass = document.getElementById('inp-login-pass').value;
  if (!email || !pass) { toast('Please enter email and password.'); return; }

  btn.disabled = true;
  btn.textContent = 'Logging in…';

  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) { toast('Error: ' + error.message); }

  btn.disabled = false;
  btn.textContent = 'Log in';
}

async function sendPasswordReset() {
  const email = document.getElementById('inp-forgot-email').value.trim();
  if (!email) { toast('Please enter your email.'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error) {
    toast('Error: ' + error.message);
  } else {
    toast('If that email has an account, a reset link has been sent.');
    showScreen('s-login');
  }
}

async function setNewPassword() {
  const newPass = document.getElementById('inp-newpass').value;
  if (!newPass || newPass.length < 6) { toast('Password must be at least 6 characters.'); return; }
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) {
    toast('Error: ' + error.message);
  } else {
    toast('Password updated! You can now use it to log in.');
    showScreen('s-login');
  }
}

async function signInGoogle() {
  const type = window._signupType || 'customer';
  localStorage.setItem('scoop_intended_role', type);
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) toast('Google sign-in error: ' + error.message);
}

async function signInFacebook() {
  const type = window._signupType || 'customer';
  localStorage.setItem('scoop_intended_role', type);
  const { error } = await sb.auth.signInWithOAuth({ provider: 'facebook', options: { redirectTo: window.location.origin } });
  if (error) toast('Facebook sign-in error: ' + error.message);
}

async function doLogout() {
  if (isLive) await goOffline();
  await sb.auth.signOut();
  localStorage.removeItem('scoop_intended_role');
  showScreen('s-splash');
}

// NOTE: the callback below is intentionally NOT `async`. Supabase JS v2
// holds an internal lock while onAuthStateChange fires, and calling any
// other sb.* method (like sb.from(...)) synchronously inside it can
// deadlock — which was the root cause of the "logs out on refresh" bug,
// even though the token in storage/on the server was always valid.
// Wrapping the body in setTimeout(..., 0) defers it until after the lock
// is released.
sb.auth.onAuthStateChange((event, session) => {
  setTimeout(async () => {
    userSession = session;
    if (!session) { showScreen('s-splash'); return; }

    if (event === 'PASSWORD_RECOVERY') {
      showScreen('s-newpassword');
      return;
    }

    // Supabase fires this periodically in the background just to keep the
    // session alive — it's not a fresh login, so it shouldn't yank the
    // user away from whatever screen they're currently on.
    if (event === 'TOKEN_REFRESHED') return;

    const user = session.user;
    let { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();

    if (!profile) {
      const intendedRole = localStorage.getItem('scoop_intended_role');
      showScreen('s-role');
      if (intendedRole === 'driver') setTimeout(() => showVanNameInput(), 100);
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
  }, 0);
});

// ── Account settings: phone number ──
function openAccountSettings() {
  const menu = document.getElementById('driver-settings-menu');
  if (menu) menu.style.display = 'none';
  showScreen('s-account-settings');
  loadAccountSettingsIntoEditor();
}

function closeAccountSettings() {
  showScreen('s-app');
}

async function loadAccountSettingsIntoEditor() {
  const user = userSession.user;
  const { data: profile } = await sb.from('profiles').select('phone').eq('id', user.id).single();
  document.getElementById('acc-phone').value = (profile && profile.phone) || '';
}

async function savePhoneNumber() {
  const phone = document.getElementById('acc-phone').value.trim();
  const { error } = await sb.from('profiles').update({ phone: phone || null }).eq('id', userSession.user.id);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Phone number saved.');
}

function redirectToStripe() {
  window.location.href = STRIPE_PAYMENT_LINK + '?client_reference_id=' + userSession.user.id;
}

// Lets someone who ended up on the driver payment screen back out
// instead of being stuck there — switches them to a plain customer account.
async function cancelDriverSignup() {
  const user = userSession.user;
  const { error } = await sb.from('profiles').update({
    role: 'customer',
    van_name: null,
    subscribed: false
  }).eq('id', user.id);

  if (error) {
    toast('Error: ' + error.message);
    return;
  }

  userRole = 'customer';
  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();
  openApp(user, profile);
}

async function manageSubscription() {
  toast('Opening subscription settings…');
  try {
    const res = await fetch('/api/create-portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userSession.user.id })
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      toast(data.error || 'Could not open subscription settings.');
    }
  } catch (err) {
    toast('Error: ' + err.message);
  }
}

async function openApp(user, profile) {
  const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
  document.getElementById('app-username').textContent = name;

  if (profile.role === 'driver') {
    document.getElementById('driver-badge').style.display = 'inline-block';
    document.getElementById('driver-panel').style.display = 'block';
    document.getElementById('customer-panel').style.display = 'none';
    document.getElementById('become-driver-btn').style.display = 'none';
    document.getElementById('request-btn-wrap').style.display = 'none';
    document.getElementById('search-box-wrap').style.display = 'none';
    document.getElementById('toggle-view-btn').style.display = 'inline-block';
    document.getElementById('van-display-name').textContent = profile.van_name || 'Your van';
    document.getElementById('menu-item-van-profile').style.display = 'block';
    document.getElementById('menu-item-subscription').style.display = 'block';
    document.getElementById('sound-toggle-btn').style.display = 'block';
  } else {
    document.getElementById('driver-panel').style.display = 'none';
    document.getElementById('customer-panel').style.display = 'flex';
    document.getElementById('become-driver-btn').style.display = 'block';
    document.getElementById('request-btn-wrap').style.display = 'block';
    document.getElementById('search-box-wrap').style.display = 'flex';
    document.getElementById('toggle-view-btn').style.display = 'none';
    document.getElementById('menu-item-van-profile').style.display = 'none';
    document.getElementById('menu-item-subscription').style.display = 'none';
    document.getElementById('sound-toggle-btn').style.display = 'none';
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
      myLat = pos.coords.latitude;
      myLng = pos.coords.longitude;
    });
  }

  if (role === 'driver') {
    updateSoundToggleUI();
    loadRequestsForDriver();
    setInterval(loadRequestsForDriver, 10000);
    loadVans();
    setInterval(loadVans, 5000);
  } else {
    loadVans();
    setInterval(loadVans, 5000);
    checkExistingRequest();
    setupAddressSearch();
  }
}

// ── Lets a driver temporarily browse the map as a customer, without
// changing their actual account role or subscription. ──
let viewingAsCustomer = false;
let addressSearchReady = false;

function toggleCustomerView() {
  viewingAsCustomer = !viewingAsCustomer;
  const btn = document.getElementById('toggle-view-btn');

  if (viewingAsCustomer) {
    document.getElementById('driver-panel').style.display = 'none';
    document.getElementById('customer-panel').style.display = 'flex';
    document.getElementById('request-btn-wrap').style.display = 'block';
    document.getElementById('search-box-wrap').style.display = 'flex';
    btn.textContent = '🚐 Back to driver view';

    if (!addressSearchReady) {
      setupAddressSearch();
      addressSearchReady = true;
    }
    checkExistingRequest();
  } else {
    document.getElementById('driver-panel').style.display = 'block';
    document.getElementById('customer-panel').style.display = 'none';
    document.getElementById('request-btn-wrap').style.display = 'none';
    document.getElementById('search-box-wrap').style.display = 'none';
    document.getElementById('cancel-preview-wrap').style.display = 'none';
    document.getElementById('save-home-wrap').style.display = 'none';
    btn.textContent = '🍦 Browse as customer';
  }

  setMapSize();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

let vanInfoWindows = {};
let vanRatingCache = {};

function renderStars(avg, count, myRating, vanId) {
  let html = '<div style="margin-top:6px">';
  for (let i = 1; i <= 5; i++) {
    const filled = i <= Math.round(avg);
    html += '<span onclick="rateVan(\'' + vanId + '\',' + i + ')" style="cursor:pointer;font-size:16px;color:' + (filled ? '#f59e0b' : '#ddd') + '">★</span>';
  }
  if (count > 0) {
    html += ' <span style="font-size:12px;color:#777">' + avg.toFixed(1) + ' (' + count + ')</span>';
  } else {
    html += ' <span style="font-size:12px;color:#999">No ratings yet</span>';
  }
  if (myRating) {
    html += '<div style="font-size:11px;color:#999;margin-top:2px">You rated: ' + myRating + '★ — tap to change</div>';
  } else {
    html += '<div style="font-size:11px;color:#999;margin-top:2px">Tap a star to rate</div>';
  }
  html += '</div>';
  return html;
}

function buildVanPopupContent(vanId, vanName, p) {
  const stats = vanRatingCache[vanId] || { avg: 0, count: 0, myRating: null };

  let content = '<div style="font-family:sans-serif;padding:4px;max-width:220px">';
  if (p.van_photo_url) {
    content += '<img src="' + escapeHtml(p.van_photo_url) + '" style="width:100%;border-radius:8px;margin-bottom:6px"/>';
  }
  content += '<strong style="font-size:14px">' + escapeHtml(vanName) + '</strong><br/>';
  content += '<span style="color:#22c55e;font-size:12px">● Live now</span>';
  content += renderStars(stats.avg, stats.count, stats.myRating, vanId);
  if (p.bio) content += '<p style="font-size:12px;color:#555;margin:6px 0 0">' + escapeHtml(p.bio) + '</p>';
  if (p.hours_note) content += '<p style="font-size:12px;color:#555;margin:4px 0 0">🕐 ' + escapeHtml(p.hours_note) + '</p>';

  const payments = [];
  if (p.payment_cash) payments.push('Cash');
  if (p.payment_card) payments.push('Card');
  if (p.payment_contactless) payments.push('Contactless');
  if (payments.length) content += '<p style="font-size:12px;color:#555;margin:4px 0 0">💳 ' + payments.join(', ') + '</p>';

  if (p.menu_photo_url) {
    content += '<a href="' + escapeHtml(p.menu_photo_url) + '" target="_blank" style="display:inline-block;margin-top:6px;font-size:12px;color:#d4a000;font-weight:600">📋 View menu</a><br/>';
  }
  if (p.instagram_link) {
    content += '<a href="' + escapeHtml(p.instagram_link) + '" target="_blank" style="display:inline-block;margin-top:4px;margin-right:10px;font-size:12px;color:#d4a000;font-weight:600">📸 Instagram</a>';
  }
  if (p.tiktok_link) {
    content += '<a href="' + escapeHtml(p.tiktok_link) + '" target="_blank" style="display:inline-block;margin-top:4px;font-size:12px;color:#d4a000;font-weight:600">🎵 TikTok</a>';
  }
  content += '</div>';
  return content;
}

// Called when a customer taps a star in a van's popup.
async function rateVan(vanId, rating) {
  if (!userSession) { toast('Log in to rate a van.'); return; }
  const customerId = userSession.user.id;

  const { error } = await sb.from('van_ratings').upsert({
    van_id: vanId,
    customer_id: customerId,
    rating: rating
  }, { onConflict: 'van_id,customer_id' });

  if (error) {
    toast('Error saving rating: ' + error.message);
    return;
  }

  toast('Thanks for rating! 🍦');

  // Refresh this van's stats and re-render just its popup content.
  const { data: allRatings } = await sb.from('van_ratings').select('rating, customer_id').eq('van_id', vanId);
  const count = allRatings.length;
  const avg = count > 0 ? allRatings.reduce((s, r) => s + r.rating, 0) / count : 0;
  const mine = allRatings.find(r => r.customer_id === customerId);
  vanRatingCache[vanId] = { avg, count, myRating: mine ? mine.rating : null };

  const marker = vanMarkers[vanId];
  const info = vanInfoWindows[vanId];
  if (info && marker && marker.__vanName !== undefined) {
    info.setContent(buildVanPopupContent(vanId, marker.__vanName, marker.__profile));
  }
}

async function loadVans() {
  const { data: rawVans, error } = await sb
    .from('van_locations')
    .select('id, lat, lng, profiles(van_name, van_photo_url, menu_photo_url, payment_cash, payment_card, payment_contactless, bio, hours_note, instagram_link, tiktok_link)')
    .eq('is_live', true);

  if (error) { console.error(error); return; }

  // Only show vans within a sensible distance — otherwise a driver/customer
  // in London would see vans live in Manchester or Birmingham too.
  const vans = (myLat != null)
    ? rawVans.filter(v => distanceMeters(myLat, myLng, v.lat, v.lng) / 1000 <= NEARBY_RADIUS_KM)
    : rawVans;

  Object.values(vanMarkers).forEach(m => m.setMap(null));
  vanMarkers = {};

  const vanIds = vans.map(v => v.id);
  let ratingsByVan = {};
  if (vanIds.length > 0) {
    const { data: allRatings } = await sb.from('van_ratings').select('van_id, rating, customer_id').in('van_id', vanIds);
    (allRatings || []).forEach(r => {
      if (!ratingsByVan[r.van_id]) ratingsByVan[r.van_id] = [];
      ratingsByVan[r.van_id].push(r);
    });
  }
  const myId = userSession ? userSession.user.id : null;
  vanIds.forEach(id => {
    const list = ratingsByVan[id] || [];
    const count = list.length;
    const avg = count > 0 ? list.reduce((s, r) => s + r.rating, 0) / count : 0;
    const mine = myId ? list.find(r => r.customer_id === myId) : null;
    vanRatingCache[id] = { avg, count, myRating: mine ? mine.rating : null };
  });

  vans.forEach(v => {
    const p = v.profiles || {};
    const vanName = p.van_name || 'Ice Cream Van';
    const marker = new google.maps.Marker({
      position: { lat: v.lat, lng: v.lng },
      map,
      label: { text: '🍦', fontSize: '24px' },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 18,
        fillOpacity: 0,
        strokeOpacity: 0
      }
    });
    marker.__vanName = vanName;
    marker.__profile = p;

    const info = new google.maps.InfoWindow({ content: buildVanPopupContent(v.id, vanName, p) });
    marker.addListener('click', () => info.open(map, marker));
    vanMarkers[v.id] = marker;
    vanInfoWindows[v.id] = info;
  });


  const label = document.getElementById('van-count-label');
  if (label) label.textContent = vans.length === 0 ? 'No vans live right now — check back soon!' : vans.length + ' van' + (vans.length > 1 ? 's' : '') + ' live near you 🍦';
}

function refreshMap() { loadVans(); toast('Map refreshed!'); }

let isPreviewing = false;

// ── Address search: lets a customer type an address instead of using GPS ──
function setupAddressSearch() {
  const input = document.getElementById('address-search');
  if (!input || !window.google || !google.maps.places) return;
  const autocomplete = new google.maps.places.Autocomplete(input, { fields: ['geometry'] });
  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry) { toast('Please choose an address from the list.'); return; }
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    showPreviewPin(lat, lng);
    map.setCenter({ lat, lng });
    map.setZoom(16);
    input.value = '';
    input.blur();
  });
}

// Drops a draggable pin the customer can nudge before confirming.
function showPreviewPin(lat, lng) {
  if (myRequestMarker) { myRequestMarker.setMap(null); }
  myRequestMarker = new google.maps.Marker({
    position: { lat, lng },
    map,
    draggable: true,
    label: { text: '🙋', fontSize: '24px' },
    // Icon is invisible but has a real size, so there's an actual
    // touch/drag target on phones — a 0-scale icon can't be dragged.
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 20,
      fillOpacity: 0,
      strokeOpacity: 0
    }
  });

  myRequestMarker.addListener('dragend', async () => {
    // If a request is already saved, keep it in sync as they drag.
    if (hasActiveRequest) {
      const pos = myRequestMarker.getPosition();
      await sb.from('van_requests').upsert({
        lat: pos.lat(),
        lng: pos.lng(),
        user_id: userSession.user.id,
        created_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    }
  });
  isPreviewing = !hasActiveRequest;
  document.getElementById('cancel-preview-wrap').style.display = isPreviewing ? 'block' : 'none';
  document.getElementById('save-home-wrap').style.display = 'block';
  updateRequestButton();
}

// ── Home address: save current pin as home, or jump straight to it ──
async function saveAsHome() {
  if (!myRequestMarker) { toast('Place a pin first, then save it as home.'); return; }
  const pos = myRequestMarker.getPosition();
  const { error } = await sb.from('profiles').update({
    home_lat: pos.lat(),
    home_lng: pos.lng()
  }).eq('id', userSession.user.id);

  if (error) toast('Error saving home: ' + error.message);
  else toast('Saved as your home address 🏠');
}

async function useHomeAddress() {
  const { data: profile } = await sb.from('profiles').select('home_lat, home_lng').eq('id', userSession.user.id).single();
  if (!profile || profile.home_lat == null || profile.home_lng == null) {
    toast('No home address saved yet — place a pin, then tap "Save as home".');
    return;
  }
  showPreviewPin(profile.home_lat, profile.home_lng);
  map.setCenter({ lat: profile.home_lat, lng: profile.home_lng });
  map.setZoom(16);
}

function updateRequestButton() {
  const btn = document.getElementById('request-van-btn');
  if (!btn) return;
  btn.disabled = false;
  if (hasActiveRequest) btn.textContent = '❌ Cancel request';
  else if (isPreviewing) btn.textContent = '✅ Confirm this spot';
  else btn.textContent = '🍦 Request a van here';
}

// ── Main button: request → confirm → cancel, all in one place ──
async function requestVanHere() {
  if (hasActiveRequest) { await cancelRequest(); return; }
  if (isPreviewing) { await confirmRequest(); return; }

  const btn = document.getElementById('request-van-btn');
  btn.textContent = '📍 Getting your location…';
  btn.disabled = true;

  if (!navigator.geolocation) {
    toast('Location not supported on this device.');
    updateRequestButton();
    return;
  }

  navigator.geolocation.getCurrentPosition((pos) => {
    // Fuzz the GPS location slightly (~20m) for privacy. Once dropped,
    // the customer can drag the pin to the exact spot before confirming.
    const { lat, lng } = fuzzLocation(pos.coords.latitude, pos.coords.longitude);
    showPreviewPin(lat, lng);
    map.setCenter({ lat, lng });
  }, () => {
    toast('Could not get your location. Check permissions.');
    updateRequestButton();
  });
}

async function confirmRequest() {
  const btn = document.getElementById('request-van-btn');
  btn.disabled = true;

  const pos = myRequestMarker.getPosition();

  cleanupExpiredRequests();

  const { error } = await sb.from('van_requests').upsert({
    lat: pos.lat(),
    lng: pos.lng(),
    user_id: userSession.user.id,
    created_at: new Date().toISOString()
  }, { onConflict: 'user_id' });

  if (error) {
    toast('Error sending request: ' + error.message);
  } else {
    toast('Request sent! Drivers near you will see it 🍦');
    isPreviewing = false;
    hasActiveRequest = true;
    document.getElementById('cancel-preview-wrap').style.display = 'none';
  }

  updateRequestButton();
}

// Drops the preview pin without saving anything (used before confirming).
function cancelPreview() {
  if (myRequestMarker) { myRequestMarker.setMap(null); myRequestMarker = null; }
  isPreviewing = false;
  document.getElementById('cancel-preview-wrap').style.display = 'none';
  document.getElementById('save-home-wrap').style.display = 'none';
  updateRequestButton();
}

async function cancelRequest() {
  const btn = document.getElementById('request-van-btn');
  btn.disabled = true;

  const { error } = await sb.from('van_requests').delete().eq('user_id', userSession.user.id);

  if (error) {
    toast('Error cancelling request: ' + error.message);
  } else {
    toast('Request cancelled.');
    if (myRequestMarker) { myRequestMarker.setMap(null); myRequestMarker = null; }
    hasActiveRequest = false;
    isPreviewing = false;
    document.getElementById('cancel-preview-wrap').style.display = 'none';
    document.getElementById('save-home-wrap').style.display = 'none';
  }

  updateRequestButton();
}

// Check if this customer already has an active request (e.g. after a
// page reload) so the button and pin show the correct state on load.
async function checkExistingRequest() {
  if (!userSession) return;
  const { data } = await sb.from('van_requests').select('*').eq('user_id', userSession.user.id).maybeSingle();
  if (data) {
    hasActiveRequest = true;
    isPreviewing = false;
    showPreviewPin(data.lat, data.lng);
    document.getElementById('cancel-preview-wrap').style.display = 'none';
  } else {
    hasActiveRequest = false;
  }
  updateRequestButton();
}

async function loadRequestMarkers() {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // last 30 min only
  const { data: reqs } = await sb.from('van_requests').select('*').gte('created_at', since);
  if (!reqs) return;
  Object.values(requestMarkers).forEach(m => m.setMap(null));
  requestMarkers = {};
  reqs.forEach(r => {
    const m = new google.maps.Marker({
      position: { lat: r.lat, lng: r.lng },
      map,
      label: { text: '🙋', fontSize: '16px' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 }
    });
    requestMarkers[r.id] = m;
  });
}

// ── Distance between two points in metres (Haversine formula) ──
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Groups nearby requests together into "hotspots" so drivers see demand
// as a single coloured zone instead of many overlapping circles.
function clusterRequests(reqs, radiusMeters = 40) {
  const used = new Array(reqs.length).fill(false);
  const clusters = [];

  reqs.forEach((r, i) => {
    if (used[i]) return;
    const group = [r];
    used[i] = true;
    reqs.forEach((r2, j) => {
      if (used[j]) return;
      if (distanceMeters(r.lat, r.lng, r2.lat, r2.lng) <= radiusMeters) {
        group.push(r2);
        used[j] = true;
      }
    });
    const avgLat = group.reduce((s, p) => s + p.lat, 0) / group.length;
    const avgLng = group.reduce((s, p) => s + p.lng, 0) / group.length;
    clusters.push({ lat: avgLat, lng: avgLng, count: group.length });
  });

  return clusters;
}

// Green = low demand, amber = medium, red = high.
// These render as Marker icons, not geo-anchored Circles — Marker icon
// "scale" is always a fixed pixel size in Google Maps, regardless of
// zoom level, which is exactly what a UI indicator like this needs.
// (An earlier version used Circle with a real-world meter radius, which
// necessarily grows/shrinks with zoom since it represents an actual
// geographic area — no way to keep that visually constant without the
// circle's real duty which is inherently zoom relative.)
function demandStyle(count) {
  if (count >= 3) return { fill: '#ef4444', stroke: '#b91c1c', pixelRadius: 26 };
  if (count >= 2) return { fill: '#f59e0b', stroke: '#b45309', pixelRadius: 20 };
  return { fill: '#22c55e', stroke: '#15803d', pixelRadius: 15 };
}

// Actually removes expired request rows from the database, instead of
// just hiding them from view. Piggybacked onto driver polling (every 10s
// while a driver is live) rather than a scheduled job, since Vercel's
// free plan only allows once-daily cron jobs — this achieves near
// real-time cleanup for free as long as at least one driver is online.
async function cleanupExpiredRequests() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { error } = await sb.from('van_requests').delete().lt('created_at', cutoff);
  if (error) console.error('Cleanup error:', error.message);
}

async function loadRequestsForDriver() {
  cleanupExpiredRequests();

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // last 30 min only
  const { data: rawReqs } = await sb.from('van_requests').select('*').gte('created_at', since);

  // Only show requests within a sensible distance of this driver —
  // otherwise a driver in London would see demand in Manchester too.
  const reqs = (rawReqs && myLat != null)
    ? rawReqs.filter(r => distanceMeters(myLat, myLng, r.lat, r.lng) / 1000 <= NEARBY_RADIUS_KM)
    : rawReqs;

  Object.values(requestMarkers).forEach(m => m.setMap(null));
  requestMarkers = {};

  if (!reqs || reqs.length === 0) {
    knownRequestIds = new Set();
    hasLoadedRequestsOnce = true;
    return;
  }

  // Play a sound if any request wasn't here on the last check —
  // but not on the very first load, so drivers don't get a ping
  // just from opening the app with existing requests already up.
  const currentIds = new Set(reqs.map(r => r.id));
  if (hasLoadedRequestsOnce) {
    const isNew = [...currentIds].some(id => !knownRequestIds.has(id));
    if (isNew) playPingSound();
  }
  knownRequestIds = currentIds;
  hasLoadedRequestsOnce = true;

  const clusters = clusterRequests(reqs);

  clusters.forEach((c, idx) => {
    const style = demandStyle(c.count);
    const label = c.count > 1 ? '🙋×' + c.count : '🙋';

    const m = new google.maps.Marker({
      position: { lat: c.lat, lng: c.lng },
      map,
      label: { text: label, fontSize: '13px', fontWeight: '700', color: '#1a1a1a' },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: style.pixelRadius,
        fillColor: style.fill,
        fillOpacity: 0.55,
        strokeColor: style.stroke,
        strokeOpacity: 0.9,
        strokeWeight: 2
      },
      title: c.count === 1 ? 'Customer wants ice cream here!' : c.count + ' customers waiting here!'
    });
    requestMarkers[idx] = m;
  });
}

// ── Sound alert: pings drivers when a new request appears nearby ──
let knownRequestIds = new Set();
let hasLoadedRequestsOnce = false;

function isSoundMuted() {
  return localStorage.getItem('scoop_sound_muted') === 'true';
}

function toggleSoundMute() {
  const muted = !isSoundMuted();
  localStorage.setItem('scoop_sound_muted', muted ? 'true' : 'false');
  updateSoundToggleUI();
  toast(muted ? 'Sound alerts off' : 'Sound alerts on');
}

function updateSoundToggleUI() {
  const btn = document.getElementById('sound-toggle-btn');
  if (!btn) return;
  btn.textContent = isSoundMuted() ? '🔇 Sound alerts: off' : '🔔 Sound alerts: on';
}

// ── Driver settings menu ──
function toggleDriverSettingsMenu() {
  const menu = document.getElementById('driver-settings-menu');
  if (!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// ── Van profile editing ──
function openVanProfileEditor() {
  const menu = document.getElementById('driver-settings-menu');
  if (menu) menu.style.display = 'none';
  showScreen('s-van-profile');
  loadVanProfileIntoEditor();
}

function closeVanProfileEditor() {
  showScreen('s-app');
}

let pendingPhotoRemoval = { van: false, menu: false };

// Shows an instant preview of a chosen photo before it's uploaded/saved,
// with the option to back out and remove it right away.
function handlePhotoSelect(type) {
  const input = document.getElementById('vp-' + type + '-photo');
  const file = input.files[0];
  if (!file) return;

  const preview = document.getElementById('vp-' + type + '-photo-preview');
  const removeLink = document.getElementById('vp-' + type + '-photo-remove');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
  removeLink.style.display = 'inline-block';
  pendingPhotoRemoval[type] = false;
}

async function loadVanProfileIntoEditor() {
  const user = userSession.user;
  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (!profile) return;

  pendingPhotoRemoval = { van: false, menu: false };
  document.getElementById('vp-van-photo').value = '';
  document.getElementById('vp-menu-photo').value = '';

  document.getElementById('vp-pay-cash').checked = profile.payment_cash ?? true;
  document.getElementById('vp-pay-card').checked = profile.payment_card ?? false;
  document.getElementById('vp-pay-contactless').checked = profile.payment_contactless ?? false;
  document.getElementById('vp-bio').value = profile.bio || '';
  document.getElementById('vp-hours').value = profile.hours_note || '';
  document.getElementById('vp-instagram').value = profile.instagram_link || '';
  document.getElementById('vp-tiktok').value = profile.tiktok_link || '';

  const vanImg = document.getElementById('vp-van-photo-preview');
  const vanRemoveLink = document.getElementById('vp-van-photo-remove');
  if (profile.van_photo_url) {
    vanImg.src = profile.van_photo_url; vanImg.style.display = 'block';
    vanRemoveLink.style.display = 'inline-block';
  } else {
    vanImg.style.display = 'none';
    vanRemoveLink.style.display = 'none';
  }

  const menuImg = document.getElementById('vp-menu-photo-preview');
  const menuRemoveLink = document.getElementById('vp-menu-photo-remove');
  if (profile.menu_photo_url) {
    menuImg.src = profile.menu_photo_url; menuImg.style.display = 'block';
    menuRemoveLink.style.display = 'inline-block';
  } else {
    menuImg.style.display = 'none';
    menuRemoveLink.style.display = 'none';
  }
}

// Marks a photo for removal (actually cleared when Save is pressed) and
// hides its preview immediately so it's clear something changed.
function removeVanPhoto(type) {
  pendingPhotoRemoval[type] = true;
  document.getElementById('vp-' + type + '-photo-preview').style.display = 'none';
  document.getElementById('vp-' + type + '-photo-remove').style.display = 'none';
  document.getElementById('vp-' + type + '-photo').value = '';
  toast('Photo will be removed when you save');
}

async function uploadVanImage(fileInputId, folder) {
  const input = document.getElementById(fileInputId);
  const file = input.files[0];
  if (!file) return null;

  const user = userSession.user;
  const path = folder + '/' + user.id + '-' + Date.now() + '-' + file.name;
  const { error } = await sb.storage.from('van-photos').upload(path, file, { upsert: true });
  if (error) {
    toast('Photo upload error: ' + error.message);
    return null;
  }
  const { data } = sb.storage.from('van-photos').getPublicUrl(path);
  return data.publicUrl;
}

async function saveVanProfile() {
  const btn = document.getElementById('vp-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const user = userSession.user;
  const update = {
    payment_cash: document.getElementById('vp-pay-cash').checked,
    payment_card: document.getElementById('vp-pay-card').checked,
    payment_contactless: document.getElementById('vp-pay-contactless').checked,
    bio: document.getElementById('vp-bio').value.trim() || null,
    hours_note: document.getElementById('vp-hours').value.trim() || null,
    instagram_link: document.getElementById('vp-instagram').value.trim() || null,
    tiktok_link: document.getElementById('vp-tiktok').value.trim() || null
  };

  if (pendingPhotoRemoval.van) {
    update.van_photo_url = null;
  } else {
    const vanPhotoUrl = await uploadVanImage('vp-van-photo', 'vans');
    if (vanPhotoUrl) update.van_photo_url = vanPhotoUrl;
  }

  if (pendingPhotoRemoval.menu) {
    update.menu_photo_url = null;
  } else {
    const menuPhotoUrl = await uploadVanImage('vp-menu-photo', 'menus');
    if (menuPhotoUrl) update.menu_photo_url = menuPhotoUrl;
  }

  const { error } = await sb.from('profiles').update(update).eq('id', user.id);

  btn.disabled = false;
  btn.textContent = 'Save profile';

  if (error) {
    toast('Error saving: ' + error.message);
  } else {
    toast('Van profile saved 🍦');
    closeVanProfileEditor();
  }
}

function playPingSound() {
  if (isSoundMuted()) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playOneTone = (startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, startTime);
      osc.frequency.setValueAtTime(1100, startTime + 0.2);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(1.0, startTime + 0.05);
      gain.gain.setValueAtTime(1.0, startTime + duration - 0.15);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    const toneDuration = 1.3;
    const gap = 0.55;
    const now = ctx.currentTime;
    playOneTone(now, toneDuration);
    playOneTone(now + toneDuration + gap, toneDuration);
    playOneTone(now + (toneDuration + gap) * 2, toneDuration);
  } catch (e) {
    // Some browsers block audio until the user has interacted with the
    // page at least once — safe to ignore if that's the case.
  }
}

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

// ── Privacy: fuzz a lat/lng so it lands near the street, not the exact house ──
function fuzzLocation(lat, lng) {
  // ~20m of randomness in a random direction — kept inside the 30m
  // demand circle drivers see, while still not showing the exact house
  const radiusMeters = 20;
  const radiusInDegrees = radiusMeters / 111320; // rough meters-to-degrees conversion

  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.random() * radiusInDegrees;

  const fuzzedLat = lat + (distance * Math.cos(angle));
  const fuzzedLng = lng + (distance * Math.sin(angle)) / Math.cos(lat * Math.PI / 180);

  return { lat: fuzzedLat, lng: fuzzedLng };
}
