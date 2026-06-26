// ============================================
// ICE CREAM VAN APP — app.js
// ============================================

const SUPABASE_URL = 'https://wwgovmkzxrtobklxxija.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Z292bWt6eHJ0b2JrbHh4aWphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTUyMjksImV4cCI6MjA5ODA3MTIyOX0.zdad6bvjSNALfZSmcC8t-N13fDZceYWdqFuNdKPsTM4';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;
let userType = 'customer';
let map = null;
let driverMarkers = {};
let isLive = false;
let locationWatcher = null;

// ============================================
// INIT
// ============================================
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadProfile();
    showApp();
  } else {
    showScreen('s-splash');
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      await loadProfile();
      showApp();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
      showScreen('s-splash');
    }
  });
});

// ============================================
// AUTH
// ============================================
function setType(type) {
  userType = type;
  const tc = document.getElementById('tt-c');
  const td = document.getElementById('tt-d');
  const df = document.getElementById('driver-fields');
  const db = document.getElementById('driver-info-box');
  const btn = document.getElementById('su-btn');
  const heading = document.getElementById('su-heading');
  const sub = document.getElementById('su-sub');

  if (type === 'customer') {
    tc.className = 'ttab active-c'; td.className = 'ttab';
    df.style.display = 'none'; db.style.display = 'none';
    heading.textContent = 'Create your account';
    sub.textContent = 'Free forever — request vans near you.';
    btn.className = 'btn b-amber'; btn.textContent = 'Create account';
  } else {
    td.className = 'ttab active-d'; tc.className = 'ttab';
    df.style.display = 'block'; db.style.display = 'flex';
    heading.textContent = 'Register your van';
    sub.textContent = 'Reach more customers every single day.';
    btn.className = 'btn b-navy'; btn.textContent = 'Register my van';
  }
}

async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) showError('auth-error', error.message);
}

async function doSignup() {
  const name = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const pass = document.getElementById('su-pass').value;

  if (!name || !email || !pass) {
    showError('auth-error', 'Please fill in all fields.');
    return;
  }
  if (pass.length < 8) {
    showError('auth-error', 'Password must be at least 8 characters.');
    return;
  }

  const btn = document.getElementById('su-btn');
  btn.textContent = 'Creating account...';
  btn.disabled = true;

  const { data, error } = await supabase.auth.signUp({
    email, password: pass,
    options: { data: { full_name: name, role: userType } }
  });

  if (error) {
    showError('auth-error', error.message);
    btn.textContent = userType === 'driver' ? 'Register my van' : 'Create account';
    btn.disabled = false;
    return;
  }

  if (userType === 'driver') {
    const vanName = document.getElementById('su-van').value.trim();
    const area = document.getElementById('su-area').value.trim();
    if (data.user) {
      await supabase.from('drivers').upsert({
        id: data.user.id,
        van_name: vanName || 'My Van',
        area: area || '',
        is_live: false,
        subscription_active: true
      });
      await supabase.from('profiles').update({ role: 'driver' }).eq('id', data.user.id);
    }
  }

  toast('Account created! Check your email to confirm. 🎉');
  btn.textContent = userType === 'driver' ? 'Register my van' : 'Create account';
  btn.disabled = false;
}

async function doLogin() {
  const email = document.getElementById('li-email').value.trim();
  const pass = document.getElementById('li-pass').value;

  if (!email || !pass) {
    showError('login-error', 'Please enter your email and password.');
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) showError('login-error', error.message);
}

async function doLogout() {
  if (locationWatcher) navigator.geolocation.clearWatch(locationWatcher);
  if (isLive) await setDriverOffline();
  await supabase.auth.signOut();
}

// ============================================
// PROFILE
// ============================================
async function loadProfile() {
  if (!currentUser) return;
  const { data } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = data;

  const name = data?.full_name || currentUser.email?.split('@')[0] || 'User';
  const role = data?.role || 'customer';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  document.getElementById('prof-name').textContent = name;
  document.getElementById('prof-avi').textContent = initials;
  document.getElementById('prof-role').textContent = role === 'driver' ? 'Van driver' : 'Customer';

  if (role === 'driver') {
    document.getElementById('tab-driver').style.display = 'flex';
    document.getElementById('nb-driver').style.display = 'flex';
    document.getElementById('prof-role').className = 'badge b-blue';
  }
}

// ============================================
// APP SCREENS
// ============================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  const el = document.getElementById(id);
  el.style.display = 'flex';
}

function showApp() {
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  document.getElementById('s-app').style.display = 'flex';
  initMap();
  loadVans();
  loadEvents();
  loadAlerts();
  if (currentProfile?.role === 'driver') loadDriverDashboard();
}

function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => {
    t.classList.remove('active');
    t.style.display = 'none';
  });
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on', 'on-blue'));

  const tab = document.getElementById('tab-' + name);
  tab.style.display = 'flex';
  tab.classList.add('active');

  const nb = document.getElementById('nb-' + name);
  nb.classList.add(name === 'driver' ? 'on-blue' : 'on');

  if (name === 'map') loadVans();
  if (name === 'driver') loadDriverDashboard();
}

// ============================================
// MAP
// ============================================
function initMap() {
  if (map) return;
  map = L.map('map').setView([50.9097, -1.4044], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 15);
      L.circleMarker([pos.coords.latitude, pos.coords.longitude], {
        radius: 8, fillColor: '#1E3A8A', color: '#fff', weight: 3, fillOpacity: 1
      }).addTo(map).bindPopup('You are here');
    });
  }
}

async function loadVans() {
  const { data: drivers, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('is_live', true);

  Object.values(driverMarkers).forEach(m => map?.removeLayer(m));
  driverMarkers = {};

  if (error || !drivers || drivers.length === 0) {
    document.getElementById('van-count-lbl').textContent = 'No vans live right now';
    document.getElementById('van-list').innerHTML = '<div class="loading">No vans are live in your area right now. Check back soon!</div>';
    return;
  }

  document.getElementById('van-count-lbl').textContent = `${drivers.length} van${drivers.length > 1 ? 's' : ''} active near you`;

  let html = '';
  drivers.forEach(d => {
    if (d.latitude && d.longitude && map) {
      const marker = L.marker([d.latitude, d.longitude])
        .addTo(map)
        .bindPopup(`<strong>${d.van_name}</strong><br>${d.area || ''}`);
      driverMarkers[d.id] = marker;
    }
    html += `
      <div class="van-card">
        <div class="van-avi">🚐</div>
        <div class="van-info">
          <div class="van-name">${d.van_name}</div>
          <div class="van-det">${d.area || 'Your area'}</div>
        </div>
        <div class="van-right">
          <span class="sp sp-live">Live</span>
        </div>
      </div>`;
  });
  document.getElementById('van-list').innerHTML = html;
}

// ============================================
// REQUEST
// ============================================
async function sendRequest() {
  if (!currentUser) { toast('Please log in first'); return; }

  const btn = document.getElementById('req-btn');
  btn.disabled = true;
  btn.textContent = 'Sending request...';

  navigator.geolocation.getCurrentPosition(async pos => {
    const { error } = await supabase.from('requests').insert({
      customer_id: currentUser.id,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      status: 'pending'
    });

    if (error) {
      toast('Something went wrong. Try again.');
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-ice-cream"></i> Request a van to my street';
    } else {
      btn.textContent = '✓ Request sent — vans notified!';
      toast('Done! Nearby van drivers can see your request 🍦');
    }
  }, () => {
    toast('Please allow location access to send a request');
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-ice-cream"></i> Request a van to my street';
  });
}

// ============================================
// EVENTS
// ============================================
async function loadEvents() {
  const { data: events } = await supabase
    .from('events')
    .select('*, drivers(van_name)')
    .order('event_date', { ascending: true });

  if (!events || events.length === 0) {
    document.getElementById('events-list').innerHTML = '<div class="loading">No events listed yet — check back soon!</div>';
    return;
  }

  let html = '';
  events.forEach(e => {
    html += `
      <div class="ev-card">
        <div class="ev-top" style="background:#FFFBEB">
          <div class="ev-name" style="color:#1a0a00">${e.title}</div>
          <div class="ev-loc" style="color:#6B4B00">📍 ${e.location || 'Location TBC'}</div>
        </div>
        <div class="ev-body">
          <div class="ev-date">📅 ${e.event_date || 'Date TBC'} ${e.event_time ? '· ' + e.event_time : ''}</div>
          <span class="badge b-sun">${e.drivers?.van_name || 'Van'}</span>
        </div>
      </div>`;
  });
  document.getElementById('events-list').innerHTML = html;
}

function showBookingForm() {
  toast('Booking requests coming soon! For now contact a driver directly.');
}

// ============================================
// ALERTS
// ============================================
async function loadAlerts() {
  const { data: requests } = await supabase
    .from('requests')
    .select('*')
    .eq('customer_id', currentUser?.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!requests || requests.length === 0) {
    document.getElementById('alerts-list').innerHTML = '<div class="loading">No alerts yet — request a van to get started!</div>';
    return;
  }

  let html = '';
  requests.forEach(r => {
    const time = new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    html += `
      <div class="notif">
        <div class="ni">📍</div>
        <div style="flex:1">
          <div class="nt-title">Van requested</div>
          <div class="nt-sub">Status: ${r.status}</div>
        </div>
        <div class="nt-time">${time}</div>
      </div>`;
  });
  document.getElementById('alerts-list').innerHTML = html;
}

// ============================================
// DRIVER DASHBOARD
// ============================================
async function loadDriverDashboard() {
  const { data: reqs } = await supabase
    .from('requests')
    .select('*')
    .eq('status', 'pending');

  document.getElementById('s-requests').textContent = reqs?.length || 0;

  if (reqs && reqs.length > 0) {
    let html = '';
    const grouped = {};
    reqs.forEach(r => {
      const key = `${Math.round(r.latitude * 100) / 100},${Math.round(r.longitude * 100) / 100}`;
      grouped[key] = (grouped[key] || 0) + 1;
    });
    Object.entries(grouped).slice(0, 3).forEach(([loc, count], i) => {
      const colors = ['#B91C1C', '#C2410C', '#D97706'];
      html += `
        <div class="hot-card">
          <div class="hot-dot" style="background:${colors[i]}"></div>
          <div class="hot-street">Request area ${i + 1}</div>
          <span class="hot-cnt">${count} request${count > 1 ? 's' : ''}</span>
        </div>`;
    });
    document.getElementById('hotspots-list').innerHTML = html;
    document.getElementById('s-hotspot').textContent = reqs.length + ' total';
  } else {
    document.getElementById('hotspots-list').innerHTML = '<div class="loading">No requests right now</div>';
  }

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('driver_id', currentUser.id)
    .eq('status', 'pending');

  if (bookings && bookings.length > 0) {
    let html = '';
    bookings.forEach(b => {
      html += `
        <div class="book-card">
          <div class="book-title">${b.address || 'Booking request'}</div>
          <div class="book-det">${b.event_date || ''} ${b.event_time || ''} ${b.notes ? '· ' + b.notes : ''}</div>
          <div class="book-row">
            <button class="bk-y" onclick="respondBooking('${b.id}','accepted')">Accept</button>
            <button class="bk-n" onclick="respondBooking('${b.id}','declined')">Decline</button>
          </div>
        </div>`;
    });
    document.getElementById('bookings-list').innerHTML = html;
  } else {
    document.getElementById('bookings-list').innerHTML = '<div class="loading">No pending bookings</div>';
  }
}

async function respondBooking(id, status) {
  await supabase.from('bookings').update({ status }).eq('id', id);
  toast(status === 'accepted' ? 'Booking accepted! Customer notified.' : 'Booking declined.');
  loadDriverDashboard();
}

async function toggleLive() {
  if (!currentUser) return;
  isLive = !isLive;
  const toggle = document.getElementById('driver-toggle');
  const lbl = document.getElementById('tgl-lbl');
  const sub = document.getElementById('driver-status-lbl');

  toggle.classList.toggle('on', isLive);
  lbl.textContent = isLive ? 'Live' : 'Offline';
  sub.textContent = isLive ? "You're live — customers can see you 🟢" : "You're currently offline";

  if (isLive) {
    toast("You're live! 🟢");
    navigator.geolocation.getCurrentPosition(async pos => {
      await supabase.from('drivers').update({
        is_live: true,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude
      }).eq('id', currentUser.id);

      locationWatcher = navigator.geolocation.watchPosition(async p => {
        await supabase.from('drivers').update({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude
        }).eq('id', currentUser.id);
      });
    });
  } else {
    toast("You've gone offline");
    await setDriverOffline();
    if (locationWatcher) navigator.geolocation.clearWatch(locationWatcher);
  }
}

async function setDriverOffline() {
  if (!currentUser) return;
  await supabase.from('drivers').update({ is_live: false }).eq('id', currentUser.id);
}

// ============================================
// HELPERS
// ============================================
function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function toast(msg) {
  const t = document.getElementById('toast-msg');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
