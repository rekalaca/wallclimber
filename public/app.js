// HawkStone Client-Side Application Logic

const API_BASE = ''; // Same host
const qrcode = window.qrcode || window.QRCode;

// ---------------- UTILS & TOASTS ----------------
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : '✕'}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Custom Styled Confirm & Alert Modal (replaces browser native confirm/alert)
function showConfirmModal(optionsOrMessage) {
  const opts = typeof optionsOrMessage === 'string'
    ? { message: optionsOrMessage }
    : (optionsOrMessage || {});

  const title = opts.title || 'Megerősítés szükséges';
  const message = opts.message || 'Biztosan végrehajtod ezt a műveletet?';
  const badgeText = opts.badge || (opts.variant === 'danger' ? 'Törlés megerősítése' : (opts.variant === 'warning' ? 'Figyelmeztetés' : 'HawkStone Rendszer'));
  const variant = opts.variant || 'danger';
  const actions = Array.isArray(opts.actions) && opts.actions.length > 0
    ? opts.actions
    : [
        { label: opts.cancelText || 'Mégse', value: false, className: 'btn btn-secondary' },
        { label: opts.confirmText || 'Törlés', value: true, className: variant === 'danger' ? 'btn btn-danger' : 'btn btn-primary' }
      ];

  return new Promise((resolve) => {
    const existing = document.getElementById('hs-custom-dialog-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'hs-custom-dialog-backdrop';
    backdrop.className = 'hs-dialog-backdrop';

    const card = document.createElement('div');
    card.className = `hs-dialog-card hs-dialog-${variant}`;

    const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    card.innerHTML = `
      <span class="hs-dialog-badge">${esc(badgeText)}</span>
      <h3 class="hs-dialog-title">${esc(title)}</h3>
      <p class="hs-dialog-message">${esc(message).replace(/\n/g, '<br>')}</p>
      <div class="hs-dialog-actions"></div>
    `;

    const actionsContainer = card.querySelector('.hs-dialog-actions');
    let settled = false;

    const closeWith = (val) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown);
      backdrop.classList.remove('open');
      setTimeout(() => {
        backdrop.remove();
        resolve(val);
      }, 180);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeWith(opts.cancelValue !== undefined ? opts.cancelValue : false);
      }
    };
    document.addEventListener('keydown', onKeyDown);

    actions.forEach((act) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = act.className || 'btn btn-secondary';
      btn.textContent = act.label;
      btn.onclick = () => closeWith(act.value);
      actionsContainer.appendChild(btn);
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeWith(opts.cancelValue !== undefined ? opts.cancelValue : false);
      }
    });

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    requestAnimationFrame(() => {
      backdrop.classList.add('open');
    });
  });
}

function showAlertModal(message, title = 'Hiba történt', variant = 'danger') {
  return showConfirmModal({
    title,
    message,
    variant,
    badge: variant === 'danger' ? 'Hibaüzenet' : 'Értesítés',
    cancelValue: true,
    actions: [
      { label: 'Rendben', value: true, className: 'btn btn-primary' }
    ]
  });
}

window.showConfirmModal = showConfirmModal;
window.showAlertModal = showAlertModal;

// Get Auth Header
function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
}

// Get User Role
function getUserRole() {
  try {
    const userStr = localStorage.getItem('user');
    if (!userStr || userStr === 'undefined') return null;
    const user = JSON.parse(userStr);
    return user.role || null;
  } catch (e) {
    console.error('Error parsing user role', e);
    return null;
  }
}

// Get User Roles Array (supports comma-separated multi-roles)
function getUserRoles() {
  try {
    const userStr = localStorage.getItem('user');
    if (!userStr || userStr === 'undefined') return [];
    const user = JSON.parse(userStr);
    return (user.role || '').split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
  } catch (e) {
    console.error('Error parsing user roles', e);
    return [];
  }
}

// Check if user has specific role
function hasRole(targetRole) {
  const roles = getUserRoles();
  return roles.includes((targetRole || '').trim().toUpperCase());
}

// Logout function
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('hawkstone_last_activity');
  showToast('Sikeres kijelentkezés!');
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 800);
}

// ---------------- INACTIVITY AUTO-LOGOUT (10 MINUTES) ----------------
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const INACTIVITY_WARNING_MS = 9 * 60 * 1000;  // 9 minutes (60 seconds countdown)
const ACTIVITY_THROTTLE_MS = 4000;            // update localStorage at most every 4 seconds

let inactivityWarningModal = null;
let inactivityCountdownTimer = null;
let lastRecordedActivityTime = Date.now();

function recordUserActivity() {
  const token = localStorage.getItem('token');
  if (!token) return;

  const now = Date.now();
  if (now - lastRecordedActivityTime > ACTIVITY_THROTTLE_MS) {
    lastRecordedActivityTime = now;
    localStorage.setItem('hawkstone_last_activity', String(now));
    if (inactivityWarningModal) {
      dismissInactivityWarning();
    }
  }
}

function playInactivityWarningSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const playTone = (freq, startTime, duration, maxGain = 0.22) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(maxGain, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    // Kellemes, jól hallható háromhangú figyelemfelhívó dallam: D5 -> F#5 -> A5
    playTone(587.33, now, 0.24, 0.22);
    playTone(739.99, now + 0.16, 0.24, 0.24);
    playTone(880.00, now + 0.32, 0.48, 0.28);

    setTimeout(() => {
      try { ctx.close(); } catch (_) {}
    }, 1200);
  } catch (err) {
    console.warn('Inactivity sound playback prevented:', err);
  }
}

function playInactivityUrgentSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.24, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);

    setTimeout(() => {
      try { ctx.close(); } catch (_) {}
    }, 600);
  } catch (_) {}
}

function dismissInactivityWarning() {
  if (inactivityCountdownTimer) {
    clearInterval(inactivityCountdownTimer);
    inactivityCountdownTimer = null;
  }
  if (inactivityWarningModal) {
    inactivityWarningModal.remove();
    inactivityWarningModal = null;
  }
}

function showInactivityWarningModal(secondsLeft) {
  if (inactivityWarningModal) return;

  let remaining = typeof secondsLeft === 'number' && secondsLeft > 0 ? secondsLeft : 60;

  // Hangjelzés lejátszása a felugró megjelenésekor
  playInactivityWarningSound();

  const backdrop = document.createElement('div');
  backdrop.id = 'hs-inactivity-modal';
  backdrop.className = 'hs-dialog-backdrop open';
  backdrop.style.zIndex = '999999';

  backdrop.innerHTML = `
    <div class="hs-dialog-card hs-dialog-warning" style="text-align: center; max-width: 440px;">
      <span class="hs-dialog-badge">Biztonsági Figyelmeztetés</span>
      <h3 class="hs-dialog-title" style="margin-top: 8px;">Inaktivitási időkorlát</h3>
      <p class="hs-dialog-message" style="margin-bottom: 18px; line-height: 1.6;">
        Mivel nem észleltünk aktivitást, adatvédelmi okokból (online fizetések és időpontfoglalások védelme érdekében)
        a munkameneted hamarosan automatikusan lezárul:
      </p>
      <div style="font-size: 36px; font-weight: 800; color: #fbbf24; margin-bottom: 22px; font-variant-numeric: tabular-nums;">
        <span id="hs-inactivity-countdown">${remaining}</span> mp
      </div>
      <div class="hs-dialog-actions" style="justify-content: center; gap: 10px;">
        <button type="button" id="hs-stay-logged-in-btn" class="btn btn-primary" style="padding: 10px 22px; font-weight: 700;">
          Munkamenet folytatása
        </button>
        <button type="button" id="hs-logout-now-btn" class="btn btn-secondary btn-sm" style="padding: 10px 16px;">
          Kijelentkezés most
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  inactivityWarningModal = backdrop;

  const countdownSpan = document.getElementById('hs-inactivity-countdown');
  const stayBtn = document.getElementById('hs-stay-logged-in-btn');
  const logoutNowBtn = document.getElementById('hs-logout-now-btn');

  if (stayBtn) {
    stayBtn.onclick = () => {
      lastRecordedActivityTime = Date.now();
      localStorage.setItem('hawkstone_last_activity', String(Date.now()));
      dismissInactivityWarning();
      showToast('Munkamenet sikeresen meghosszabbítva!', 'success');
    };
  }

  if (logoutNowBtn) {
    logoutNowBtn.onclick = () => {
      dismissInactivityWarning();
      performInactivityLogout();
    };
  }

  inactivityCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (countdownSpan) countdownSpan.textContent = remaining;

    if (remaining === 10) {
      playInactivityUrgentSound();
    }

    if (remaining <= 0) {
      clearInterval(inactivityCountdownTimer);
      inactivityCountdownTimer = null;
      dismissInactivityWarning();
      performInactivityLogout();
    }
  }, 1000);
}

function performInactivityLogout() {
  dismissInactivityWarning();
  const token = localStorage.getItem('token');
  if (!token) return;

  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('hawkstone_last_activity');
  sessionStorage.setItem('hawkstone_inactivity_logged_out', '1');

  const path = window.location.pathname;
  const isWebAdminPage = path.endsWith('webadmin.html') || path.endsWith('/webadmin');
  const isClubAdminPage = !isWebAdminPage && (path.endsWith('/admin.html') || path === 'admin.html' || path.endsWith('scanner.html'));
  const isDashboardPage = path.endsWith('dashboard.html');

  if (isWebAdminPage) {
    window.location.href = 'webadmin.html';
  } else if (isClubAdminPage || isDashboardPage) {
    window.location.href = 'auth.html';
  } else {
    renderHeader();
    showAlertModal(
      'Biztonsági okokból (10 perc tétlenség után) a rendszer automatikusan kijelentkeztetett az időpontfoglalások és tranzakciók védelme érdekében. Kérjük, jelentkezz be újra a folytatáshoz.',
      'Munkamenet lezárva',
      'warning'
    );
  }
}

function checkInactivity() {
  const token = localStorage.getItem('token');
  if (!token) {
    if (inactivityWarningModal) dismissInactivityWarning();
    return;
  }

  let storedLast = parseInt(localStorage.getItem('hawkstone_last_activity') || '0', 10);
  if (!storedLast || isNaN(storedLast)) {
    storedLast = Date.now();
    localStorage.setItem('hawkstone_last_activity', String(storedLast));
  }

  const elapsed = Date.now() - storedLast;

  if (elapsed >= INACTIVITY_TIMEOUT_MS) {
    performInactivityLogout();
  } else if (elapsed >= INACTIVITY_WARNING_MS && !inactivityWarningModal) {
    const secondsLeft = Math.max(1, Math.round((INACTIVITY_TIMEOUT_MS - elapsed) / 1000));
    showInactivityWarningModal(secondsLeft);
  }
}

function initInactivityWatcher() {
  if (sessionStorage.getItem('hawkstone_inactivity_logged_out')) {
    sessionStorage.removeItem('hawkstone_inactivity_logged_out');
    setTimeout(() => {
      showAlertModal(
        'Biztonsági okokból (10 perc tétlenség után) a rendszer automatikusan kijelentkeztetett az időpontfoglalások és tranzakciók védelme érdekében. Kérjük, jelentkezz be újra a folytatáshoz.',
        'Munkamenet lezárva',
        'warning'
      );
    }, 450);
  }

  const token = localStorage.getItem('token');
  if (token) {
    if (!localStorage.getItem('hawkstone_last_activity')) {
      localStorage.setItem('hawkstone_last_activity', String(Date.now()));
    }
  }

  const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
  activityEvents.forEach((ev) => {
    window.addEventListener(ev, recordUserActivity, { passive: true });
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'hawkstone_last_activity') {
      const newTimestamp = parseInt(e.newValue || '0', 10);
      if (newTimestamp > lastRecordedActivityTime) {
        lastRecordedActivityTime = newTimestamp;
        if (inactivityWarningModal) {
          dismissInactivityWarning();
        }
      }
    } else if (e.key === 'token' && !e.newValue) {
      if (inactivityWarningModal) dismissInactivityWarning();
      renderHeader();
    }
  });

  setInterval(checkInactivity, 4000);
}

// ---------------- DYNAMIC HEADER/NAV ----------------
function getCachedContactInfo() {
  const defaults = {
    company_name: 'HOVI-TECH Kft.',
    address: '4531 Nyírpazony, Árpád u. 139.',
    phone_display: '(+36) 30 574 6946',
    phone_tel: '+36305746946',
    email_primary: 'orangeramp.info@gmail.com',
    email_secondary: 'info@hawkstone.hu',
    web_primary: 'www.orangeramp.com',
    web_secondary: 'www.hawkstone.hu'
  };
  if (window.siteContactInfo) {
    return { ...defaults, ...window.siteContactInfo };
  }
  try {
    const cached = sessionStorage.getItem('hawkstone_contact_info');
    if (cached) {
      return { ...defaults, ...JSON.parse(cached) };
    }
  } catch (_) {}
  return defaults;
}

function renderHeader() {
  const headerEl = document.querySelector('header');
  if (!headerEl) return;

  const token = localStorage.getItem('token');
  let user = {};
  try {
    const userStr = localStorage.getItem('user');
    if (userStr && userStr !== 'undefined') {
      user = JSON.parse(userStr);
    }
  } catch (e) {
    console.error('Error parsing user object', e);
  }

  const userRoles = (user.role || '').split(',').map(r => r.trim().toUpperCase());
  const isAdmin = userRoles.includes('ADMIN');
  const isStaff = userRoles.includes('STAFF');
  const isConfiguredAdmin = token && (isAdmin || isStaff);
  const isStaffOnly = token && isStaff && !isAdmin;
  const path = window.location.pathname;
  const hostname = (window.location.hostname || '').toLowerCase();
  const isClubHost = hostname.startsWith('klub.') || hostname.startsWith('maszoklub.') || hostname.startsWith('foglalas.');
  const isClubPage = isClubHost || path.endsWith('klub.html') || path.endsWith('maszoklub.html') || path.endsWith('foglalas.html') || path.endsWith('szabalyzat.html');
  const isClubSection = isClubPage || path.endsWith('auth.html') || path.endsWith('dashboard.html') || path.endsWith('hasznalati-szabalyok.html') || path.endsWith('withdrawal.html');
  const isContactPage = path.endsWith('kapcsolat.html') || path.endsWith('iso9001.html') || path.endsWith('maszofalaink.html') || path.endsWith('referenciak.html') || path.endsWith('404.html') || path.includes('404');
  const isCompanyIndex = !isClubHost && (path.endsWith('index.html') || path === '/' || path.endsWith('webpage/') || path.endsWith('/'));
  const isWebAdminPage = path.endsWith('webadmin.html') || path.endsWith('/webadmin');
  const isClubAdminPage = !isWebAdminPage && (path.endsWith('/admin.html') || path === 'admin.html' || path.endsWith('scanner.html'));
  const isAdminPage = isClubAdminPage || isWebAdminPage;

  // Set admin classes for fix header layout
  if (isAdminPage && isConfiguredAdmin) {
    headerEl.className = 'admin-header';
    document.body.classList.add('admin-body');
  } else {
    headerEl.className = isClubSection ? 'club-header' : ((isAdminPage) ? '' : 'no-auth-mobile');
    if (isClubSection) document.body.classList.add('club-page');
    document.body.classList.remove('admin-body');
  }

  const contactInfo = getCachedContactInfo();
  const phoneDisplay = contactInfo.phone_display || '(+36) 30 574 6946';
  const phoneTel = contactInfo.phone_tel || '+36305746946';
  const emailPrimary = contactInfo.email_primary || 'orangeramp.info@gmail.com';

  let navItems = '';

  const contactMobileSnippet = `
    <li class="menu-contact-mobile">
      <div class="menu-contact-box">
        <span class="menu-contact-title">Elérhetőség</span>
        <a href="tel:${phoneTel}" class="menu-contact-item" title="Telefonszám hívása">
          <div class="menu-contact-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
            </svg>
          </div>
          <div class="menu-contact-details">
            <span class="menu-contact-label">Telefon</span>
            <span class="menu-contact-val">${phoneDisplay}</span>
          </div>
        </a>
        <a href="mailto:${emailPrimary}" class="menu-contact-item" title="E-mail küldése">
          <div class="menu-contact-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="20" height="16" x="2" y="4" rx="2"></rect>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
            </svg>
          </div>
          <div class="menu-contact-details">
            <span class="menu-contact-label">E-mail</span>
            <span class="menu-contact-val">${emailPrimary}</span>
          </div>
        </a>
      </div>
    </li>
  `;

  const activeClass = (page, hash = '') => {
    const isPage = path.endsWith(page) || (page === 'webadmin.html' && path.endsWith('/webadmin'));
    let isHash = false;
    if (hash === '#dashboard' || hash === '#references') {
      isHash = (window.location.hash === hash || !window.location.hash);
    } else {
      isHash = hash ? window.location.hash === hash : !window.location.hash;
    }
    return isPage && isHash ? 'active' : '';
  };

  const isCustomerToken = Boolean(token && !isConfiguredAdmin);

  if (isClubAdminPage && isConfiguredAdmin) {
    if (isStaffOnly) {
      // Staff (Falmester Light) Specific Menu: Beléptetés / Scanner és Foglalások
      navItems = `
        <li><a href="scanner.html" class="nav-link ${activeClass('scanner.html')}">Beléptetés / Scanner</a></li>
        <li><a href="admin.html#bookings" class="nav-link ${activeClass('admin.html', '#bookings')}">Foglalások</a></li>
        <li><a href="klub.html" target="_blank" rel="noopener" class="nav-link">Weboldal ↗</a></li>
      `;
    } else {
      // Teljes Rendszergazda (Admin) Menu
      navItems = `
        <li><a href="admin.html#dashboard" class="nav-link ${activeClass('admin.html', '#dashboard')}">Kezdőlap</a></li>
        <li><a href="admin.html#stats" class="nav-link ${activeClass('admin.html', '#stats')}">Statisztika</a></li>
        <li><a href="admin.html#checkins" class="nav-link ${activeClass('admin.html', '#checkins')}">Beléptetések</a></li>
        <li><a href="scanner.html" class="nav-link ${activeClass('scanner.html')}">Beléptetés / Scanner</a></li>
        <li><a href="admin.html#schedule" class="nav-link ${activeClass('admin.html', '#schedule')}">Órarend kezelése</a></li>
        <li><a href="admin.html#users" class="nav-link ${activeClass('admin.html', '#users')}">Felhasználók kezelése</a></li>
        <li><a href="admin.html#bookings" class="nav-link ${activeClass('admin.html', '#bookings')}">Foglalások</a></li>
        <li><a href="admin.html#news" class="nav-link ${activeClass('admin.html', '#news')}">Üzenőfal</a></li>
        <li><a href="admin.html#withdrawals" class="nav-link ${activeClass('admin.html', '#withdrawals')}">Elállások</a></li>
        <li><a href="klub.html" target="_blank" rel="noopener" class="nav-link">Weboldal ↗</a></li>
      `;
    }
  } else if (isWebAdminPage && isConfiguredAdmin) {
    // Weboldal Admin Menu
    navItems = `
      <li><a href="webadmin.html#references" class="nav-link ${activeClass('webadmin.html', '#references')}">Referenciák &amp; Galéria</a></li>
      <li><a href="webadmin.html#home-types" class="nav-link ${activeClass('webadmin.html', '#home-types')}">Mászófal Típusaink</a></li>
      <li><a href="webadmin.html#walls" class="nav-link ${activeClass('webadmin.html', '#walls')}">Mászófalaink</a></li>
      <li><a href="webadmin.html#news" class="nav-link ${activeClass('webadmin.html', '#news')}">Üzenőfal</a></li>
      <li><a href="webadmin.html#contact" class="nav-link ${activeClass('webadmin.html', '#contact')}">Kapcsolati adatok</a></li>
      <li><a href="index.html" target="_blank" rel="noopener" class="nav-link">Weboldal ↗</a></li>
    `;
  } else {
    let profileItem = '';
    if (isClubSection && token) {
      if (isStaffOnly) {
        profileItem = `<li><a href="admin.html#bookings" class="nav-link">Falmester Panel</a></li>`;
      } else if (isAdmin) {
        profileItem = `<li><a href="admin.html#dashboard" class="nav-link">Admin Panel</a></li>`;
      } else {
        profileItem = `<li><a href="dashboard.html" class="nav-link ${isActive('dashboard.html')}">Profilom</a></li>`;
      }
    }

    if (isClubSection) {
      // Climbing Club (Nyíregyháza) & Club Subpages Menu
      const isSub = !path.endsWith('klub.html') && !path.endsWith('maszoklub.html') && !path.endsWith('foglalas.html');
      const clubBase = isSub ? (isClubHost ? '/' : 'klub.html') : '';
      navItems = `
        <li><a href="${isClubHost ? 'https://hawkstone.hu/' : 'index.html'}" class="nav-link nav-link-company" style="color:var(--primary); font-weight:600;"><span style="font-size:12px; margin-right:4px;">←</span> HawkStone.hu</a></li>
        <li><a href="${clubBase}#about" class="nav-link">Rólunk</a></li>
        <li><a href="${clubBase}#locations" class="nav-link">Helyszínek</a></li>
        <li><a href="${clubBase}#prices" class="nav-link">Áraink</a></li>
        <li><a href="szabalyzat.html" class="nav-link ${isActive('szabalyzat.html')}">Szabályzatunk</a></li>
        <li><a href="${clubBase}#contact" class="nav-link">Kapcsolat</a></li>
        ${profileItem}
        ${contactMobileSnippet}
      `;
    } else if (isContactPage) {
      // Normál weboldal aloldalak (Mászófalaink, Referenciák, ISO 9001, Kapcsolat, 404): bejelentkezés nélkül
      navItems = `
        <li><a href="index.html#about" class="nav-link">Bemutatkozunk</a></li>
        <li><a href="index.html#walls" class="nav-link">Mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html" class="nav-link nav-sublink">Iskolai mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#boulder" class="nav-link nav-sublink">Boulder mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#jatszoter" class="nav-link nav-sublink">Játszótéri mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#egyeb" class="nav-link nav-sublink">Egyéb mászófalak</a></li>
        <li><a href="index.html#gallery" class="nav-link">Galéria</a></li>
        <li><a href="referenciak.html" class="nav-link ${isActive('referenciak.html')}">Referenciák</a></li>
        <li><a href="iso9001.html" class="nav-link ${isActive('iso9001.html')}">ISO 9001</a></li>
        <li><a href="kapcsolat.html" class="nav-link ${isActive('kapcsolat.html')}">Kapcsolat</a></li>
        <li><a href="klub.html" class="nav-link nav-pulse-btn"><span>Próbáld ki!</span><img src="pictures/logos/header_logo.png" alt="HawkStone Logo" class="nav-pulse-logo" /></a></li>
        ${contactMobileSnippet}
      `;
    } else if (isCompanyIndex) {
      // Company Main Page (HawkStone Mászófalak Tervezés & Gyártás) Menu – bejelentkezés nélkül
      navItems = `
        <li><a href="#about" class="nav-link">Bemutatkozunk</a></li>
        <li><a href="#walls" class="nav-link">Mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html" class="nav-link nav-sublink">Iskolai mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#boulder" class="nav-link nav-sublink">Boulder mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#jatszoter" class="nav-link nav-sublink">Játszótéri mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#egyeb" class="nav-link nav-sublink">Egyéb mászófalak</a></li>
        <li><a href="#gallery" class="nav-link">Galéria</a></li>
        <li><a href="referenciak.html" class="nav-link">Referenciák</a></li>
        <li><a href="iso9001.html" class="nav-link">ISO 9001</a></li>
        <li><a href="kapcsolat.html" class="nav-link">Kapcsolat</a></li>
        <li><a href="klub.html" class="nav-link nav-pulse-btn"><span>Próbáld ki!</span><img src="pictures/logos/header_logo.png" alt="HawkStone Logo" class="nav-pulse-logo" /></a></li>
        ${contactMobileSnippet}
      `;
    } else {
      // Generic Subpages (Adatvédelem, ÁSZF, Impresszum, Cookie, stb.) – bejelentkezés nélkül
      navItems = `
        <li><a href="index.html" class="nav-link">Főoldal</a></li>
        <li><a href="maszofalaink.html" class="nav-link">Mászófalaink</a></li>
        <li><a href="referenciak.html" class="nav-link ${isActive('referenciak.html')}">Referenciák</a></li>
        <li><a href="iso9001.html" class="nav-link ${isActive('iso9001.html')}">ISO 9001</a></li>
        <li><a href="kapcsolat.html" class="nav-link ${isActive('kapcsolat.html')}">Kapcsolat</a></li>
        <li><a href="klub.html" class="nav-link nav-pulse-btn"><span>Próbáld ki!</span><img src="pictures/logos/header_logo.png" alt="HawkStone Logo" class="nav-pulse-logo" /></a></li>
        ${contactMobileSnippet}
      `;
    }
  }

  let authSection = '';
  let authSectionMobile = '';
  const userName = user.name || 'Fiókom';

  if (isAdminPage) {
    // Admin oldalakon (admin.html, scanner.html, webadmin.html)
    if (isConfiguredAdmin) {
      const logoutFn = isWebAdminPage ? 'logoutWebAdmin()' : 'logout()';
      const profileHref = isWebAdminPage ? 'webadmin.html#references' : (isStaffOnly ? 'admin.html#bookings' : 'admin.html#dashboard');
      authSection = `
        <div class="nav-auth" style="display: flex; align-items: center; gap: 15px;">
          <div class="profile-header-widget" style="border-left: 1px solid rgba(255,255,255,0.08); padding-left: 15px;">
            <a href="${profileHref}" class="profile-trigger-link">
              <div class="profile-avatar-circle">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <span class="profile-subtext" title="${userName}">${userName}</span>
            </a>
            <button class="logout-icon-btn" onclick="${logoutFn}" title="Kijelentkezés" aria-label="Kijelentkezés">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
      authSectionMobile = `
        <div class="nav-auth-mobile">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <a href="${profileHref}" style="font-weight:600; font-size:14px; color:#ffffff; text-decoration:none;">${userName}</a>
          </div>
          <button onclick="${logoutFn}" class="btn btn-secondary btn-sm" style="width:100%;">Kijelentkezés</button>
        </div>
      `;
    } else {
      authSection = `<div class="nav-auth"></div>`;
    }
  } else if (isClubSection) {
    // Klub oldalon és annak aloldalain: bejelentkezett fiók kezelése (mászó, staff vagy admin)
    if (token) {
      const panelHref = isStaffOnly ? 'admin.html#bookings' : (isAdmin ? 'admin.html#dashboard' : 'dashboard.html');
      authSection = `
        <div class="nav-auth">
          <button class="search-trigger-btn" onclick="toggleHeaderSearch()" title="Keresés" aria-label="Keresés">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
          <div class="profile-header-widget">
            <a href="${panelHref}" class="profile-trigger-link">
              <div class="profile-avatar-circle">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <span class="profile-subtext" title="${userName}">${userName}</span>
            </a>
            <button class="logout-icon-btn" onclick="logout()" title="Kijelentkezés" aria-label="Kijelentkezés">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
      authSectionMobile = `
        <div class="nav-auth-mobile">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <a href="${panelHref}" style="font-weight:600; font-size:14px; color:#ffffff; text-decoration:none;">${userName}</a>
          </div>
          <button onclick="logout()" class="btn btn-secondary btn-sm" style="width:100%;">Kijelentkezés</button>
        </div>
      `;
    } else {
      authSection = `
        <div class="nav-auth">
          <button class="search-trigger-btn" onclick="toggleHeaderSearch()" title="Keresés" aria-label="Keresés">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
          <div class="profile-header-widget">
            <a href="auth.html" class="profile-trigger-link">
              <div class="profile-avatar-circle">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <span class="profile-subtext">Bejelentkezés</span>
            </a>
          </div>
        </div>
      `;
      authSectionMobile = `
        <div class="nav-auth-mobile">
          <a href="auth.html" class="btn btn-primary btn-sm" style="width:100%; text-align:center;">Bejelentkezés</a>
        </div>
      `;
    }
  } else {
    // Normál (fő) weboldalon: Bejelentkezés nélkül, asztali nézetben a telefonszámmal és e-mail címmel azonos dizájnú keresőmezővel
    authSection = `
      <div class="nav-auth">
        <div class="header-inline-search-wrap" id="header-inline-search-wrap">
          <div class="header-inline-search-box">
            <span class="header-contact-icon header-inline-search-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              id="header-inline-search-input"
              class="header-inline-search-input"
              placeholder="Keresés az oldalon..."
              autocomplete="off"
              oninput="handleInlineHeaderSearch(this.value)"
              onfocus="if(this.value.trim()) handleInlineHeaderSearch(this.value)"
            />
            <button type="button" id="header-inline-search-clear" class="header-inline-search-clear" onclick="clearInlineHeaderSearch()" aria-label="Keresés törlése">&times;</button>
          </div>
          <div class="header-inline-search-results" id="header-inline-search-results" style="display:none;"></div>
          <button class="search-trigger-btn header-inline-search-mobile-btn" onclick="toggleHeaderSearch()" title="Keresés" aria-label="Keresés">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  const contactDesktopSnippet = !isAdminPage ? `
    <div class="header-contact-desktop ${!isClubSection ? 'header-contact-right-aligned' : ''}">
      <a href="tel:${phoneTel}" class="header-contact-item" title="Telefonszám: ${phoneDisplay}">
        <span class="header-contact-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
          </svg>
        </span>
        <span class="header-contact-text">${phoneDisplay}</span>
      </a>
      <span class="header-contact-divider">•</span>
      <a href="mailto:${emailPrimary}" class="header-contact-item" title="E-mail: ${emailPrimary}">
        <span class="header-contact-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="20" height="16" x="2" y="4" rx="2"></rect>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
          </svg>
        </span>
        <span class="header-contact-text">${emailPrimary}</span>
      </a>
      ${!isClubSection ? '<span class="header-contact-divider">•</span>' : ''}
    </div>
  ` : '';

  headerEl.innerHTML = `
    <div class="container">
      <nav class="navbar ${isClubSection ? 'club-navbar' : ''}">
        <a href="${isClubSection ? (isClubHost ? '/' : 'klub.html') : 'index.html'}" class="logo ${isClubSection ? 'club-logo-link' : 'company-logo-link'}" style="display: flex; align-items: center; gap: 0; height: 100%;">
          <img src="${(isClubSection || !document.body.classList.contains('theme-silver')) ? 'pictures/logos/klub_logo_transp.png' : 'pictures/logos/header_logo.png'}" alt="HawkStone Logo" class="${isClubSection ? 'club-header-logo-img' : 'header-logo-img'}" style="width: auto; object-fit: contain; display: block;" />
        </a>

        ${(isAdminPage && isConfiguredAdmin) ? `
          <div class="menu-trigger-btn" id="admin-menu-trigger">
            <span>MENÜ</span>
            <button class="hamburger-btn" style="display: flex; background: none; border: none; color: var(--primary); cursor: pointer; padding: 0; pointer-events: none;" aria-label="Menü megnyitása">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
          </div>
        ` : `
          <div class="menu-trigger-btn" id="hamburger-toggle">
            <span>MENÜ</span>
            <button class="hamburger-btn" style="display: flex; background: none; border: none; color: var(--primary); cursor: pointer; padding: 0; pointer-events: none;" aria-label="Menü megnyitása">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
          </div>
        `}

        ${contactDesktopSnippet}

        <!-- Menu overlay background -->
        <div class="menu-overlay" id="menu-overlay" onclick="window.setHeaderMenuOpen && window.setHeaderMenuOpen(false)"></div>

        <!-- Navigation Menu -->
        <ul class="nav-menu" id="nav-menu">
          <!-- Close Button in Menu (Mobile / Admin Drawer Close) -->
          <button type="button" class="menu-close-btn" id="menu-close" aria-label="Menü bezárása" onclick="event.stopPropagation(); window.setHeaderMenuOpen && window.setHeaderMenuOpen(false)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          
          <li class="menu-title-mobile">MENÜ</li>
          ${(isClubSection || isAdminPage) ? authSectionMobile : ''}
          ${navItems}
        </ul>

        ${authSection}
      </nav>
    </div>

    ${(isAdminPage && isConfiguredAdmin) ? '' : `
      <!-- Search Bar Dropdown -->
      <div class="search-dropdown-bar" id="search-dropdown-bar">
        <div class="search-bar-inner">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: var(--text-muted);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" placeholder="Keresés az oldalon..." id="header-search-input" autocomplete="off" oninput="handleHeaderSearch(this.value)" />
          <button class="search-clear-btn" onclick="clearHeaderSearch()" aria-label="Keresés törlése">&times;</button>
        </div>
        <div class="search-results-dropdown" id="search-results-dropdown" style="display:none;"></div>
      </div>
    `}
  `;

  // Hamburger Menu toggle events
  const hamburger = document.getElementById('hamburger-toggle') || document.getElementById('admin-menu-trigger');
  const closeBtn = document.getElementById('menu-close');
  const navMenu = document.getElementById('nav-menu');
  const overlay = document.getElementById('menu-overlay');

  if (hamburger && closeBtn && navMenu && overlay) {
    // Egyszer kötött, delegált eseménykezelő: a fejléc újrarenderelése után sem vész el
    window.setHeaderMenuOpen = (open) => {
      const nm = document.getElementById('nav-menu');
      const ov = document.getElementById('menu-overlay');
      if (!nm || !ov) return;
      nm.classList.toggle('open', open);
      ov.classList.toggle('active', open);
      document.body.style.overflow = open ? 'hidden' : ''; // Prevent scroll when menu open
    };

    if (!window.headerMenuDelegationBound) {
      window.headerMenuDelegationBound = true;
      document.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('#menu-close') || t.closest('#menu-overlay') || t.closest('#nav-menu a')) {
          window.setHeaderMenuOpen(false);
        } else if (t.closest('#hamburger-toggle') || t.closest('#admin-menu-trigger')) {
          window.setHeaderMenuOpen(true);
        }
      });
    }
  }

  initNavActiveState();
}

// ---------------- AKTÍV MENÜPONT (oldal + szekció figyelés görgetéskor) ----------------
let navActiveListenersBound = false;
function updateNavActiveState() {
  const menu = document.getElementById('nav-menu');
  if (!menu) return;
  const curFile = (window.location.pathname.split('/').pop() || 'index.html') || 'index.html';
  const entries = [];
  menu.querySelectorAll('a.nav-link').forEach(a => {
    if (a.classList.contains('nav-pulse-btn') || a.classList.contains('nav-link-company')) return;
    const href = a.getAttribute('href') || '';
    const [fileRaw, hash] = href.split('#');
    const file = fileRaw || curFile;
    if (file !== curFile) return;
    entries.push({ a, id: hash || null });
  });
  if (!entries.length) return;

  // Aktuális szekció: az utolsó, amelynek teteje már a header alá ért
  let activeId = null;
  entries.forEach(e => {
    if (!e.id) return;
    const el = document.getElementById(e.id);
    if (el && el.getBoundingClientRect().top <= 140) activeId = e.id;
  });
  let target = activeId ? entries.find(e => e.id === activeId) : entries.find(e => !e.id);
  // Ha az oldal nem szekció-alapú (pl. Kapcsolat, ISO): a hash nélküli link az aktív
  menu.querySelectorAll('a.nav-link').forEach(a => a.classList.remove('active'));
  if (target) target.a.classList.add('active');
}

function initNavActiveState() {
  updateNavActiveState();
  if (navActiveListenersBound) return;
  navActiveListenersBound = true;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updateNavActiveState(); ticking = false; });
  }, { passive: true });
  window.addEventListener('hashchange', updateNavActiveState);
}
// ---------------- HEADER SEARCH UTILITIES (FULL-SITE + DYNAMIC + DOM CONTENT) ----------------
const searchIndex = [
  // --- Cégoldal / Főoldal (index.html) ---
  { title: "Bemutatkozunk – Rólunk", desc: "A HawkStone mászófalgyártó csapat és a HOVI-TECH Kft. története, 2008 óta több mint 15 év tapasztalat egyedi mászófalak tervezésében és kivitelezésében.", link: "index.html#about", tags: "rolunk bemutatkozas csapat hovi-tech kft tervezes gyartas kivitelezes karbantartas felulvizsgalat 2008 tapasztalat" },
  { title: "Mászófal típusaink és működési elvük", desc: "Beltéri, kültéri, iskolai, óvodai, boulder, interaktív és végtelenített forgó mászófalak bemutatása, előnyei és biztonsági megoldásai.", link: "index.html#walls", tags: "tipusok maszofalak tipusaink mukodesi elv belteri kulteri ovodai iskolai boulder interaktiv forgo" },
  { title: "Szabványok, biztonság és eséscsillapító szivacsok", desc: "MSZ EN 12572 szabványnak megfelelő kivitelezés, felhajtható és fix biztonsági esésvédő szőnyegek, éves felülvizsgálat.", link: "index.html#walls", tags: "szabvany msz en 12572 tuv biztonsag szivacs esescsillapito szonyeg felhajthato karbantartas" },
  { title: "Galéria – Képgaléria", desc: "Fotóválogatás az elkészült iskolai, kültéri, boulder és egyedi grafikás mászófalainkból.", link: "index.html#gallery", tags: "kepgaleria galeria kepek fotok munkaink referencia" },
  // --- Mászófalaink oldal (maszofalaink.html) ---
  { title: "Mászófalaink – Összes mászófal típus és méret", desc: "Iskolai, boulder, játszótéri kültéri és nagy felületű mászófalak részletes méretei és műszaki adatai.", link: "maszofalaink.html", tags: "maszofalaink katalogus meretek magassag szelesseg felulet m1101 m1102 m1103 m1104 m1105 m1106 m1107 m1108 m1109" },
  { title: "Iskolai mászófalak (M1104, M1106, M1105)", desc: "Iskolai tornatermekbe, bordásfal helyére vagy szabad falfelületre építhető mászófalak (3 m magasság, 9–18 m² felület).", link: "maszofalaink.html#iskolai", tags: "iskola iskolai tornaterem bordasfal testneveles m1104 m1106 m1105 9 m2 13,5 m2 18 m2 magassag szelesseg" },
  { title: "M1104 Iskolai mászófal", desc: "Magasság: 3,0 m | Szélesség: 3,0 m | Felület: kb. 9 m² – tornatermi mászófal biztonsági szivaccsal.", link: "maszofalaink.html#iskolai", tags: "m1104 iskolai maszofal 3m 9m2 tornaterem" },
  { title: "M1106 Iskolai mászófal", desc: "Magasság: 3,0 m | Szélesség: 4,5 m | Felület: kb. 13,5 m² – iskolai tornatermi mászófal.", link: "maszofalaink.html#iskolai", tags: "m1106 iskolai maszofal 4,5m 13,5m2 tornaterem" },
  { title: "M1105 Iskolai mászófal", desc: "Magasság: 3,0 m | Szélesség: 6,0 m | Felület: kb. 18 m² – nagy felületű iskolai mászófal.", link: "maszofalaink.html#iskolai", tags: "m1105 iskolai maszofal 6m 18m2 tornaterem" },
  { title: "Boulder mászófalak (M1101, M1102, M1103)", desc: "Kötélbiztosítás nélkül használható boulder mászófalak 2,5 m magassággal, 7,5–15 m² mászófelülettel.", link: "maszofalaink.html#boulder", tags: "boulder bouldering m1101 m1102 m1103 kis magassagu kotel nelkul 2,5m 7,5m2 10m2 15m2" },
  { title: "M1101 Boulder mászófal", desc: "Magasság: 2,5 m | Szélesség: 3,0 m | Felület: kb. 7,5 m² – kompakt boulder mászófal.", link: "maszofalaink.html#boulder", tags: "m1101 boulder maszofal 2,5m 3m 7,5m2" },
  { title: "M1102 Boulder mászófal", desc: "Magasság: 2,5 m | Szélesség: 4,0 m | Felület: kb. 10 m² – közepes boulder mászófal.", link: "maszofalaink.html#boulder", tags: "m1102 boulder maszofal 2,5m 4m 10m2" },
  { title: "M1103 Boulder mászófal", desc: "Magasság: 2,5 m | Szélesség: 6,0 m | Felület: kb. 15 m² – széles boulder mászófal döntött szakaszokkal.", link: "maszofalaink.html#boulder", tags: "m1103 boulder maszofal 2,5m 6m 15m2" },
  { title: "Játszóterekre, parkokba – Játszótéri kültéri mászófal (M1109)", desc: "Időjárásálló kültéri mászófal M1109: 3,0 m magas, 2,5 m széles, kb. 11 m² mászófelület közterületekre és iskolaudvarokra.", link: "maszofalaink.html#jatszoter", tags: "jatszoter jatszoteri kulteri park parkok m1109 szabadteri idojarasallo udvar 11m2" },
  { title: "Egyéb és nagy felületű mászófalak (M1107, M1108)", desc: "Magas, felsőbiztosítási pontokkal ellátott mászófalak M1107 (45 m², 5 biztosítási pont) és M1108 (57 m², 5 biztosítási pont).", link: "maszofalaink.html#egyeb", tags: "egyeb nagy m1107 m1108 felsobiztositas felso biztositasi pontok 45m2 57m2 6m magas koteles" },
  // --- Referenciáink (referenciak.html) ---
  { title: "Referenciáink – Elkészült mászófalak országszerte", desc: "Iskolai, óvodai, kültéri, interaktív, forgó és mobil mászófal referenciáink (Budapest, Debrecen, Esztergom, Fonyód, Gyula, Keszthely, Nyíregyháza, Pápa és sok más település).", link: "referenciak.html", tags: "referenciak referencia munkaink debrecen esztergom gyula nyiregyhaza papa budapest fonyod keszthely kerecsend maglod maklar mako monor ocsa tiszatelek veszto mobil forgo maszofal maszoka video" },
  { title: "Forgó mászófal és Mobil mászófal", desc: "Végtelenített forgó mászófal videóval és rendezvényekre telepíthető mobil mászófal referenciák.", link: "referenciak.html", tags: "forgo maszofal mobil maszofal vegtelenitett interaktiv rendezveny video" },
  // --- ISO 9001 és Kapcsolat ---
  { title: "ISO 9001 Minőségirányítás és Tanúsítványok", desc: "A HOVI-TECH Kft. minőségpolitikája és érvényes ISO 9001 tanúsítványai magyar, angol és német nyelven.", link: "iso9001.html", tags: "iso 9001 minosegpolitika tanusitvany certificate zertifikat minosites minosegbiztositas hovi-tech" },
  { title: "Kapcsolat és Ajánlatkérés", desc: "HOVI-TECH Kft. – Telefon: +36 30 229 3915, E-mail: info@hawkstone.hu, Cím: 4531 Nyírpazony, Széchenyi u. 36. Írj nekünk az űrlapon!", link: "kapcsolat.html", tags: "kapcsolat elerhetoseg email telefon uzenet urlap ajanlatkeres cim nyirpazony szechenyi hovitech info@hawkstone.hu +36302293915" },
  // --- Városi Mászóklub (klub.html és aloldalai) ---
  { title: "Városi Mászóklub – Nyíregyháza", desc: "Nyíregyházi Városi Mászóklub – próbáld ki a falainkat! Edzések, szabad mászás, online időpontfoglalás.", link: "klub.html", tags: "klub maszoklub nyiregyhaza proba probald ki idopontfoglalas foglalas edzes falmaszas" },
  { title: "Mászóklub Helyszínek (Eötvös, Kossuth, Zrínyi)", desc: "Eötvös József Gyakorló Iskola, Kossuth Lajos Evangélikus Gimnázium és Zrínyi Ilona Gimnázium mászótermei Nyíregyházán.", link: "klub.html#locations", tags: "helyszin helyek eotvos kossuth zrinyi nyitvatartas cimek tornaterem nyiregyhaza" },
  { title: "Mászóklub Áraink – Jegyek és Bérletek", desc: "Napijegy (2 800 Ft), 10 alkalmas bérlet (22 000 Ft), Havi bérlet (28 000 Ft) – online vásárlás a mászóklubban.", link: "klub.html#prices", tags: "arak jegy berlet napijegy 10 alkalmas havi berlet vasarlas fizetes 2800 22000 28000" },
  { title: "Mászóklub Órarend és Időpontfoglalás", desc: "Aktuális edzés időpontok, szabad helyek és azonnali online helyfoglalás.", link: "klub.html#schedule", tags: "orarend idopont idopontfoglalas naptar szabad helyek edzes" },
  { title: "Szabályzatunk – Házirend és Kártyarendszer", desc: "Mászófal biztonsági szabályzat, házirend, Zöld kártya és Piros kártya vizsgarendszer.", link: "szabalyzat.html", tags: "szabalyzat vizsga biztonsag zold kartya piros kartya hazirend biztositas" },
  { title: "Mászófal használati szabályok", desc: "A mászófalak, boulder falak és a TRUBLUE automata biztosító biztonságos használatának részletes szabályai.", link: "hasznalati-szabalyok.html", tags: "hasznalati szabalyok biztonsag trublue automata biztosito beulo maszas" },
  { title: "Profilom és Belépés (Mászóklub)", desc: "Személyes profil, megvásárolt QR-kódos jegyek, bérletek és időpontfoglalások kezelése.", link: "dashboard.html", tags: "profil dashboard vezerlopult foglalas jegyek qr kod belepes bejelentkezes regisztracio" },
  // --- Jogi oldalak ---
  { title: "Adatkezelési Tájékoztató (GDPR)", desc: "Személyes adatok kezelése és adatvédelmi szabályzat.", link: "adatvedelem.html", tags: "adatvedelem adatkezeles gdpr adatok" },
  { title: "Süti (Cookie) Tájékoztató", desc: "Cookie-k (sütik) használata a weboldalon.", link: "cookie-szabalyzat.html", tags: "suti cookie sutik tajekoztato" },
  { title: "ÁSZF – Általános Szerződési Feltételek", desc: "Általános Szerződési Feltételek és vásárlási tájékoztató.", link: "aszf.html", tags: "aszf altalanos szerzodesi feltetelek" },
  { title: "Elállás a szerződéstől", desc: "Online elállási és felmondási nyilatkozat.", link: "withdrawal.html", tags: "elallas visszaterites szerzodestol nyilatkozat" },
  { title: "Impresszum – Cégadatok", desc: "HOVI-TECH Kft. hivatalos cégadatok, adószám, cégjegyzékszám és tárhelyszolgáltató.", link: "impresszum.html", tags: "impresszum cegadatok hovi-tech adoszam cegjegyzekszam" }
];

// Ékezet- és kisbetű-független normalizálás a kereséshez
function normalizeSearchText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ő/g, 'o').replace(/ű/g, 'u');
}

function escapeSearchHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resolveSearchLink(link) {
  if (!link) return 'index.html';
  if (link.startsWith('#')) {
    const curFile = (window.location.pathname.split('/').pop() || 'index.html');
    return curFile ? `${curFile}${link}` : link;
  }
  return link;
}

// Dinamikus adatbázis elemek (galéria/referencia képek, mászófal kártyák, kapcsolat) bevonása a keresésbe
function getDynamicSearchEntries() {
  const entries = [];
  const seenKeys = new Set();

  // 1. Galéria és Referencia elemek (beleértve a webadminon feltöltött új képeket is)
  if (typeof ALL_HAWKSTONE_GALLERY_IMAGES !== 'undefined' && Array.isArray(ALL_HAWKSTONE_GALLERY_IMAGES)) {
    ALL_HAWKSTONE_GALLERY_IMAGES.forEach(img => {
      const city = (img.city || '').trim();
      const name = (img.name || '').trim();
      if (!city && !name) return;
      const key = `ref:${normalizeSearchText(city)}:${normalizeSearchText(name)}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      const label = (name && name !== city) ? `${city} – ${name}` : city;
      entries.push({
        title: `Referencia: ${label}`,
        desc: `Elkészült HawkStone mászófal referencia (${label}).`,
        link: 'referenciak.html',
        tags: `referencia referenciak foto kep ${city} ${name} ${img.alt || ''}`
      });
    });
  }

  // 2. Dinamikus Mászófalaink kártyák (/api/wall-products)
  if (Array.isArray(window.ALL_WALL_PRODUCTS)) {
    window.ALL_WALL_PRODUCTS.forEach(w => {
      const code = (w.code || '').trim();
      const title = (w.title || '').trim();
      const cat = (w.category || 'iskolai').trim();
      const key = `wall:${normalizeSearchText(code)}:${normalizeSearchText(title)}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      const specs = [
        w.height ? `Magasság: ${w.height}` : '',
        w.width ? `Szélesség: ${w.width}` : '',
        w.surface ? `Felület: ${w.surface}` : '',
        w.anchor_points ? `Felsőbiztosítási pontok: ${w.anchor_points}` : ''
      ].filter(Boolean).join(' | ');

      entries.push({
        title: `${code ? code + ' – ' : ''}${title}`,
        desc: specs || 'HawkStone mászófal típus részletes műszaki adatokkal.',
        link: `maszofalaink.html#${cat}`,
        tags: `maszofal maszofalaink ${code} ${title} ${cat} ${w.height || ''} ${w.width || ''} ${w.surface || ''}`
      });
    });
  }

  // 3. Dinamikus kapcsolati adatok (/api/site-contact)
  if (window.siteContactInfo) {
    const c = window.siteContactInfo;
    entries.push({
      title: `Elérhetőség – ${c.company_name || 'HOVI-TECH Kft.'}`,
      desc: `Telefon: ${c.phone_display || ''} | E-mail: ${c.email_primary || ''} | Cím: ${c.address || ''}`,
      link: 'kapcsolat.html',
      tags: `kapcsolat telefon email cim szekhely ${c.company_name || ''} ${c.phone_display || ''} ${c.email_primary || ''} ${c.email_secondary || ''} ${c.address || ''}`
    });
  }

  return entries;
}

// Az aktuálisan megnyitott oldal teljes szöveges DOM tartalmának átvizsgálása
function scanCurrentPageDOM(terms, existingLinksAndTitles) {
  const domResults = [];
  const mainEl = document.querySelector('main') || document.body;
  if (!mainEl || !terms.length) return domResults;

  // Biztosítjuk, hogy a DOM-elemeknek legyen egyedi azonosítója a görgetéshez
  const blocks = mainEl.querySelectorAll('section, article, .glass-card, .school-card, .wall-type-card, .faq-item');
  blocks.forEach((block, idx) => {
    if (block.closest('header') || block.closest('footer') || block.closest('.aeo-geo-sr-only')) return;
    const rawText = (block.innerText || block.textContent || '').replace(/\s+/g, ' ').trim();
    if (!rawText || rawText.length < 15) return;

    const normText = normalizeSearchText(rawText);
    if (!terms.every(t => normText.includes(t))) return;

    // Cím keresése a blokkon vagy a szülő szekción belül
    const headingEl = block.querySelector('h1, h2, h3, h4') || block.closest('section')?.querySelector('h1, h2, h3');
    const headingText = headingEl ? headingEl.textContent.replace(/\s+/g, ' ').trim() : 'Találat ezen az oldalon';

    // Keresünk egy releváns szövegrészletet (snippet) az első kifejezés körül
    const firstTermPos = normText.indexOf(terms[0]);
    const start = Math.max(0, firstTermPos - 35);
    const end = Math.min(rawText.length, firstTermPos + 110);
    let snippet = rawText.slice(start, end).trim();
    if (start > 0) snippet = '…' + snippet;
    if (end < rawText.length) snippet = snippet + '…';

    const parentSec = block.closest('section[id]') || (block.id ? block : null);
    if (!block.id && !parentSec) {
      block.id = `search-hit-target-${idx}`;
    }
    const targetId = parentSec ? parentSec.id : block.id;
    const link = `#${targetId}`;

    const dedupeKey = normalizeSearchText(headingText);
    if (existingLinksAndTitles.has(dedupeKey)) return;
    existingLinksAndTitles.add(dedupeKey);

    domResults.push({
      title: `${headingText} (ezen az oldalon)`,
      desc: snippet,
      link
    });
  });

  return domResults.slice(0, 6);
}

// Egységes keresőmotor a teljes weboldalhoz
function performSiteSearch(query) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const allEntries = [...searchIndex, ...getDynamicSearchEntries()];
  const matched = [];
  const existingTitles = new Set();

  allEntries.forEach(item => {
    const titleNorm = normalizeSearchText(item.title);
    const descNorm = normalizeSearchText(item.desc);
    const tagsNorm = normalizeSearchText(item.tags || '');
    const hay = `${titleNorm} ${descNorm} ${tagsNorm}`;

    if (terms.every(t => hay.includes(t))) {
      // Pontozás: címben lévő találat előrébb kerül
      let score = 1;
      if (terms.every(t => titleNorm.includes(t))) score += 10;
      else if (terms.some(t => titleNorm.includes(t))) score += 5;
      if (terms.every(t => descNorm.includes(t))) score += 3;

      const dedupeKey = `${item.link}|${titleNorm}`;
      if (!existingTitles.has(dedupeKey)) {
        existingTitles.add(dedupeKey);
        existingTitles.add(titleNorm);
        matched.push({ ...item, score });
      }
    }
  });

  matched.sort((a, b) => b.score - a.score);

  // Kiegészítjük az aktuális oldal élő DOM-szövegében található egyezésekkel
  const domMatches = scanCurrentPageDOM(terms, existingTitles);
  return [...matched, ...domMatches].slice(0, 15);
}

function toggleHeaderSearch() {
  const bar = document.getElementById('search-dropdown-bar');
  if (!bar) return;
  const isOpen = bar.classList.toggle('open');
  if (isOpen) {
    const input = document.getElementById('header-search-input');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 50);
    }
    const results = document.getElementById('search-results-dropdown');
    if (results) {
      results.style.display = 'none';
      results.innerHTML = '';
    }
  }
}

function clearHeaderSearch() {
  // Az X bezárja a lecsúszó keresősávot (és kiüríti a mezőt)
  const input = document.getElementById('header-search-input');
  if (input) input.value = '';
  const results = document.getElementById('search-results-dropdown');
  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
  const bar = document.getElementById('search-dropdown-bar');
  if (bar) bar.classList.remove('open');
}

function handleHeaderSearch(query) {
  const resultsDiv = document.getElementById('search-results-dropdown');
  if (!resultsDiv) return;

  const cleanQuery = (query || '').toLowerCase().trim();
  if (!cleanQuery) {
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = '';
    return;
  }

  const filtered = performSiteSearch(query);

  resultsDiv.style.display = 'block';
  if (filtered.length === 0) {
    resultsDiv.innerHTML = `<div class="search-no-results">Nincs találat a következőre: "${escapeSearchHtml(query)}"</div>`;
    return;
  }

  resultsDiv.innerHTML = filtered.map(item => {
    const resolvedLink = resolveSearchLink(item.link);
    return `
      <a href="${resolvedLink}" class="search-result-item" onclick="toggleHeaderSearch()">
        <span class="search-result-title">${escapeSearchHtml(item.title)}</span>
        <span class="search-result-desc">${escapeSearchHtml(item.desc)}</span>
      </a>
    `;
  }).join('');
}

function clearInlineHeaderSearch() {
  const input = document.getElementById('header-inline-search-input');
  const clearBtn = document.getElementById('header-inline-search-clear');
  const resultsDiv = document.getElementById('header-inline-search-results');
  if (input) {
    input.value = '';
    input.focus();
  }
  if (clearBtn) clearBtn.style.display = 'none';
  if (resultsDiv) {
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = '';
  }
}

function handleInlineHeaderSearch(query) {
  const resultsDiv = document.getElementById('header-inline-search-results');
  const clearBtn = document.getElementById('header-inline-search-clear');
  if (!resultsDiv) return;

  const cleanQuery = (query || '').toLowerCase().trim();
  if (clearBtn) clearBtn.style.display = cleanQuery ? 'block' : 'none';

  if (!cleanQuery) {
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = '';
    return;
  }

  const filtered = performSiteSearch(query);

  resultsDiv.style.display = 'block';
  if (filtered.length === 0) {
    resultsDiv.innerHTML = `<div class="search-no-results">Nincs találat a következőre: "${escapeSearchHtml(query)}"</div>`;
    return;
  }

  resultsDiv.innerHTML = filtered.map(item => {
    const resolvedLink = resolveSearchLink(item.link);
    return `
      <a href="${resolvedLink}" class="search-result-item" onclick="document.getElementById('header-inline-search-results').style.display='none'">
        <span class="search-result-title">${escapeSearchHtml(item.title)}</span>
        <span class="search-result-desc">${escapeSearchHtml(item.desc)}</span>
      </a>
    `;
  }).join('');
}

// Click outside to close search bar
document.addEventListener('click', (event) => {
  const bar = document.getElementById('search-dropdown-bar');
  const clickedTrigger = event.target.closest && event.target.closest('.search-trigger-btn');
  if (bar && bar.classList.contains('open') && !bar.contains(event.target) && !clickedTrigger) {
    bar.classList.remove('open');
  }

  const inlineWrap = document.getElementById('header-inline-search-wrap');
  const inlineResults = document.getElementById('header-inline-search-results');
  if (inlineWrap && inlineResults && inlineResults.style.display !== 'none' && !inlineWrap.contains(event.target)) {
    inlineResults.style.display = 'none';
  }
});

// Bind search utilities to window
window.toggleHeaderSearch = toggleHeaderSearch;
window.clearHeaderSearch = clearHeaderSearch;
window.handleHeaderSearch = handleHeaderSearch;
window.handleInlineHeaderSearch = handleInlineHeaderSearch;
window.clearInlineHeaderSearch = clearInlineHeaderSearch;

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const target = window.event ? (window.event.currentTarget || window.event.target) : null;
  if (input.type === 'password') {
    input.type = 'text';
    if (target) target.textContent = '🙈';
  } else {
    input.type = 'password';
    if (target) target.textContent = '👁️';
  }
}
window.togglePasswordVisibility = togglePasswordVisibility;

function isActive(page) {
  const path = window.location.pathname;
  return path.endsWith(page) ? 'active' : '';
}

// ---------------- PARALLAX EFFECT ----------------
function initParallax() {
  const parallaxContainer = document.getElementById('parallax-divider');
  const parallaxBg = parallaxContainer ? parallaxContainer.querySelector('.parallax-bg') : null;
  if (!parallaxContainer || !parallaxBg) return;

  let ticking = false;

  function updateParallax() {
    const rect = parallaxContainer.getBoundingClientRect();
    const viewHeight = window.innerHeight;
    
    // Check if the parallax container is visible in viewport
    if (rect.bottom >= 0 && rect.top <= viewHeight) {
      // Calculate scroll progress through viewport (0 to 1)
      const totalDist = viewHeight + rect.height;
      const scrolledDist = viewHeight - rect.top;
      const progress = Math.max(0, Math.min(1, scrolledDist / totalDist));
      
      // Calculate excess height dynamically based on actual element clientHeights in pixels.
      // This is extremely robust and handles desktop/mobile size differences automatically.
      const containerHeight = parallaxContainer.clientHeight;
      const bgHeight = parallaxBg.clientHeight;
      const maxOffset = Math.max(0, bgHeight - containerHeight);
      
      const yOffset = -progress * maxOffset;
      
      parallaxBg.style.transform = `translate3d(0, ${yOffset}px, 0)`;
    }
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(updateParallax);
      ticking = true;
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateParallax);
      ticking = true;
    }
  });
  
  // Initial run
  updateParallax();
}

// ---------------- SCROLL DIVIDER ANIMATION ----------------
function initScrollDivider() {
  const containers = document.querySelectorAll('.scroll-divider-container');
  if (!containers.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const divider = entry.target.querySelector('.scroll-divider-line');
        if (divider) {
          divider.classList.add('active');
        }
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1
  });

  containers.forEach(container => {
    observer.observe(container);
  });
}

// ---------------- PUBLIC LANDING PAGE (INDEX) ----------------
async function initPublicLanding() {
  initParallax();
  initScrollDivider();
  const video = document.querySelector('.hero-video-bg');
  const heroContent = document.querySelector('.hero-content');
  const isMobileInit = window.innerWidth <= 768;
  let hasAnimatedHeroMobile = false;

  if (video) {
    video.playbackRate = 0.65;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.classList.remove('video-ended');
    video.loop = false;
    
    // Prepare initial position of text on startup (desktop only)
    if (!isMobileInit && heroContent) {
      heroContent.classList.add('prepare-text');
    }
    
    let hasFadedInText = false;
    let hasZoomedText = false;
    let hasFadedOutText = false;
    let hasFadedOutVideo = false;

    const revealVideo = () => video.classList.remove('video-ended');
    video.addEventListener('playing', revealVideo);
    video.addEventListener('canplay', revealVideo);
    video.addEventListener('loadeddata', revealVideo);
    setTimeout(revealVideo, 300);

    const startPlay = video.play();
    if (startPlay !== undefined) {
      startPlay.then(revealVideo).catch(() => revealVideo());
    }
    
    // Fade in on first play and reset flags at loop start
    video.addEventListener('play', () => {
      video.classList.remove('video-ended');
      if (video.currentTime < 1) {
        hasFadedInText = false;
        hasZoomedText = false;
        hasFadedOutText = false;
        hasFadedOutVideo = false;
      }
      
      // Mobilon a videó indulásakor indítjuk a szövegek késleltetett beúszását (csak egyszer fut le)
      const isMobile = window.innerWidth <= 768;
      if (isMobile && heroContent && !hasAnimatedHeroMobile) {
        hasAnimatedHeroMobile = true;
        heroContent.classList.remove('visible-title', 'visible-text');
        
        setTimeout(() => {
          heroContent.classList.add('visible-title');
        }, 500); // 500ms a címnek
        
        setTimeout(() => {
          heroContent.classList.add('visible-text');
        }, 1300); // további 800ms (összesen 1300ms) a leírásnak
      }
    });
    
    // Listen to timeupdate to trigger text fade-in, grow zoom, and video fade-out before the end
    video.addEventListener('timeupdate', () => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) return; // Mobilon ne animáljuk a szöveg ki/be áttűnését lejátszás közben
 
      // 1. Text fade-in (5 seconds before end)
      if (video.duration && (video.duration - video.currentTime <= 5)) {
        if (!hasFadedInText) {
          hasFadedInText = true;
          if (heroContent) {
            heroContent.classList.remove('prepare-text'); // Remove Y=80px translate reset
            heroContent.classList.add('visible-title');
            heroContent.classList.add('visible-text');
          }
        }
      }
      
      // 2. Text grow zoom (4.2 seconds before end)
      if (video.duration && (video.duration - video.currentTime <= 4.2)) {
        if (!hasZoomedText) {
          hasZoomedText = true;
          if (heroContent) {
            heroContent.classList.add('grow');
          }
        }
      }
 
      // 3. Video fade-out to black (1.8 seconds before end, only on desktop)
      if (!isMobile && video.duration && (video.duration - video.currentTime <= 1.8)) {
        if (!hasFadedOutVideo) {
          hasFadedOutVideo = true;
          video.classList.add('video-ended');
        }
      }
 
      // 4. Title (h1) fade-out (0.5 seconds before end, only on desktop)
      if (!isMobile && video.duration && (video.duration - video.currentTime <= 0.5)) {
        if (!hasFadedOutText) {
          hasFadedOutText = true;
          if (heroContent) {
            heroContent.classList.remove('visible-title');
          }
        }
      }
    });
    
    video.addEventListener('ended', () => {
      const isMobile = window.innerWidth <= 768;
      
      if (isMobile) {
        // Mobile loop: restart immediately with fade-in and keep text visible
        video.classList.add('no-transition');
        video.classList.add('video-ended'); // Set opacity to 0 instantly
        video.currentTime = 0;
        
        // Force reflow
        video.offsetHeight;
        
        video.classList.remove('no-transition');
        video.play().then(() => {
          video.classList.remove('video-ended'); // Smooth fade-in
        }).catch(err => {
          console.log("Video autoplay loop error:", err);
          video.classList.remove('video-ended');
        });
      } else {
        // Desktop loop: fade to black, wait 500ms, then restart
        video.classList.add('video-ended');
        
        setTimeout(() => {
          video.currentTime = 0;
          video.classList.remove('video-ended');
          video.play().catch(err => console.log("Video autoplay loop error:", err));
          
          // Remove paragraph class 2200 ms after video starts playing!
          // This makes the text stay visible significantly longer for better readability
          setTimeout(() => {
            if (heroContent) {
              heroContent.classList.remove('visible-text');
              // Delay removing grow class and resetting translateY position until the slow 2.4s fade-out is completely finished
              setTimeout(() => {
                heroContent.classList.remove('grow');
                heroContent.classList.add('prepare-text'); // Instantly reset translateY to 80px while invisible
              }, 2500);
            }
          }, 2200);
        }, 500);
      }
    });
  }
  try {
    const res = await fetch('/api/locations');
    if (!res.ok) throw new Error('Hiba a helyszínek betöltésekor');
    const locations = await res.json();

    const container = document.getElementById('public-locations-grid');
    if (!container) return;

    container.innerHTML = '';
    
    // Setup date picker to default to today
    const dateInput = document.getElementById('public-schedule-date');
    if (dateInput) {
      const today = new Date().toISOString().split('T')[0];
      dateInput.value = today;
      dateInput.min = today;
      
      // Load schedules when date changes
      dateInput.addEventListener('change', () => loadPublicSchedules(locations, dateInput.value));
      
      // Load initial
      loadPublicSchedules(locations, today);
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadPublicSchedules(locations, date) {
  const container = document.getElementById('public-locations-grid');
  if (!container) return;
  
  container.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Órarendek lekérdezése...</p>';

  let html = '';
  
  for (const loc of locations) {
    try {
      // If user is not logged in, we fetch a public variant or fetch with empty headers (the server requires login for schedules to know if user booked it. Wait, let's check: the server /api/schedule uses authenticateToken middleware. So public users must be prompted to log in to see schedules or see live capacity!)
      // Wait, let's look at the server.js: app.get('/api/schedule', authenticateToken, ...)
      // Since it requires authentication, we will try to fetch if we have a token. If we don't, we will display a premium teaser card inviting them to register/login to view and book, or we bypass auth? Let's check: if not logged in, we can fetch, but we might get 401. Let's make sure it handles 401 elegantly and tells the user: "Bejelentkezés szükséges az órarend megtekintéséhez!"
      const token = localStorage.getItem('token');
      
      if (!token) {
        html += `
          <div class="glass-card location-card">
            <h3 class="location-title">${loc.name}</h3>
            <p class="location-address">${loc.address}</p>
            <div style="text-align: center; padding: 20px 0;">
              <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 15px;">Órarend megtekintéséhez és időpont foglaláshoz kérjük regisztrálj vagy jelentkezz be!</p>
              <a href="auth.html" class="btn btn-primary btn-sm">Belépés az órarendhez</a>
            </div>
          </div>
        `;
        continue;
      }

      const res = await fetch(`/api/schedule?locationId=${loc.id}&date=${date}`, {
        headers: getAuthHeaders()
      });
      
      if (!res.ok) throw new Error();
      const slots = await res.json();
      
      let slotsHtml = '';
      if (slots.length === 0) {
        slotsHtml = '<p style="color:var(--text-muted); font-size: 13px;">Nincs elérhető időpont ezen a napon.</p>';
      } else {
        slots.forEach(slot => {
          const ratio = slot.booked_count / slot.max_capacity;
          let progressClass = '';
          let occupancyText = 'Szabad';
          if (ratio >= 1.0) {
            progressClass = 'high';
            occupancyText = 'Telt ház';
          } else if (ratio >= 0.7) {
            progressClass = 'medium';
            occupancyText = 'Zsúfolt';
          }
          
          slotsHtml += `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; padding: 8px 12px; background: rgba(255,255,255,0.01); border-radius: 8px; border: 1px solid rgba(255,255,255,0.02)">
              <span style="font-weight:600; font-family:'Montserrat'; font-size:14px;">${slot.start_time} - ${slot.end_time}</span>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
                <span class="occupancy-text" style="font-size:11px;">${slot.booked_count}/${slot.max_capacity} fő (${occupancyText})</span>
                <div class="progress-bar-bg" style="width: 80px; height: 4px;">
                  <div class="progress-bar-fill ${progressClass}" style="width: ${ratio * 100}%;"></div>
                </div>
              </div>
            </div>
          `;
        });
      }

      html += `
        <div class="glass-card location-card">
          <h3 class="location-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--primary);"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
            ${loc.name}
          </h3>
          <p class="location-address">${loc.address}</p>
          <h4 style="font-size: 13px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 12px; letter-spacing: 0.05em;">Idősávok kapacitása</h4>
          <div class="schedule-list-mini">
            ${slotsHtml}
          </div>
          ${token ? `<div style="margin-top: 20px; text-align: right;"><a href="dashboard.html" class="btn btn-secondary btn-sm" style="width: 100%;">Foglalás kezelése →</a></div>` : ''}
        </div>
      `;
    } catch (err) {
      html += `
        <div class="glass-card location-card">
          <h3 class="location-title">${loc.name}</h3>
          <p style="color: var(--danger); font-size: 13px;">Nem sikerült betölteni az órarendet.</p>
        </div>
      `;
    }
  }
  
  container.innerHTML = html;
}

// Helper to check if a booking has expired (i.e. slot end time has passed) in Europe/Budapest timezone
function isBookingExpired(bookingDateStr, endTimeStr) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find(p => p.type === type).value;
  
  const curYear = getPart('year');
  const curMonth = getPart('month');
  const curDay = getPart('day');
  const curHour = getPart('hour');
  const curMin = getPart('minute');
  
  const currentBudapestStr = `${curYear}-${curMonth}-${curDay}T${curHour}:${curMin}`;
  const bookingBudapestStr = `${bookingDateStr}T${endTimeStr}`;
  
  return currentBudapestStr > bookingBudapestStr;
}

// ---------------- CLIENT DASHBOARD (DASHBOARD) ----------------
async function initDashboard() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = 'auth.html';
    return;
  }

  await checkBarionCallback(); // Verify transaction if returning from Barion checkout
  await loadProfileAndDashboard();
}

async function loadProfileAndDashboard() {
  try {
    const res = await fetch('/api/auth/profile', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      logout();
      return;
    }
    if (!res.ok) throw new Error('Hiba a profil betöltésekor');
    
    const data = await res.json();
    const { user, tickets, bookings, logs } = data;
    
    const urlParams = new URLSearchParams(window.location.search);
    const forceParam = urlParams.get('forceChangePassword') === 'true';
    if (user.must_change_password === 1 || forceParam) {
      window.forcedPasswordChangeMode = true;
      setTimeout(() => {
        switchDashboardView('password');
        const tabBar = document.getElementById('dashboard-tab-bar');
        const forceWarning = document.getElementById('password-force-warning');
        if (tabBar) tabBar.style.display = 'none';
        if (forceWarning) forceWarning.style.display = 'block';
      }, 50);
    } else {
      window.forcedPasswordChangeMode = false;
    }
    
    // Save data to window for tab switching
    window.dashboardTickets = tickets;
    window.dashboardBookings = bookings;
    window.dashboardLogs = logs;
    
    // Save count of active tickets
    const todayStr = new Date().toISOString().split('T')[0];
    window.activeTicketsCount = tickets.filter(t => t.status === 'ACTIVE' && t.expires_date >= todayStr).length;
    
    // Save/update local storage user details
    localStorage.setItem('user', JSON.stringify(user));

    // Render profile card
    const profileEl = document.getElementById('user-profile-info');
    if (profileEl) {
      const tooltipText = user.card_type === 'ZÖLD' ? 
        'Sikeres mászóvizsgával rendelkezik, önállóan biztosíthatja társát a falon.' : 
        'Nem rendelkezik mászóvizsgával. Biztosítóként nem tevékenykedhet, kizárólag önbiztosítóval vagy zöld kártyás kísérővel mászhat.';
      const roleBadgeHtml = user.role !== 'USER' ? `<span class="badge badge-secondary" style="margin-left:8px;">Szerep: ${user.role}</span>` : '';

      profileEl.innerHTML = `
        <div class="avatar">🧗</div>
        <div class="profile-details">
          <h3>${user.name}</h3>
          <p style="margin-bottom: 8px;">E-mail: ${user.email} | Telefon: ${user.phone}</p>
          <div>
            <span class="badge ${user.card_type === 'ZÖLD' ? 'badge-green' : 'badge-red'}" data-tooltip="${tooltipText}">
              ${user.card_type} KÁRTYA (${user.card_type === 'ZÖLD' ? 'Biztosíthat' : 'NEM biztosíthat'})
            </span>
            ${user.license_number ? `<span class="badge badge-secondary" style="margin-left:8px;">Engedély: ${user.license_number}</span>` : ''}
            ${roleBadgeHtml}
          </div>
        </div>
      `;
    }

    // Render entry logs history
    const logsContainer = document.getElementById('dashboard-entry-logs');
    if (logsContainer) {
      logsContainer.innerHTML = '';
      if (!logs || logs.length === 0) {
        logsContainer.innerHTML = '<p style="color:var(--text-muted); font-size: 13px;">Még nincsenek belépési előzményeid.</p>';
      } else {
        logs.forEach(log => {
          let ticketLabel = '';
          if (log.ticket_type === 'NAPI') ticketLabel = 'Napijegy';
          else if (log.ticket_type === 'TIZ_ALKALMAS') ticketLabel = '10 alk. bérlet';
          else if (log.ticket_type === 'HAVI') ticketLabel = 'Havi bérlet';

          const formattedTime = log.scan_time ? log.scan_time.substring(0, 16).replace('T', ' ') : '-';
          const statusIcon = log.status === 'SUCCESS' ? '✅' : '❌';

          const logDiv = document.createElement('div');
          logDiv.style.background = 'rgba(255, 255, 255, 0.01)';
          logDiv.style.border = '1px solid var(--border-color)';
          logDiv.style.borderRadius = '8px';
          logDiv.style.padding = '10px 12px';
          logDiv.style.fontSize = '12px';

          logDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
              <span style="font-weight: 600; color: #fff;">${statusIcon} ${ticketLabel}</span>
              <span style="color: var(--text-muted); font-size: 11px;">${formattedTime}</span>
            </div>
            <div style="color: var(--text-secondary); line-height: 1.3;">
              Helyszín: <strong>${log.location_name || 'Ismeretlen'}</strong><br>
              <span style="font-size: 11px; color: ${log.status === 'SUCCESS' ? 'var(--success)' : 'var(--danger)'};">${log.message}</span>
            </div>
          `;
          logsContainer.appendChild(logDiv);
        });
      }
    }

    // Call tab-based render functions
    renderDashboardTickets(window.currentTicketTab || 'active');
    renderDashboardBookings(window.currentBookingTab || 'upcoming');

    // Initialize locations dynamic dropdown for Booking
    const locSelect = document.getElementById('booking-location');
    if (locSelect && locSelect.options.length <= 1) {
      const locRes = await fetch('/api/locations');
      const locations = await locRes.json();
      locations.forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc.id;
        opt.textContent = loc.name;
        locSelect.appendChild(opt);
      });

      // Bind listener
      locSelect.addEventListener('change', loadBookingSchedules);
      const bookingDate = document.getElementById('booking-date');
      if (bookingDate) {
        const todayObj = new Date();
        const today = todayObj.toISOString().split('T')[0];
        
        // Max date is 3 weeks (21 days) from today
        const maxDateObj = new Date();
        maxDateObj.setDate(todayObj.getDate() + 21);
        const maxDate = maxDateObj.toISOString().split('T')[0];
        
        bookingDate.value = today;
        bookingDate.min = today;
        bookingDate.max = maxDate;
        bookingDate.addEventListener('change', loadBookingSchedules);
      }
    }

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Render tickets by tab
function renderDashboardTickets(filter) {
  window.currentTicketTab = filter;
  const tickets = window.dashboardTickets || [];
  const ticketsContainer = document.getElementById('dashboard-tickets');
  if (!ticketsContainer) return;

  // Update tab button styles
  const activeBtn = document.getElementById('ticket-tab-active');
  const expiredBtn = document.getElementById('ticket-tab-expired');
  if (activeBtn && expiredBtn) {
    if (filter === 'active') {
      activeBtn.className = 'btn btn-primary btn-sm';
      expiredBtn.className = 'btn btn-secondary btn-sm';
    } else {
      activeBtn.className = 'btn btn-secondary btn-sm';
      expiredBtn.className = 'btn btn-primary btn-sm';
    }
  }

  const today = new Date().toISOString().split('T')[0];
  
  const filteredTickets = tickets.filter(t => {
    const isExpired = t.expires_date < today;
    const isActive = t.status === 'ACTIVE' && !isExpired;
    return filter === 'active' ? isActive : !isActive;
  });

  // Sort
  if (filter === 'expired') {
    // expired/used: purchase_date ASC (chronological)
    filteredTickets.sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));
  } else {
    // active: purchase_date DESC (newest first)
    filteredTickets.sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));
  }

  if (filteredTickets.length === 0) {
    ticketsContainer.innerHTML = filter === 'active' 
      ? '<p style="color:var(--text-muted);">Nincsenek érvényes jegyeid vagy bérleteid.</p>'
      : '<p style="color:var(--text-muted);">Nincsenek lejárt vagy felhasznált jegyeid.</p>';
    return;
  }

  ticketsContainer.innerHTML = '';
  filteredTickets.forEach(t => {
    let hungarianType = '';
    let usageText = '';
    if (t.ticket_type === 'NAPI') {
      hungarianType = 'Egyszeri Napijegy';
      usageText = t.status === 'USED' ? 'Felhasználva' : 'Még nem használt (1 alkalom)';
    } else if (t.ticket_type === 'TIZ_ALKALMAS') {
      hungarianType = '10 Alkalmas Bérlet';
      usageText = `Fennmaradó alkalmak: ${t.sessions_remaining}/10`;
    } else if (t.ticket_type === 'HAVI') {
      hungarianType = '30 Napos Korlátlan Bérlet';
      usageText = 'Korlátlan belépés érvényességi időn belül';
    }

    const ticketCard = document.createElement('div');
    ticketCard.className = 'ticket-item';

    const isExpired = t.expires_date < today;
    let statusLabelClass = 'badge-green';
    let statusText = 'Aktív';
    if (t.status === 'USED') {
      statusLabelClass = 'badge-secondary';
      statusText = 'Felhasznált';
    } else if (t.status === 'EXPIRED' || isExpired) {
      statusLabelClass = 'badge-red';
      statusText = 'Lejárt';
    }

    let qrSectionHtml = '';
    if (t.status === 'ACTIVE' && !isExpired) {
      qrSectionHtml = `
        <div class="ticket-qr-container">
          <div class="qr-large-trigger" onclick="openQRModal('${t.qr_code_uuid}', '${hungarianType}')" title="Kattints a QR kód nagyításához">
            <div id="large-qr-${t.id}" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;"></div>
          </div>
        </div>
      `;
      setTimeout(() => {
        const largeDiv = document.getElementById(`large-qr-${t.id}`);
        if (largeDiv) {
          if (typeof qrcode !== 'undefined' && qrcode && typeof qrcode.toDataURL === 'function') {
            const qrUrl = window.location.origin + '/scanner.html?uuid=' + t.qr_code_uuid;
            qrcode.toDataURL(qrUrl, { width: 100, margin: 1 }, (err, url) => {
              if (!err) largeDiv.innerHTML = `<img src="${url}" alt="QR" />`;
            });
          } else {
            largeDiv.innerHTML = '<span style="font-size:10px;color:var(--danger);">Nincs QR generátor</span>';
          }
        }
      }, 50);
    } else {
      qrSectionHtml = `
        <div class="ticket-qr-container">
          <div class="qr-placeholder-expired" title="Nem aktív jegy">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted); opacity: 0.5;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
        </div>
      `;
    }

    const purchaseTime = new Date(t.purchase_date).getTime();
    const nowTime = new Date().getTime();
    const timeDiffMs = nowTime - purchaseTime;
    const diffDays = timeDiffMs / (1000 * 3600 * 24);
    
    let withdrawalBtnHtml = '';
    if (t.status === 'ACTIVE') {
      if (diffDays <= 14) {
        withdrawalBtnHtml = `
          <a href="withdrawal.html?id=${t.id}" class="btn btn-secondary btn-sm" style="padding: 10px 15px; width: fit-content; color: var(--danger); border-color: rgba(239, 68, 68, 0.2);">
            Elállás a szerződéstől
          </a>
        `;
      } else {
        withdrawalBtnHtml = `
          <a href="#" onclick="event.preventDefault()" class="btn btn-secondary btn-sm has-tooltip" style="padding: 10px 15px; width: fit-content; color: var(--text-muted); border-color: rgba(255, 255, 255, 0.1); cursor: not-allowed; opacity: 0.5;" data-tooltip="Az elállási határidő (14 nap) lejárt. Online elállásra már nincs lehetőség ehhez a jegyhez/bérlethez.">
            Elállás a szerződéstől
          </a>
        `;
      }
    }

          const purchaseDisplay = t.purchase_date ? new Date(t.purchase_date).toLocaleString('hu-HU') : '-';
          ticketCard.innerHTML = `
            <div class="ticket-info">
              <div class="ticket-info-details">
                <h4 style="display:flex; align-items:center; gap: 10px; flex-wrap: wrap;">
                  ${hungarianType} 
                  <span class="badge ${statusLabelClass}" style="font-size:9px; padding:3px 8px;">${statusText}</span>
                </h4>
                <p style="margin-top: 4px;">${usageText}</p>
                <p class="ticket-dates" style="margin-top:4px; font-size:11px; color:var(--text-muted);">Vásárlás: ${purchaseDisplay} | Lejárat: ${t.expires_date}</p>
              </div>
        <div style="margin-top: auto; padding-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
          <button onclick="downloadRulesPDF(${t.id})" class="btn btn-secondary btn-sm" style="padding: 10px 15px; width: fit-content;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            PDF jegy & szabályzat
          </button>
          ${withdrawalBtnHtml}
        </div>
      </div>
      ${qrSectionHtml}
    `;
    ticketsContainer.appendChild(ticketCard);
  });
}

// Render bookings by tab
function renderDashboardBookings(filter) {
  window.currentBookingTab = filter;
  const bookings = window.dashboardBookings || [];
  const bookingsContainer = document.getElementById('dashboard-bookings');
  if (!bookingsContainer) return;

  // Update tab button styles
  const upcomingBtn = document.getElementById('booking-tab-upcoming');
  const pastBtn = document.getElementById('booking-tab-past');
  if (upcomingBtn && pastBtn) {
    if (filter === 'upcoming') {
      upcomingBtn.className = 'btn btn-primary btn-sm';
      pastBtn.className = 'btn btn-secondary btn-sm';
    } else {
      upcomingBtn.className = 'btn btn-secondary btn-sm';
      pastBtn.className = 'btn btn-primary btn-sm';
    }
  }

  // Filter bookings
  const filteredBookings = bookings.filter(b => {
    const isExpired = isBookingExpired(b.booking_date, b.end_time);
    return filter === 'upcoming' ? !isExpired : isExpired;
  });

  // Sort
  // chronological order: ASC
  filteredBookings.sort((a, b) => {
    const dateComp = a.booking_date.localeCompare(b.booking_date);
    if (dateComp !== 0) return dateComp;
    return a.start_time.localeCompare(b.start_time);
  });

  if (filteredBookings.length === 0) {
    bookingsContainer.innerHTML = filter === 'upcoming' 
      ? '<p style="color:var(--text-muted);">Nincsenek aktív helyfoglalásaid.</p>'
      : '<p style="color:var(--text-muted);">Nincsenek korábbi helyfoglalásaid.</p>';
    return;
  }

  bookingsContainer.innerHTML = '';
  filteredBookings.forEach(b => {
    const item = document.createElement('div');
    item.className = 'schedule-item';
    item.style.padding = '15px 20px';
    
    const isExpired = isBookingExpired(b.booking_date, b.end_time);
    const isAttended = b.attended > 0;
    
    let actionButtonHtml = '';
    if (isExpired) {
      actionButtonHtml = `<button class="btn btn-secondary btn-sm" disabled style="opacity: 0.5; cursor: not-allowed;">Lejárt</button>`;
    } else if (isAttended) {
      actionButtonHtml = `<button class="btn btn-secondary btn-sm" disabled style="opacity: 0.5; cursor: not-allowed;">Megjelent</button>`;
    } else {
      actionButtonHtml = `<button onclick="cancelBooking(${b.booking_id})" class="btn btn-danger btn-sm">Lemondás</button>`;
    }
    
    item.innerHTML = `
      <div>
        <h4 style="font-size: 16px; margin-bottom: 4px;">${b.location_name}</h4>
        <p style="font-size: 13px; color: var(--text-secondary);">
          Időpont: <strong>${b.booking_date}</strong> | <strong>${b.start_time} - ${b.end_time}</strong>
        </p>
      </div>
      ${actionButtonHtml}
    `;
    bookingsContainer.appendChild(item);
  });
}

function switchTicketTab(filter) {
  renderDashboardTickets(filter);
}

function switchBookingTab(filter) {
  renderDashboardBookings(filter);
}

// Open QR Modal
function openQRModal(uuid, title) {
  const backdrop = document.getElementById('qr-modal-backdrop');
  const qrContainer = document.getElementById('modal-qr-code');
  const modalTitle = document.getElementById('modal-ticket-title');
  if (!backdrop || !qrContainer || !modalTitle) return;

  modalTitle.textContent = title;
  qrContainer.innerHTML = 'QR kód generálása...';
  
  if (typeof qrcode !== 'undefined' && qrcode && typeof qrcode.toDataURL === 'function') {
    const qrUrl = window.location.origin + '/scanner.html?uuid=' + uuid;
    qrcode.toDataURL(qrUrl, { width: 250, margin: 1 }, (err, url) => {
      if (!err) {
        qrContainer.innerHTML = `<img src="${url}" alt="QR Code" />`;
      } else {
        qrContainer.innerHTML = 'Sikertelen QR kód generálás';
      }
    });
  } else {
    qrContainer.innerHTML = '<span style="color:var(--danger);font-size:13px;">Hiba: A QR kód generáló könyvtár nem töltődött be. Ellenőrizd a hálózatot!</span>';
  }

  backdrop.classList.add('open');
}

function closeQRModal() {
  const backdrop = document.getElementById('qr-modal-backdrop');
  if (backdrop) backdrop.classList.remove('open');
}

function openNoTicketModal() {
  const backdrop = document.getElementById('no-ticket-modal-backdrop');
  if (backdrop) backdrop.classList.add('open');
}

function closeNoTicketModal() {
  const backdrop = document.getElementById('no-ticket-modal-backdrop');
  if (backdrop) backdrop.classList.remove('open');
}

// Download PDF
async function downloadRulesPDF(ticketId) {
  try {
    showToast('Szabályzat PDF generálása folyamatban...', 'info');
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/tickets/${ticketId}/rules-pdf`, {
      method: 'GET',
      headers: {
        'Authorization': token ? `Bearer ${token}` : ''
      }
    });

    // Check content type – if not PDF, extract the error message
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/pdf')) {
      let errMsg = 'Nem sikerült a PDF generálása.';
      try {
        const errJson = await res.json();
        errMsg = errJson.error || errMsg;
      } catch (_) {
        errMsg = await res.text().catch(() => errMsg);
      }
      throw new Error(errMsg);
    }

    const blob = await res.blob();
    const pdfBlob = new Blob([blob], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `HawkStone_Jegy_${ticketId}.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      window.URL.revokeObjectURL(url);
    }, 200);
    showToast('PDF sikeresen letöltve!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Check and verify Barion payment returning from gateway
async function checkBarionCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const paymentId = urlParams.get('paymentId');
  if (!paymentId) return;

  // Create loading overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '99999';
  overlay.innerHTML = `
    <div class="glass-card" style="padding: 40px; text-align: center; max-width: 400px; width: 90%;">
      <div class="spinner" style="margin: 0 auto 20px auto; width: 50px; height: 50px; border: 5px solid rgba(255,255,255,0.1); border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <h3 style="margin-bottom: 10px; color: var(--primary);">Fizetés ellenőrzése...</h3>
      <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.6;">Ellenőrizzük a tranzakciót a Barion rendszerében. Kérjük, ne zárd be az ablakot!</p>
    </div>
  `;
  document.body.appendChild(overlay);

  // Add css keyframe animation for spinner if not present
  if (!document.getElementById('spin-keyframe-style')) {
    const style = document.createElement('style');
    style.id = 'spin-keyframe-style';
    style.innerHTML = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  try {
    const res = await fetch('/api/barion/verify-payment', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ paymentId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sikertelen fizetésellenőrzés');

    showToast('Sikeres fizetés! A jegyet és a QR kódot kiállítottuk.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    // Remove overlay
    overlay.remove();
    // Clean URL query parameters so page refresh doesn't trigger verification again
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: newUrl }, '', newUrl);
  }
}

// Global storage for checkout flow
window.selectedTicketType = null;

// Close Billing Modal
function closeBillingModal() {
  const form = document.getElementById('billing-form');
  if (form) form.reset();
  const checkbox = document.getElementById('immediate-commencement');
  if (checkbox) checkbox.checked = false;
  const modal = document.getElementById('billing-modal-backdrop');
  if (modal) modal.classList.remove('open');
}

// Handle Billing Form Submit
async function handleBillingSubmit(event) {
  event.preventDefault();
  
  const billingName = document.getElementById('billing-name').value.trim();
  const billingZip = document.getElementById('billing-zip').value.trim();
  const billingCity = document.getElementById('billing-city').value.trim();
  const billingAddress = document.getElementById('billing-address').value.trim();
  const billingTaxNumber = document.getElementById('billing-tax-number').value.trim();
  const immediateCheckbox = document.getElementById('immediate-commencement');

  if (immediateCheckbox && !immediateCheckbox.checked) {
    showToast('A szolgáltatás azonnali megkezdéséhez el kell fogadnod a nyilatkozatot!', 'error');
    return;
  }

  if (!billingName || !billingZip || !billingCity || !billingAddress) {
    showToast('Kérjük, minden kötelező számlázási mezőt tölts ki!', 'error');
    return;
  }

  // Store pending payment data in window
  window.pendingPaymentData = {
    billingName,
    billingZip,
    billingCity,
    billingAddress,
    billingTaxNumber
  };

  // Close the main billing modal first
  closeBillingModal();

  // Check if billing details are already saved in user profile
  const userJson = localStorage.getItem('user');
  let hasSavedBilling = false;
  if (userJson) {
    try {
      const user = JSON.parse(userJson);
      // We check if billing_name and billing_address are present
      if (user.billing_name && user.billing_address) {
        hasSavedBilling = true;
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (!hasSavedBilling) {
    // Show confirmation modal to ask if they want to save details
    const confirmModal = document.getElementById('confirm-save-billing-modal-backdrop');
    if (confirmModal) {
      confirmModal.classList.add('open');
    } else {
      // If modal doesn't exist, fallback to direct payment start
      await handleSaveBillingResponse(false);
    }
  } else {
    // Already has saved billing, proceed directly to Barion
    await handleSaveBillingResponse(false);
  }
}

// Close Confirm Save Billing Modal
function closeConfirmSaveBillingModal() {
  const modal = document.getElementById('confirm-save-billing-modal-backdrop');
  if (modal) modal.classList.remove('open');
}

// Handle Save Billing Dialog Response
async function handleSaveBillingResponse(save) {
  closeConfirmSaveBillingModal();

  const paymentData = window.pendingPaymentData;
  if (!paymentData) return;

  if (save) {
    try {
      // Save billing details in the database via API
      const res = await fetch('/api/auth/billing', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          billingName: paymentData.billingName,
          billingZip: paymentData.billingZip,
          billingCity: paymentData.billingCity,
          billingAddress: paymentData.billingAddress,
          billingTaxNumber: paymentData.billingTaxNumber
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Mentési hiba');
      
      // Update local storage user profile cache
      const userJson = localStorage.getItem('user');
      if (userJson) {
        const user = JSON.parse(userJson);
        user.billing_name = paymentData.billingName;
        user.billing_zip = paymentData.billingZip;
        user.billing_city = paymentData.billingCity;
        user.billing_address = paymentData.billingAddress;
        user.billing_tax_number = paymentData.billingTaxNumber;
        localStorage.setItem('user', JSON.stringify(user));
      }
      showToast('Számlázási adatok elmentve!', 'success');
    } catch (err) {
      console.error('Error saving billing details:', err);
      showToast('Nem sikerült elmenteni a számlázási adatokat: ' + err.message, 'error');
    }
  }

  // Proceed with initiating Barion payment
  try {
    showToast('Fizetés kezdeményezése a Barion rendszerében...', 'info');
    const res = await fetch('/api/barion/start-payment', {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ticketType: window.selectedTicketType,
        billingName: paymentData.billingName,
        billingZip: paymentData.billingZip,
        billingCity: paymentData.billingCity,
        billingAddress: paymentData.billingAddress,
        billingTaxNumber: paymentData.billingTaxNumber
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fizetés indítási hiba');

    // Redirect user to secure Barion Gateway page
    window.location.href = data.GatewayUrl;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Buy Ticket (Opens Billing Modal first)
function buyTicket(ticketType) {
  window.selectedTicketType = ticketType;
  
  // Try to pre-fill user name and billing details from local storage details
  const userJson = localStorage.getItem('user');
  if (userJson) {
    try {
      const user = JSON.parse(userJson);
      const nameInput = document.getElementById('billing-name');
      const zipInput = document.getElementById('billing-zip');
      const cityInput = document.getElementById('billing-city');
      const addressInput = document.getElementById('billing-address');
      const taxInput = document.getElementById('billing-tax-number');

      if (nameInput) nameInput.value = user.billing_name || user.name || '';
      if (zipInput) zipInput.value = user.billing_zip || '';
      if (cityInput) cityInput.value = user.billing_city || '';
      if (addressInput) addressInput.value = user.billing_address || '';
      if (taxInput) taxInput.value = user.billing_tax_number || '';
    } catch (e) {
      console.error('Error pre-filling billing details:', e);
    }
  }

  // Open billing modal
  const modal = document.getElementById('billing-modal-backdrop');
  if (modal) {
    modal.classList.add('open');
  } else {
    // Fallback if modal not present (e.g. on other pages)
    showToast('Nem található számlázási modal!', 'error');
  }
}

// Load Slots for Booking Selector
async function loadBookingSchedules() {
  const locationId = document.getElementById('booking-location').value;
  const date = document.getElementById('booking-date').value;
  const container = document.getElementById('booking-slots-container');
  
  if (!locationId || !date || !container) return;

  container.innerHTML = '<p style="color:var(--text-muted);">Idősávok betöltése...</p>';

  try {
    const res = await fetch(`/api/schedule?locationId=${locationId}&date=${date}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error();
    const slots = await res.json();

    container.innerHTML = '';
    if (slots.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);">Nincs elérhető időpont ezen a napon.</p>';
      return;
    }

    slots.forEach(slot => {
      const item = document.createElement('div');
      item.className = 'schedule-item';
      if (slot.is_past) {
        item.style.opacity = '0.5';
      }
      
      const ratio = slot.booked_count / slot.max_capacity;
      const isFull = ratio >= 1.0;
      
      let progressClass = '';
      let occupancyText = 'Szabad';
      if (isFull) {
        progressClass = 'high';
        occupancyText = 'Betelt (Telt ház)';
      } else if (ratio >= 0.7) {
        progressClass = 'medium';
        occupancyText = 'Zsúfolt';
      }

      let btnHtml = '';
      if (slot.is_past) {
        btnHtml = `<button class="btn btn-secondary btn-sm btn-disabled" disabled>Elmúlt</button>`;
      } else if (slot.user_booked) {
        btnHtml = `<button class="btn btn-secondary btn-sm btn-disabled" disabled>Foglaltad</button>`;
      } else if (isFull) {
        btnHtml = `<button class="btn btn-secondary btn-sm btn-disabled" disabled>Betelt</button>`;
      } else {
        btnHtml = `<button onclick="bookSlot(${slot.id}, '${date}')" class="btn btn-primary btn-sm">Foglalás</button>`;
      }

      item.innerHTML = `
        <div>
          <span class="schedule-time">${slot.start_time} - ${slot.end_time}</span>
          <div class="schedule-occupancy" style="margin-top: 8px;">
            <span class="occupancy-text">${slot.booked_count}/${slot.max_capacity} hely foglalt (${occupancyText})</span>
            <div class="progress-bar-bg" style="width: 150px;">
              <div class="progress-bar-fill ${progressClass}" style="width: ${ratio * 100}%;"></div>
            </div>
          </div>
        </div>
        ${btnHtml}
      `;
      container.appendChild(item);
    });
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger);">Hiba az idősávok betöltésekor.</p>';
  }
}

// Perform Booking
async function bookSlot(slotId, date) {
  // Check if user has active ticket
  if (!window.activeTicketsCount || window.activeTicketsCount <= 0) {
    openNoTicketModal();
    return;
  }

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ slotId, date })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Foglalási hiba');

    showToast('Sikeres foglalás!');
    loadProfileAndDashboard();
    loadBookingSchedules();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Cancel Booking
async function cancelBooking(bookingId) {
  const confirmed = await showConfirmModal({
    title: 'Foglalás lemondása',
    message: 'Biztosan lemondod ezt a foglalást?',
    confirmText: 'Lemondás',
    cancelText: 'Mégse',
    variant: 'danger'
  });
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lemondási hiba');

    showToast('Foglalás lemondva!');
    loadProfileAndDashboard();
    const loc = document.getElementById('booking-location');
    if (loc && loc.value) loadBookingSchedules();
  } catch (err) {
    showToast(err.message, 'error');
    showAlertModal(err.message || 'Nem sikerült lemondani a foglalást.', 'Lemondási hiba');
  }
}

// ---------------- STAFF QR SCANNER (SCANNER) ----------------
let html5QrCode = null;
let lastScannedUuid = null;

function startCameraScanner() {
  if (html5QrCode) return;
  
  const cameraCard = document.getElementById('scanner-camera-card');
  if (cameraCard) cameraCard.style.display = 'block';

  try {
    if (typeof Html5Qrcode !== 'undefined') {
      html5QrCode = new Html5Qrcode("qr-reader-viewport");
      
      const config = { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      };

      html5QrCode.start(
        { facingMode: "environment" }, 
        config,
        onScanSuccess,
        onScanError
      ).then(() => {
        const btn = document.getElementById('btn-toggle-camera');
        if (btn) {
          btn.innerHTML = 'Kamera bezárása';
          btn.className = 'btn btn-secondary';
        }
      }).catch(err => {
        console.error('Kamera indítási hiba:', err);
        showToast('Nem sikerült hozzáférni a kamerához. Ellenőrizd a jogosultságokat!', 'error');
        stopCameraScanner();
      });
    } else {
      showToast('A QR kód olvasó könyvtár nem töltődött be!', 'error');
    }
  } catch (cameraErr) {
    console.warn('Nem sikerült elindítani a kamerát:', cameraErr);
  }
}

function stopCameraScanner() {
  if (!html5QrCode) return;
  
  html5QrCode.stop().then(() => {
    html5QrCode = null;
    const btn = document.getElementById('btn-toggle-camera');
    if (btn) {
      btn.innerHTML = 'Kamera megnyitása';
      btn.className = 'btn btn-primary';
    }
    const cameraCard = document.getElementById('scanner-camera-card');
    if (cameraCard) cameraCard.style.display = 'none';
  }).catch(err => {
    console.error('Kamera leállítási hiba:', err);
    html5QrCode = null; // force clear reference
    const cameraCard = document.getElementById('scanner-camera-card');
    if (cameraCard) cameraCard.style.display = 'none';
  });
}

function toggleCamera() {
  if (html5QrCode) {
    stopCameraScanner();
  } else {
    startCameraScanner();
  }
}

async function initScanner() {
  if (!hasRole('STAFF') && !hasRole('ADMIN')) {
    window.location.href = 'index.html';
    return;
  }

  // Auto-check if uuid exists in URL
  const urlParams = new URLSearchParams(window.location.search);
  const urlUuid = urlParams.get('uuid');
  if (urlUuid) {
    setTimeout(() => {
      validateScannedQR(urlUuid);
    }, 100);
  }

  // Populate locations select in the scanner view
  const locSelect = document.getElementById('scanner-location-select');
  if (locSelect) {
    try {
      const res = await fetch('/api/locations');
      const locations = await res.json();
      
      locSelect.innerHTML = '<option value="">Kérjük, válassz helyszínt...</option>';
      locations.forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc.id;
        opt.textContent = loc.name;
        locSelect.appendChild(opt);
      });

      // Restore previously saved location
      const savedLoc = localStorage.getItem('scanner_location_id');
      if (savedLoc) {
        locSelect.value = savedLoc;
      }

      // Save location on change and update checkin button state if currently displaying one
      locSelect.addEventListener('change', () => {
        localStorage.setItem('scanner_location_id', locSelect.value);
        const confirmBtn = document.getElementById('confirm-checkin-btn');
        const locWarning = document.getElementById('scanner-location-warning');
        if (confirmBtn) {
          if (locSelect.value) {
            confirmBtn.disabled = confirmBtn.dataset.ticketValid !== 'true';
            if (locWarning) locWarning.style.display = 'none';
          } else {
            confirmBtn.disabled = true;
            if (locWarning) locWarning.style.display = 'block';
          }
        }
        if (lastScannedUuid) {
          validateScannedQR(lastScannedUuid);
        }
      });
    } catch (e) {
      console.error('Hiba a beléptető helyszínek betöltésekor:', e);
      showToast('Nem sikerült betölteni a mászófalak helyszíneit!', 'error');
    }
  }

  if (urlUuid) {
    const readerViewport = document.getElementById('qr-reader-viewport');
    if (readerViewport) {
      readerViewport.innerHTML = '<p style="text-align:center; padding:15px; color:var(--text-secondary); font-size: 14px;">Kód beolvasva a külső kamerából. Jegy adatok lekérdezése folyamatban...</p>';
    }
  }
}

async function onScanSuccess(decodedText, decodedResult) {
  // If we are already displaying checkin/confirm screen or success screen, ignore new scans
  const resultCard = document.getElementById('scan-result-container');
  if (resultCard && resultCard.style.display === 'block') {
    return;
  }

  if (html5QrCode) {
    try {
      showToast('Kód észlelve, adatok betöltése...', 'success');
      await validateScannedQR(decodedText);
    } catch (e) {
      console.error(e);
    }
  }
}

function onScanError(errorMessage) {
  // Silent scanner frames search
}

async function validateScannedQR(uuid) {
  let finalUuid = uuid;
  if (uuid && typeof uuid === 'string') {
    if (uuid.includes('uuid=')) {
      const urlParams = new URLSearchParams(uuid.split('?')[1]);
      finalUuid = urlParams.get('uuid') || uuid;
    } else if (uuid.includes('/')) {
      finalUuid = uuid.split('/').pop();
    }
  }

  // Set last scanned UUID for dynamic updates
  lastScannedUuid = finalUuid;

  const resultCard = document.getElementById('scan-result-container');
  if (!resultCard) return;

  resultCard.style.display = 'block';
  resultCard.innerHTML = '<p style="text-align:center; padding:20px;">Jegy adatok lekérdezése az adatbázisból...</p>';

  try {
    const res = await fetch(`/api/tickets/scan-info?qrCodeUuid=${finalUuid}`, {
      headers: getAuthHeaders()
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sikertelen jegy lekérdezés');

    const climber = data.user || {};
    const ticket = data.ticket || {};
    const isValid = data.isValid;
    const reasonMsg = data.reason || '';

    let statusClass = isValid ? 'scan-status-valid' : 'scan-status-invalid';
    let statusText = isValid ? 'Belépésre Kész' : 'Érvénytelen Belépő';
    let statusIcon = isValid ? 'ℹ️' : '❌';

    let hungarianType = '';
    if (ticket.ticket_type === 'NAPI') hungarianType = 'Napijegy';
    else if (ticket.ticket_type === 'TIZ_ALKALMAS') hungarianType = '10 Alkalmas Bérlet';
    else if (ticket.ticket_type === 'HAVI') hungarianType = '30 Napos Bérlet';

    let sessionsVal = '';
    if (ticket.ticket_type === 'NAPI') {
      sessionsVal = '1x használatos (még nem használt)';
    } else if (ticket.ticket_type === 'TIZ_ALKALMAS') {
      sessionsVal = `${ticket.sessions_remaining || 0} alkalom maradt`;
    } else if (ticket.ticket_type === 'HAVI') {
      sessionsVal = 'Korlátlan';
    }

    if (ticket.status === 'USED') {
      sessionsVal = 'Már felhasznált';
    } else if (ticket.status === 'EXPIRED') {
      sessionsVal = 'Lejárt';
    }

    // Safety Certification Display
    let cardBadgeHtml = '';
    if (climber.card_type === 'ZÖLD') {
      cardBadgeHtml = `
        <span class="badge badge-green" style="font-size:14px; padding:6px 15px;">
          ZÖLD KÁRTYÁS - BIZTOSÍTHAT
        </span>
      `;
    } else {
      cardBadgeHtml = `
        <span class="badge badge-red" style="font-size:14px; padding:6px 15px;">
          PIROS KÁRTYÁS - NEM BIZTOSÍTHAT
        </span>
      `;
    }

    const locSelect = document.getElementById('scanner-location-select');
    const selectedLocation = locSelect.value;
    const hasLocation = !!selectedLocation;

    // Process bookings comparison
    const bookings = data.bookings || [];
    let bookingInfoHtml = '';

    // Get current date in Europe/Budapest timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const todayStr = formatter.format(new Date());

    const formatTime = (t) => t ? t.substring(0, 5) : '';

    let hasBookingToday = false;
    let isAlreadyAttended = false;

    if (hasLocation) {
      const selectedLocationName = locSelect.options[locSelect.selectedIndex].text;
      
      // Look for a matching booking TODAY at the SELECTED location
      const matchingBooking = bookings.find(b => b.booking_date === todayStr && String(b.location_id) === String(selectedLocation));
      
      isAlreadyAttended = !!(matchingBooking && matchingBooking.attended > 0);
      hasBookingToday = !!(matchingBooking && !isAlreadyAttended);
      
      // Look for any booking TODAY (at any location)
      const todayBookingAnyLoc = bookings.find(b => b.booking_date === todayStr);

      // Create a list of other bookings (different day/time/location)
      const otherBookingsList = bookings.filter(b => !matchingBooking || b.booking_id !== matchingBooking.booking_id);
      
      let otherBookingsHtml = '';
      if (otherBookingsList.length > 0) {
        otherBookingsHtml = `
          <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 13px;">
            <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 5px;">Mászó egyéb foglalásai:</div>
            <ul style="margin: 0; padding-left: 15px; color: var(--text-muted); list-style-type: disc; text-align: left;">
              ${otherBookingsList.map(b => `
                <li>
                  <strong>${b.booking_date}</strong> | ${formatTime(b.start_time)} - ${formatTime(b.end_time)} (${b.location_name}) ${b.attended > 0 ? '(Megjelent)' : ''}
                </li>
              `).join('')}
            </ul>
          </div>
        `;
      }

      if (matchingBooking) {
        if (isAlreadyAttended) {
          bookingInfoHtml = `
            <div class="scan-booking-info">
              <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
              <div class="scan-booking-warning">
                ⚠️ A mászó ma már egyszer belépett erre az időpontra: <strong>${formatTime(matchingBooking.start_time)} - ${formatTime(matchingBooking.end_time)} (${matchingBooking.location_name})</strong>!
              </div>
              ${otherBookingsHtml}
            </div>
          `;
        } else {
          bookingInfoHtml = `
            <div class="scan-booking-info">
              <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
              <div class="scan-booking-match">
                ✅ Foglalás ma: ${formatTime(matchingBooking.start_time)} - ${formatTime(matchingBooking.end_time)} (${matchingBooking.location_name})
              </div>
              ${otherBookingsHtml}
            </div>
          `;
        }
      } else if (todayBookingAnyLoc) {
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
            <div class="scan-booking-warning">
              ⚠️ A mászó a ${todayBookingAnyLoc.location_name} mászófalra jelentkezett ma (${formatTime(todayBookingAnyLoc.start_time)} - ${formatTime(todayBookingAnyLoc.end_time)}), de te az ${selectedLocationName} helyszínen olvasod be!
            </div>
            ${otherBookingsHtml}
          </div>
        `;
      } else {
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
            <div class="scan-booking-error">
              ❌ Nincs mára foglalása ezen a helyszínen!
            </div>
            ${otherBookingsHtml}
          </div>
        `;
      }
    } else {
      // No location selected yet
      if (bookings.length > 0) {
        const bookingList = bookings.map(b => `<li><strong>${b.booking_date}</strong>: ${formatTime(b.start_time)} - ${formatTime(b.end_time)} (${b.location_name})</li>`).join('');
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Aktív foglalások</div>
            <div style="font-size:13px; color:var(--text-secondary); line-height: 1.5; text-align: left;">
              Mászó összes foglalása:<br>
              <ul style="margin: 5px 0 0 15px; padding: 0; list-style-type: disc;">
                ${bookingList}
              </ul>
              <span style="font-size:11px; color:var(--text-muted); display: block; margin-top: 5px;">(Válassz helyszínt a fejlécben a pontos ellenőrzéshez)</span>
            </div>
          </div>
        `;
      } else {
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
            <div style="font-size:13px; color:var(--text-secondary);">
              Nincs aktív foglalása. (Válassz helyszínt a fejlécben az ellenőrzéshez)
            </div>
          </div>
        `;
      }
    }

    let actionButtonHtml = '';
    if (isValid) {
      actionButtonHtml = `
        <div id="scanner-location-warning" style="margin-top:15px; color:var(--warning); font-size:13px; font-weight:600; display: ${hasLocation ? 'none' : 'block'}; text-align: center;">
          ⚠️ Kérjük, válassz helyszínt a lap tetején a beléptetéshez!
        </div>
        <button id="confirm-checkin-btn" onclick="processCheckIn('${ticket.qr_code_uuid}', ${hasBookingToday}, ${isAlreadyAttended})" class="btn btn-primary" style="margin-top: 20px; width: 100%;" data-ticket-valid="${isValid}" ${hasLocation ? '' : 'disabled'}>
          Beléptetés Jóváhagyása
        </button>
      `;
    } else {
      actionButtonHtml = `
        <p style="font-size:14px; font-weight:600; margin-top:20px; color:var(--danger); text-align: center;">${reasonMsg || 'Ez a jegy nem használható fel belépésre.'}</p>
      `;
    }

    resultCard.innerHTML = `
      <div class="scan-status-indicator ${statusClass}">
        <span>${statusIcon}</span>
        <span>${statusText}</span>
      </div>

      <div style="margin-bottom: 20px; margin-top: 20px;">
        <h4 style="color:var(--text-secondary); font-size:12px; text-transform:uppercase; margin-bottom:8px;">Biztonsági Státusz</h4>
        ${cardBadgeHtml}
        ${climber.license_number ? `<p style="font-size:12px; color:var(--text-muted); margin-top:5px;">Engedélyszám: ${climber.license_number}</p>` : '<p style="font-size:12px; color:var(--text-muted); margin-top:5px;">Nincs sportmászó vizsga igazolvány</p>'}
      </div>

      <div class="scan-details-grid">
        <div class="scan-detail-item">
          <div class="scan-detail-label">Mászó neve</div>
          <div class="scan-detail-value">${climber.name || 'Ismeretlen'}</div>
        </div>
        <div class="scan-detail-item">
          <div class="scan-detail-label">Telefon</div>
          <div class="scan-detail-value">${climber.phone || '-'}</div>
        </div>
        <div class="scan-detail-item">
          <div class="scan-detail-label">Jegytípus</div>
          <div class="scan-detail-value">${hungarianType || 'Nincs'}</div>
        </div>
        <div class="scan-detail-item">
          <div class="scan-detail-label">Státusz/Egyenleg</div>
          <div class="scan-detail-value">${sessionsVal}</div>
        </div>
        <div class="scan-detail-item" style="grid-column: 1/-1;">
          <div class="scan-detail-label">Lejárati Dátum</div>
          <div class="scan-detail-value">${ticket.expires_date || '-'}</div>
        </div>
      </div>

      ${bookingInfoHtml}

      ${actionButtonHtml}
      <button onclick="resetScannerUI()" class="btn btn-secondary btn-sm" style="margin-top: 15px; width: 100%;">Mégse / Új beolvasás</button>
    `;
  } catch (err) {
    resultCard.innerHTML = `
      <div class="scan-status-indicator scan-status-invalid">
        <span>❌</span>
        <span>Lekérdezési Hiba</span>
      </div>
      <p style="margin-top: 15px; text-align: center;">${err.message}</p>
      <button onclick="resetScannerUI()" class="btn btn-primary" style="margin-top: 20px; width:100%;">Újra próbálkozás</button>
    `;
  }
}

async function processCheckIn(uuid, hasBookingToday = true, isAlreadyAttended = false) {
  if (isAlreadyAttended) {
    const confirmCheckin = await showConfirmModal({
      title: 'Ismételt beléptetés megerősítése',
      message: 'A mászó ma már egyszer belépett erre az időpontra ezen a helyszínen! Ennek ellenére belépteted?',
      confirmText: 'Beléptetés',
      cancelText: 'Mégse',
      variant: 'warning'
    });
    if (!confirmCheckin) return;
  } else if (!hasBookingToday) {
    const confirmCheckin = await showConfirmModal({
      title: 'Foglalás nélküli beléptetés',
      message: 'A mászónak nincs mára érvényes foglalása erre a helyszínre. Ennek ellenére belépteted?',
      confirmText: 'Beléptetés',
      cancelText: 'Mégse',
      variant: 'warning'
    });
    if (!confirmCheckin) return;
  }

  const locationId = document.getElementById('scanner-location-select').value;
  if (!locationId) {
    showToast('Kérjük, válassz beléptetési helyszínt!', 'error');
    return;
  }

  // Disable button immediately to prevent double scan clicks
  const confirmBtn = document.getElementById('confirm-checkin-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Beléptetés folyamatban...';
  }

  const resultCard = document.getElementById('scan-result-container');
  if (!resultCard) return;

  resultCard.innerHTML = '<p style="text-align:center; padding:20px;">Beléptetés feldolgozása, egyenleg módosítása...</p>';

  try {
    const res = await fetch('/api/tickets/validate', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ qrCodeUuid: uuid, locationId: parseInt(locationId) })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sikertelen beléptetés');

    const climber = data.user || {};
    const ticket = data.ticket || {};
    const message = data.message || 'Sikeres belépés!';

    let hungarianType = '';
    if (ticket.ticket_type === 'NAPI') hungarianType = 'Napijegy';
    else if (ticket.ticket_type === 'TIZ_ALKALMAS') hungarianType = '10 Alkalmas Bérlet';
    else if (ticket.ticket_type === 'HAVI') hungarianType = '30 Napos Bérlet';

    let sessionsVal = '';
    if (ticket.ticket_type === 'NAPI') {
      sessionsVal = 'Elhasználva (Lezárva)';
    } else if (ticket.ticket_type === 'TIZ_ALKALMAS') {
      sessionsVal = `${ticket.sessions_remaining || 0} alkalom maradt`;
    } else if (ticket.ticket_type === 'HAVI') {
      sessionsVal = 'Korlátlan';
    }

    // Keep camera scanner active to prevent recurring permission prompts on mobile

    // Hide camera and location cards
    const cameraCard = document.getElementById('scanner-camera-card');
    const locationCard = document.getElementById('scanner-location-card');
    if (cameraCard) cameraCard.style.display = 'none';
    if (locationCard) locationCard.style.display = 'none';

    resultCard.innerHTML = `
      <div style="text-align: center; padding: 20px 0;">
        <div class="scan-status-indicator scan-status-valid" style="margin: 0 auto 20px auto; width: fit-content;">
          <span>✅</span>
          <span>Sikeres Beléptetés!</span>
        </div>
        
        <p style="font-size:18px; font-weight:700; margin: 25px 0; color: var(--success); text-align: center;">${message}</p>
  
        <div class="scan-details-grid" style="margin-bottom: 25px; border: 1px solid var(--border-color); padding: 15px; border-radius: 10px; background: rgba(255,255,255,0.01);">
          <div class="scan-detail-item">
            <div class="scan-detail-label">Mászó neve</div>
            <div class="scan-detail-value" style="font-size: 16px; font-weight: 600; color: #fff;">${climber.name || 'Ismeretlen'}</div>
          </div>
          <div class="scan-detail-item">
            <div class="scan-detail-label">Új Egyenleg</div>
            <div class="scan-detail-value" style="font-size: 16px; font-weight: 600; color: var(--primary);">${sessionsVal}</div>
          </div>
        </div>
  
        <button onclick="resetScannerAfterSuccess()" class="btn btn-primary" style="margin-top: 15px; width: 100%; font-size: 16px; padding: 12px 20px;">
          További beolvasás...
        </button>
      </div>
    `;
    showToast('Beléptetés sikeresen végrehajtva!', 'success');
  } catch (err) {
    resultCard.innerHTML = `
      <div class="scan-status-indicator scan-status-invalid">
        <span>❌</span>
        <span>Hiba a beléptetéskor</span>
      </div>
      <p style="margin-top: 15px; color: var(--danger); font-weight:600; text-align: center;">${err.message}</p>
      <button onclick="resetScannerUI()" class="btn btn-primary" style="margin-top: 20px; width:100%;">Újra próbálkozás</button>
    `;
    showToast(err.message, 'error');
  }
}

function resetScannerAfterSuccess() {
  lastScannedUuid = null;
  
  // Show camera and location cards
  const cameraCard = document.getElementById('scanner-camera-card');
  const locationCard = document.getElementById('scanner-location-card');
  if (cameraCard) cameraCard.style.display = 'block';
  if (locationCard) locationCard.style.display = 'block';
  
  // Hide result card
  const resultCard = document.getElementById('scan-result-container');
  if (resultCard) {
    resultCard.innerHTML = '';
    resultCard.style.display = 'none';
  }
  
  // Restart camera scanner
  startCameraScanner();
}

function resetScannerUI() {
  lastScannedUuid = null;
  const resultCard = document.getElementById('scan-result-container');
  if (resultCard) resultCard.style.display = 'none';
}

// ---------------- ADMIN PANEL (ADMIN / STAFF) ----------------
async function initAdminPanel() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = 'auth.html';
    return;
  }

  const isAdmin = hasRole('ADMIN');
  const isStaff = hasRole('STAFF');

  if (!isAdmin && !isStaff) {
    window.location.href = 'auth.html';
    return;
  }

  const isStaffOnly = isStaff && !isAdmin;

  // Switch tab instantly on load to prevent flickering showing the wrong default tab
  const hash = window.location.hash || '#dashboard';
  let initialTab = 'dashboard';
  if (isStaffOnly) {
    initialTab = 'bookings';
  } else {
    if (hash === '#stats' || hash === '#analytics') initialTab = 'stats';
    else if (hash === '#checkins') initialTab = 'checkins';
    else if (hash === '#users') initialTab = 'users';
    else if (hash === '#news') initialTab = 'news';
    else if (hash === '#schedule') initialTab = 'slots';
    else if (hash === '#bookings') initialTab = 'bookings';
    else if (hash === '#withdrawals') initialTab = 'withdrawals';
  }

  if (typeof window.switchAdminTab === 'function') {
    window.switchAdminTab(initialTab);
  }

  // Load administrative data: Staff Light only loads bookings, Admin loads all
  if (isStaffOnly) {
    if (typeof loadAdminBookings === 'function') {
      loadAdminBookings().catch(err => console.error('Error loading bookings for staff:', err));
    }
  } else {
    Promise.all([
      loadAdminUsers(),
      loadAdminSlots(),
      loadNewsAnnouncements(),
      loadAdminBookings(),
      loadAdminWithdrawals()
    ]).catch(err => {
      console.error('Error loading admin panel resources in parallel:', err);
    });
  }

  // News Form submission
  const newsForm = document.getElementById('admin-news-form');
  if (newsForm) {
    newsForm.addEventListener('submit', saveNewsAnnouncement);
  }

  // CRM Search Form listener
  const crmForm = document.getElementById('crm-search-form');
  if (crmForm) {
    crmForm.addEventListener('submit', handleCRMSearch);
  }

  // Global hash change listener for admin page tabs
  window.addEventListener('hashchange', () => {
    const currentHash = window.location.hash || '#dashboard';
    let tab = 'dashboard';
    if (isStaffOnly) {
      tab = 'bookings';
    } else {
      if (currentHash === '#stats' || currentHash === '#analytics') tab = 'stats';
      else if (currentHash === '#checkins') tab = 'checkins';
      else if (currentHash === '#users') tab = 'users';
      else if (currentHash === '#news') tab = 'news';
      else if (currentHash === '#schedule') tab = 'slots';
      else if (currentHash === '#bookings') tab = 'bookings';
      else if (currentHash === '#withdrawals') tab = 'withdrawals';
    }

    if (typeof window.switchAdminTab === 'function') window.switchAdminTab(tab);
    renderHeader();
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadAdminUsers() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; color: var(--text-muted); width: 100%; padding: 30px;">Tagok betöltése...</p>';

  try {
    const res = await fetch('/api/admin/users', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    const users = await res.json();

    window.adminUsers = users; // Store globally for details/editing modal lookup and sorting
    renderAdminUsers();
  } catch (err) {
    container.innerHTML = '<p style="text-align:center; color:var(--danger); width: 100%; padding: 30px;">Nem sikerült a felhasználók betöltése.</p>';
  }
}

function filterAdminUsersTable() {
  renderAdminUsers();
}

function clearAdminUsersSearch() {
  const searchInput = document.getElementById('admin-users-search');
  if (searchInput) {
    searchInput.value = '';
    renderAdminUsers();
  }
}

function renderAdminUsers() {
  const container = document.getElementById('admin-users-list');
  if (!container || !window.adminUsers) return;

  const sortSelect = document.getElementById('admin-users-sort');
  const sortBy = sortSelect ? sortSelect.value : 'name-asc';
  const searchInput = document.getElementById('admin-users-search');
  const searchFilter = (searchInput ? searchInput.value : '').toLowerCase().trim();

  let filteredUsers = [...window.adminUsers];

  if (searchFilter) {
    filteredUsers = filteredUsers.filter(u => {
      const name = (u.name || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const phone = (u.phone || '').toLowerCase();
      const role = (u.role || '').toLowerCase();
      const card = (u.card_type || '').toLowerCase();
      const license = (u.license_number || '').toLowerCase();
      return name.includes(searchFilter) ||
             email.includes(searchFilter) ||
             phone.includes(searchFilter) ||
             role.includes(searchFilter) ||
             card.includes(searchFilter) ||
             license.includes(searchFilter);
    });
  }

  if (sortBy === 'name-asc') {
    filteredUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'hu'));
  } else if (sortBy === 'name-desc') {
    filteredUsers.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'hu'));
  } else if (sortBy === 'reg-desc') {
    filteredUsers.sort((a, b) => b.id - a.id); // Newest first
  } else if (sortBy === 'reg-asc') {
    filteredUsers.sort((a, b) => a.id - b.id); // Oldest first
  }

  if (filteredUsers.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding: 40px 20px; color: var(--text-muted);">
        <p style="font-size: 15px; margin-bottom: 8px;">${searchFilter ? 'Nincs a keresési feltételnek megfelelő tag.' : 'Nem található regisztrált tag az adatbázisban.'}</p>
        ${searchFilter ? '<button class="btn btn-secondary btn-sm" onclick="clearAdminUsersSearch()">Szűrés törlése</button>' : ''}
      </div>
    `;
    return;
  }

  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

  let rowsHtml = '';
  filteredUsers.forEach(u => {
    const userRoles = (u.role || '').split(',').map(r => r.trim().toUpperCase());
    const isAdmin = userRoles.includes('ADMIN');
    const isStaff = userRoles.includes('STAFF');
    const isZold = (u.card_type || '').toUpperCase() === 'ZÖLD';
    const isSelf = (currentUser.id === u.id);
    const isSuperAdmin = (u.email === 'admin@hawkstone.hu');
    const cannotDelete = isSelf || isSuperAdmin || isAdmin;

    // Badges list (Support multiple roles & cards)
    let badges = [];
    if (isAdmin) {
      badges.push('<span class="badge user-badge-role-admin" title="Adminisztrátor">ADMIN</span>');
    }
    if (isStaff) {
      badges.push('<span class="badge user-badge-role-staff" title="Falmester / Pultos">STAFF</span>');
    }
    if (!isAdmin && !isStaff) {
      badges.push('<span class="badge user-badge-role-user" title="Regisztrált mászó">MÁSZÓ</span>');
    }
    if (isZold) {
      badges.push('<span class="badge badge-green" title="Biztosításra jogosult">ZÖLD KÁRTYA</span>');
    } else {
      badges.push('<span class="badge badge-red" title="Nem biztosíthat">PIROS KÁRTYA</span>');
    }

    rowsHtml += `
      <tr>
        <td>
          <div style="font-weight: 700; color: #ffffff; font-size: 14px; letter-spacing: 0.01em;">${escapeHtml(u.name)}</div>
          ${u.phone ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">📞 ${escapeHtml(u.phone)}</div>` : ''}
          ${u.license_number ? `<div style="font-size: 11px; color: var(--primary); margin-top: 2px; font-weight: 500;">🏅 Engedély: ${escapeHtml(u.license_number)}</div>` : ''}
        </td>
        <td>
          <div style="font-size: 13px; color: #ffffff; word-break: break-all;">
            <a href="mailto:${escapeHtml(u.email)}" style="color: #ffffff; text-decoration: none; transition: color 0.2s;" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='#ffffff'">
              ${escapeHtml(u.email)}
            </a>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Azonosító: #${u.id}</div>
        </td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
            ${badges.join(' ')}
          </div>
        </td>
        <td style="text-align: right;">
          <div class="admin-users-actions">
            <button onclick="openEditUserModal(${u.id})" class="btn btn-primary btn-sm" title="Felhasználó adatainak és jogosultságainak szerkesztése" style="padding: 6px 12px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
              <span>✏️</span> Szerkesztés
            </button>
            <button onclick="confirmDeleteUser(${u.id})" class="btn btn-danger btn-sm" title="${cannotDelete ? (isSelf ? 'Saját fiókodat nem törölheted!' : (isSuperAdmin ? 'Az Admin Főnök nem törölhető!' : 'Admin fiók nem törölhető!')) : 'Felhasználó törlése'}" style="padding: 6px 10px; font-size: 12px; background: #ef4444; border-color: #ef4444; display: inline-flex; align-items: center; gap: 4px; ${cannotDelete ? 'opacity: 0.35; cursor: not-allowed;' : ''}" ${cannotDelete ? 'disabled' : ''}>
              <span>🗑️</span> Törlés
            </button>
            <button onclick="openUserDetailsModal(${u.id})" class="btn btn-secondary btn-sm" title="Részletes profil, jegyek, foglalások és belépési logok megtekintése" style="padding: 6px 9px; font-size: 12px;">
              👁️
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  container.innerHTML = `
    <table class="admin-table admin-users-table">
      <thead>
        <tr>
          <th style="min-width: 170px;">Név</th>
          <th style="min-width: 200px;">Felhasználónév / E-mail</th>
          <th style="min-width: 180px;">Jogosultságok</th>
          <th style="text-align: right; min-width: 190px;">Műveletek</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}

function sortAdminUsers() {
  renderAdminUsers();
}

// ---------------- USER EDIT MODAL (POPUP WITH MULTI-ROLE & CARDS) ----------------
function openEditUserModal(userId) {
  const user = (window.adminUsers || []).find(u => u.id === userId);
  if (!user) {
    showToast('A felhasználó nem található!', 'error');
    return;
  }

  // Remove existing modal if any
  closeEditUserModal();

  const userRoles = (user.role || '').split(',').map(r => r.trim().toUpperCase());
  const isAdmin = userRoles.includes('ADMIN');
  const isStaff = userRoles.includes('STAFF');
  const isZold = (user.card_type || '').toUpperCase() === 'ZÖLD';
  const isPiros = !isZold;

  const isSuperAdminUser = (user.email === 'admin@hawkstone.hu');

  const modal = document.createElement('div');
  modal.id = 'admin-edit-user-modal';
  modal.className = 'hs-modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);backdrop-filter:blur(6px);padding:20px;';

  modal.innerHTML = `
    <div class="glass-card admin-edit-modal-card">
      
      <!-- Close button -->
      <button type="button" onclick="closeEditUserModal()" style="position:absolute;top:18px;right:18px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:16px;line-height:1;transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">✕</button>

      <div style="margin-bottom:18px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:10px;">
        <div>
          <span style="font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:var(--primary); font-weight:700;">Felhasználó szerkesztése</span>
          <h3 style="margin:4px 0 0; font-size:22px; color:#ffffff; font-family:'Montserrat',sans-serif; font-weight:700;">${escapeHtml(user.name)}</h3>
        </div>
        <p style="margin:0; font-size:13px; color:var(--text-muted); font-family:'Outfit',monospace;">Azonosító: #${user.id} &nbsp;·&nbsp; ${escapeHtml(user.email)}</p>
      </div>

      <form id="admin-modal-edit-user-form" onsubmit="submitEditUserModal(event, ${user.id})">
        
        <!-- 4 OSZLOPOS ALAPADATOK ASZTALI NÉZETBEN -->
        <div class="edit-user-grid-4">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="edit-modal-name">Teljes név *</label>
            <input type="text" id="edit-modal-name" class="form-control" value="${escapeHtml(user.name)}" required>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="edit-modal-email">E-mail cím *</label>
            <input type="email" id="edit-modal-email" class="form-control" value="${escapeHtml(user.email)}" required ${isSuperAdminUser ? 'readonly style="opacity:0.7;cursor:not-allowed;" title="Az Admin Főnök email címe nem módosítható!"' : ''}>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="edit-modal-phone">Telefonszám *</label>
            <input type="tel" id="edit-modal-phone" class="form-control" value="${escapeHtml(user.phone || '')}" placeholder="+36..." required>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="edit-modal-license">Sportmászó engedély</label>
            <input type="text" id="edit-modal-license" class="form-control" value="${escapeHtml(user.license_number || '')}" placeholder="pl. SMV-00001">
          </div>
        </div>

        <!-- 2 OSZLOPOS SPLIT: JOGOSULTSÁGOK ÉS JELSZÓ -->
        <div class="edit-user-split-2">
          
          <!-- JOGOSULTSÁGOK PANEL -->
          <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <h4 style="margin:0; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:var(--primary); font-weight:700;">
                Jogosultságok &amp; Szerepkörök
              </h4>
              <span style="font-size:11px; color:var(--text-muted);">Egyéni beállítás</span>
            </div>
            <p style="font-size:11px; color:var(--text-secondary); margin:0 0 14px 0;">
              Egy felhasználó több jogosultsággal is rendelkezhet (pl. Admin, Staff, Zöld kártya).
            </p>

            <div style="display:flex; flex-direction:column; gap:14px;">
              <!-- Rendszer jogosultságok -->
              <div>
                <span style="font-size:11px; color:#ffffff; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:8px;">Rendszerbeli hozzáférés:</span>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                  <label class="role-select-card role-admin ${isAdmin ? 'is-active' : ''}">
                    <input type="checkbox" id="edit-modal-role-admin" onchange="updateRoleCardVisuals()" style="accent-color:#f59e0b;" ${isAdmin ? 'checked' : ''} ${isSuperAdminUser ? 'disabled title="Az Admin Főnök szerepköre kötelezően ADMIN!"' : ''}>
                    <div style="flex:1;">
                      <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong class="role-card-title" style="font-size:13px; color:#f59e0b;">Admin</strong>
                        <span class="role-active-indicator" style="background:#f59e0b; color:#000;">AKTÍV</span>
                      </div>
                      <span class="role-card-desc">Teljes hozzáférés</span>
                    </div>
                  </label>

                  <label class="role-select-card role-staff ${isStaff ? 'is-active' : ''}">
                    <input type="checkbox" id="edit-modal-role-staff" onchange="updateRoleCardVisuals()" style="accent-color:#818cf8;" ${isStaff ? 'checked' : ''}>
                    <div style="flex:1;">
                      <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong class="role-card-title" style="font-size:13px; color:#818cf8;">Staff (Falmester)</strong>
                        <span class="role-active-indicator" style="background:#818cf8; color:#000;">AKTÍV</span>
                      </div>
                      <span class="role-card-desc">Scanner &amp; Foglalások</span>
                    </div>
                  </label>
                </div>
              </div>

              <!-- Mászókártya minősítés -->
              <div style="border-top:1px dashed rgba(255,255,255,0.08); padding-top:12px;">
                <span style="font-size:11px; color:#ffffff; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:8px;">Mászókártya minősítés:</span>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                  <label class="role-select-card card-zold ${isZold ? 'is-active' : ''}">
                    <input type="radio" name="edit-modal-card" id="edit-modal-card-zold" value="ZÖLD" onchange="updateRoleCardVisuals()" style="accent-color:#10b981;" ${isZold ? 'checked' : ''}>
                    <div style="flex:1;">
                      <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong class="role-card-title" style="font-size:13px; color:#10b981;">ZÖLD KÁRTYA</strong>
                        <span class="role-active-indicator" style="background:#10b981; color:#000;">AKTÍV</span>
                      </div>
                      <span class="role-card-desc">Mások biztosítására jogosult</span>
                    </div>
                  </label>

                  <label class="role-select-card card-piros ${isPiros ? 'is-active' : ''}">
                    <input type="radio" name="edit-modal-card" id="edit-modal-card-piros" value="PIROS" onchange="updateRoleCardVisuals()" style="accent-color:#ef4444;" ${isPiros ? 'checked' : ''}>
                    <div style="flex:1;">
                      <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong class="role-card-title" style="font-size:13px; color:#ef4444;">PIROS KÁRTYA</strong>
                        <span class="role-active-indicator" style="background:#ef4444; color:#fff;">AKTÍV</span>
                      </div>
                      <span class="role-card-desc">Önálló mászás &amp; auto-belay</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <!-- JELSZÓ MÓDOSÍTÁS PANEL -->
          <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:15px;">
            <h4 style="margin:0 0 6px 0; font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:var(--primary); font-weight:700;">
              Biztonság
            </h4>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" for="edit-modal-password" style="font-size:12px;">Új jelszó megadása (opcionális)</label>
              <div style="position:relative;">
                <input type="password" id="edit-modal-password" class="form-control" placeholder="Hagyd üresen, ha változatlan">
                <span class="password-toggle-eye" onclick="togglePasswordVisibility('edit-modal-password')">👁️</span>
              </div>
              <small class="password-hint" style="font-size:11px; color:var(--text-muted); display:block; margin-top:6px; line-height:1.3;">
                Csak akkor töltsd ki, ha jelszót szeretnél váltani a tagnak (min. 8 karakter, kis- és nagybetű, szám).
              </small>
            </div>
          </div>

        </div>

        <!-- FOGLALÁSOK ÉS BELÉPTETÉSEK LEKÉRDEZÉSE -->
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:15px; margin-bottom:18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px;">📅</span>
              <h4 style="margin:0; font-size:13px; text-transform:uppercase; letter-spacing:0.08em; color:var(--primary); font-weight:700;">
                Felhasználó foglalásai &amp; beléptetései
              </h4>
            </div>
            <button type="button" onclick="loadUserBookingsInModal(${user.id})" class="btn btn-secondary btn-sm" style="padding:4px 10px; font-size:11px; height:auto; display:inline-flex; align-items:center; gap:4px;">
              🔄 Frissítés
            </button>
          </div>
          <div id="modal-user-bookings-container" style="max-height:220px; overflow-y:auto; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:10px;">
            <p style="color:var(--text-muted); font-size:12px; margin:0; text-align:center;">Foglalások betöltése...</p>
          </div>
        </div>

        <div style="display:flex; gap:12px; justify-content:flex-end;">
          <button type="button" onclick="closeEditUserModal()" class="btn btn-secondary" style="padding:10px 20px;">Mégse</button>
          <button type="submit" class="btn btn-primary" style="padding:10px 26px; font-weight:600;">Módosítások mentése</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  // Auto-fetch user bookings for convenient viewing
  setTimeout(() => {
    loadUserBookingsInModal(user.id);
  }, 50);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeEditUserModal();
  });
}

function closeEditUserModal() {
  const modal = document.getElementById('admin-edit-user-modal');
  if (modal) modal.remove();
}

function updateRoleCardVisuals() {
  document.querySelectorAll('.role-select-card').forEach(card => {
    const input = card.querySelector('input');
    if (input && input.checked) {
      card.classList.add('is-active');
    } else {
      card.classList.remove('is-active');
    }
  });
}

async function submitEditUserModal(e, userId) {
  if (e) e.preventDefault();

  const name = (document.getElementById('edit-modal-name').value || '').trim();
  const email = (document.getElementById('edit-modal-email').value || '').trim();
  const phone = (document.getElementById('edit-modal-phone').value || '').trim();
  const license_number = (document.getElementById('edit-modal-license').value || '').trim();
  const password = document.getElementById('edit-modal-password').value;

  const adminCheckbox = document.getElementById('edit-modal-role-admin');
  const staffCheckbox = document.getElementById('edit-modal-role-staff');

  const adminChecked = adminCheckbox ? adminCheckbox.checked : false;
  const staffChecked = staffCheckbox ? staffCheckbox.checked : false;

  let roles = [];
  if (adminChecked) roles.push('ADMIN');
  if (staffChecked) roles.push('STAFF');
  if (roles.length === 0) roles.push('USER');
  const roleStr = roles.join(',');

  const card_type = document.getElementById('edit-modal-card-zold').checked ? 'ZÖLD' : 'PIROS';

  if (card_type === 'ZÖLD') {
    if (!license_number) {
      showAlertModal('Zöld kártya minősítéshez kötelező sportmászó engedélyszám megadása!', 'Hiányzó engedélyszám', 'warning');
      return;
    }
    const licenseRegex = /^(SMV-\d+|[A-Za-zÖüóőúéáíÖÜŐÚÉÁÍ]{2,8}-?\d+(?:\s*\/\s*\d{4})?)$/;
    if (!licenseRegex.test(license_number)) {
      showAlertModal('A megadott sportmászó engedélyszám formátuma érvénytelen! (Elvárt pl. SMV-00001 vagy GSE9999/2025)', 'Érvénytelen engedélyszám', 'warning');
      return;
    }
  }

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name,
        email,
        phone,
        license_number,
        card_type,
        role: roleStr,
        password: password || undefined
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Mentési hiba');

    showToast('Felhasználó adatai és jogosultságai sikeresen frissítve!');
    closeEditUserModal();
    loadAdminUsers();

    // If current logged in user, update localStorage and re-render header
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    if (currentUser.id === userId) {
      currentUser.name = name;
      currentUser.email = email;
      currentUser.role = roleStr;
      currentUser.card_type = card_type;
      localStorage.setItem('user', JSON.stringify(currentUser));
      renderHeader();
    }
  } catch (err) {
    showAlertModal(err.message || 'Hiba történt a felhasználó mentésekor.', 'Mentési hiba');
  }
}

// ---------------- USER DELETE WITH CONFIRMATION MODAL ----------------
async function confirmDeleteUser(userId) {
  const user = (window.adminUsers || []).find(u => u.id === userId);
  if (!user) {
    showToast('A felhasználó nem található!', 'error');
    return;
  }

  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  if (currentUser.id === userId) {
    showAlertModal('Nem törölheted a saját adminisztrátori fiókodat!', 'Törlés nem engedélyezett', 'warning');
    return;
  }

  if (user.email === 'admin@hawkstone.hu') {
    showAlertModal('Az Admin Főnök (admin@hawkstone.hu) fiók nem törölhető a rendszerből!', 'Törlés nem engedélyezett', 'warning');
    return;
  }

  const userRoles = (user.role || '').split(',').map(r => r.trim().toUpperCase());
  if (userRoles.includes('ADMIN')) {
    showAlertModal('Biztonsági okokból adminisztrátori fiókot nem lehet törölni! Előbb vond vissza az Admin jogosultságot a szerkesztésben.', 'Törlés nem engedélyezett', 'warning');
    return;
  }

  const confirmed = await showConfirmModal({
    title: 'Felhasználó törlése',
    message: `Biztosan törölni szeretnéd a következő tagot?

👤 ${user.name}
✉️ ${user.email}

Figyelem: Ez a művelet végleges és nem visszavonható! A felhasználó fiókja, valamint minden megvásárolt jegye, bérlete és foglalása azonnal törlődik az adatbázisból.`,
    confirmText: 'Végleges törlés',
    cancelText: 'Mégse',
    badge: 'Törlés megerősítése',
    variant: 'danger'
  });

  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Törlési hiba');

    showToast(`"${user.name}" sikeresen törölve a rendszerből!`);
    loadAdminUsers();
  } catch (err) {
    showAlertModal(err.message || 'Nem sikerült törölni a felhasználót.', 'Törlési hiba');
  }
}

let currentViewedUser = null;
let currentViewedUserLogs = [];

async function openUserDetailsModal(userId) {
  const listWrapper = document.getElementById('admin-users-list-wrapper');
  const detailsSubpage = document.getElementById('admin-user-details-subpage');
  
  if (!listWrapper || !detailsSubpage) return;
  
  // Hide list, show subpage details
  listWrapper.style.display = 'none';
  detailsSubpage.style.display = 'block';
  
  // Reset fields to loading
  document.getElementById('subpage-user-name-title').textContent = 'Betöltés...';
  document.getElementById('subpage-user-email').textContent = '-';
  document.getElementById('subpage-user-phone').textContent = '-';
  document.getElementById('subpage-user-license').textContent = '-';
  
  document.getElementById('subpage-user-tickets').innerHTML = '<p style="color:var(--text-muted); font-size: 13px;">Betöltés...</p>';
  document.getElementById('subpage-user-bookings').innerHTML = '<p style="color:var(--text-muted); font-size: 13px;">Betöltés...</p>';
  document.getElementById('subpage-user-logs').innerHTML = '<p style="color:var(--text-muted); font-size: 13px;">Betöltés...</p>';
  
  switchSubpageToView();

  try {
    const res = await fetch(`/api/admin/users/${userId}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Nem sikerült betölteni a tag részletes adatait.');
    
    const data = await res.json();
    const { user, tickets, bookings, logs } = data;
    
    currentViewedUser = user;
    currentViewedUserLogs = logs;
    
    // Hide delete button if editing oneself, Admin Főnök, or any user with ADMIN role
    const deleteBtn = document.getElementById('subpage-delete-user-btn');
    const currentUserObj = JSON.parse(localStorage.getItem('user') || '{}');
    if (deleteBtn) {
      if (user.id === currentUserObj.id || user.email === 'admin@hawkstone.hu' || user.role === 'ADMIN') {
        deleteBtn.style.display = 'none';
      } else {
        deleteBtn.style.display = 'block';
      }
    }
    
    // Populate User basic details
    document.getElementById('subpage-user-name-title').textContent = user.name;
    document.getElementById('subpage-user-email').textContent = user.email;
    document.getElementById('subpage-user-phone').textContent = user.phone || '-';
    document.getElementById('subpage-user-license').textContent = user.license_number || 'Nincs megadva';
    
    const cardBadge = document.getElementById('subpage-user-card');
    if (cardBadge) {
      cardBadge.textContent = user.card_type + ' KÁRTYA';
      cardBadge.className = 'badge ' + (user.card_type === 'ZÖLD' ? 'badge-green' : 'badge-red');
    }
    
    const roleLabel = user.role === 'ADMIN' ? 'Admin' : (user.role === 'STAFF' ? 'Staff' : 'Mászó');
    const roleEl = document.getElementById('subpage-user-role');
    if (roleEl) roleEl.textContent = roleLabel;
    
    // Pre-populate Edit fields
    document.getElementById('subpage-edit-user-id').value = user.id;
    document.getElementById('subpage-edit-user-name').value = user.name;
    document.getElementById('subpage-edit-user-email').value = user.email;
    document.getElementById('subpage-edit-user-phone').value = user.phone || '';
    document.getElementById('subpage-edit-user-license').value = user.license_number || '';
    document.getElementById('subpage-edit-user-card').value = user.card_type;
    document.getElementById('subpage-edit-user-role').value = user.role;
    
    // Save tickets and bookings globally for subpage tabs filtering
    window.currentSubpageTickets = tickets || [];
    window.currentSubpageBookings = bookings || [];
    
    // Render default tab states
    filterSubpageTickets('active');
    filterSubpageBookings('future');
    
    // Render Entry Logs
    const logsContainer = document.getElementById('subpage-user-logs');
    if (logsContainer) {
      logsContainer.innerHTML = '';
      if (!logs || logs.length === 0) {
        logsContainer.innerHTML = '<p style="color:var(--text-muted); font-size: 13px;">Nincsenek korábbi belépései.</p>';
      } else {
        logs.forEach(log => {
          let ticketLabel = '';
          if (log.ticket_type === 'NAPI') ticketLabel = 'Napijegy';
          else if (log.ticket_type === 'TIZ_ALKALMAS') ticketLabel = '10 alk. bérlet';
          else if (log.ticket_type === 'HAVI') ticketLabel = 'Havi bérlet';

          const formattedTime = log.scan_time ? log.scan_time.substring(0, 16).replace('T', ' ') : '-';
          const statusIcon = log.status === 'SUCCESS' ? '✅' : '❌';

          const logDiv = document.createElement('div');
          logDiv.style.background = 'rgba(255, 255, 255, 0.02)';
          logDiv.style.border = '1px solid rgba(255, 255, 255, 0.05)';
          logDiv.style.borderRadius = '6px';
          logDiv.style.padding = '6px 8px';
          logDiv.style.fontSize = '11px';

          logDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
              <span style="font-weight: 600; color: #fff;">${statusIcon} ${ticketLabel}</span>
              <span style="color: var(--text-muted); font-size: 10px;">${formattedTime}</span>
            </div>
            <div style="color: var(--text-secondary); line-height: 1.2;">
              Helyszín: <strong>${log.location_name || 'Ismeretlen'}</strong> | 
              <span style="color: ${log.status === 'SUCCESS' ? 'var(--success)' : 'var(--danger)'};">${log.message}</span>
            </div>
          `;
          logsContainer.appendChild(logDiv);
        });
      }
    }
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

function closeUserDetailsSubpage() {
  const listWrapper = document.getElementById('admin-users-list-wrapper');
  const detailsSubpage = document.getElementById('admin-user-details-subpage');
  if (listWrapper && detailsSubpage) {
    listWrapper.style.display = 'block';
    detailsSubpage.style.display = 'none';
  }
  currentViewedUser = null;
  currentViewedUserLogs = [];
}

function filterSubpageTickets(filter) {
  const activeBtn = document.getElementById('subpage-tickets-tab-active');
  const usedBtn = document.getElementById('subpage-tickets-tab-used');
  if (activeBtn && usedBtn) {
    if (filter === 'active') {
      activeBtn.className = 'btn btn-primary btn-sm';
      usedBtn.className = 'btn btn-secondary btn-sm';
    } else {
      activeBtn.className = 'btn btn-secondary btn-sm';
      usedBtn.className = 'btn btn-primary btn-sm';
    }
  }
  renderSubpageTicketsList(filter);
}

function renderSubpageTicketsList(filter) {
  const tickets = window.currentSubpageTickets || [];
  const ticketsContainer = document.getElementById('subpage-user-tickets');
  if (!ticketsContainer) return;

  ticketsContainer.innerHTML = '';
  
  const filtered = tickets.filter(t => filter === 'active' ? t.status === 'ACTIVE' : t.status !== 'ACTIVE');

  if (filtered.length === 0) {
    ticketsContainer.innerHTML = `<p style="color:var(--text-muted); font-size: 13px;">Nincsenek ${filter === 'active' ? 'aktív' : 'felhasznált/lejárt'} jegyek/bérletek.</p>`;
    return;
  }

  filtered.forEach(t => {
    let typeLabel = '';
    if (t.ticket_type === 'NAPI') typeLabel = 'Napijegy';
    else if (t.ticket_type === 'TIZ_ALKALMAS') typeLabel = '10 alk. bérlet';
    else if (t.ticket_type === 'HAVI') typeLabel = 'Havi bérlet';

    let sessionsLabel = '';
    if (t.ticket_type === 'NAPI') sessionsLabel = '1 alk.';
    else if (t.ticket_type === 'TIZ_ALKALMAS') sessionsLabel = `${t.sessions_remaining}/10 alk. maradt`;
    else if (t.ticket_type === 'HAVI') sessionsLabel = 'Korlátlan';

    const ticketDiv = document.createElement('div');
    ticketDiv.style.background = 'rgba(255, 255, 255, 0.02)';
    ticketDiv.style.border = '1px solid rgba(255,255,255,0.06)';
    ticketDiv.style.borderRadius = '8px';
    ticketDiv.style.padding = '8px 12px';
    ticketDiv.style.fontSize = '12px';
      const purchaseDisplay = t.purchase_date ? new Date(t.purchase_date).toLocaleString('hu-HU') : '-';
      ticketDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 3px;">
          <strong style="color:#ffffff;">${typeLabel}</strong>
          <span class="badge ${t.status === 'ACTIVE' ? 'badge-green' : 'badge-secondary'}" style="font-size:10px; padding: 2px 6px;">
            ${t.status === 'ACTIVE' ? 'Aktív' : (t.status === 'USED' ? 'Elhasznált' : 'Lejárt')}
          </span>
        </div>
        <div style="color:var(--text-secondary); font-size:11px;">
          Vásárlás: ${purchaseDisplay} | Lejárat: ${t.expires_date}<br>
          Egyenleg: <strong>${sessionsLabel}</strong>
        </div>
      `;
    ticketsContainer.appendChild(ticketDiv);
  });
}

function filterSubpageBookings(filter) {
  const futureBtn = document.getElementById('subpage-bookings-tab-future');
  const pastBtn = document.getElementById('subpage-bookings-tab-past');
  if (futureBtn && pastBtn) {
    if (filter === 'future') {
      futureBtn.className = 'btn btn-primary btn-sm';
      pastBtn.className = 'btn btn-secondary btn-sm';
    } else {
      futureBtn.className = 'btn btn-secondary btn-sm';
      pastBtn.className = 'btn btn-primary btn-sm';
    }
  }
  renderSubpageBookingsList(filter);
}

function renderSubpageBookingsList(filter) {
  const bookings = window.currentSubpageBookings || [];
  const bookingsContainer = document.getElementById('subpage-user-bookings');
  if (!bookingsContainer) return;

  bookingsContainer.innerHTML = '';

  const filtered = bookings.filter(b => {
    const isExpired = isBookingExpired(b.booking_date, b.end_time);
    const isAttended = b.attended > 0;
    const isPast = isExpired || isAttended;
    return filter === 'future' ? !isPast : isPast;
  });

  filtered.sort((a, b) => {
    const dateComp = a.booking_date.localeCompare(b.booking_date);
    if (dateComp !== 0) return filter === 'future' ? dateComp : -dateComp;
    return filter === 'future' ? a.start_time.localeCompare(b.start_time) : -a.start_time.localeCompare(b.start_time);
  });

  if (filtered.length === 0) {
    bookingsContainer.innerHTML = `<p style="color:var(--text-muted); font-size: 13px;">Nincsenek ${filter === 'future' ? 'aktuális' : 'korábbi'} foglalásai.</p>`;
    return;
  }

  filtered.forEach(b => {
    const isAttended = b.attended > 0;
    const bookingDiv = document.createElement('div');
    bookingDiv.style.background = 'rgba(255, 255, 255, 0.02)';
    bookingDiv.style.border = '1px solid rgba(255,255,255,0.04)';
    bookingDiv.style.borderRadius = '6px';
    bookingDiv.style.padding = '6px 10px';
    bookingDiv.style.fontSize = '11px';
    bookingDiv.style.display = 'flex';
    bookingDiv.style.justifyContent = 'space-between';
    bookingDiv.style.alignItems = 'center';
    
    let badgeHtml = '';
    if (isAttended) {
      const staffWho = b.scanned_by_staff_name ? ` (Staff: ${b.scanned_by_staff_name})` : '';
      badgeHtml = `<span class="badge badge-green" style="font-size: 9px; padding: 2px 6px; opacity: 0.95;" title="Beléptetve: ${b.scanned_at || ''}${staffWho}">✓ Megjelent${staffWho}</span>`;
    } else if (filter === 'past') {
      badgeHtml = `<span class="badge badge-secondary" style="font-size: 9px; padding: 2px 6px; opacity: 0.7;">Nem jelent meg</span>`;
    }

    bookingDiv.innerHTML = `
      <div>
        <span style="font-weight:600; color:#fff;">${b.booking_date}</span> | 
        <span>${b.start_time.substring(0,5)} - ${b.end_time.substring(0,5)}</span> 
        <span style="color:var(--primary);">(${b.location_name})</span>
      </div>
      ${badgeHtml}
    `;
    bookingsContainer.appendChild(bookingDiv);
  });
}

function switchSubpageToView() {
  const viewEl = document.getElementById('user-details-subpage-view-mode');
  const editEl = document.getElementById('user-details-subpage-edit-mode');
  if (viewEl) viewEl.style.display = 'block';
  if (editEl) editEl.style.display = 'none';
}

function switchSubpageToEdit() {
  const userIdVal = document.getElementById('subpage-edit-user-id').value;
  if (userIdVal) {
    openEditUserModal(parseInt(userIdVal));
  }
}

function triggerUserDeleteFromSubpage() {
  const userIdVal = document.getElementById('subpage-edit-user-id').value;
  if (userIdVal) {
    deleteUserFromSubpage(parseInt(userIdVal));
  }
}

async function deleteUserFromSubpage(userId) {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  if (currentUser.id === userId) {
    showAlertModal('Nem törölheted a saját adminisztrátori fiókodat!', 'Törlés nem engedélyezett');
    return;
  }

  if (currentViewedUser && currentViewedUser.email === 'admin@hawkstone.hu') {
    showAlertModal('Az Admin Főnök felhasználó nem törölhető az admin felületről!', 'Törlés nem engedélyezett');
    return;
  }

  if (currentViewedUser && currentViewedUser.role === 'ADMIN') {
    showAlertModal('Biztonsági okokból adminisztrátori fiókot nem lehet törölni!', 'Törlés nem engedélyezett');
    return;
  }

  const confirmed = await showConfirmModal({
    title: 'Felhasználó törlése',
    message: 'Biztosan törlöd ezt a felhasználót és minden hozzá tartozó adatot (jegyek, foglalások)?',
    confirmText: 'Törlés',
    cancelText: 'Mégse',
    variant: 'danger'
  });
  if (!confirmed) return;
  
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Törlési hiba');
    
    showToast('Felhasználó sikeresen törölve!');
    closeUserDetailsSubpage();
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
    showAlertModal(err.message || 'Nem sikerült törölni a felhasználót.', 'Törlési hiba');
  }
}

async function handleSubpageEditUserSubmit(e) {
  if (e) e.preventDefault();
  
  const id = document.getElementById('subpage-edit-user-id').value;
  const name = document.getElementById('subpage-edit-user-name').value;
  const email = document.getElementById('subpage-edit-user-email').value;
  const phone = document.getElementById('subpage-edit-user-phone').value;
  const license_number = document.getElementById('subpage-edit-user-license').value;
  const card_type = document.getElementById('subpage-edit-user-card').value;
  const role = document.getElementById('subpage-edit-user-role').value;
  const password = document.getElementById('subpage-edit-user-password').value;
  
  // Validation for ZÖLD card type
  if (card_type === 'ZÖLD') {
    if (!license_number || !license_number.trim()) {
      showToast('Zöld kártya minősítéshez kötelező sportmászó engedélyszám megadása!', 'error');
      return;
    }
    const licenseRegex = /^(SMV-\d+|[A-Za-zÖüóőúéáíÖÜÓŐÚÉÁÍ]{2,8}-?\d+(?:\s*\/\s*\d{4})?)$/;
    if (!licenseRegex.test(license_number.trim())) {
      showToast('A megadott sportmászó engedélyszám formátuma érvénytelen! (Elvárt pl. SMV-00001 vagy GSE9999/2025)', 'error');
      return;
    }
  }
  
  const payload = { name, email, phone, license_number, card_type, role };
  
  if (password && password.trim().length > 0) {
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    if (!passwordRegex.test(password)) {
      showToast('A megadott új jelszó nem felel meg a biztonsági követelményeknek! Legalább 8 karakter, kisbetű, nagybetű, szám és speciális karakter szükséges.', 'error');
      return;
    }
    payload.password = password;
  }
  
  try {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Mentési hiba');
    
    showToast('Felhasználó adatai sikeresen frissítve!');
    const passInput = document.getElementById('subpage-edit-user-password');
    if (passInput) passInput.value = '';
    
    // Refresh subpage details
    openUserDetailsModal(parseInt(id));
    loadAdminUsers();
    
    // If current user, update localStorage
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    if (currentUser.id === parseInt(id)) {
      currentUser.name = name;
      currentUser.email = email;
      currentUser.role = role;
      currentUser.card_type = card_type;
      localStorage.setItem('user', JSON.stringify(currentUser));
      renderHeader();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function exportUserLogsCSV() {
  if (!currentViewedUser || !currentViewedUserLogs) {
    showToast('Nincs betöltött felhasználó vagy előzmény!', 'error');
    return;
  }
  
  let csvContent = "\uFEFF"; // UTF-8 BOM
  csvContent += "Dátum;Jegytípus;Helyszín;Státusz;Részletek\r\n";
  
  currentViewedUserLogs.forEach(log => {
    let ticketLabel = '';
    if (log.ticket_type === 'NAPI') ticketLabel = 'Napijegy';
    else if (log.ticket_type === 'TIZ_ALKALMAS') ticketLabel = '10 alk. bérlet';
    else if (log.ticket_type === 'HAVI') ticketLabel = 'Havi bérlet';

    const formattedTime = log.scan_time ? log.scan_time.substring(0, 16).replace('T', ' ') : '-';
    const statusLabel = log.status === 'SUCCESS' ? 'SIKERES' : 'SIKERTELEN';
    const location = log.location_name || 'Ismeretlen';
    const message = log.message || '';

    csvContent += `"${formattedTime}";"${ticketLabel}";"${location}";"${statusLabel}";"${message.replace(/"/g, '""')}"\r\n`;
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const filename = `HawkStone_Belepesek_${currentViewedUser.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast('Látogatási előzmények kiexportálva!', 'success');
}

async function exportAllUsersToCSV() {
  try {
    const res = await fetch('/api/admin/users', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Nem sikerült lekérni a tagok listáját.');
    
    const users = await res.json();
    
    let csvContent = "\uFEFF"; // UTF-8 BOM
    csvContent += "Név;Email;Telefon;Engedélyszám;Kártyatípus;Szerepkör\r\n";
    
    users.forEach(u => {
      csvContent += `"${u.name}";"${u.email}";"${u.phone || ''}";"${u.license_number || ''}";"${u.card_type}";"${u.role}"\r\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const filename = `HawkStone_Felhasznalok_${new Date().toISOString().split('T')[0]}.csv`;
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Összes felhasználó kiexportálva!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function importUsersFromCSVFile(input) {
  const file = input.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async function(e) {
    const text = e.target.result;
    const lines = text.split(/\r?\n/);
    if (lines.length <= 1) {
      showToast('A CSV fájl üres vagy hiányzik a fejléc!', 'error');
      return;
    }
    
    const users = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const separator = line.includes(';') ? ';' : ',';
      const cols = line.split(separator).map(col => {
        let c = col.trim();
        if (c.startsWith('"') && c.endsWith('"')) {
          c = c.substring(1, c.length - 1);
        }
        return c;
      });
      
      if (cols.length < 2) continue;
      
      const [name, email, phone, license_number, card_type, role] = cols;
      if (!name || !email) continue;
      
      users.push({
        name,
        email,
        phone: phone || '',
        license_number: license_number || '',
        card_type: (card_type || 'PIROS').toUpperCase(),
        role: (role || 'USER').toUpperCase()
      });
    }
    
    if (users.length === 0) {
      showToast('Nem található érvényes felhasználó adat a fájlban!', 'error');
      return;
    }
    
    const confirmed = await showConfirmModal({
      title: 'Felhasználók importálása',
      message: `Biztosan be akarsz importálni ${users.length} felhasználót? A meglévő tagok adatai frissülni fognak.`,
      confirmText: 'Importálás',
      cancelText: 'Mégse',
      variant: 'primary'
    });
    if (!confirmed) {
      input.value = '';
      return;
    }
    
    try {
      const res = await fetch('/api/admin/users/import', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ users })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Importálási hiba');
      
      showToast(data.message, 'success');
      loadAdminUsers();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

window.selectedAdminWeek = 0;

function getMonday(d) {
  d = new Date(d);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const res = new Date(d);
  res.setUTCDate(diff);
  return res;
}

function renderWeekSelector() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find(p => p.type === type).value;
  const currentBudapest = new Date(`${getPart('year')}-${getPart('month')}-${getPart('day')}`);

  const currentMonday = getMonday(currentBudapest);
  for (let w = 0; w < 3; w++) {
    const m = new Date(currentMonday);
    m.setUTCDate(currentMonday.getUTCDate() + w * 7);
    const s = new Date(m);
    s.setUTCDate(m.getUTCDate() + 6);
    
    const pad = (n) => String(n).padStart(2, '0');
    const rangeStr = `${pad(m.getUTCMonth() + 1)}.${pad(m.getUTCDate())} - ${pad(s.getUTCMonth() + 1)}.${pad(s.getUTCDate())}`;
    
    const btn = document.getElementById(`admin-week-btn-${w}`);
    if (btn) {
      btn.innerHTML = `${w === 0 ? 'Ezen a héten' : (w === 1 ? 'Következő héten' : 'Harmadik héten')} <br><span style="font-size:11px; opacity:0.8;">(${rangeStr})</span>`;
      
      // Update active class
      if (w === window.selectedAdminWeek) {
        btn.className = 'btn btn-primary btn-sm';
      } else {
        btn.className = 'btn btn-secondary btn-sm';
      }
    }
  }
}

function switchAdminScheduleWeek(weekIndex) {
  window.selectedAdminWeek = weekIndex;
  renderWeekSelector();
  loadAdminSlots();
}

// Toggle the "Új idősáv hozzáadása" collapsible accordion
function toggleSlotForm() {
  const body = document.getElementById('slot-form-body');
  const arrow = document.getElementById('slot-form-arrow');
  if (!body) return;

  const isOpen = body.style.maxHeight && body.style.maxHeight !== '0px';
  if (isOpen) {
    body.style.maxHeight = '0px';
    body.style.paddingTop = '0';
    body.style.paddingBottom = '0';
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  } else {
    body.style.maxHeight = body.scrollHeight + 'px';
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  }
}
window.toggleSlotForm = toggleSlotForm;

async function loadAdminSlots() {
  renderWeekSelector(); // Ensure selectors are rendered
  
  const list = document.getElementById('admin-slots-list');
  const locSelect = document.getElementById('admin-slot-location');
  if (!list) return;

  list.innerHTML = '<p style="color:var(--text-muted);">Heti órarend betöltése...</p>';

  try {
    // Populate locations select if empty
    if (locSelect && locSelect.options.length <= 1) {
      const locRes = await fetch('/api/locations');
      const locations = await locRes.json();
      locations.forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc.id;
        opt.textContent = loc.name;
        locSelect.appendChild(opt);
      });
    }

    const res = await fetch('/api/admin/slots', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    const slots = await res.json();

    const cancRes = await fetch('/api/admin/cancellations', { headers: getAuthHeaders() });
    const cancellations = cancRes.ok ? await cancRes.json() : [];

    const daysHungarian = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];

    list.innerHTML = '';
    
    // Group slots by location and day index (0-6)
    const grouped = {};
    slots.forEach(s => {
      const locKey = s.location_name;
      if (!grouped[locKey]) grouped[locKey] = {};
      
      if (!grouped[locKey][s.day_of_week]) grouped[locKey][s.day_of_week] = [];
      
      grouped[locKey][s.day_of_week].push(s);
    });

    const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Monday (1) to Sunday (0)
    
    // Calculate Monday of the selected week
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('hu-HU', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type) => parts.find(p => p.type === type).value;
    const currentBudapest = new Date(`${getPart('year')}-${getPart('month')}-${getPart('day')}`);

    const currentMonday = getMonday(currentBudapest);
    const selectedMonday = new Date(currentMonday);
    selectedMonday.setUTCDate(currentMonday.getUTCDate() + window.selectedAdminWeek * 7);

    for (const locName in grouped) {
      const locDiv = document.createElement('div');
      locDiv.style.marginBottom = '30px';
      
      let daysHtml = '';
      dayOrder.forEach(dayIdx => {
        if (grouped[locName][dayIdx] && grouped[locName][dayIdx].length > 0) {
          const dayName = daysHungarian[dayIdx];
          
          // Calculate specific date for this day of the selected week
          const offset = dayIdx === 0 ? 6 : dayIdx - 1;
          const targetDate = new Date(selectedMonday);
          targetDate.setUTCDate(selectedMonday.getUTCDate() + offset);
          
          const pad = (n) => String(n).padStart(2, '0');
          const dateStr = `${targetDate.getUTCFullYear()}-${pad(targetDate.getUTCMonth() + 1)}-${pad(targetDate.getUTCDate())}`;
          const dateDisplayStr = `${pad(targetDate.getUTCMonth() + 1)}.${pad(targetDate.getUTCDate())}`;

          let slotItemsHtml = '';
          grouped[locName][dayIdx].forEach(s => {
            const isCancelled = cancellations.some(c => c.slot_id === s.id && c.cancelled_date === dateStr);
            
            if (isCancelled) {
              slotItemsHtml += `
                <div style="display:inline-flex; align-items:center; gap:8px; background:rgba(239,68,68,0.08); border:1px dashed #ef4444; padding:6px 12px; border-radius:30px; margin:4px; font-size:13px; text-decoration: line-through; color: var(--text-muted);">
                  <strong>${s.start_time} - ${s.end_time}</strong> (${s.max_capacity} fő)
                  <span onclick="uncancelAdminSlot(${s.id}, '${dateStr}')" style="color:var(--success); cursor:pointer; font-weight:bold; padding-left:4px; text-decoration: none;" title="Lemondás visszavonása">+</span>
                </div>
              `;
            } else {
              slotItemsHtml += `
                <div style="display:inline-flex; align-items:center; gap:8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-color); padding:6px 12px; border-radius:30px; margin:4px; font-size:13px;">
                  <strong>${s.start_time} - ${s.end_time}</strong> (${s.max_capacity} fő)
                  <span onclick="deleteAdminSlot(${s.id}, '${dateStr}')" style="color:var(--danger); cursor:pointer; font-weight:bold; padding-left:4px;" title="Törlés/Lemondás">×</span>
                </div>
              `;
            }
          });

          daysHtml += `
            <div style="margin-bottom:12px;">
              <span style="font-weight:600; font-size:14px; width:150px; display:inline-block; color:var(--text-secondary);">${dayName} (${dateDisplayStr}):</span>
              <div style="display:inline-block; vertical-align:middle;">${slotItemsHtml}</div>
            </div>
          `;
        }
      });

      locDiv.innerHTML = `
        <h4 style="border-bottom: 1px solid var(--border-color); padding-bottom:8px; margin-bottom:12px; color:var(--primary);">${locName}</h4>
        ${daysHtml}
      `;
      list.appendChild(locDiv);
    }
  } catch (err) {
    list.innerHTML = '<p style="color:var(--danger);">Nem sikerült az órarend betöltése.</p>';
  }
}

async function addAdminSlot(e) {
  if (e) e.preventDefault();
  const locationId = document.getElementById('admin-slot-location').value;
  const dayOfWeek = document.getElementById('admin-slot-day').value;
  const startTime = document.getElementById('admin-slot-start').value;
  const endTime = document.getElementById('admin-slot-end').value;
  const maxCapacity = document.getElementById('admin-slot-capacity').value;

  if (!locationId || dayOfWeek === '' || !startTime || !endTime) {
    showToast('Kérjük tölts ki minden mezőt!', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/slots', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ locationId: parseInt(locationId), dayOfWeek: parseInt(dayOfWeek), startTime, endTime, maxCapacity: parseInt(maxCapacity) })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Új idősáv sikeresen hozzáadva!');
    loadAdminSlots();
    document.getElementById('admin-slot-form').reset();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteAdminSlot(slotId, dateStr) {
  const choice = await showConfirmModal({
    title: 'Idősáv törlése / lemondása',
    message: `Mit szeretnél tenni ezzel az idősávval (${dateStr})?\n\nVálaszthatod, hogy csak erre a hétre mondod le, vagy véglegesen törlöd a heti alap órarendből.`,
    badge: 'Órarend módosítása',
    variant: 'warning',
    cancelValue: null,
    actions: [
      { label: 'Mégse', value: null, className: 'btn btn-secondary' },
      { label: 'Csak ezen a héten', value: 'week', className: 'btn btn-primary' },
      { label: 'Végleges törlés', value: 'permanent', className: 'btn btn-danger' }
    ]
  });

  if (choice === 'week') {
    try {
      const res = await fetch('/api/admin/slots/cancel', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ slotId, date: dateStr })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Hiba a lemondás során');
      showToast('Idősáv lemondva erre a dátumra.');
      loadAdminSlots();
    } catch (err) {
      showToast(err.message, 'error');
      showAlertModal(err.message || 'Hiba történt az idősáv lemondása során.', 'Lemondási hiba');
    }
  } else if (choice === 'permanent') {
    try {
      const res = await fetch(`/api/admin/slots/${slotId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Hiba a törlés során');

      showToast('Idősáv véglegesen törölve a sablonból.');
      loadAdminSlots();
    } catch (err) {
      showToast(err.message, 'error');
      showAlertModal(err.message || 'Hiba történt az idősáv végleges törlése során.', 'Törlési hiba');
    }
  }
}

async function uncancelAdminSlot(slotId, dateStr) {
  const confirmed = await showConfirmModal({
    title: 'Idősáv visszaállítása',
    message: `Biztosan visszaállítod ezt az idősávot a megadott dátumra (${dateStr})?`,
    confirmText: 'Visszaállítás',
    cancelText: 'Mégse',
    variant: 'primary'
  });
  if (!confirmed) return;
  
  try {
    const res = await fetch('/api/admin/slots/uncancel', {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ slotId, date: dateStr })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a visszaállítás során');
    
    showToast('Idősáv visszaállítva.');
    loadAdminSlots();
  } catch (err) {
    showToast(err.message, 'error');
    showAlertModal(err.message || 'Hiba a visszaállítás során.', 'Hiba történt');
  }
}

// ---------------- ANNOUNCEMENTS BOARD (ÜZENŐFAL) ----------------

// Text formatting for Rich Editor
function formatEditorText(tag) {
  const textarea = document.getElementById('admin-news-content-text');
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selectedText = text.substring(start, end);
  
  const formatted = `<${tag}>${selectedText}</${tag}>`;
  textarea.value = text.substring(0, start) + formatted + text.substring(end);
  
  textarea.focus();
  textarea.selectionStart = start;
  textarea.selectionEnd = start + formatted.length;
  updateAdminNewsPreview();
}

function updateAdminNewsPreview() {
  const titleVal = document.getElementById('admin-news-title')?.value?.trim() || 'Ünnepi nyitvatartás';
  const contentVal = document.getElementById('admin-news-content-text')?.value?.trim() || 'Írd be bal oldalon a közlemény címét és szövegét az élő előnézethez!';
  const pTitle = document.getElementById('admin-news-preview-title');
  const pContent = document.getElementById('admin-news-preview-content');
  if (pTitle) pTitle.textContent = titleVal;
  if (pContent) pContent.innerHTML = contentVal;
}
window.updateAdminNewsPreview = updateAdminNewsPreview;

// Load all announcements in Admin view
async function loadNewsAnnouncements() {
  const container = document.getElementById('admin-news-list');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--text-muted); text-align:center; width:100%;">Hírek betöltése...</p>';

  try {
    const res = await fetch('/api/announcements?target=club', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    const list = await res.json();

    container.innerHTML = '';
    if (list.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); padding:15px; text-align:center; width:100%;">Nincs még közzétett hír.</p>';
      return;
    }

    window.adminAnnouncements = list; // Save globally for editing lookup

    const grid = document.createElement('div');
    grid.className = 'news-cards-grid';

    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'news-card';
      card.style.cursor = 'default';

      const activeBadge = item.is_active ? '<span class="badge badge-green">Aktív</span>' : '<span class="badge badge-red">Inaktív</span>';
      
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = item.content;
      const cleanContent = tempDiv.textContent || tempDiv.innerText || '';
      const preview = cleanContent.length > 120 ? cleanContent.substring(0, 120) + '...' : cleanContent;

      let imagePreviewHtml = '';
      if (item.image_url) {
        imagePreviewHtml = `<div style="margin-top: 8px; max-height: 100px; overflow: hidden; border-radius: 6px;"><img src="${item.image_url}" style="width: 100%; height: auto; object-fit: cover; opacity: 0.8;" /></div>`;
      }

      card.innerHTML = `
        <div style="flex-grow: 1; text-align: center;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap: 10px;">
            <div style="font-weight:700; color:#fff; font-size:16px; flex:1; text-align:center;">${item.title}</div>
            ${activeBadge}
          </div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px; text-align:center;">
            ${item.created_at ? item.created_at.substring(0, 16).replace('T', ' ') : '-'}
          </div>
          ${imagePreviewHtml}
          <div style="font-size:13px; color:var(--text-secondary); margin-top:8px; line-height:1.5; text-align:center;">
            ${preview}
          </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:15px; border-top: 1px solid rgba(255,255,255,0.05); padding-top:12px;">
          <button onclick="editNewsAnnouncement(${item.id})" class="btn btn-secondary btn-sm" style="flex:1; padding:6px;">Szerkesztés</button>
          <button onclick="deleteNewsAnnouncement(${item.id})" class="btn btn-danger btn-sm" style="flex:1; padding:6px; background:#ef4444; border-color:#ef4444;">Törlés</button>
        </div>
      `;
      grid.appendChild(card);
    });

    container.appendChild(grid);
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger); text-align:center; width:100%;">Nem sikerült betölteni az üzenőfalat.</p>';
  }
}

// Create or Update Announcement
async function saveNewsAnnouncement(e) {
  if (e) e.preventDefault();

  const id = document.getElementById('admin-news-id').value;
  const title = document.getElementById('admin-news-title').value;
  const content = document.getElementById('admin-news-content-text').value;
  const imageUrl = document.getElementById('admin-news-image').value;
  const isActive = document.getElementById('admin-news-active').checked;

  if (!title || !content) {
    showToast('Kérjük töltsd ki a címet és a tartalmat!', 'error');
    return;
  }

  const payload = { title, content, imageUrl, isActive, target: 'club' };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/announcements/${id}` : '/api/announcements';

  try {
    const res = await fetch(url, {
      method: method,
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(id ? 'Hír sikeresen frissítve!' : 'Új hír sikeresen közzétéve!');
    cancelNewsEdit();
    loadNewsAnnouncements();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Load news details into editor form
function editNewsAnnouncement(id) {
  if (!window.adminAnnouncements) return;
  const item = window.adminAnnouncements.find(ann => ann.id === id);
  if (!item) return;

  document.getElementById('admin-news-id').value = item.id;
  document.getElementById('admin-news-title').value = item.title;
  document.getElementById('admin-news-content-text').value = item.content;
  document.getElementById('admin-news-image').value = item.image_url || '';
  document.getElementById('admin-news-active').checked = !!item.is_active;

  document.getElementById('news-form-title').textContent = 'Közlemény Szerkesztése';
  document.getElementById('news-submit-btn').textContent = 'Módosítás Mentése';
  document.getElementById('news-cancel-btn').style.display = 'block';
  updateAdminNewsPreview();

  document.getElementById('admin-news-form').scrollIntoView({ behavior: 'smooth' });
}

// Delete announcement
async function deleteNewsAnnouncement(id) {
  const confirmed = await showConfirmModal({
    title: 'Közlemény törlése',
    message: 'Biztosan törlöd ezt a közleményt az üzenőfalról?',
    confirmText: 'Törlés',
    cancelText: 'Mégse',
    variant: 'danger'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/announcements/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Közlemény törölve!');
    loadNewsAnnouncements();
  } catch (err) {
    showToast(err.message, 'error');
    showAlertModal(err.message || 'Nem sikerült törölni a közleményt.', 'Törlési hiba');
  }
}

// Cancel news editing and clear form
function cancelNewsEdit() {
  document.getElementById('admin-news-id').value = '';
  document.getElementById('admin-news-form').reset();

  document.getElementById('news-form-title').textContent = 'Új közlemény közzététele';
  document.getElementById('news-submit-btn').textContent = 'Közzététel';
  document.getElementById('news-cancel-btn').style.display = 'none';
  updateAdminNewsPreview();
}

// ---------------- ADMIN BOOKINGS (ADMIN) ----------------
let currentSelectedWeekIdx = 0; // Default to the first (current) week
window.adminBookings = [];

function getWeeksData() {
  const now = new Date();
  
  // Get current Budapest date/time
  const formatter = new Intl.DateTimeFormat('hu-HU', {
    timeZone: 'Europe/Budapest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find(p => p.type === type).value;
  const currentBudapest = new Date(`${getPart('year')}-${getPart('month')}-${getPart('day')}`);

  // Get day of week (0 = Sun, 1 = Mon ... 6 = Sat)
  const day = currentBudapest.getUTCDay();
  // Calculate distance to current week's Monday
  // If today is Sunday (0), distance is -6 days. Otherwise distance is -(day - 1) days.
  const distanceToMonday = day === 0 ? -6 : -(day - 1);
  
  const monday1 = new Date(currentBudapest);
  monday1.setUTCDate(currentBudapest.getUTCDate() + distanceToMonday);
  
  const sunday1 = new Date(monday1);
  sunday1.setUTCDate(monday1.getUTCDate() + 6);
  
  const monday2 = new Date(monday1);
  monday2.setUTCDate(monday1.getUTCDate() + 7);
  const sunday2 = new Date(monday2);
  sunday2.setUTCDate(monday2.getUTCDate() + 6);

  const monday3 = new Date(monday1);
  monday3.setUTCDate(monday1.getUTCDate() + 14);
  const sunday3 = new Date(monday3);
  sunday3.setUTCDate(monday3.getUTCDate() + 6);

  const formatDate = (d) => {
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${month}.${day}`;
  };

  const formatDateIso = (d) => {
    return d.toISOString().split('T')[0];
  };

  return [
    {
      label: `${formatDate(monday1)} - ${formatDate(sunday1)}`,
      start: formatDateIso(monday1),
      end: formatDateIso(sunday1)
    },
    {
      label: `${formatDate(monday2)} - ${formatDate(sunday2)}`,
      start: formatDateIso(monday2),
      end: formatDateIso(sunday2)
    },
    {
      label: `${formatDate(monday3)} - ${formatDate(sunday3)}`,
      start: formatDateIso(monday3),
      end: formatDateIso(sunday3)
    }
  ];
}

// ---------------- ADMIN WITHDRAWALS LOG (EU 2023/2673) ----------------

// Format UTC datetime string to Hungarian local time (Europe/Budapest)
function formatHungarianDateTime(utcStr) {
  if (!utcStr) return '-';
  // SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" in UTC
  // Add 'Z' suffix so JS parses it as UTC
  const normalized = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z';
  try {
    const d = new Date(normalized);
    return d.toLocaleString('hu-HU', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch (_) {
    return utcStr.substring(0, 19);
  }
}

window.currentWithdrawalFilter = 'pending';
window.currentWithdrawalMonth = '';
window.currentWithdrawalSearch = '';
window.adminWithdrawals = [];
window.currentFilteredWithdrawals = [];

let withdrawalsSearchTimeout = null;

async function loadAdminWithdrawals() {
  const container = document.getElementById('admin-withdrawals-list');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; color: var(--text-muted); padding: 20px;">Elállások lekérése...</p>';

  try {
    const res = await fetch('/api/admin/withdrawals', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Hiba a naplózott elállások lekérésekor.');
    const data = await res.json();

    window.adminWithdrawals = data;
    initWithdrawalsMonthFilter(data);
    renderAdminWithdrawals();
  } catch (err) {
    container.innerHTML = `<p style="text-align:center; color: var(--danger); padding: 20px;">Hiba történt az elállások betöltésekor: ${err.message}</p>`;
  }
}

function initWithdrawalsMonthFilter(list) {
  const monthSelect = document.getElementById('admin-withdrawals-filter-month');
  if (!monthSelect) return;

  const monthsSet = new Set();
  (list || []).forEach(w => {
    if (w.withdrawal_time) {
      monthsSet.add(w.withdrawal_time.substring(0, 7));
    }
  });

  const months = Array.from(monthsSet).sort().reverse();
  const currentVal = monthSelect.value;
  monthSelect.innerHTML = '<option value="">Összes elállási időszak</option>';

  months.forEach(m => {
    const [y, mo] = m.split('-');
    const d = new Date(parseInt(y), parseInt(mo) - 1, 1);
    const monthName = d.toLocaleString('hu-HU', { month: 'long' });
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = `${y}. ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`;
    if (m === currentVal) opt.selected = true;
    monthSelect.appendChild(opt);
  });
}

function applyWithdrawalsFilters() {
  const monthSelect = document.getElementById('admin-withdrawals-filter-month');
  const searchInput = document.getElementById('admin-withdrawals-filter-search');

  window.currentWithdrawalMonth = monthSelect ? monthSelect.value : '';
  window.currentWithdrawalSearch = searchInput ? searchInput.value.trim().toLowerCase() : '';

  renderAdminWithdrawals();
}

function debounceWithdrawalsSearch() {
  clearTimeout(withdrawalsSearchTimeout);
  withdrawalsSearchTimeout = setTimeout(() => {
    applyWithdrawalsFilters();
  }, 350);
}

function renderAdminWithdrawals() {
  const container = document.getElementById('admin-withdrawals-list');
  if (!container || !window.adminWithdrawals) return;

  const currentFilter = window.currentWithdrawalFilter || 'pending';
  const monthVal = window.currentWithdrawalMonth || '';
  const searchVal = window.currentWithdrawalSearch || '';

  const tabPending = document.getElementById('withdrawal-tab-pending');
  const tabCompleted = document.getElementById('withdrawal-tab-completed');
  const tabAll = document.getElementById('withdrawal-tab-all');
  if (tabPending && tabCompleted) {
    tabPending.className = currentFilter === 'pending' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    tabCompleted.className = currentFilter === 'completed' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    if (tabAll) tabAll.className = currentFilter === 'all' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
  }

  const filtered = window.adminWithdrawals.filter(w => {
    const status = w.refund_status || 'PENDING';

    if (currentFilter === 'pending') {
      if (!(status === 'PENDING' || status === 'UNDER_REVIEW')) return false;
    } else if (currentFilter === 'completed') {
      if (!(status === 'REFUNDED' || status === 'REJECTED')) return false;
    }

    if (monthVal && !(w.withdrawal_time || '').startsWith(monthVal)) return false;

    if (searchVal) {
      const name = (w.customer_name || w.user_name || '').toLowerCase();
      const email = (w.customer_email || w.user_email || '').toLowerCase();
      const contract = (w.contract_id || '').toLowerCase();
      if (!name.includes(searchVal) && !email.includes(searchVal) && !contract.includes(searchVal)) return false;
    }

    return true;
  });

  window.currentFilteredWithdrawals = filtered;

  if (filtered.length === 0) {
    let emptyMsg = 'Nincsenek a megadott szűrésnek megfelelő elállási igények.';
    if (currentFilter === 'pending') emptyMsg = 'Nincsenek folyamatban lévő elállási igények a megadott szűrésben.';
    else if (currentFilter === 'completed') emptyMsg = 'Nincsenek kivizsgált elállási igények a megadott szűrésben.';
    container.innerHTML = `<p style="text-align:center; color: var(--text-muted); padding: 40px 20px;">${emptyMsg}</p>`;
    return;
  }

  const refundLabels = {
    'PENDING':  { label: 'Folyamatban', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
    'REFUNDED': { label: 'Visszatérítve', color: '#10b981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.25)' },
    'REJECTED': { label: 'Elutasítva', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)' },
    'UNDER_REVIEW': { label: 'Vizsgálat alatt', color: '#6366f1', bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.25)' },
  };

  let html = `<div style="display: flex; flex-direction: column; gap: 16px;">`;

  filtered.forEach(w => {
    let typeLabel = '';
    let priceText = '';
    if (w.ticket_type === 'NAPI') { typeLabel = 'Napijegy'; priceText = '2 800 Ft'; }
    else if (w.ticket_type === 'TIZ_ALKALMAS') { typeLabel = '10 Alkalmas Bérlet'; priceText = '22 000 Ft'; }
    else if (w.ticket_type === 'HAVI') { typeLabel = 'Korlátlan Havi Bérlet'; priceText = '28 000 Ft'; }

    const refundKey = w.refund_status || 'PENDING';
    const rf = refundLabels[refundKey] || refundLabels['PENDING'];
    const formattedWithdrawal = formatHungarianDateTime(w.withdrawal_time);
    const purchaseDisplay = w.purchase_date ? new Date(w.purchase_date).toLocaleDateString('hu-HU') : '-';

    html += `
      <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 14px; padding: 20px 24px; display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; transition: border-color 0.2s;" onmouseover="this.style.borderColor='rgba(242,118,32,0.35)'" onmouseout="this.style.borderColor='var(--border-color)'">
        
        <!-- Left: Customer & ticket info -->
        <div style="flex: 1; min-width: 220px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
            <span style="font-size: 15px; font-weight: 700; color: #fff;">${escapeHtml(w.customer_name || w.user_name)}</span>
            <span style="font-size: 11px; background: ${rf.bg}; border: 1px solid ${rf.border}; color: ${rf.color}; padding: 3px 9px; border-radius: 20px; font-weight: 600;">${rf.label}</span>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">${escapeHtml(w.customer_email || w.user_email)} ${w.user_phone ? '· ' + escapeHtml(w.user_phone) : ''}</div>
          <div style="font-size: 13px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 3px;">
            <span>🎫 <strong style="color:#fff;">${typeLabel}</strong> &nbsp;|&nbsp; ID: <code style="font-size:12px; color: var(--primary);">#${w.ticket_id}</code></span>
            <span>💰 Vételár (becsült): <strong style="color:#fff;">${priceText}</strong></span>
            <span>📅 Vásárlás: <strong style="color:#fff;">${purchaseDisplay}</strong></span>
            <span>⏱️ Elállás: <strong style="color: var(--primary);">${formattedWithdrawal}</strong></span>
            ${w.admin_note ? `<span style="margin-top:6px; font-size:11px; color:#94a3b8; font-style:italic;">📝 Megjegyzés: ${escapeHtml(w.admin_note)}</span>` : ''}
          </div>
        </div>

        <!-- Right: Contract ID + Actions -->
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 10px; min-width: 180px;">
          <div style="font-size: 11px; color: var(--text-muted); text-align: right;">
            Szerz. azonosító:<br><code style="font-size:12px; color:#fff;">${w.contract_id}</code>
          </div>
          <button onclick="openWithdrawalInvestigationModal(${JSON.stringify(w).replace(/"/g, '&quot;')})" class="btn btn-primary btn-sm" style="padding: 9px 16px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
            Vizsgálat indítása
          </button>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function switchWithdrawalFilter(filter) {
  window.currentWithdrawalFilter = filter;
  renderAdminWithdrawals();
}

// Export Withdrawals to Excel (CSV with UTF-8 BOM)
async function exportWithdrawalsToExcel() {
  const rows = window.currentFilteredWithdrawals || window.adminWithdrawals || [];
  if (rows.length === 0) {
    showToast('Nincs exportálható elállási adat a megadott szűréshez!', 'warning');
    return;
  }

  const headers = [
    'Bejelentés Időpontja',
    'Tag / Vásárló Neve',
    'E-mail Cím',
    'Telefonszám',
    'Szerződés / Bizonylat ID',
    'Jegy / Bérlet Típusa',
    'Visszatérítendő Becsült Összeg',
    'Fennmaradó Alkalmak',
    'Eredeti Vásárlás Dátuma',
    'Bérlet Lejárata',
    'Elállás Státusza',
    'Adminisztrátori Megjegyzés'
  ];

  const csvLines = [headers.map(h => `"${h}"`).join(';')];

  rows.forEach(w => {
    let typeLabel = '';
    let priceText = '';
    if (w.ticket_type === 'NAPI') { typeLabel = 'Napijegy'; priceText = '2800 Ft'; }
    else if (w.ticket_type === 'TIZ_ALKALMAS') { typeLabel = '10 Alkalmas Bérlet'; priceText = '22000 Ft'; }
    else if (w.ticket_type === 'HAVI') { typeLabel = 'Korlátlan Havi Bérlet'; priceText = '28000 Ft'; }

    let statusLabel = 'Folyamatban';
    if (w.refund_status === 'REFUNDED') statusLabel = 'Visszatérítve';
    else if (w.refund_status === 'REJECTED') statusLabel = 'Elutasítva';
    else if (w.refund_status === 'UNDER_REVIEW') statusLabel = 'Vizsgálat alatt';

    const line = [
      w.withdrawal_time ? w.withdrawal_time.substring(0, 19).replace('T', ' ') : '',
      w.customer_name || w.user_name || '',
      w.customer_email || w.user_email || '',
      w.user_phone || '',
      w.contract_id || '',
      typeLabel,
      priceText,
      w.sessions_remaining != null ? w.sessions_remaining : '-',
      w.purchase_date ? w.purchase_date.substring(0, 10) : '',
      w.ticket_expires_date ? w.ticket_expires_date.substring(0, 10) : '',
      statusLabel,
      w.admin_note || ''
    ].map(val => `"${String(val).replace(/"/g, '""')}"`);

    csvLines.push(line.join(';'));
  });

  const csvContent = '\uFEFF' + csvLines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const today = new Date().toISOString().split('T')[0];
  const monthTag = window.currentWithdrawalMonth ? `_${window.currentWithdrawalMonth}` : '';
  link.download = `hawkstone_elallasok${monthTag}_${today}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Elállási adatok sikeresen letöltve Excel formátumban!', 'success');
}

// Export Withdrawals to PDF / Print
async function exportWithdrawalsToPDF() {
  const rows = window.currentFilteredWithdrawals || window.adminWithdrawals || [];
  if (rows.length === 0) {
    showToast('Nincs nyomtatható elállási adat a megadott szűréshez!', 'warning');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Kérjük, engedélyezd a felugró ablakokat a nyomtatáshoz!', 'error');
    return;
  }

  let tableRowsHtml = '';
  let totalPending = 0;
  let totalRefunded = 0;

  rows.forEach(w => {
    let typeLabel = '';
    let priceText = '';
    if (w.ticket_type === 'NAPI') { typeLabel = 'Napijegy'; priceText = '2 800 Ft'; }
    else if (w.ticket_type === 'TIZ_ALKALMAS') { typeLabel = '10 Alkalmas Bérlet'; priceText = '22 000 Ft'; }
    else if (w.ticket_type === 'HAVI') { typeLabel = 'Korlátlan Havi Bérlet'; priceText = '28 000 Ft'; }

    let statusStyle = 'color:#f59e0b;font-weight:bold;';
    let statusLabel = 'Folyamatban';
    if (w.refund_status === 'REFUNDED') {
      statusLabel = 'Visszatérítve';
      statusStyle = 'color:#10b981;font-weight:bold;';
      totalRefunded++;
    } else if (w.refund_status === 'REJECTED') {
      statusLabel = 'Elutasítva';
      statusStyle = 'color:#ef4444;font-weight:bold;';
    } else {
      totalPending++;
    }

    tableRowsHtml += `
      <tr>
        <td>${w.withdrawal_time ? w.withdrawal_time.substring(0, 16).replace('T', ' ') : '-'}</td>
        <td><strong>${escapeHtml(w.customer_name || w.user_name || '-')}</strong><br><small>${escapeHtml(w.customer_email || w.user_email || '')}</small></td>
        <td><code style="background:#f4f4f4;padding:2px 4px;border-radius:3px;">${escapeHtml(w.contract_id || '-')}</code></td>
        <td>${escapeHtml(typeLabel)}<br><small style="color:#666;">${priceText}</small></td>
        <td>${w.sessions_remaining != null ? w.sessions_remaining : '-'} alkalom</td>
        <td style="${statusStyle}">${statusLabel}</td>
        <td><small>${escapeHtml(w.admin_note || '-')}</small></td>
      </tr>
    `;
  });

  const todayStr = new Date().toLocaleString('hu-HU');
  const monthHeader = window.currentWithdrawalMonth ? ` (${window.currentWithdrawalMonth} havi szűrés)` : '';

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HawkStone - Elállási Nyilatkozatok & Visszatérítések</title>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; color: #222; margin: 25px; }
        h2 { margin: 0 0 4px 0; color: #f27620; text-transform: uppercase; }
        .meta { font-size: 11px; color: #666; margin-bottom: 15px; }
        .kpi-box { display: flex; gap: 15px; margin-bottom: 20px; }
        .kpi { background: #f9f9f9; border: 1px solid #e5e5e5; padding: 10px 14px; border-radius: 6px; }
        .kpi strong { display: block; font-size: 16px; color: #111; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 7px 9px; text-align: left; }
        th { background: #f4f4f4; font-weight: bold; font-size: 11px; }
        @media print {
          body { margin: 0; }
        }
      </style>
    </head>
    <body>
      <h2>HawkStone Mászóklub – Elállási Jegyzék & Visszatérítések${monthHeader}</h2>
      <div class="meta">Generálva: ${todayStr} | Összesen ${rows.length} bejegyzés a nézetben</div>
      <div class="kpi-box">
        <div class="kpi"><span>Összes elállás:</span><strong>${rows.length} db</strong></div>
        <div class="kpi"><span>Visszatérítve:</span><strong style="color:#10b981;">${totalRefunded} db</strong></div>
        <div class="kpi"><span>Folyamatban lévő:</span><strong style="color:#f59e0b;">${totalPending} db</strong></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Időpont</th>
            <th>Tag / Fogyasztó</th>
            <th>Szerződés ID</th>
            <th>Jegytípus</th>
            <th>Fennmaradt</th>
            <th>Státusz</th>
            <th>Megjegyzés</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// Open investigation modal for a withdrawal record
function openWithdrawalInvestigationModal(w) {
  // Remove existing modal if any
  const existing = document.getElementById('withdrawal-investigation-modal');
  if (existing) existing.remove();

  let typeLabel = '';
  let priceText = '';
  if (w.ticket_type === 'NAPI') { typeLabel = 'Egyszeri Napijegy'; priceText = '2 800 Ft'; }
  else if (w.ticket_type === 'TIZ_ALKALMAS') { typeLabel = '10 Alkalmas Bérlet'; priceText = '22 000 Ft'; }
  else if (w.ticket_type === 'HAVI') { typeLabel = 'Korlátlan Havi Bérlet (30 nap)'; priceText = '28 000 Ft'; }

  const formattedWithdrawal = formatHungarianDateTime(w.withdrawal_time);
  const purchaseDisplay = w.purchase_date ? w.purchase_date.substring(0, 10) : '-';
  const expiresDisplay = w.ticket_expires_date ? w.ticket_expires_date.substring(0, 10) : '-';

  const refundLabels = {
    'PENDING':  { label: 'Folyamatban', color: '#f59e0b' },
    'REFUNDED': { label: 'Visszatérítve', color: '#10b981' },
    'REJECTED': { label: 'Elutasítva', color: '#ef4444' },
    'UNDER_REVIEW': { label: 'Vizsgálat alatt', color: '#6366f1' },
  };
  const rf = refundLabels[w.refund_status || 'PENDING'] || refundLabels['PENDING'];

  const modal = document.createElement('div');
  modal.id = 'withdrawal-investigation-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);padding:20px;';
  modal.innerHTML = `
    <div style="background: #0f1117; border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; box-shadow: 0 24px 80px rgba(0,0,0,0.7);">
      
      <!-- Header -->
      <div style="padding: 24px 28px 18px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between;">
        <div>
          <h3 style="margin:0; font-size:18px; font-weight:700; color:#fff; font-family:'Montserrat',sans-serif;">🔍 Elállás Vizsgálata</h3>
          <p style="margin:4px 0 0; font-size:12px; color: var(--text-muted);">Elállás #${w.id} &nbsp;·&nbsp; Szerz. azonosító: <code style="color:var(--primary)">${w.contract_id}</code></p>
        </div>
        <button onclick="document.getElementById('withdrawal-investigation-modal').remove()" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:14px;transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">✕</button>
      </div>

      <!-- Body -->
      <div style="padding: 24px 28px; display: flex; flex-direction: column; gap: 20px;">
        
        <!-- Customer info -->
        <div>
          <p style="margin:0 0 10px; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:var(--primary); font-weight:700;">Fogyasztó adatai</p>
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px 16px; font-size:13px; color: var(--text-secondary); display: flex; flex-direction: column; gap:5px;">
            <span>👤 <strong style="color:#fff;">${w.customer_name}</strong></span>
            <span>✉️ ${w.customer_email}</span>
            <span>🔖 Felhasználó ID: #${w.user_id}</span>
          </div>
        </div>

        <!-- Ticket info -->
        <div>
          <p style="margin:0 0 10px; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:var(--primary); font-weight:700;">Jegy adatai</p>
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px 16px; font-size:13px; color: var(--text-secondary); display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <span>🎫 Típus: <strong style="color:#fff;">${typeLabel}</strong></span>
            <span>🆔 Jegy ID: <code style="color:var(--primary);">#${w.ticket_id}</code></span>
            <span>💰 Becsült vételár: <strong style="color:#fff;">${priceText}</strong></span>
            <span>🔢 Felhasználatlan: <strong style="color:#fff;">${w.sessions_remaining} alkalom</strong></span>
            <span>📅 Vásárlás: <strong style="color:#fff;">${purchaseDisplay}</strong></span>
            <span>⏳ Lejárat: <strong style="color:#fff;">${expiresDisplay}</strong></span>
          </div>
        </div>

        <!-- Withdrawal timing -->
        <div>
          <p style="margin:0 0 10px; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:var(--primary); font-weight:700;">Elállás időbélyege</p>
          <div style="background: rgba(242,118,32,0.06); border: 1px solid rgba(242,118,32,0.2); border-radius: 10px; padding: 14px 16px; font-size:13px; color: var(--text-secondary); display: flex; flex-direction: column; gap:5px;">
            <span>⏱️ Magyar idő: <strong style="color: var(--primary); font-size:15px;">${formattedWithdrawal}</strong></span>
            <span style="font-size:11px; color: var(--text-muted);">Az EU fogyasztóvédelmi rendelet (2023/2673) értelmében a nyilatkozat tartós adathordozón (e-mailben) visszaigazolásra került.</span>
          </div>
        </div>

        <!-- Current refund status -->
        <div>
          <p style="margin:0 0 10px; font-size:11px; text-transform:uppercase; letter-spacing:0.1em; color:var(--primary); font-weight:700;">Visszatérítési státusz</p>
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <span style="font-size:13px; font-weight:700; color:${rf.color};">● ${rf.label}</span>
            <select id="modal-refund-status-${w.id}" style="background:#1a1d2e;border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer;flex:1;min-width:160px;">
              <option value="PENDING" ${(w.refund_status||'PENDING')==='PENDING'?'selected':''}>Folyamatban (Pending)</option>
              <option value="UNDER_REVIEW" ${w.refund_status==='UNDER_REVIEW'?'selected':''}>Vizsgálat alatt</option>
              <option value="REFUNDED" ${w.refund_status==='REFUNDED'?'selected':''}>Visszatérítve</option>
              <option value="REJECTED" ${w.refund_status==='REJECTED'?'selected':''}>Elutasítva</option>
            </select>
          </div>
          ${w.admin_note ? `<p style="margin:10px 0 0; font-size:12px; color:#94a3b8; font-style:italic; background:rgba(255,255,255,0.02); border-radius:8px; padding:10px;">📝 Utolsó megjegyzés: ${w.admin_note}</p>` : ''}
        </div>

      </div>

      <!-- Action Buttons -->
      <div style="padding: 18px 28px 24px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end;">
        <button onclick="openWithdrawalMessageModal(${w.id}, '${w.customer_name.replace(/'/g,"\\'")}', '${w.customer_email}', '${w.contract_id}')" style="background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);color:#818cf8;border-radius:10px;padding:11px 20px;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.2s;display:flex;align-items:center;gap:7px;" onmouseover="this.style.background='rgba(99,102,241,0.22)'" onmouseout="this.style.background='rgba(99,102,241,0.12)'">
          Üzenet írása
        </button>
        <button onclick="initiateWithdrawalRefund(${w.id})" style="background:linear-gradient(135deg,#10b981,#059669);border:none;color:#fff;border-radius:10px;padding:11px 20px;cursor:pointer;font-size:13px;font-weight:700;transition:all 0.2s;display:flex;align-items:center;gap:7px;box-shadow:0 4px 14px rgba(16,185,129,0.3);" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 20px rgba(16,185,129,0.4)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 14px rgba(16,185,129,0.3)'">
          Visszatérítés indítása
        </button>
      </div>
    </div>
  `;

  // Close on backdrop click
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// Initiate refund: update status to REFUNDED
async function initiateWithdrawalRefund(withdrawalId) {
  const selectEl = document.getElementById(`modal-refund-status-${withdrawalId}`);
  const newStatus = selectEl ? selectEl.value : 'REFUNDED';

  try {
    const res = await fetch(`/api/admin/withdrawals/${withdrawalId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ refund_status: newStatus === 'PENDING' ? 'REFUNDED' : newStatus })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    showToast('Visszatérítési státusz frissítve!', 'success');
    document.getElementById('withdrawal-investigation-modal')?.remove();
    await loadAdminWithdrawals();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Open message modal
function openWithdrawalMessageModal(withdrawalId, customerName, customerEmail, contractId) {
  const existing = document.getElementById('withdrawal-message-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'withdrawal-message-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);padding:20px;';
  modal.innerHTML = `
    <div style="background: #0f1117; border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; width: 100%; max-width: 520px; box-shadow: 0 24px 80px rgba(0,0,0,0.8);">
      <div style="padding: 22px 26px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:space-between;">
        <div>
          <h3 style="margin:0; font-size:16px; font-weight:700; color:#fff; font-family:'Montserrat',sans-serif;">✉️ Üzenet a fogyasztónak</h3>
          <p style="margin:4px 0 0; font-size:12px; color:var(--text-muted);">Küldés: <strong style="color:#fff;">${customerName}</strong> &lt;${customerEmail}&gt;</p>
        </div>
        <button onclick="document.getElementById('withdrawal-message-modal').remove()" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:8px;padding:7px 11px;cursor:pointer;font-size:13px;">✕</button>
      </div>
      <div style="padding: 22px 26px; display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:12px; color:var(--primary); font-weight:600; display:block; margin-bottom:6px;">Tárgy (opcionális)</label>
          <input id="msg-subject-${withdrawalId}" type="text" placeholder="HawkStone – Elállási ügy értesítő (#${contractId})" style="width:100%;background:#1a1d2e;border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:8px;padding:10px 12px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:12px; color:var(--primary); font-weight:600; display:block; margin-bottom:6px;">Üzenet szövege *</label>
          <textarea id="msg-body-${withdrawalId}" rows="6" placeholder="Írja ide az üzenetet a fogyasztónak..." style="width:100%;background:#1a1d2e;border:1px solid rgba(255,255,255,0.12);color:#fff;border-radius:8px;padding:10px 12px;font-size:13px;box-sizing:border-box;resize:vertical;font-family:inherit;line-height:1.6;"></textarea>
        </div>
      </div>
      <div style="padding: 14px 26px 22px; border-top: 1px solid rgba(255,255,255,0.08); display:flex; gap:10px; justify-content:flex-end;">
        <button onclick="document.getElementById('withdrawal-message-modal').remove()" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:9px;padding:10px 18px;cursor:pointer;font-size:13px;font-weight:600;">Mégse</button>
        <button onclick="sendWithdrawalMessage(${withdrawalId})" style="background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;color:#fff;border-radius:9px;padding:10px 22px;cursor:pointer;font-size:13px;font-weight:700;box-shadow:0 4px 14px rgba(99,102,241,0.35);">Küldés</button>
      </div>
    </div>
  `;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// Send admin message to customer
async function sendWithdrawalMessage(withdrawalId) {
  const subjectEl = document.getElementById(`msg-subject-${withdrawalId}`);
  const bodyEl = document.getElementById(`msg-body-${withdrawalId}`);
  const message = bodyEl?.value?.trim();
  if (!message) { showToast('Az üzenet szövege kötelező!', 'error'); return; }

  const btn = document.querySelector('#withdrawal-message-modal button[onclick*="sendWithdrawalMessage"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Küldés...'; }

  try {
    const res = await fetch(`/api/admin/withdrawals/${withdrawalId}/message`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ subject: subjectEl?.value?.trim() || '', message })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    showToast('Üzenet sikeresen elküldve!', 'success');
    document.getElementById('withdrawal-message-modal')?.remove();
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Küldés'; }
  }
}

let currentBookingsLocationId = null;
let currentBookingsLocationName = '';

async function loadAdminBookings() {
  const locationsView = document.getElementById('admin-bookings-locations-view');
  const detailsView = document.getElementById('admin-bookings-details-view');
  
  if (currentBookingsLocationId === null) {
    if (locationsView) locationsView.style.display = 'block';
    if (detailsView) detailsView.style.display = 'none';

    const container = document.getElementById('admin-bookings-locations-grid');
    if (!container) return;
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 20px; grid-column: 1/-1;">Helyszínek statisztikáinak betöltése...</p>';

    try {
      const res = await fetch('/api/admin/bookings/stats', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error();
      const stats = await res.json();
      renderBookingsLocationsGrid(stats);
    } catch (err) {
      console.error(err);
      container.innerHTML = '<p style="color:var(--danger); text-align:center; padding: 20px; grid-column: 1/-1;">Nem sikerült betölteni a helyszínek statisztikáit.</p>';
    }
  } else {
    if (locationsView) locationsView.style.display = 'none';
    if (detailsView) detailsView.style.display = 'block';

    const container = document.getElementById('admin-bookings-list');
    if (!container) return;
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 20px;">Foglalások betöltése...</p>';

    try {
      const weeks = getWeeksData();
      const activeWeek = weeks[currentSelectedWeekIdx];
      const res = await fetch(`/api/admin/bookings?locationId=${currentBookingsLocationId}&startDate=${activeWeek.start}&endDate=${activeWeek.end}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error();
      const bookings = await res.json();
      window.adminBookings = bookings;
      renderAdminBookings();
    } catch (err) {
      console.error(err);
      container.innerHTML = '<p style="color:var(--danger); text-align:center; padding: 20px;">Nem sikerült betölteni a foglalásokat.</p>';
    }
  }
}

function renderBookingsLocationsGrid(stats) {
  const container = document.getElementById('admin-bookings-locations-grid');
  if (!container) return;

  container.innerHTML = '';
  
  const imageMap = {
    1: 'pictures/eotvos_wall.png',
    2: 'pictures/kossuth_wall.png',
    3: 'pictures/zrinyi_wall.png'
  };

  stats.forEach(loc => {
    const imgPath = imageMap[loc.location_id] || 'pictures/eotvos_wall.png';
    const card = document.createElement('div');
    card.className = 'location-booking-card';
    card.onclick = () => showBookingsDetailsForLocation(loc.location_id, loc.location_name);

    card.innerHTML = `
      <img src="${imgPath}" alt="${loc.location_name}">
      <div class="location-booking-card-body">
        <h4 class="location-booking-card-title">${loc.location_name}</h4>
        <div class="location-booking-card-stats">
          <div class="location-booking-card-stat-item">
            <span class="location-booking-card-stat-label">Korábbi</span>
            <span class="location-booking-card-stat-value">${loc.past_count || 0}</span>
          </div>
          <div class="location-booking-card-stat-item">
            <span class="location-booking-card-stat-label">Aktuális</span>
            <span class="location-booking-card-stat-value">${loc.future_count || 0}</span>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function showBookingsLocationsGrid() {
  currentBookingsLocationId = null;
  currentBookingsLocationName = '';
  loadAdminBookings();
}

function showBookingsDetailsForLocation(locationId, locationName) {
  currentBookingsLocationId = locationId;
  currentBookingsLocationName = locationName;
  
  const titleEl = document.getElementById('admin-booking-location-title');
  if (titleEl) titleEl.textContent = locationName;
  
  currentSelectedWeekIdx = 0;
  loadAdminBookings();
}

function renderAdminBookings() {
  const container = document.getElementById('admin-bookings-list');
  const weekSelector = document.getElementById('admin-bookings-week-selector');
  if (!container || !window.adminBookings) return;

  const weeks = getWeeksData();

  if (weekSelector) {
    weekSelector.innerHTML = '';
    weeks.forEach((w, idx) => {
      const btn = document.createElement('button');
      btn.className = idx === currentSelectedWeekIdx ? 'btn btn-primary' : 'btn btn-secondary';
      btn.style.fontSize = '14px';
      btn.style.padding = '8px 16px';
      btn.style.margin = '4px';
      btn.textContent = w.label;
      btn.onclick = () => {
        currentSelectedWeekIdx = idx;
        loadAdminBookings();
      };
      weekSelector.appendChild(btn);
    });
  }

  const activeWeek = weeks[currentSelectedWeekIdx];
  const filteredBookings = window.adminBookings;

  container.innerHTML = '';
  if (filteredBookings.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding: 35px; font-size:15px;">Nincs aktív foglalás erre a hétre (${activeWeek.label}).</p>`;
    return;
  }

  const grouped = {};
  filteredBookings.forEach(b => {
    const date = b.booking_date;
    const slotTime = `${b.start_time.substring(0, 5)} - ${b.end_time.substring(0, 5)}`;

    if (!grouped[date]) grouped[date] = {};
    if (!grouped[date][slotTime]) grouped[date][slotTime] = [];

    grouped[date][slotTime].push(b);
  });

  const sortedDates = Object.keys(grouped).sort();
  const daysHungarian = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];

  sortedDates.forEach(date => {
    const dateCard = document.createElement('div');
    dateCard.className = 'glass-card';
    dateCard.style.marginBottom = '25px';
    dateCard.style.padding = '20px';
    dateCard.style.background = 'rgba(255, 255, 255, 0.01)';
    dateCard.style.border = '1px solid var(--border-color)';

    const dateObj = new Date(date);
    const formattedDate = `${date.replace(/-/g, '. ')}. (${daysHungarian[dateObj.getDay()]})`;

    let dateHtml = `<h4 style="font-size:18px; color:var(--primary); margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:8px; font-family:'Outfit', sans-serif;">${formattedDate}</h4>`;

    for (const slotTime in grouped[date]) {
      dateHtml += `
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 12px; margin-bottom: 10px;">
          <div style="font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; font-size: 13px; display: flex; align-items: center; gap: 6px;">
            <span style="color: var(--primary); font-size: 11px;">🕒</span> ${slotTime}
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
      `;

      grouped[date][slotTime].forEach(b => {
        const isPastBooking = isBookingExpired(b.booking_date, b.end_time);
        let attendedBadge = '';
        if (b.attended > 0) {
          const staffText = b.scanned_by_staff_name ? ` (Beléptette: ${b.scanned_by_staff_name})` : '';
          attendedBadge = `<span class="badge badge-green" style="font-size: 9px; padding: 2px 6px; opacity: 0.95; margin-left: 8px;" title="Beléptetve: ${b.scanned_at || ''}${staffText}">✓ Megjelent${staffText}</span>`;
        } else if (isPastBooking) {
          attendedBadge = `<span class="badge badge-secondary" style="font-size: 9px; padding: 2px 6px; opacity: 0.7; margin-left: 8px;">Nem jelent meg</span>`;
        }
        dateHtml += `
          <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; font-size: 13px;">
            <div>
              <strong style="color: #fff; font-size: 14px;">${b.user_name}</strong> 
              ${attendedBadge}
              <span style="color: var(--text-muted); margin-left: 8px; font-size: 11px;">(${b.user_email} | ${b.user_phone || '-'})</span>
            </div>
            <button onclick="cancelAdminBooking(${b.booking_id})" class="btn btn-danger btn-sm" style="padding: 4px 10px; font-size: 11px; background: #ef4444; border-color: #ef4444; min-height: auto; line-height: 1.2;">
              Törlés
            </button>
          </div>
        `;
      });

      dateHtml += `
          </div>
        </div>
      `;
    }

    dateCard.innerHTML = dateHtml;
    container.appendChild(dateCard);
  });
}

async function cancelAdminBooking(bookingId) {
  const confirmed = await showConfirmModal({
    title: 'Foglalás törlése',
    message: 'Biztosan törölni szeretnéd ezt a foglalást?',
    confirmText: 'Törlés',
    cancelText: 'Mégse',
    variant: 'danger'
  });
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Foglalás sikeresen törölve!');
    loadAdminBookings();
  } catch (err) {
    showToast(err.message, 'error');
    showAlertModal(err.message || 'Nem sikerült törölni a foglalást.', 'Törlési hiba');
  }
}

// Check if there is an active announcement and display modal on landing/dashboard
async function checkActiveAnnouncement() {
  const path = window.location.pathname;
  const hostname = (window.location.hostname || '').toLowerCase();
  const isClubHost = hostname.startsWith('klub.') || hostname.startsWith('maszoklub.') || hostname.startsWith('foglalas.');
  const isClubTarget = isClubHost || path.endsWith('klub.html') || path.endsWith('maszoklub.html') || path.endsWith('foglalas.html') || path.endsWith('dashboard.html');
  const isWebTarget = !isClubHost && (path.endsWith('index.html') || path === '/' || path.endsWith('webpage/') || path.endsWith('/') || path.endsWith('maszofalaink.html') || path.endsWith('referenciak.html') || path.endsWith('iso9001.html') || path.endsWith('kapcsolat.html'));
  if (!isClubTarget && !isWebTarget) return;

  const targetParam = isClubTarget ? 'club' : 'web';

  try {
    const res = await fetch(`/api/announcements/active?target=${targetParam}`);
    if (!res.ok) return;
    const active = await res.json();

    if (!active) return;

    const isDismissed = sessionStorage.getItem('announcement_closed_' + active.id);
    if (isDismissed) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'announcement-modal-backdrop';
    backdrop.id = 'announcement-modal-backdrop';

    const card = document.createElement('div');
    card.className = 'announcement-modal-card';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'announcement-modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => {
      backdrop.classList.remove('open');
      sessionStorage.setItem('announcement_closed_' + active.id, 'true');
      setTimeout(() => backdrop.remove(), 400);
    };

    const titleEl = document.createElement('h3');
    titleEl.style.fontSize = '24px';
    titleEl.style.color = 'var(--primary)';
    titleEl.style.marginBottom = '15px';
    titleEl.style.fontFamily = "'Montserrat', sans-serif";
    titleEl.textContent = active.title;

    const contentEl = document.createElement('div');
    contentEl.className = 'announcement-modal-content';
    contentEl.innerHTML = active.content;

    card.appendChild(closeBtn);
    card.appendChild(titleEl);

    if (active.image_url) {
      const img = document.createElement('img');
      img.className = 'announcement-modal-img';
      img.src = active.image_url;
      img.alt = active.title;
      card.appendChild(img);
    }

    card.appendChild(contentEl);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    setTimeout(() => {
      backdrop.classList.add('open');
    }, 100);

  } catch (err) {
    console.error('Failed to load active announcement modal', err);
  }
}

// ---------------- GLOBAL SCROLL REVEAL ANIMATIONS ----------------
function initScrollAnimations() {
  const animElements = document.querySelectorAll(
    '.scroll-animate, .rules-item, .climb-card, .glass-card:not(.main-rules-card), .wall-card, .price-card, .about-text-col, .about-video-col, .location-card'
  );
  
  if (animElements.length === 0) return;

  animElements.forEach(el => {
    if (!el.classList.contains('scroll-animate')) {
      el.classList.add('scroll-animate');
    }
  });

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -80px 0px',
    threshold: 0.12
  };

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animated');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  animElements.forEach(el => {
    observer.observe(el);
  });
}

// ---------------- 3D CARD STACK HERO SHOWCASE ----------------
let cardStackOrder = [0, 1, 2, 3, 4, 5];
let cardStackAutoTimer = null;
let isStackAnimating = false;

function updateCardPositions() {
  const cardItems = document.querySelectorAll('.card-stack-item');
  if (cardItems.length === 0) return;

  cardItems.forEach(card => {
    const cardId = parseInt(card.getAttribute('data-card'), 10);
    const posIndex = cardStackOrder.indexOf(cardId);
    
    // Remove all pos-* classes
    for (let i = 0; i < 6; i++) {
      card.classList.remove(`pos-${i}`);
    }
    
    if (posIndex !== -1) {
      card.classList.add(`pos-${posIndex}`);
    }
  });

  // Sync indicator dots with the top active card
  const dots = document.querySelectorAll('.card-dot');
  if (dots.length > 0) {
    const topCardId = cardStackOrder[0];
    dots.forEach((dot, idx) => {
      dot.classList.toggle('active', idx === topCardId);
    });
  }

  // Sync center brand overlay (herocim.png):
  // When card 0 (hero01.png which already includes the 3D logo graphic) is on top,
  // we let hero01's built-in logo shine cleanly without duplication;
  // when cards 1..5 are in front, herocim.png floats in the center branding the photos!
  const brandOverlay = document.getElementById('heroBrandOverlay');
  if (brandOverlay) {
    const topCardId = cardStackOrder[0];
    if (topCardId === 0) {
      brandOverlay.style.opacity = '0';
      brandOverlay.style.transform = 'translate(-50%, -50%) scale(0.94)';
    } else {
      brandOverlay.style.opacity = '1';
      brandOverlay.style.transform = 'translate(-50%, -50%) scale(1)';
    }
  }

  const counterEl = document.getElementById('cardCurrentIndex');
  if (counterEl) {
    counterEl.textContent = (cardStackOrder[0] + 1).toString();
  }
}

function cycleCardStack(direction = 1) {
  if (isStackAnimating) return;
  const container = document.getElementById('cardStack');
  if (!container) return;

  const cardItems = document.querySelectorAll('.card-stack-item');
  if (cardItems.length === 0) return;

  isStackAnimating = true;

  if (direction === 1) {
    // Top card flies out to the right
    const topCardId = cardStackOrder[0];
    const nextTopCard = cardStackOrder[1];
    if (nextTopCard === 0) {
      // Amikor az utolsó kép van és jön újra az első, kicsit hamarabb tűnjön el a cím
      const brandOverlay = document.getElementById('heroBrandOverlay');
      if (brandOverlay) {
        brandOverlay.style.opacity = '0';
        brandOverlay.style.transform = 'translate(-50%, -50%) scale(0.92)';
      }
    }

    const topCard = container.querySelector(`.card-stack-item[data-card="${topCardId}"]`);
    if (topCard) {
      topCard.classList.add('card-flying-out');
    }

    setTimeout(() => {
      cardStackOrder.push(cardStackOrder.shift());
      if (topCard) topCard.classList.remove('card-flying-out');
      updateCardPositions();
      setTimeout(() => {
        isStackAnimating = false;
      }, 100);
    }, 400);

  } else {
    // Reverse cycle: last card comes to the front
    const lastCardId = cardStackOrder[cardStackOrder.length - 1];
    const lastCard = container.querySelector(`.card-stack-item[data-card="${lastCardId}"]`);
    
    if (lastCard) {
      lastCard.classList.add('card-flying-out-reverse');
    }

    setTimeout(() => {
      cardStackOrder.unshift(cardStackOrder.pop());
      if (lastCard) lastCard.classList.remove('card-flying-out-reverse');
      updateCardPositions();
      setTimeout(() => {
        isStackAnimating = false;
      }, 100);
    }, 400);
  }

  const isTopHero01 = cardStackOrder[0] === 0;
  resetCardStackAutoTimer(isTopHero01 ? 6000 : 5000);
}

function handleCardItemClick(clickedCardId) {
  const currentTop = cardStackOrder[0];
  if (clickedCardId === currentTop) {
    cycleCardStack(1);
  } else {
    if (clickedCardId === 0) {
      const brandOverlay = document.getElementById('heroBrandOverlay');
      if (brandOverlay) {
        brandOverlay.style.opacity = '0';
        brandOverlay.style.transform = 'translate(-50%, -50%) scale(0.92)';
      }
    }
    // Bring clicked card directly to top
    while (cardStackOrder[0] !== clickedCardId) {
      cardStackOrder.push(cardStackOrder.shift());
    }
    updateCardPositions();
    const isTopHero01 = cardStackOrder[0] === 0;
    resetCardStackAutoTimer(isTopHero01 ? 6000 : 5000);
  }
}

let preFadeTitleTimer = null;

function resetCardStackAutoTimer(delay = 5000) {
  if (cardStackAutoTimer) clearTimeout(cardStackAutoTimer);
  if (preFadeTitleTimer) clearTimeout(preFadeTitleTimer);

  const nextTopCard = cardStackOrder[1];
  // Ha a következő kép az első kép (hero01.png), kb. 1000ms-mal a váltás előtt finoman eltüntetjük a címet
  if (nextTopCard === 0 && delay > 1400) {
    preFadeTitleTimer = setTimeout(() => {
      const brandOverlay = document.getElementById('heroBrandOverlay');
      if (brandOverlay) {
        brandOverlay.style.opacity = '0';
        brandOverlay.style.transform = 'translate(-50%, -50%) scale(0.92)';
      }
    }, delay - 1000);
  }

  cardStackAutoTimer = setTimeout(() => {
    cycleCardStack(1);
    const isTopHero01 = cardStackOrder[0] === 0;
    resetCardStackAutoTimer(isTopHero01 ? 6000 : 5000);
  }, delay);
}

// Bind to window for HTML inline calls
window.cycleCardStack = cycleCardStack;
window.handleCardItemClick = handleCardItemClick;

function initCompanyLanding() {
  updateCardPositions();
  // Az első kép (hero01.png) 6 másodpercig marad a képernyőn
  resetCardStackAutoTimer(6000);

  const container = document.getElementById('cardStack');
  if (container) {
    // Pause auto timer on hover
    container.addEventListener('mouseenter', () => {
      if (cardStackAutoTimer) clearTimeout(cardStackAutoTimer);
      if (preFadeTitleTimer) clearTimeout(preFadeTitleTimer);
    });
    container.addEventListener('mouseleave', () => {
      const isTopHero01 = cardStackOrder[0] === 0;
      resetCardStackAutoTimer(isTopHero01 ? 6000 : 5000);
    });

    // Touch swipe support for mobile
    let touchStartX = 0;
    container.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const diff = touchStartX - touchEndX;
      if (Math.abs(diff) > 40) {
        cycleCardStack(diff > 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  // Lightbox Modal for gallery images
  document.querySelectorAll('.company-gallery-thumbs .gallery-item img').forEach(img => {
    img.style.cursor = 'pointer';
    img.addEventListener('click', () => {
      openCompanyLightbox(img.src, img.alt);
    });
  });
}

function openCompanyLightbox(src, alt) {
  let modal = document.getElementById('company-lightbox-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'company-lightbox-modal';
    modal.className = 'lightbox-modal';
    modal.innerHTML = `
      <div class="lightbox-overlay" onclick="closeCompanyLightbox()"></div>
      <div class="lightbox-content">
        <button class="lightbox-close" onclick="closeCompanyLightbox()" aria-label="Bezárás">&times;</button>
        <img id="lightbox-img" src="" alt="">
        <p id="lightbox-caption" style="text-align:center; color:var(--text-secondary); margin-top:10px; font-size:14px;"></p>
      </div>
    `;
    document.body.appendChild(modal);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeCompanyLightbox();
    });
  }

  const imgEl = modal.querySelector('#lightbox-img');
  const captionEl = modal.querySelector('#lightbox-caption');
  if (imgEl) imgEl.src = src;
  if (captionEl) captionEl.textContent = alt || '';

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCompanyLightbox() {
  const modal = document.getElementById('company-lightbox-modal');
  if (modal) {
    modal.classList.remove('active');
  }
  document.body.style.overflow = '';
}

// ---------------- INITIALIZATION CHECK ----------------
document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  loadDynamicContactInfo();
  loadDynamicWallProducts();
  loadDynamicHomeWallTypes();
  checkActiveAnnouncement();
  initScrollAnimations();
  initInactivityWatcher();

  const path = window.location.pathname;
  const hostname = (window.location.hostname || '').toLowerCase();
  const isClubHost = hostname.startsWith('klub.') || hostname.startsWith('maszoklub.') || hostname.startsWith('foglalas.');
  const isClubPage = isClubHost || path.endsWith('klub.html') || path.endsWith('maszoklub.html') || path.endsWith('foglalas.html');
  const isLocationsGridPresent = !!document.getElementById('public-locations-grid');

  if (isClubPage || isLocationsGridPresent) {
    initPublicLanding();
  } else if (!isClubHost && (path.endsWith('index.html') || path === '/' || path.endsWith('webpage/'))) {
    initCompanyLanding();
  } else if (path.endsWith('dashboard.html')) {
    initDashboard();
  } else if (path.endsWith('webadmin.html') || path.endsWith('/webadmin')) {
    initWebAdminPanel();
  } else if (path.endsWith('/admin.html') || path === 'admin.html') {
    initAdminPanel();
    const form = document.getElementById('admin-slot-form');
    if (form) form.addEventListener('submit', addAdminSlot);
  } else if (path.endsWith('scanner.html')) {
    initScanner();
  }

  // Global Click Listener for mobile tooltips
  document.addEventListener('click', (e) => {
    const badge = e.target.closest('.badge[data-tooltip]');
    document.querySelectorAll('.badge.show-tooltip').forEach(b => {
      if (b !== badge) b.classList.remove('show-tooltip');
    });
    if (badge) {
      badge.classList.toggle('show-tooltip');
      e.stopPropagation();
    } else {
      document.querySelectorAll('.badge.show-tooltip').forEach(b => b.classList.remove('show-tooltip'));
    }
  });
});

// ---------------- CHECKINS & PAST BOOKINGS MANAGEMENT ----------------

// State variables for Checkins
let currentCheckinsPage = 1;
const checkinsPageLimit = 25;
let checkinsSearchTimeout = null;
let checkinsStaffListCache = null;

// State variables for Past Bookings
let currentPastBookingsPage = 1;
const pastBookingsPageLimit = 25;
let pastBookingsSearchTimeout = null;

// 1. Load user bookings inside edit modal
async function loadUserBookingsInModal(userId) {
  const container = document.getElementById('modal-user-bookings-container');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--text-muted); font-size:12px; margin:0; text-align:center;">Foglalások lekérdezése...</p>';

  try {
    const res = await fetch(`/api/admin/users/${userId}/bookings`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Hiba a foglalások lekérdezésekor');
    const bookings = await res.json();

    if (!bookings || bookings.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:12px; margin:0; text-align:center;">Ennek a felhasználónak még nincsenek foglalásai.</p>';
      return;
    }

    let html = '<div class="modal-bookings-grid">';
    bookings.forEach(b => {
      const isPast = isBookingExpired(b.booking_date, b.end_time);
      const isAttended = b.attended > 0;

      let statusBadge = '';
      if (isAttended) {
        const staffWho = b.scanned_by_staff_name ? ` · Staff: <strong>${escapeHtml(b.scanned_by_staff_name)}</strong>` : '';
        const scanTimeText = b.scanned_at ? ` (${b.scanned_at.substring(11, 16)})` : '';
        statusBadge = `<span class="badge badge-green" style="font-size:10px; padding:2px 7px; font-weight:600;">✅ Megjelent${staffWho}${scanTimeText}</span>`;
      } else if (isPast) {
        statusBadge = '<span class="badge badge-secondary" style="font-size:10px; padding:2px 7px; opacity:0.75;">❌ Nem jelent meg</span>';
      } else {
        statusBadge = '<span class="badge badge-primary" style="font-size:10px; padding:2px 7px; font-weight:600;">⏳ Aktuális</span>';
      }

      html += `
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:8px 10px; display:flex; flex-direction:column; gap:5px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
            <span style="font-weight:700; color:#fff; font-size:12px; font-family:'Outfit',monospace;">${b.booking_date}</span>
            <span style="color:var(--primary); font-size:11px; font-weight:600;">${escapeHtml(b.location_name)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
            <span style="color:var(--text-secondary); font-size:11px;">🕒 ${b.start_time.substring(0,5)} - ${b.end_time.substring(0,5)}</span>
            <div>${statusBadge}</div>
          </div>
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    console.error('Error loading user bookings in modal:', err);
    container.innerHTML = '<p style="color:var(--danger); font-size:12px; margin:0; text-align:center;">Nem sikerült betölteni a foglalási adatokat.</p>';
  }
}

// 2. Load Checkins Filters (Locations & Staff)
async function initCheckinsFilters() {
  const locSelect = document.getElementById('admin-checkins-filter-location');
  const staffSelect = document.getElementById('admin-checkins-filter-staff');

  // Load locations if empty
  if (locSelect && locSelect.options.length <= 1) {
    try {
      const res = await fetch('/api/locations');
      if (res.ok) {
        const locations = await res.json();
        locations.forEach(loc => {
          const opt = document.createElement('option');
          opt.value = loc.id;
          opt.textContent = loc.name;
          locSelect.appendChild(opt);
        });
      }
    } catch (e) {}
  }

  // Load staff list if empty
  if (staffSelect && staffSelect.options.length <= 1) {
    try {
      if (!checkinsStaffListCache) {
        const res = await fetch('/api/admin/checkins/staff-list', { headers: getAuthHeaders() });
        if (res.ok) checkinsStaffListCache = await res.json();
      }
      if (checkinsStaffListCache) {
        checkinsStaffListCache.forEach(staff => {
          const opt = document.createElement('option');
          opt.value = staff.id;
          opt.textContent = `${staff.name} (${staff.role})`;
          staffSelect.appendChild(opt);
        });
      }
    } catch (e) {}
  }
}

// 3. Load Admin Checkins List with Pagination & Filters
async function loadAdminCheckins(page = 1) {
  currentCheckinsPage = page;
  await initCheckinsFilters();

  const container = document.getElementById('admin-checkins-table-container');
  const paginationEl = document.getElementById('admin-checkins-pagination');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 25px;">Beléptetési adatok betöltése...</p>';

  const locVal = document.getElementById('admin-checkins-filter-location')?.value || '';
  const staffVal = document.getElementById('admin-checkins-filter-staff')?.value || '';
  const statusVal = document.getElementById('admin-checkins-filter-status')?.value || 'SUCCESS';
  const searchVal = document.getElementById('admin-checkins-filter-search')?.value.trim() || '';

  const queryParams = new URLSearchParams({
    page: currentCheckinsPage,
    limit: checkinsPageLimit
  });
  if (locVal) queryParams.set('locationId', locVal);
  if (staffVal) queryParams.set('staffId', staffVal);
  if (statusVal) queryParams.set('status', statusVal);
  if (searchVal) queryParams.set('search', searchVal);

  try {
    const res = await fetch(`/api/admin/checkins?${queryParams.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Nem sikerült betölteni a beléptetési naplót.');
    const data = await res.json();
    const { checkins, pagination } = data;

    window.currentAdminCheckins = checkins;
    window.currentAdminCheckinsPagination = pagination;

    renderCheckinsTable(checkins);
    renderCheckinsPagination(pagination);
  } catch (err) {
    console.error('Error loading checkins:', err);
    container.innerHTML = `<p style="color:var(--danger); text-align:center; padding: 25px;">${err.message}</p>`;
    if (paginationEl) paginationEl.innerHTML = '';
  }
}

function renderCheckinsTable(checkins) {
  const container = document.getElementById('admin-checkins-table-container');
  if (!container) return;

  if (!checkins || checkins.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 35px; font-size:14px;">A megadott szűrési feltételekkel nem található beléptetés.</p>';
    return;
  }

  let tableHtml = `
    <table class="admin-table admin-checkins-table">
      <thead>
        <tr>
          <th style="min-width:140px;">Mikor (Időpont)</th>
          <th style="min-width:130px;">Melyik falnál</th>
          <th style="min-width:180px;">Kit (Mászó / Tag)</th>
          <th style="min-width:120px;">Jegy / Bérlet</th>
          <th style="min-width:160px;">Ki engedte be (Staff)</th>
          <th style="min-width:130px;">Státusz</th>
        </tr>
      </thead>
      <tbody>
  `;

  checkins.forEach(c => {
    const dateFormatted = c.scan_time ? c.scan_time.substring(0, 16).replace('T', ' ') : '-';
    const locBadge = c.location_name ? `<span class="badge badge-primary" style="font-size:11px;">${escapeHtml(c.location_name)}</span>` : '<span style="color:var(--text-muted);">-</span>';
    
    // Ticket type label
    let ticketTypeLabel = c.ticket_type || 'JEGY';
    if (ticketTypeLabel === 'NAPI') ticketTypeLabel = 'Napijegy';
    else if (ticketTypeLabel === 'TIZ_ALKALMAS') ticketTypeLabel = '10 Alkalmas';
    else if (ticketTypeLabel === 'HAVI') ticketTypeLabel = 'Havi Bérlet';

    // Status label
    const isSuccess = c.status === 'SUCCESS';
    const statusBadge = isSuccess 
      ? '<span class="badge badge-green" style="font-size:11px; padding:3px 8px; font-weight:600;">✓ Sikeres belépés</span>'
      : `<span class="badge badge-danger" style="font-size:11px; padding:3px 8px; font-weight:600;" title="${escapeHtml(c.message || '')}">✕ Sikertelen</span>`;

    // Climber card type
    let cardBadge = '';
    if (c.user_card_type === 'ZÖLD') cardBadge = '<span class="badge user-badge-green" style="font-size:10px; padding:1px 5px; margin-left:4px;">ZÖLD</span>';
    else if (c.user_card_type === 'PIROS') cardBadge = '<span class="badge user-badge-red" style="font-size:10px; padding:1px 5px; margin-left:4px;">PIROS</span>';

    tableHtml += `
      <tr>
        <td style="font-weight:600; font-family:'Outfit',monospace; font-size:13px; color:#fff;">
          ${dateFormatted}
        </td>
        <td>
          ${locBadge}
        </td>
        <td>
          <div style="font-weight:600; color:#fff; font-size:13px;">
            ${escapeHtml(c.user_name)} ${cardBadge}
          </div>
          <div style="font-size:11px; color:var(--text-muted);">
            ${escapeHtml(c.user_email)} ${c.user_phone ? ' · ' + escapeHtml(c.user_phone) : ''}
          </div>
        </td>
        <td>
          <span class="badge badge-secondary" style="font-size:11px; font-weight:600;">${ticketTypeLabel}</span>
          ${c.qr_code_uuid ? `<div style="font-size:10px; color:var(--text-muted); font-family:monospace; margin-top:2px;">#${c.qr_code_uuid.substring(0,8)}</div>` : ''}
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="badge user-badge-role-staff" style="font-size:10px; padding:2px 6px;">STAFF</span>
            <strong style="font-size:13px; color:#fff;">${escapeHtml(c.staff_name || 'Rendszer')}</strong>
          </div>
          ${c.staff_email ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${escapeHtml(c.staff_email)}</div>` : ''}
        </td>
        <td>
          ${statusBadge}
          ${(!isSuccess && c.message) ? `<div style="font-size:10px; color:var(--danger); margin-top:3px; max-width:160px; line-height:1.2;">${escapeHtml(c.message)}</div>` : ''}
        </td>
      </tr>
    `;
  });

  tableHtml += '</tbody></table>';
  container.innerHTML = tableHtml;
}

function renderCheckinsPagination(pagination) {
  const el = document.getElementById('admin-checkins-pagination');
  if (!el || !pagination) return;

  const { total, page, totalPages, limit } = pagination;
  if (total <= limit && totalPages <= 1) {
    el.innerHTML = `<div style="color:var(--text-muted); font-size:12px;">Összesen ${total} beléptetés</div>`;
    return;
  }

  const startIdx = (page - 1) * limit + 1;
  const endIdx = Math.min(page * limit, total);

  el.innerHTML = `
    <div style="color:var(--text-muted); font-size:13px;">
      Megjelenítve: <strong>${startIdx} - ${endIdx}</strong> / ${total} beléptetés
    </div>
    <div style="display:flex; gap:6px; align-items:center;">
      <button type="button" onclick="changeCheckinsPage(${page - 1})" class="btn btn-secondary btn-sm" ${page <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} style="padding:4px 10px; font-size:12px;">
        ‹ Előző
      </button>
      <span style="font-size:13px; color:#fff; font-weight:600; padding:0 8px;">
        ${page} / ${totalPages}
      </span>
      <button type="button" onclick="changeCheckinsPage(${page + 1})" class="btn btn-secondary btn-sm" ${page >= totalPages ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} style="padding:4px 10px; font-size:12px;">
        Következő ›
      </button>
    </div>
  `;
}

function changeCheckinsPage(newPage) {
  const totalPages = window.currentAdminCheckinsPagination?.totalPages || 1;
  if (newPage < 1 || newPage > totalPages) return;
  loadAdminCheckins(newPage);
}

function applyCheckinsFilters() {
  currentCheckinsPage = 1;
  loadAdminCheckins(1);
}

function debounceCheckinsSearch() {
  clearTimeout(checkinsSearchTimeout);
  checkinsSearchTimeout = setTimeout(() => {
    applyCheckinsFilters();
  }, 350);
}

// 4. Export Checkins to Excel (CSV with UTF-8 BOM)
async function exportCheckinsToExcel() {
  const locVal = document.getElementById('admin-checkins-filter-location')?.value || '';
  const staffVal = document.getElementById('admin-checkins-filter-staff')?.value || '';
  const statusVal = document.getElementById('admin-checkins-filter-status')?.value || 'SUCCESS';
  const searchVal = document.getElementById('admin-checkins-filter-search')?.value.trim() || '';

  const queryParams = new URLSearchParams({ exportType: 'all' });
  if (locVal) queryParams.set('locationId', locVal);
  if (staffVal) queryParams.set('staffId', staffVal);
  if (statusVal) queryParams.set('status', statusVal);
  if (searchVal) queryParams.set('search', searchVal);

  try {
    showToast('Excel export előkészítése...', 'info');
    const res = await fetch(`/api/admin/checkins?${queryParams.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Hiba az adatok letöltésekor');
    const data = await res.json();
    const rows = data.checkins || [];

    if (rows.length === 0) {
      showToast('Nincs exportálható adat a megadott szűréshez!', 'warning');
      return;
    }

    const headers = ['Időpont', 'Mászófal', 'Mászó Neve', 'Mászó Email', 'Mászó Telefon', 'Mászókártya', 'Jegy Típus', 'Beléptető Személyzet (Staff)', 'Staff Email', 'Státusz', 'Üzenet'];
    const csvLines = [headers.map(h => `"${h}"`).join(';')];

    rows.forEach(r => {
      const line = [
        r.scan_time ? r.scan_time.substring(0, 16).replace('T', ' ') : '',
        r.location_name || '',
        r.user_name || '',
        r.user_email || '',
        r.user_phone || '',
        r.user_card_type || 'NINCS',
        r.ticket_type || '',
        r.staff_name || 'Rendszer',
        r.staff_email || '',
        r.status === 'SUCCESS' ? 'Sikeres' : 'Sikertelen',
        r.message || ''
      ].map(val => `"${String(val).replace(/"/g, '""')}"`);
      csvLines.push(line.join(';'));
    });

    const csvContent = '﻿' + csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const today = new Date().toISOString().split('T')[0];
    link.download = `hawkstone_beleptetesek_${today}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Excel fájl sikeresen letöltve!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 5. Export Checkins to PDF / Print
async function exportCheckinsToPDF() {
  const rows = window.currentAdminCheckins || [];
  if (rows.length === 0) {
    showToast('Nincs nyomtatható adat a jelenlegi nézetben!', 'warning');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Kérjük, engedélyezd a felugró ablakokat a nyomtatáshoz!', 'error');
    return;
  }

  let tableRowsHtml = '';
  rows.forEach(r => {
    tableRowsHtml += `
      <tr>
        <td>${r.scan_time ? r.scan_time.substring(0, 16).replace('T', ' ') : '-'}</td>
        <td>${escapeHtml(r.location_name || '-')}</td>
        <td><strong>${escapeHtml(r.user_name)}</strong><br><small>${escapeHtml(r.user_email)}</small></td>
        <td>${escapeHtml(r.ticket_type || '-')}</td>
        <td><strong>${escapeHtml(r.staff_name || 'Rendszer')}</strong></td>
        <td>${r.status === 'SUCCESS' ? '<span style="color:green;font-weight:bold;">Sikeres</span>' : '<span style="color:red;font-weight:bold;">Sikertelen</span>'}</td>
      </tr>
    `;
  });

  const todayStr = new Date().toLocaleString('hu-HU');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HawkStone - Beléptetések Naplója</title>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; color: #222; margin: 25px; }
        h2 { margin: 0 0 5px 0; color: #f27620; text-transform: uppercase; }
        .meta { font-size: 11px; color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
        th { background: #f8f8f8; font-weight: bold; }
        @media print {
          body { margin: 0; }
        }
      </style>
    </head>
    <body>
      <h2>HawkStone Mászóklub – Beléptetések Naplója</h2>
      <div class="meta">Nyomtatva: ${todayStr} | Összesen ${rows.length} bejegyzés a jelenlegi nézetben</div>
      <table>
        <thead>
          <tr>
            <th>Időpont</th>
            <th>Mászófal</th>
            <th>Mászó / Tag</th>
            <th>Jegy / Bérlet</th>
            <th>Beléptető Staff</th>
            <th>Státusz</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ---------------- PAST BOOKINGS ARCHIVE MANAGEMENT ----------------

// Toggle between Active Bookings view and Past Archive view
function switchBookingsMode(mode) {
  const activeBtn = document.getElementById('bookings-toggle-active-btn');
  const pastBtn = document.getElementById('bookings-toggle-past-btn');
  const activeWrapper = document.getElementById('admin-bookings-active-wrapper');
  const pastWrapper = document.getElementById('admin-bookings-past-view');

  if (!activeBtn || !pastBtn || !activeWrapper || !pastWrapper) return;

  if (mode === 'past') {
    activeBtn.className = 'btn btn-secondary btn-sm';
    pastBtn.className = 'btn btn-primary btn-sm';
    activeWrapper.style.display = 'none';
    pastWrapper.style.display = 'block';
    loadPastAdminBookings(1);
  } else {
    activeBtn.className = 'btn btn-primary btn-sm';
    pastBtn.className = 'btn btn-secondary btn-sm';
    activeWrapper.style.display = 'block';
    pastWrapper.style.display = 'none';
  }
}

// Load Past Bookings Filters (Locations & Staff & Months)
async function initPastBookingsFilters() {
  const locSelect = document.getElementById('admin-past-bookings-filter-location');
  const staffSelect = document.getElementById('admin-past-bookings-filter-staff');
  const monthSelect = document.getElementById('admin-past-bookings-filter-month');

  if (monthSelect && monthSelect.options.length <= 1) {
    try {
      const res = await fetch('/api/admin/bookings/months', { headers: getAuthHeaders() });
      if (res.ok) {
        const months = await res.json();
        months.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          const [y, mo] = m.split('-');
          const d = new Date(parseInt(y), parseInt(mo) - 1, 1);
          const monthName = d.toLocaleString('hu-HU', { month: 'long' });
          opt.textContent = `${y}. ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`;
          monthSelect.appendChild(opt);
        });
      }
    } catch (e) {}
  }

  if (locSelect && locSelect.options.length <= 1) {
    try {
      const res = await fetch('/api/locations');
      if (res.ok) {
        const locations = await res.json();
        locations.forEach(loc => {
          const opt = document.createElement('option');
          opt.value = loc.id;
          opt.textContent = loc.name;
          locSelect.appendChild(opt);
        });
      }
    } catch (e) {}
  }

  if (staffSelect && staffSelect.options.length <= 1) {
    try {
      if (!checkinsStaffListCache) {
        const res = await fetch('/api/admin/checkins/staff-list', { headers: getAuthHeaders() });
        if (res.ok) checkinsStaffListCache = await res.json();
      }
      if (checkinsStaffListCache) {
        checkinsStaffListCache.forEach(staff => {
          const opt = document.createElement('option');
          opt.value = staff.id;
          opt.textContent = `${staff.name} (${staff.role})`;
          staffSelect.appendChild(opt);
        });
      }
    } catch (e) {}
  }
}

// Load Past Admin Bookings List with Pagination & Filters
async function loadPastAdminBookings(page = 1) {
  currentPastBookingsPage = page;
  await initPastBookingsFilters();

  const container = document.getElementById('admin-past-bookings-table-container');
  const paginationEl = document.getElementById('admin-past-bookings-pagination');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 25px;">Múltbéli foglalások betöltése...</p>';

  const monthVal = document.getElementById('admin-past-bookings-filter-month')?.value || '';
  const locVal = document.getElementById('admin-past-bookings-filter-location')?.value || '';
  const attendedVal = document.getElementById('admin-past-bookings-filter-attended')?.value || 'all';
  const staffVal = document.getElementById('admin-past-bookings-filter-staff')?.value || '';
  const searchVal = document.getElementById('admin-past-bookings-filter-search')?.value.trim() || '';

  const queryParams = new URLSearchParams({
    page: currentPastBookingsPage,
    limit: pastBookingsPageLimit
  });
  if (monthVal) queryParams.set('month', monthVal);
  if (locVal) queryParams.set('locationId', locVal);
  if (attendedVal && attendedVal !== 'all') queryParams.set('attended', attendedVal);
  if (staffVal) queryParams.set('staffId', staffVal);
  if (searchVal) queryParams.set('search', searchVal);

  try {
    const res = await fetch(`/api/admin/bookings/past?${queryParams.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Nem sikerült betölteni a múltbéli foglalásokat.');
    const data = await res.json();
    const { bookings, pagination } = data;

    window.currentPastAdminBookings = bookings;
    window.currentPastAdminBookingsPagination = pagination;

    renderPastBookingsTable(bookings);
    renderPastBookingsPagination(pagination);
  } catch (err) {
    console.error('Error loading past bookings:', err);
    container.innerHTML = `<p style="color:var(--danger); text-align:center; padding: 25px;">${err.message}</p>`;
    if (paginationEl) paginationEl.innerHTML = '';
  }
}

function renderPastBookingsTable(bookings) {
  const container = document.getElementById('admin-past-bookings-table-container');
  if (!container) return;

  if (!bookings || bookings.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 35px; font-size:14px;">A megadott szűrési feltételekkel nem található lezárt múltbéli foglalás.</p>';
    return;
  }

  let tableHtml = `
    <table class="admin-table admin-past-bookings-table">
      <thead>
        <tr>
          <th style="min-width:130px;">Dátum &amp; Idősáv</th>
          <th style="min-width:130px;">Melyik falnál</th>
          <th style="min-width:180px;">Kit (Mászó / Tag)</th>
          <th style="min-width:130px;">Megjelent-e?</th>
          <th style="min-width:170px;">Ki engedte be (Staff)</th>
          <th style="min-width:80px; text-align:center;">Művelet</th>
        </tr>
      </thead>
      <tbody>
  `;

  bookings.forEach(b => {
    const isAttended = b.attended > 0;
    const locBadge = b.location_name ? `<span class="badge badge-primary" style="font-size:11px;">${escapeHtml(b.location_name)}</span>` : '-';

    let cardBadge = '';
    if (b.user_card_type === 'ZÖLD') cardBadge = '<span class="badge user-badge-green" style="font-size:10px; padding:1px 5px; margin-left:4px;">ZÖLD</span>';
    else if (b.user_card_type === 'PIROS') cardBadge = '<span class="badge user-badge-red" style="font-size:10px; padding:1px 5px; margin-left:4px;">PIROS</span>';

    // Attended badge
    const attendedBadge = isAttended 
      ? '<span class="badge badge-green" style="font-size:11px; padding:3px 8px; font-weight:600;">✓ Megjelent</span>'
      : '<span class="badge badge-secondary" style="font-size:11px; padding:3px 8px; opacity:0.75;">Nem jelent meg</span>';

    // Staff info
    let staffHtml = '<span style="color:var(--text-muted); font-size:12px;">-</span>';
    if (isAttended && b.scanned_by_staff_name) {
      const scanTimeStr = b.scanned_at ? b.scanned_at.substring(11, 16) : '';
      staffHtml = `
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="badge user-badge-role-staff" style="font-size:10px; padding:2px 5px;">STAFF</span>
          <strong style="font-size:12px; color:#fff;">${escapeHtml(b.scanned_by_staff_name)}</strong>
        </div>
        ${scanTimeStr ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Beléptetve: ${scanTimeStr}</div>` : ''}
      `;
    }

    tableHtml += `
      <tr>
        <td>
          <div style="font-weight:700; color:#fff; font-size:13px; font-family:'Outfit',monospace;">${b.booking_date}</div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${b.start_time.substring(0,5)} - ${b.end_time.substring(0,5)}</div>
        </td>
        <td>
          ${locBadge}
        </td>
        <td>
          <div style="font-weight:600; color:#fff; font-size:13px;">
            ${escapeHtml(b.user_name)} ${cardBadge}
          </div>
          <div style="font-size:11px; color:var(--text-muted);">
            ${escapeHtml(b.user_email)} ${b.user_phone ? ' · ' + escapeHtml(b.user_phone) : ''}
          </div>
        </td>
        <td>
          ${attendedBadge}
        </td>
        <td>
          ${staffHtml}
        </td>
        <td style="text-align:center;">
          <button onclick="deletePastAdminBooking(${b.booking_id})" class="btn btn-danger btn-sm" title="Foglalás törlése az adatbázisból" style="padding: 4px 8px; font-size: 11px;">
            🗑️
          </button>
        </td>
      </tr>
    `;
  });

  tableHtml += '</tbody></table>';
  container.innerHTML = tableHtml;
}

function renderPastBookingsPagination(pagination) {
  const el = document.getElementById('admin-past-bookings-pagination');
  if (!el || !pagination) return;

  const { total, page, totalPages, limit } = pagination;
  if (total <= limit && totalPages <= 1) {
    el.innerHTML = `<div style="color:var(--text-muted); font-size:12px;">Összesen ${total} múltbéli foglalás</div>`;
    return;
  }

  const startIdx = (page - 1) * limit + 1;
  const endIdx = Math.min(page * limit, total);

  el.innerHTML = `
    <div style="color:var(--text-muted); font-size:13px;">
      Megjelenítve: <strong>${startIdx} - ${endIdx}</strong> / ${total} múltbéli foglalás
    </div>
    <div style="display:flex; gap:6px; align-items:center;">
      <button type="button" onclick="changePastBookingsPage(${page - 1})" class="btn btn-secondary btn-sm" ${page <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} style="padding:4px 10px; font-size:12px;">
        ‹ Előző
      </button>
      <span style="font-size:13px; color:#fff; font-weight:600; padding:0 8px;">
        ${page} / ${totalPages}
      </span>
      <button type="button" onclick="changePastBookingsPage(${page + 1})" class="btn btn-secondary btn-sm" ${page >= totalPages ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''} style="padding:4px 10px; font-size:12px;">
        Következő ›
      </button>
    </div>
  `;
}

function changePastBookingsPage(newPage) {
  const totalPages = window.currentPastAdminBookingsPagination?.totalPages || 1;
  if (newPage < 1 || newPage > totalPages) return;
  loadPastAdminBookings(newPage);
}

function applyPastBookingsFilters() {
  currentPastBookingsPage = 1;
  loadPastAdminBookings(1);
}

function debouncePastBookingsSearch() {
  clearTimeout(pastBookingsSearchTimeout);
  pastBookingsSearchTimeout = setTimeout(() => {
    applyPastBookingsFilters();
  }, 350);
}

async function deletePastAdminBooking(bookingId) {
  const confirmed = await showConfirmModal({
    title: 'Múltbéli foglalás törlése',
    message: 'Biztosan törölni szeretnéd ezt a múltbéli foglalási bejegyzést az archívumból?',
    confirmText: 'Törlés',
    cancelText: 'Mégse',
    variant: 'danger'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a törlés során');
    showToast('Foglalás sikeresen törölve!', 'success');
    loadPastAdminBookings(currentPastBookingsPage);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Export Past Bookings to Excel (CSV)
async function exportPastBookingsToExcel() {
  const monthVal = document.getElementById('admin-past-bookings-filter-month')?.value || '';
  const locVal = document.getElementById('admin-past-bookings-filter-location')?.value || '';
  const attendedVal = document.getElementById('admin-past-bookings-filter-attended')?.value || 'all';
  const staffVal = document.getElementById('admin-past-bookings-filter-staff')?.value || '';
  const searchVal = document.getElementById('admin-past-bookings-filter-search')?.value.trim() || '';

  const queryParams = new URLSearchParams({ exportType: 'all' });
  if (monthVal) queryParams.set('month', monthVal);
  if (locVal) queryParams.set('locationId', locVal);
  if (attendedVal && attendedVal !== 'all') queryParams.set('attended', attendedVal);
  if (staffVal) queryParams.set('staffId', staffVal);
  if (searchVal) queryParams.set('search', searchVal);

  try {
    showToast('Múltbéli foglalások exportálása...', 'info');
    const res = await fetch(`/api/admin/bookings/past?${queryParams.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Hiba az adatok letöltésekor');
    const data = await res.json();
    const rows = data.bookings || [];

    if (rows.length === 0) {
      showToast('Nincs exportálható adat a megadott szűréshez!', 'warning');
      return;
    }

    const headers = ['Dátum', 'Kezdés', 'Befejezés', 'Mászófal', 'Mászó Neve', 'Mászó Email', 'Mászó Telefon', 'Mászókártya', 'Megjelent-e', 'Beléptető Személyzet (Staff)', 'Beléptetés Időpontja'];
    const csvLines = [headers.map(h => `"${h}"`).join(';')];

    rows.forEach(r => {
      const line = [
        r.booking_date || '',
        r.start_time ? r.start_time.substring(0, 5) : '',
        r.end_time ? r.end_time.substring(0, 5) : '',
        r.location_name || '',
        r.user_name || '',
        r.user_email || '',
        r.user_phone || '',
        r.user_card_type || 'NINCS',
        r.attended > 0 ? 'Megjelent' : 'Nem jelent meg',
        r.scanned_by_staff_name || '-',
        r.scanned_at ? r.scanned_at.substring(0, 16).replace('T', ' ') : '-'
      ].map(val => `"${String(val).replace(/"/g, '""')}"`);
      csvLines.push(line.join(';'));
    });

    const csvContent = '\uFEFF' + csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const today = new Date().toISOString().split('T')[0];
    const monthTag = monthVal ? `_${monthVal}` : '';
    link.download = `hawkstone_multbeli_foglalasok${monthTag}_${today}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Excel fájl sikeresen letöltve!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Export Past Bookings to PDF / Print
async function exportPastBookingsToPDF() {
  const rows = window.currentPastAdminBookings || [];
  if (rows.length === 0) {
    showToast('Nincs nyomtatható adat a jelenlegi nézetben!', 'warning');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Kérjük, engedélyezd a felugró ablakokat a nyomtatáshoz!', 'error');
    return;
  }

  let tableRowsHtml = '';
  rows.forEach(r => {
    tableRowsHtml += `
      <tr>
        <td>${r.booking_date} ${r.start_time ? r.start_time.substring(0, 5) : ''} - ${r.end_time ? r.end_time.substring(0, 5) : ''}</td>
        <td>${escapeHtml(r.location_name || '-')}</td>
        <td><strong>${escapeHtml(r.user_name)}</strong><br><small>${escapeHtml(r.user_email)}</small></td>
        <td>${r.attended > 0 ? '<span style="color:green;font-weight:bold;">Megjelent</span>' : '<span style="color:#666;">Nem jelent meg</span>'}</td>
        <td>${escapeHtml(r.scanned_by_staff_name || '-')}</td>
      </tr>
    `;
  });

  const todayStr = new Date().toLocaleString('hu-HU');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HawkStone - Múltbéli Foglalások Archívuma</title>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; color: #222; margin: 25px; }
        h2 { margin: 0 0 5px 0; color: #f27620; text-transform: uppercase; }
        .meta { font-size: 11px; color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
        th { background: #f8f8f8; font-weight: bold; }
        @media print {
          body { margin: 0; }
        }
      </style>
    </head>
    <body>
      <h2>HawkStone Mászóklub – Múltbéli Foglalások Archívuma</h2>
      <div class="meta">Nyomtatva: ${todayStr} | Összesen ${rows.length} foglalás a jelenlegi nézetben</div>
      <table>
        <thead>
          <tr>
            <th>Dátum &amp; Idősáv</th>
            <th>Mászófal</th>
            <th>Mászó / Tag</th>
            <th>Részvétel</th>
            <th>Beléptető Staff</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
      <script>
        window.onload = function() {
          window.print();
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ---------------- STATISZTIKA & NYITÁNY ANALYTICS ----------------

window.currentStatsRange = 'all';
window.currentStatsData = null;

async function loadAdminStats(range = window.currentStatsRange || 'all') {
  window.currentStatsRange = range;

  // Update pills
  ['all', 'month', '30d', '7d'].forEach(r => {
    const btn = document.getElementById(`stats-range-${r}`);
    if (btn) {
      btn.className = r === range ? 'btn btn-primary btn-sm stats-range-btn' : 'btn btn-secondary btn-sm stats-range-btn';
    }
  });

  const kpiGrid = document.getElementById('stats-kpi-grid');
  if (kpiGrid) {
    kpiGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align:center; padding:30px; color:var(--text-muted);">Statisztikák betöltése...</div>';
  }

  try {
    const res = await fetch(`/api/admin/stats?range=${range}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Nem sikerült betölteni a statisztikai adatokat.');
    const data = await res.json();
    window.currentStatsData = data;
    renderAdminStats(data);
  } catch (err) {
    console.error('Error loading stats:', err);
    if (kpiGrid) {
      kpiGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding:30px; color:var(--danger);">${err.message}</div>`;
    }
  }
}

function changeStatsRange(range) {
  loadAdminStats(range);
}

function renderAdminStats(data) {
  if (!data) return;
  const { summary, locations, hourly_distribution, card_distribution, ticket_types, withdrawals, staff_leaderboard } = data;

  // 1. Render KPI Grid
  const kpiGrid = document.getElementById('stats-kpi-grid');
  if (kpiGrid) {
    const attendanceColor = summary.attendance_rate >= 85 ? '#10b981' : (summary.attendance_rate >= 70 ? '#f59e0b' : '#ef4444');
    const withdrawalBadgeColor = summary.withdrawal_rate <= 15 ? '#10b981' : '#f59e0b';

    kpiGrid.innerHTML = `
      <!-- KPI 1: Users -->
      <div class="stat-kpi-card">
        <div class="stat-kpi-header">
          <span class="stat-kpi-title">Regisztrált Tagok</span>
          <span class="stat-kpi-icon">👥</span>
        </div>
        <div class="stat-kpi-value">${summary.total_users}</div>
        <div class="stat-kpi-sub">
          <span class="stat-trend-up">▲ +${summary.new_users_7d}</span> az elmúlt 7 napban
        </div>
      </div>

      <!-- KPI 2: Bookings -->
      <div class="stat-kpi-card">
        <div class="stat-kpi-header">
          <span class="stat-kpi-title">Összes Foglalás</span>
          <span class="stat-kpi-icon">🧗</span>
        </div>
        <div class="stat-kpi-value">${summary.total_bookings}</div>
        <div class="stat-kpi-sub">
          <strong style="color:#fff;">${summary.future_bookings}</strong> aktív / <strong style="color:var(--text-muted);">${summary.past_bookings}</strong> lezárt
        </div>
      </div>

      <!-- KPI 3: Attendance Rate -->
      <div class="stat-kpi-card">
        <div class="stat-kpi-header">
          <span class="stat-kpi-title">Megjelenési Arány</span>
          <span class="stat-kpi-icon">🎯</span>
        </div>
        <div class="stat-kpi-value" style="color: ${attendanceColor};">${summary.attendance_rate}%</div>
        <div class="stat-kpi-sub">
          <div class="stat-micro-bar"><div class="stat-micro-fill" style="width: ${summary.attendance_rate}%; background: ${attendanceColor};"></div></div>
        </div>
      </div>

      <!-- KPI 4: Scans -->
      <div class="stat-kpi-card">
        <div class="stat-kpi-header">
          <span class="stat-kpi-title">Fal Belépések</span>
          <span class="stat-kpi-icon">🎟️</span>
        </div>
        <div class="stat-kpi-value">${summary.total_scans}</div>
        <div class="stat-kpi-sub">
          Sikeres QR kód érvényesítés
        </div>
      </div>

      <!-- KPI 5: Withdrawals -->
      <div class="stat-kpi-card">
        <div class="stat-kpi-header">
          <span class="stat-kpi-title">Elállási Arány</span>
          <span class="stat-kpi-icon">🛡️</span>
        </div>
        <div class="stat-kpi-value" style="color: ${withdrawalBadgeColor};">${summary.withdrawal_rate}%</div>
        <div class="stat-kpi-sub">
          ${summary.total_withdrawals} kérelem / ${summary.total_tickets_sold} jegyvásárlás
        </div>
      </div>
    `;
  }

  // 2. Render Locations List
  const locContainer = document.getElementById('stats-locations-list');
  if (locContainer) {
    if (!locations || locations.length === 0) {
      locContainer.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Nincs forgalmi adat a mászófalakhoz.</p>';
    } else {
      let locHtml = '';
      locations.forEach(l => {
        locHtml += `
          <div class="stat-location-item">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
              <strong style="font-size:14px; color:#fff;">${escapeHtml(l.location_name)}</strong>
              <div style="font-size:12px; color:var(--text-secondary);">
                <strong style="color:var(--primary); font-size:13px;">${l.booking_count}</strong> foglalás · <strong>${l.scan_count}</strong> belépés
              </div>
            </div>
            <div class="stat-progress-track">
              <div class="stat-progress-bar" style="width: ${Math.max(4, l.percent)}%;"></div>
            </div>
            <div style="display:flex; justify-content:flex-end; font-size:11px; color:var(--text-muted); margin-top:3px;">
              ${l.percent}% részesedés
            </div>
          </div>
        `;
      });
      locContainer.innerHTML = locHtml;
    }
  }

  // 3. Render Prime Time / Hourly Distribution Chart
  const hourlyContainer = document.getElementById('stats-hourly-chart');
  if (hourlyContainer) {
    const standardHours = ['08:00', '10:00', '12:00', '14:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
    const hourMap = {};
    (hourly_distribution || []).forEach(h => {
      hourMap[h.hour_slot] = h.count;
    });

    const maxCount = Math.max(1, ...(hourly_distribution || []).map(h => h.count));
    let chartHtml = '';

    standardHours.forEach(hr => {
      const count = hourMap[hr] || 0;
      const heightPercent = count > 0 ? Math.max(14, Math.round((count / maxCount) * 100)) : 8;
      const isPeak = count > 0 && count === maxCount;

      chartHtml += `
        <div class="stat-chart-col ${isPeak ? 'is-peak' : ''}" title="${hr}: ${count} foglalás">
          <div class="stat-chart-count">${count > 0 ? count : ''}</div>
          <div class="stat-chart-bar-wrap">
            <div class="stat-chart-bar" style="height: ${heightPercent}%;"></div>
          </div>
          <div class="stat-chart-label">${hr.substring(0, 5)}</div>
        </div>
      `;
    });
    hourlyContainer.innerHTML = chartHtml;
  }

  // 4. Render Card Qualifications Breakdown
  const cardsContainer = document.getElementById('stats-cards-breakdown');
  if (cardsContainer) {
    const green = card_distribution?.['ZÖLD'] || 0;
    const red = card_distribution?.['PIROS'] || 0;
    const totalCards = green + red;
    const greenPct = totalCards > 0 ? Math.round((green / totalCards) * 100) : 0;
    const redPct = totalCards > 0 ? Math.round((red / totalCards) * 100) : 0;

    cardsContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:10px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700; color:#34d399; font-size:13px;">🟢 ZÖLD KÁRTYA</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Mások biztosítására jogosultak</div>
          </div>
          <div style="text-align:right;">
            <strong style="font-size:18px; color:#fff;">${green}</strong>
            <div style="font-size:11px; color:#34d399;">${greenPct}%</div>
          </div>
        </div>

        <div style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:10px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700; color:#f87171; font-size:13px;">🔴 PIROS KÁRTYA</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Kezdő / Csak mászásra jogosultak</div>
          </div>
          <div style="text-align:right;">
            <strong style="font-size:18px; color:#fff;">${red}</strong>
            <div style="font-size:11px; color:#f87171;">${redPct}%</div>
          </div>
        </div>
      </div>
    `;
  }

  // 5. Render Ticket & Pass Mix Breakdown
  const ticketsContainer = document.getElementById('stats-tickets-breakdown');
  if (ticketsContainer) {
    let tickHtml = '<div style="display:flex; flex-direction:column; gap:8px;">';
    const typeNames = {
      'NAPI': 'Egyszeri Napijegy',
      'TIZ_ALKALMAS': '10 Alkalmas Bérlet',
      'HAVI': 'Korlátlan Havi Bérlet'
    };

    (ticket_types || []).forEach(t => {
      const name = typeNames[t.ticket_type] || t.ticket_type;
      tickHtml += `
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:600; font-size:13px; color:#fff;">${name}</div>
            <div style="font-size:11px; color:var(--text-muted);">Aktív: ${t.active_count || 0} db</div>
          </div>
          <div>
            <span class="badge badge-primary" style="font-size:12px; padding:3px 8px;">${t.count} eladva</span>
          </div>
        </div>
      `;
    });
    tickHtml += '</div>';
    ticketsContainer.innerHTML = tickHtml;
  }

  // 6. Render Withdrawals Breakdown
  const withContainer = document.getElementById('stats-withdrawals-breakdown');
  if (withContainer) {
    withContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:13px; color:#fbbf24; font-weight:600;">Folyamatban lévő</span>
          <strong style="font-size:15px; color:#fff;">${withdrawals.pending} db</strong>
        </div>
        <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.2); border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:13px; color:#34d399; font-weight:600;">Visszatérítve (lezárt)</span>
          <strong style="font-size:15px; color:#fff;">${withdrawals.refunded} db</strong>
        </div>
        <div style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:13px; color:#f87171; font-weight:600;">Elutasítva</span>
          <strong style="font-size:15px; color:#fff;">${withdrawals.rejected} db</strong>
        </div>
      </div>
    `;
  }

  // 7. Render Staff Leaderboard
  const staffContainer = document.getElementById('stats-staff-leaderboard');
  if (staffContainer) {
    if (!staff_leaderboard || staff_leaderboard.length === 0) {
      staffContainer.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Még nincs beléptetési aktivitás rögzítve.</p>';
    } else {
      let staffHtml = '';
      staff_leaderboard.forEach((s, idx) => {
        const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : '👤'));
        staffHtml += `
          <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:18px;">${medal}</span>
              <div>
                <strong style="font-size:13px; color:#fff;">${escapeHtml(s.staff_name)}</strong>
                <div style="font-size:11px; color:var(--text-muted);">Falmester / Admin</div>
              </div>
            </div>
            <div>
              <span class="badge user-badge-role-staff" style="font-size:12px; padding:3px 8px; font-weight:700;">${s.scan_count} scan</span>
            </div>
          </div>
        `;
      });
      staffContainer.innerHTML = staffHtml;
    }
  }
}

// Export Statistics to PDF / Print
async function exportAdminStatsToPDF() {
  const data = window.currentStatsData;
  if (!data) {
    showToast('A statisztikai adatok még nem töltődtek be!', 'warning');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Kérjük, engedélyezd a felugró ablakokat a nyomtatáshoz!', 'error');
    return;
  }

  const { summary, locations, hourly_distribution, card_distribution, ticket_types, withdrawals, staff_leaderboard } = data;
  const todayStr = new Date().toLocaleString('hu-HU');

  let locRowsHtml = '';
  (locations || []).forEach(l => {
    locRowsHtml += `<tr><td><strong>${escapeHtml(l.location_name)}</strong></td><td>${l.booking_count} db</td><td>${l.scan_count} db</td><td>${l.percent}%</td></tr>`;
  });

  let hourRowsHtml = '';
  (hourly_distribution || []).forEach(h => {
    hourRowsHtml += `<tr><td>${h.hour_slot}</td><td>${h.count} foglalás</td></tr>`;
  });

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>HawkStone - Nyitány Statisztikai Riport</title>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 30px; line-height: 1.4; }
        h1 { margin: 0 0 5px 0; color: #f27620; font-size: 20px; text-transform: uppercase; }
        .meta { font-size: 11px; color: #666; margin-bottom: 25px; }
        .grid-kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 25px; }
        .kpi { border: 1px solid #ddd; padding: 12px; border-radius: 6px; background: #fafafa; }
        .kpi span { font-size: 11px; color: #666; display: block; text-transform: uppercase; margin-bottom: 4px; }
        .kpi strong { font-size: 20px; color: #000; }
        .section-title { font-size: 14px; font-weight: bold; margin: 20px 0 10px 0; border-bottom: 2px solid #f27620; padding-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
        th { background: #f4f4f4; font-weight: bold; }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      <h1>HawkStone Mászóklub – Nyitány Statisztikai Riport</h1>
      <div class="meta">Időszak: ${data.range === 'all' ? 'Nyitástól összesen' : data.range} | Generálva: ${todayStr}</div>

      <div class="grid-kpi">
        <div class="kpi"><span>Regisztrált Tagok</span><strong>${summary.total_users}</strong></div>
        <div class="kpi"><span>Összes Foglalás</span><strong>${summary.total_bookings}</strong></div>
        <div class="kpi"><span>Megjelenési Arány</span><strong>${summary.attendance_rate}%</strong></div>
        <div class="kpi"><span>Fal Belépések</span><strong>${summary.total_scans}</strong></div>
      </div>

      <div class="section-title">Mászófalankénti Kihasználtság</div>
      <table>
        <thead><tr><th>Mászófal</th><th>Foglalások</th><th>Belépések</th><th>Forgalmi Részesedés</th></tr></thead>
        <tbody>${locRowsHtml}</tbody>
      </table>

      <div class="section-title">Csúcsidőszakok (Idősávok szerint)</div>
      <table>
        <thead><tr><th>Idősáv</th><th>Foglalások Száma</th></tr></thead>
        <tbody>${hourRowsHtml}</tbody>
      </table>

      <div class="section-title">Mászókártyás Minősítések & Közösség</div>
      <p>Zöld kártyások (önálló biztosítók): <strong>${card_distribution?.['ZÖLD'] || 0} fő</strong> | Piros kártyások (alapszint): <strong>${card_distribution?.['PIROS'] || 0} fő</strong></p>

      <div class="section-title">Elállások & Visszatérítések</div>
      <p>Összes elállási kérelem: <strong>${withdrawals.total} db</strong> (Visszatérítve: ${withdrawals.refunded} db, Folyamatban: ${withdrawals.pending} db, Elutasítva: ${withdrawals.rejected} db)</p>

      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// Explicit window bindings to ensure inline HTML onClick triggers resolve properly
window.openQRModal = openQRModal;
window.closeQRModal = closeQRModal;
window.openNoTicketModal = openNoTicketModal;
window.closeNoTicketModal = closeNoTicketModal;
window.buyTicket = buyTicket;
window.updateRoleCardVisuals = updateRoleCardVisuals;
window.loadUserBookingsInModal = loadUserBookingsInModal;
window.loadAdminCheckins = loadAdminCheckins;
window.applyCheckinsFilters = applyCheckinsFilters;
window.debounceCheckinsSearch = debounceCheckinsSearch;
window.changeCheckinsPage = changeCheckinsPage;
window.exportCheckinsToExcel = exportCheckinsToExcel;
window.exportCheckinsToPDF = exportCheckinsToPDF;
window.switchBookingsMode = switchBookingsMode;
window.loadPastAdminBookings = loadPastAdminBookings;
window.applyPastBookingsFilters = applyPastBookingsFilters;
window.debouncePastBookingsSearch = debouncePastBookingsSearch;
window.changePastBookingsPage = changePastBookingsPage;
window.deletePastAdminBooking = deletePastAdminBooking;
window.exportPastBookingsToExcel = exportPastBookingsToExcel;
window.exportPastBookingsToPDF = exportPastBookingsToPDF;
window.bookSlot = bookSlot;
window.cancelBooking = cancelBooking;
window.downloadRulesPDF = downloadRulesPDF;
window.loadBookingSchedules = loadBookingSchedules;
window.openUserDetailsModal = openUserDetailsModal;
window.closeUserDetailsSubpage = closeUserDetailsSubpage;
window.switchSubpageToView = switchSubpageToView;
window.switchSubpageToEdit = switchSubpageToEdit;
window.triggerUserDeleteFromSubpage = triggerUserDeleteFromSubpage;
window.handleSubpageEditUserSubmit = handleSubpageEditUserSubmit;
window.exportUserLogsCSV = exportUserLogsCSV;
window.openEditUserModal = openEditUserModal;
window.closeEditUserModal = closeEditUserModal;
window.submitEditUserModal = submitEditUserModal;
window.confirmDeleteUser = confirmDeleteUser;
window.filterAdminUsersTable = filterAdminUsersTable;
window.clearAdminUsersSearch = clearAdminUsersSearch;
window.exportAllUsersToCSV = exportAllUsersToCSV;
window.importUsersFromCSVFile = importUsersFromCSVFile;
window.switchAdminScheduleWeek = switchAdminScheduleWeek;
window.deleteAdminSlot = deleteAdminSlot;
window.uncancelAdminSlot = uncancelAdminSlot;
window.processCheckIn = processCheckIn;
window.resetScannerUI = resetScannerUI;
window.formatEditorText = formatEditorText;
window.editNewsAnnouncement = editNewsAnnouncement;
window.deleteNewsAnnouncement = deleteNewsAnnouncement;
window.cancelNewsEdit = cancelNewsEdit;
window.sortAdminUsers = sortAdminUsers;
window.switchTicketTab = switchTicketTab;
window.closeBillingModal = closeBillingModal;
window.handleBillingSubmit = handleBillingSubmit;
window.closeConfirmSaveBillingModal = closeConfirmSaveBillingModal;
window.handleSaveBillingResponse = handleSaveBillingResponse;
window.loadAdminBookings = loadAdminBookings;
window.cancelAdminBooking = cancelAdminBooking;
window.loadAdminWithdrawals = loadAdminWithdrawals;
window.openWithdrawalInvestigationModal = openWithdrawalInvestigationModal;
window.initiateWithdrawalRefund = initiateWithdrawalRefund;
window.openWithdrawalMessageModal = openWithdrawalMessageModal;
window.sendWithdrawalMessage = sendWithdrawalMessage;
window.resetScannerAfterSuccess = resetScannerAfterSuccess;
window.toggleCamera = toggleCamera;
window.handleCRMSearch = handleCRMSearch;
window.clearCRMSearch = clearCRMSearch;
window.switchWithdrawalFilter = switchWithdrawalFilter;
window.renderAdminWithdrawals = renderAdminWithdrawals;

function switchDashboardView(view) {
  const tabOverview = document.getElementById('db-tab-overview');
  const tabPassword = document.getElementById('db-tab-password');
  const secOverview = document.getElementById('dashboard-overview-section');
  const secPassword = document.getElementById('dashboard-password-section');

  if (!secOverview || !secPassword) return;

  if (view === 'overview') {
    if (tabOverview) tabOverview.className = 'btn btn-primary btn-sm';
    if (tabPassword) tabPassword.className = 'btn btn-secondary btn-sm';
    secOverview.style.display = 'block';
    secPassword.style.display = 'none';
  } else {
    if (tabOverview) tabOverview.className = 'btn btn-secondary btn-sm';
    if (tabPassword) tabPassword.className = 'btn btn-primary btn-sm';
    secOverview.style.display = 'none';
    secPassword.style.display = 'block';
  }
}
window.switchDashboardView = switchDashboardView;

async function handleChangePasswordSubmit(e) {
  if (e) e.preventDefault();
  const oldPassword = document.getElementById('old-password').value;
  const newPassword = document.getElementById('new-password').value;
  const newPasswordConfirm = document.getElementById('new-password-confirm').value;

  if (newPassword !== newPasswordConfirm) {
    showToast('Az új jelszó és a megerősítés nem egyezik meg!', 'error');
    return;
  }

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
  if (!passwordRegex.test(newPassword)) {
    showToast('Az új jelszó nem felel meg a biztonsági követelményeknek! Legalább 8 karakter, kisbetű, nagybetű, szám és speciális karakter szükséges.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ oldPassword, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a jelszómódosítás során');

    showToast('Jelszó sikeresen megváltoztatva!', 'success');
    document.getElementById('change-password-form').reset();
    
    if (window.forcedPasswordChangeMode) {
      window.forcedPasswordChangeMode = false;
      const tabBar = document.getElementById('dashboard-tab-bar');
      const forceWarning = document.getElementById('password-force-warning');
      if (tabBar) tabBar.style.display = 'flex';
      if (forceWarning) forceWarning.style.display = 'none';
      
      // Clean URL parameter
      if (history.pushState) {
        const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.pushState({ path: newurl }, '', newurl);
      }
    }

    switchDashboardView('overview');
    // Reload profile to update local state
    loadProfileAndDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
window.handleChangePasswordSubmit = handleChangePasswordSubmit;

async function handleCRMSearch(event) {
  if (event) event.preventDefault();
  
  const name = document.getElementById('crm-search-name').value;
  const email = document.getElementById('crm-search-email').value;
  const phone = document.getElementById('crm-search-phone').value;
  const paymentId = document.getElementById('crm-search-payment-id').value;

  // If all are empty, show warning
  if (!name.trim() && !email.trim() && !phone.trim() && !paymentId.trim()) {
    showToast('Kérjük, adj meg legalább egy keresési feltételt!', 'error');
    return;
  }

  const resultsArea = document.getElementById('crm-results-area');
  const emptyState = document.getElementById('crm-empty-state');
  const usersList = document.getElementById('crm-users-list');
  const paymentsList = document.getElementById('crm-payments-list');
  const usersCount = document.getElementById('crm-users-count');
  const paymentsCount = document.getElementById('crm-payments-count');

  if (!resultsArea || !emptyState || !usersList || !paymentsList) return;

  // Show results area, hide empty state, show loading indicator
  resultsArea.style.display = 'block';
  emptyState.style.display = 'none';
  usersList.innerHTML = '<p style="color:var(--text-muted); font-size: 13px; text-align: center; padding: 20px; grid-column: 1/-1;">Keresés folyamatban...</p>';
  paymentsList.innerHTML = '<p style="color:var(--text-muted); font-size: 13px; text-align: center; padding: 20px; grid-column: 1/-1;">Keresés folyamatban...</p>';
  usersCount.textContent = '0';
  paymentsCount.textContent = '0';

  try {
    const params = new URLSearchParams();
    if (name.trim()) params.append('name', name.trim());
    if (email.trim()) params.append('email', email.trim());
    if (phone.trim()) params.append('phone', phone.trim());
    if (paymentId.trim()) params.append('paymentId', paymentId.trim());

    const res = await fetch(`/api/admin/search?${params.toString()}`, {
      headers: getAuthHeaders()
    });

    if (!res.ok) throw new Error('Hiba történt a keresés során!');

    const { users, payments } = await res.json();

    // Render Users
    usersList.innerHTML = '';
    usersCount.textContent = users.length;
    if (users.length === 0) {
      usersList.innerHTML = '<p style="color:var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Nem található tag.</p>';
    } else {
      users.forEach(u => {
        const card = document.createElement('div');
        card.className = 'crm-user-result-card';
        card.style.cursor = 'pointer';
        card.onclick = () => {
          if (typeof window.switchAdminTab === 'function') {
            window.switchAdminTab('users');
            setTimeout(() => {
              if (typeof window.openUserDetailsModal === 'function') {
                window.openUserDetailsModal(u.id);
              }
            }, 50);
          }
        };

        const badgeClass = u.card_type === 'ZÖLD' ? 'badge-green' : 'badge-red';
        const roleBadge = u.role === 'ADMIN' ? 'badge-primary' : (u.role === 'STAFF' ? 'badge-secondary' : '');
        const roleLabel = u.role === 'ADMIN' ? 'Admin' : (u.role === 'STAFF' ? 'Staff' : 'Mászó');

        card.innerHTML = `
          <div class="crm-card-header">
            <div class="crm-card-title">${u.name}</div>
            <div style="display:flex; gap:5px;">
              <span class="badge ${badgeClass}" style="font-size:10px; padding:2px 6px;">${u.card_type}</span>
              ${roleBadge ? `<span class="badge" style="background:#4f46e5; font-size:10px; padding:2px 6px;">${roleLabel}</span>` : ''}
            </div>
          </div>
          <div class="crm-card-body">
            <p><strong>E-mail:</strong> ${u.email}</p>
            <p><strong>Telefon:</strong> ${u.phone || '-'}</p>
            ${u.license_number ? `<p><strong>Engedély:</strong> ${u.license_number}</p>` : ''}
          </div>
          <div class="crm-card-footer">
            <span style="font-size: 11px; color: var(--primary); font-weight: 600; text-transform: uppercase;">Megtekintés →</span>
          </div>
        `;
        usersList.appendChild(card);
      });
    }

    // Render Payments
    paymentsList.innerHTML = '';
    paymentsCount.textContent = payments.length;
    if (payments.length === 0) {
      paymentsList.innerHTML = '<p style="color:var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Nem található tranzakció.</p>';
    } else {
      payments.forEach(p => {
        const card = document.createElement('div');
        card.className = 'crm-payment-result-card';
        card.style.cursor = 'pointer';
        card.onclick = () => {
          if (typeof window.switchAdminTab === 'function') {
            window.switchAdminTab('users');
            setTimeout(() => {
              if (typeof window.openUserDetailsModal === 'function') {
                window.openUserDetailsModal(p.user_id);
              }
            }, 50);
          }
        };

        const statusClass = p.status === 'SUCCEEDED' ? 'badge-green' : (p.status === 'FAILED' ? 'badge-red' : 'badge-yellow');
        const formattedDate = new Date(p.created_at).toLocaleString('hu-HU');
        const formattedAmount = new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(p.amount);

        card.innerHTML = `
          <div class="crm-card-header">
            <div class="crm-card-title">${p.ticket_type}</div>
            <span class="badge ${statusClass}" style="font-size:10px; padding:2px 6px;">${p.status}</span>
          </div>
          <div class="crm-card-body">
            <p><strong>Tag neve:</strong> ${p.user_name} (${p.user_email})</p>
            ${p.billing_name ? `<p><strong>Számlázási név:</strong> ${p.billing_name}</p>` : ''}
            <p><strong>Összeg:</strong> ${formattedAmount}</p>
            <p><strong>Dátum:</strong> ${formattedDate}</p>
            <p><strong>Barion ID:</strong> <span style="font-family:monospace; font-size:11px; word-break: break-all;">${p.payment_id}</span></p>
            ${p.invoice_number ? `<p><strong>Számlaszám:</strong> <span style="color:var(--primary); font-weight:600;">${p.invoice_number}</span></p>` : ''}
          </div>
          <div class="crm-card-footer">
            <span style="font-size: 11px; color: var(--primary); font-weight: 600; text-transform: uppercase;">Tag profilja →</span>
          </div>
        `;
        paymentsList.appendChild(card);
      });
    }

  } catch (err) {
    showToast(err.message, 'error');
    usersList.innerHTML = '<p style="color:var(--danger); font-size: 13px; text-align: center; padding: 20px;">Hiba történt a tagok keresésekor.</p>';
    paymentsList.innerHTML = '<p style="color:var(--danger); font-size: 13px; text-align: center; padding: 20px;">Hiba történt a tranzakciók keresésekor.</p>';
  }
}

function clearCRMSearch() {
  document.getElementById('crm-search-form').reset();
  document.getElementById('crm-results-area').style.display = 'none';
  document.getElementById('crm-empty-state').style.display = 'block';
}

function switchWithdrawalFilter(filter) {
  window.currentWithdrawalFilter = filter;
  renderAdminWithdrawals();
}

// ---------------- COOKIE CONSENT BANNER & MODAL ----------------
function initCookieConsent() {
  const consent = localStorage.getItem('hawkstone_cookie_consent');
  if (consent) return; // Már van elmentett döntés

  // Modal elem létrehozása
  const overlay = document.createElement('div');
  overlay.className = 'cookie-modal-overlay';
  overlay.id = 'cookie-modal-overlay';
  overlay.innerHTML = `
    <div class="cookie-modal-card">
      <div class="cookie-modal-header">
        <div class="cookie-modal-title">
          <span>🍪 Süti (Cookie) Beállítások</span>
        </div>
      </div>
      <div class="cookie-modal-body">
        <p>A weboldalunk sütiket (cookie-kat) használ a biztonságos és zökkenőmentes működés, a felhasználói élmény javítása, valamint statisztikai és marketing célokból. Az elengedhetetlenül szükséges sütik a weboldal működéséhez elengedhetetlenek.</p>
        <p style="margin-top: 8px;">További részleteket az <a href="adatvedelem.html" target="_blank" rel="noopener">Adatkezelési Nyilatkozatban</a> és a <a href="cookie-szabalyzat.html" target="_blank" rel="noopener">Süti Tájékoztatóban</a> találsz.</p>
      </div>


      <div class="cookie-categories-list" id="cookie-categories-list">
        <div class="cookie-category-item">
          <div class="cookie-category-info">
            <h5>Elengedhetetlenül szükséges sütik</h5>
            <p>Ezek a sütik elengedhetetlenek a weboldal működéséhez, a regisztrációhoz, belépéshez és vásárlási folyamathoz.</p>
          </div>
          <label class="cookie-switch">
            <input type="checkbox" checked disabled>
            <span class="cookie-slider"></span>
          </label>
        </div>

        <div class="cookie-category-item">
          <div class="cookie-category-info">
            <h5>Preferenciális sütik</h5>
            <p>Segítenek megjegyezni a nyelvi és területi beállításokat a még személyesebb böngészéshez.</p>
          </div>
          <label class="cookie-switch">
            <input type="checkbox" id="cookie-opt-pref" checked>
            <span class="cookie-slider"></span>
          </label>
        </div>

        <div class="cookie-category-item">
          <div class="cookie-category-info">
            <h5>Statisztikai sütik (Analytics)</h5>
            <p>Névtelen adatokat gyűjtenek az oldal használatáról a szolgáltatások fejlesztéséhez (pl. Google Analytics).</p>
          </div>
          <label class="cookie-switch">
            <input type="checkbox" id="cookie-opt-stat" checked>
            <span class="cookie-slider"></span>
          </label>
        </div>

        <div class="cookie-category-item">
          <div class="cookie-category-info">
            <h5>Marketing célú sütik</h5>
            <p>Releváns ajánlatok és célzott hirdetések megjelenítéséhez (pl. Facebook Pixel, Barion Pixel).</p>
          </div>
          <label class="cookie-switch">
            <input type="checkbox" id="cookie-opt-mkt" checked>
            <span class="cookie-slider"></span>
          </label>
        </div>
      </div>

      <div class="cookie-modal-actions">
        <button type="button" class="btn btn-outline" id="cookie-categories-toggle">⚙️ Beállítások testreszabása</button>
        <button class="btn btn-secondary" id="btn-cookie-necessary">Csak a szükségesek</button>
        <button class="btn btn-primary" id="btn-cookie-all">Összes elfogadása</button>
        <button class="btn btn-outline" id="btn-cookie-custom" style="display:none;">Kijelöltek mentése</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  setTimeout(() => overlay.classList.add('active'), 100);

  const toggleBtn = document.getElementById('cookie-categories-toggle');
  const catList = document.getElementById('cookie-categories-list');
  const customBtn = document.getElementById('btn-cookie-custom');
  const arrow = document.getElementById('cookie-toggle-arrow');

  if (toggleBtn && catList) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = catList.classList.toggle('open');
      if (customBtn) customBtn.style.display = isOpen ? 'inline-block' : 'none';
      if (arrow) arrow.textContent = isOpen ? '▲' : '▼';
    });
  }

  const saveConsent = (type, details) => {
    const consentData = {
      type,
      details,
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('hawkstone_cookie_consent', JSON.stringify(consentData));
    document.cookie = `CookieConsent=${type}; max-age=31536000; path=/`;
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 400);
  };

  document.getElementById('btn-cookie-all').addEventListener('click', () => {
    saveConsent('all', { necessary: true, pref: true, stat: true, mkt: true });
  });

  document.getElementById('btn-cookie-necessary').addEventListener('click', () => {
    saveConsent('necessary', { necessary: true, pref: false, stat: false, mkt: false });
  });

  document.getElementById('btn-cookie-custom').addEventListener('click', () => {
    const pref = document.getElementById('cookie-opt-pref').checked;
    const stat = document.getElementById('cookie-opt-stat').checked;
    const mkt = document.getElementById('cookie-opt-mkt').checked;
    saveConsent('custom', { necessary: true, pref, stat, mkt });
  });
}

// Global invocation on DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCookieConsent);
} else {
  initCookieConsent();
}

// Hero scroll indicator visibility on scroll
function handleHeroScrollIndicatorVisibility() {
  const indicator = document.querySelector('.hero-scroll-indicator');
  if (!indicator) return;
  if (window.scrollY > 30) {
    indicator.style.opacity = '0';
    indicator.style.visibility = 'hidden';
    indicator.style.pointerEvents = 'none';
  } else {
    indicator.style.opacity = '1';
    indicator.style.visibility = 'visible';
    indicator.style.pointerEvents = 'auto';
  }
}
window.addEventListener('scroll', handleHeroScrollIndicatorVisibility, { passive: true });
window.addEventListener('load', handleHeroScrollIndicatorVisibility);




// ---------------- GALÉRIA LIGHTBOX (Összes 22 kép elérhető mindkét oldalon) ----------------
const ALL_HAWKSTONE_GALLERY_IMAGES = [
  // 6 db Főoldali kiemelt referencia:
  {
    src: 'pictures/hawkstone/16152307391813.jpg',
    alt: 'Kültéri boulder falpark',
    city: 'Kültéri boulder falpark',
    name: 'Kültéri szabadidős mászópark'
  },
  {
    src: 'pictures/hawkstone/16152307581081.jpg',
    alt: 'Kültéri mászófal komplexum',
    city: 'Kültéri mászófal komplexum',
    name: 'Panoráma felvétel a szabadban'
  },
  {
    src: 'pictures/hawkstone/16152307736897.jpg',
    alt: 'Kültéri geometriai boulder fal',
    city: 'Kültéri geometriai boulder fal',
    name: 'Változatos dőlésszögű mászófelület'
  },
  {
    src: 'pictures/hawkstone/16152307885749.jpg',
    alt: 'Kültéri szabadidős mászófal',
    city: 'Kültéri szabadidős mászófal',
    name: 'Közösségi és szabadidős fal'
  },
  {
    src: 'pictures/hawkstone/16375233216007.jpg',
    alt: 'Iskolai tornatermi boulder fal',
    city: 'Iskolai tornatermi boulder fal',
    name: 'Biztonsági esésvédő szivaccsal'
  },
  {
    src: 'pictures/hawkstone/16375234187316.jpg',
    alt: 'Iskolai tornatermi mászófal',
    city: 'Iskolai tornatermi mászófal',
    name: 'Tornatermi biztonsági szivacsrendszerrel'
  },
  // 16 db Iskolai és városi referenciafal:
  {
    src: 'pictures/wall/debrecen-szoboszloi-iskola.jpg',
    alt: 'Debrecen – Szoboszlói Úti Általános Iskola',
    city: 'Debrecen',
    name: 'Szoboszlói Úti Általános Iskola'
  },
  {
    src: 'pictures/wall/esztergom-babits-iskola.jpg',
    alt: 'Esztergom – Babits Mihály Általános Iskola',
    city: 'Esztergom',
    name: 'Babits Mihály Általános Iskola'
  },
  {
    src: 'pictures/wall/gyula-implom-iskola.jpg',
    alt: 'Gyula – Implom József Általános Iskola',
    city: 'Gyula',
    name: 'Implom József Általános Iskola'
  },
  {
    src: 'pictures/wall/gyula-maszofal.jpg',
    alt: 'Gyula – Közösségi Mászófal',
    city: 'Gyula',
    name: 'Közösségi Mászófal'
  },
  {
    src: 'pictures/wall/fuzesgyarmat-kossuth-iskola.jpg',
    alt: 'Füzesgyarmat – Kossuth Lajos Általános Iskola',
    city: 'Füzesgyarmat',
    name: 'Kossuth Lajos Általános Iskola'
  },
  {
    src: 'pictures/wall/lokoshaza-altalanos-iskola.jpg',
    alt: 'Lőkösháza – Lőkösházi Általános Iskola',
    city: 'Lőkösháza',
    name: 'Lőkösházi Általános Iskola'
  },
  {
    src: 'pictures/wall/mezoberenyi-altalanos-iskola.jpg',
    alt: 'Mezőberény – Mezőberényi Általános Iskola',
    city: 'Mezőberény',
    name: 'Mezőberényi Általános Iskola'
  },
  {
    src: 'pictures/wall/nyiregyhaza-bem-boulder.jpg',
    alt: 'Nyíregyháza – Bem József Általános Iskola boulder fal',
    city: 'Nyíregyháza',
    name: 'Bem József Általános Iskola boulder fal'
  },
  {
    src: 'pictures/wall/nyiregyhaza-zrinyi-boulder.jpg',
    alt: 'Nyíregyháza – Zrínyi Ilona Gimnázium boulder fal',
    city: 'Nyíregyháza',
    name: 'Zrínyi Ilona Gimnázium boulder fal'
  },
  {
    src: 'pictures/wall/nyirabrany-abranyi-iskola.jpg',
    alt: 'Nyírábrány – Ábrányi Emil Általános Iskola',
    city: 'Nyírábrány',
    name: 'Ábrányi Emil Általános Iskola'
  },
  {
    src: 'pictures/wall/papa-weores-boulder.jpg',
    alt: 'Pápa – Weöres Sándor Általános Iskola boulder fal',
    city: 'Pápa',
    name: 'Weöres Sándor Általános Iskola boulder fal'
  },
  {
    src: 'pictures/wall/gyomaendrod-rozsahegyi-iskola.jpg',
    alt: 'Gyomaendrőd – Rózsahegyi Kálmán Általános Iskola',
    city: 'Gyomaendrőd',
    name: 'Rózsahegyi Kálmán Általános Iskola'
  },
  {
    src: 'pictures/wall/szini-karoly-iskola-boulder.jpg',
    alt: 'Színi Károly Iskola boulder mászófal',
    city: 'Színi Károly Iskola',
    name: 'Két Tanítási Nyelvű Ált. Isk. boulder fal'
  },
  {
    src: 'pictures/wall/nyirtass-tass-vezer-boulder.jpg',
    alt: 'Nyírtass – Tass Vezér Általános Iskola boulder fal',
    city: 'Nyírtass',
    name: 'Tass Vezér Általános Iskola boulder fal'
  },
  {
    src: 'pictures/wall/tiszalok-kossuth-boulder.jpg',
    alt: 'Tiszalök – Kossuth Lajos Általános Iskola boulder fal',
    city: 'Tiszalök',
    name: 'Kossuth Lajos Általános Iskola boulder fal'
  },
  {
    src: 'pictures/wall/tat-bela-iskola.jpg',
    alt: 'Tát – III. Béla Általános Iskola',
    city: 'Tát',
    name: 'III. Béla Általános Iskola'
  },
  // +22 db További referenciafal és videó:
  {
    src: 'pictures/wall/budapest-kulteri-maszofal.jpg',
    alt: 'Budapest – Kültéri boulder mászófal',
    city: 'Budapest',
    name: 'Kültéri boulder mászófal'
  },
  {
    src: 'pictures/wall/budapest-liliomkert-katolikus-ovoda.jpg',
    alt: 'Budapest – Liliomkert Katolikus Óvoda mászófal',
    city: 'Budapest',
    name: 'Liliomkert Katolikus Óvoda – Óvodai mászófal'
  },
  {
    src: 'pictures/wall/fonyod-jatszoteri-maszofal.jpg',
    alt: 'Fonyód – Játszótéri kültéri mászófal',
    city: 'Fonyód',
    name: 'Játszótéri kültéri mászófal'
  },
  {
    src: 'pictures/wall/gyomaendrod-kiss-balint-iskola.jpg',
    alt: 'Gyomaendrőd – Kiss Bálint Általános Iskola',
    city: 'Gyomaendrőd',
    name: 'Kiss Bálint Általános Iskola'
  },
  {
    src: 'pictures/wall/keszthely-hotel-helikon-interaktiv.jpg',
    alt: 'Keszthely – Hotel Helikon interaktív mászófal',
    city: 'Keszthely',
    name: 'Hotel Helikon – Interaktív mászófal'
  },
  {
    src: 'pictures/wall/kerecsend-kalandpark.jpg',
    alt: 'Kerecsend – Kalandpark kültéri mászófal',
    city: 'Kerecsend',
    name: 'Kerecsend Kalandpark mászótorony'
  },
  {
    src: 'pictures/wall/maglod-vermessy-peter-iskola.jpg',
    alt: 'Maglód – Vermessy Péter Általános Iskola',
    city: 'Maglód',
    name: 'Vermessy Péter Általános Iskola'
  },
  {
    src: 'pictures/wall/maklar-kulteri-maszofal.jpg',
    alt: 'Maklár – Kültéri mászófal',
    city: 'Maklár',
    name: 'Kültéri közösségi mászófal'
  },
  {
    src: 'pictures/wall/mako-szikszai-gyorgy-iskola.jpg',
    alt: 'Makó – Szikszai György Református Általános Iskola',
    city: 'Makó',
    name: 'Szikszai György Református Általános Iskola'
  },
  {
    src: 'pictures/wall/monor-jaszai-mari-iskola.jpg',
    alt: 'Monor – Jászai Mari Általános Iskola',
    city: 'Monor',
    name: 'Jászai Mari Általános Iskola'
  },
  {
    src: 'pictures/wall/nyiregyhaza-kossuth-evangelikus-gimnazium.jpg',
    alt: 'Nyíregyháza – Evangélikus Kossuth Lajos Gimnázium mászófal',
    city: 'Nyíregyháza',
    name: 'Evangélikus Kossuth Lajos Gimnázium'
  },
  {
    src: 'pictures/wall/nyiregyhaza-sipkay-barna-technikum.jpg',
    alt: 'Nyíregyháza – Sipkay Barna Technikum mászófal',
    city: 'Nyíregyháza',
    name: 'Sipkay Barna Technikum boulder mászófal'
  },
  {
    src: 'pictures/wall/nyiregyhaza-eotvos-gyakorlo-iskola.jpg',
    alt: 'Nyíregyházi Egyetem Eötvös József Gyakorló Általános Iskola és Gimnázium mászófal',
    city: 'Nyíregyháza',
    name: 'NYE Eötvös József Gyakorló Ált. Isk. és Gimnázium'
  },
  {
    src: 'pictures/wall/ocsa-halaszi-karoly-iskola.jpg',
    alt: 'Ócsa – Halászi Károly Általános Iskola',
    city: 'Ócsa',
    name: 'Halászi Károly Általános Iskola'
  },
  {
    src: 'pictures/wall/tiszatelek-iskolai-maszofal.jpg',
    alt: 'Tiszatelek – Iskolai tornatermi mászófal',
    city: 'Tiszatelek',
    name: 'Iskolai tornatermi boulder mászófal'
  },
  {
    src: 'pictures/wall/veszto-szabo-pal-iskola.jpg',
    alt: 'Vésztő – Szabó Pál Általános Iskola',
    city: 'Vésztő',
    name: 'Szabó Pál Általános Iskola'
  },
  {
    src: 'pictures/wall/kulteri-jatszoteri-maszofal.jpg',
    alt: 'Kültéri játszótéri mászófal',
    city: 'Kültéri mászófal',
    name: 'Játszótéri mászótorony'
  },
  {
    src: 'pictures/wall/kulteri-sziklahu-maszotomb.jpg',
    alt: 'Kültéri sziklahű boulder mászótömb',
    city: 'Kültéri mászótömb',
    name: 'Sziklahű boulder mászótömb'
  },
  {
    src: 'pictures/wall/iskolai-tornatermi-maszofal.jpg',
    alt: 'Beltéri iskolai tornatermi mászófal',
    city: 'Beltéri mászófal',
    name: 'Iskolai tornatermi mászófal'
  },
  {
    src: 'pictures/wall/maszofal-epites-alatt.jpg',
    alt: 'Mászófal építés alatt – fém tartószerkezet',
    city: 'Kivitelezés',
    name: 'Mászófal építés alatt – fém tartószerkezet és burkolat'
  },
  {
    src: 'pictures/wall/egyedi-mobil-forgo-maszofal.jpg',
    alt: 'Egyedi mobil, forgó mászófal',
    city: 'Mobil mászófal',
    name: 'Egyedi mobil, forgó mászófal'
  },
  {
    src: 'video/egyedi-mobil-forgo-maszofal.mp4',
    type: 'video',
    poster: 'pictures/wall/egyedi-mobil-forgo-maszofal.jpg',
    alt: 'Egyedi mobil, forgó mászófal működés közben',
    city: 'Mobil mászófal • Videó',
    name: 'Egyedi mobil, forgó mászófal működés közben'
  }
];

function initGalleryLightbox() {
  const triggers = document.querySelectorAll('.gs-item, .ref-scatter-item, .gallery-card');
  if (!triggers.length) return;

  const images = ALL_HAWKSTONE_GALLERY_IMAGES;

  const existingBox = document.querySelector('.gallery-lightbox');
  if (existingBox) existingBox.remove();

  const box = document.createElement('div');
  box.className = 'gallery-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Képgaléria');
  box.innerHTML = `
    <button type="button" class="gl-btn gl-close" aria-label="Bezárás">✕</button>
    <div class="gl-counter"><span class="gl-cur">1</span> / ${images.length}</div>
    <button type="button" class="gl-btn gl-prev" aria-label="Előző kép">❮</button>
    <div class="gl-stage">
      <div class="gl-card">
        <img class="gl-img" src="" alt="">
        <video class="gl-video" controls playsinline preload="metadata" style="display:none;"></video>
        <div class="gl-glass-caption">
          <div class="gl-tag"><span class="gl-tag-dot"></span><span class="gl-tag-text">Referencia mászófal</span></div>
          <h3 class="gl-title"></h3>
          <p class="gl-loc"></p>
        </div>
      </div>
    </div>
    <button type="button" class="gl-btn gl-next" aria-label="Következő kép">❯</button>
  `;
  document.body.appendChild(box);

  const cardEl = box.querySelector('.gl-card');
  const imgEl = box.querySelector('.gl-img');
  const videoEl = box.querySelector('.gl-video');
  const curEl = box.querySelector('.gl-cur');
  const titleEl = box.querySelector('.gl-title');
  const locEl = box.querySelector('.gl-loc');
  let index = 0;

  const stopVideo = () => {
    if (videoEl) {
      try { videoEl.pause(); } catch (e) {}
    }
  };

  const show = (i, animate) => {
    stopVideo();
    index = (i + images.length) % images.length;
    const current = images[index];

    const apply = () => {
      const isVideo = current.type === 'video' || (current.src && current.src.endsWith('.mp4'));
      if (isVideo) {
        imgEl.style.display = 'none';
        videoEl.style.display = 'block';
        if (current.poster) videoEl.poster = current.poster;
        videoEl.src = current.src;
        cardEl.classList.add('is-video');
        videoEl.play().catch(() => {});
      } else {
        videoEl.style.display = 'none';
        videoEl.removeAttribute('src');
        cardEl.classList.remove('is-video');
        imgEl.style.display = 'block';
        imgEl.src = current.src;
        imgEl.alt = current.alt;
      }

      curEl.textContent = index + 1;
      titleEl.textContent = current.city || current.name;
      if (current.city && current.name && current.city !== current.name) {
        locEl.textContent = current.name;
        locEl.style.display = 'block';
      } else {
        locEl.textContent = '';
        locEl.style.display = 'none';
      }
      cardEl.classList.remove('switching');
    };

    if (animate) {
      cardEl.classList.add('switching');
      setTimeout(apply, 180);
    } else {
      apply();
    }
  };

  const open = (i) => {
    show(i, false);
    box.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  const close = () => {
    stopVideo();
    box.classList.remove('open');
    document.body.style.overflow = '';
  };
  const next = () => show(index + 1, true);
  const prev = () => show(index - 1, true);

  triggers.forEach((btn) => {
    if (btn.dataset.glBound === '1') return;
    btn.dataset.glBound = '1';

    const inlineVid = btn.querySelector('video');
    if (inlineVid) {
      btn.addEventListener('mouseenter', () => { inlineVid.play().catch(() => {}); });
      btn.addEventListener('mouseleave', () => { inlineVid.pause(); });
    }
    btn.addEventListener('click', () => {
      const img = btn.querySelector('img');
      const vid = btn.querySelector('video');
      const src = btn.getAttribute('data-src') || (img ? img.getAttribute('src') : (vid ? vid.getAttribute('src') : ''));
      let targetIndex = -1;
      if (src) {
        targetIndex = images.findIndex(item => item.src === src);
      }
      if (targetIndex === -1) {
        const idxAttr = btn.getAttribute('data-index');
        targetIndex = idxAttr !== null ? parseInt(idxAttr, 10) : 0;
      }
      if (window.__openHawkstoneLightbox) {
        window.__openHawkstoneLightbox(targetIndex >= 0 ? targetIndex : 0);
      } else {
        open(targetIndex >= 0 ? targetIndex : 0);
      }
    });
  });

  window.__openHawkstoneLightbox = open;

  box.querySelector('.gl-close').addEventListener('click', close);
  box.querySelector('.gl-next').addEventListener('click', (e) => { e.stopPropagation(); next(); });
  box.querySelector('.gl-prev').addEventListener('click', (e) => { e.stopPropagation(); prev(); });
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.classList.contains('gl-stage')) close();
  });

  if (!window.__glKeydownBound) {
    window.__glKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      const activeBox = document.querySelector('.gallery-lightbox.open');
      if (!activeBox) return;
      if (e.key === 'Escape') activeBox.querySelector('.gl-close')?.click();
      else if (e.key === 'ArrowRight') activeBox.querySelector('.gl-next')?.click();
      else if (e.key === 'ArrowLeft') activeBox.querySelector('.gl-prev')?.click();
    });
  }

  // Érintéses lapozás (swipe)
  let touchX = null;
  box.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) { dx < 0 ? next() : prev(); }
  }, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGalleryLightbox);
} else {
  initGalleryLightbox();
}

// ---------------- REFERENCIÁK VÁNDORLÓ VONAL ANIMÁCIÓ (KÉPEK MÖGÖTT) ----------------
function initReferencesTrack() {
  const wrap = document.getElementById('refBoardWrap');
  const board = document.getElementById('referencesBoard');
  const svg = document.getElementById('refTrackSvg');
  const container = document.getElementById('refTrackContainer');
  const pathBg = document.getElementById('refTrackBg');
  const pathMain = document.getElementById('refTrackMain');
  const pathPulse = document.getElementById('refTrackPulse');
  const nodesG = document.getElementById('refTrackNodes');

  if (!wrap || !board || !svg || !pathMain) return;

  function update() {
    const W = board.offsetWidth;
    const H = board.offsetHeight;
    if (!W || !H) return;

    const isMobile = window.innerWidth <= 600;
    const isTablet = window.innerWidth <= 992;

    // Mennyire lógjon ki a forduló (px) a legszélső képektől
    const protrude = isMobile ? 18 : (isTablet ? 36 : 60);
    const loopR = isMobile ? 15 : (isTablet ? 20 : 26);

    // Kényelmes margó az SVG doboznak, hogy a fordulóív és a fény/glow ne vágódjon le
    const padX = protrude + loopR + 24;
    const padY = isMobile ? 24 : 36;

    // A konténert és az SVG koordináta-rendszert pontosan kiterjesztjük
    container.style.position = 'absolute';
    container.style.left = (-padX) + 'px';
    container.style.top = (-padY) + 'px';
    container.style.width = (W + padX * 2) + 'px';
    container.style.height = (H + padY * 2) + 'px';

    const totalW = W + padX * 2;
    const totalH = H + padY * 2;
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

    // A kártyák bal és jobb széle az SVG koordináta-rendszerben
    const leftEdge = padX;
    const rightEdge = padX + W;

    // Kezdőpont bal fent, kissé kilógva
    const p0 = { x: leftEdge - (protrude * 0.4), y: padY + 30 };

    // Fordulópontok a kártyák síkján túl kilógatva (5 forduló a bővített galériához)
    const t1 = { x: rightEdge + protrude, y: padY + H * 0.16 };
    const t2 = { x: leftEdge - protrude, y: padY + H * 0.34 };
    const t3 = { x: rightEdge + protrude, y: padY + H * 0.52 };
    const t4 = { x: leftEdge - protrude, y: padY + H * 0.70 };
    const t5 = { x: rightEdge + protrude, y: padY + H * 0.88 };

    // Kilépő végpont bal lent
    const pEnd = { x: leftEdge - (protrude * 0.45), y: padY + H + 22 };

    // Útvonal a széleken kilógó, gömbölyű fordulóhurkokkal
    const d = [
      `M ${p0.x} ${p0.y}`,
      `L ${t1.x - loopR * 0.9} ${t1.y - loopR * 0.75}`,
      `C ${t1.x + loopR * 0.85} ${t1.y - loopR * 0.45}, ${t1.x + loopR * 0.85} ${t1.y + loopR * 0.45}, ${t1.x - loopR * 0.9} ${t1.y + loopR * 0.75}`,
      `L ${t2.x + loopR * 0.9} ${t2.y - loopR * 0.75}`,
      `C ${t2.x - loopR * 0.85} ${t2.y - loopR * 0.45}, ${t2.x - loopR * 0.85} ${t2.y + loopR * 0.45}, ${t2.x + loopR * 0.9} ${t2.y + loopR * 0.75}`,
      `L ${t3.x - loopR * 0.9} ${t3.y - loopR * 0.75}`,
      `C ${t3.x + loopR * 0.85} ${t3.y - loopR * 0.45}, ${t3.x + loopR * 0.85} ${t3.y + loopR * 0.45}, ${t3.x - loopR * 0.9} ${t3.y + loopR * 0.75}`,
      `L ${t4.x + loopR * 0.9} ${t4.y - loopR * 0.75}`,
      `C ${t4.x - loopR * 0.85} ${t4.y - loopR * 0.45}, ${t4.x - loopR * 0.85} ${t4.y + loopR * 0.45}, ${t4.x + loopR * 0.9} ${t4.y + loopR * 0.75}`,
      `L ${t5.x - loopR * 0.9} ${t5.y - loopR * 0.75}`,
      `C ${t5.x + loopR * 0.85} ${t5.y - loopR * 0.45}, ${t5.x + loopR * 0.85} ${t5.y + loopR * 0.45}, ${t5.x - loopR * 0.9} ${t5.y + loopR * 0.75}`,
      `L ${pEnd.x} ${pEnd.y}`
    ].join(' ');

    pathBg.setAttribute('d', d);
    pathMain.setAttribute('d', d);
    pathPulse.setAttribute('d', d);

    const turns = [
      { x: t1.x, y: t1.y },
      { x: t2.x, y: t2.y },
      { x: t3.x, y: t3.y },
      { x: t4.x, y: t4.y },
      { x: t5.x, y: t5.y }
    ];

    nodesG.innerHTML = turns.map((t, idx) => `
      <g class="ref-node-group ref-node-${idx}">
        <circle cx="${t.x}" cy="${t.y}" r="${isMobile ? 12 : 18}" class="ref-node-outer" />
        <circle cx="${t.x}" cy="${t.y}" r="${isMobile ? 5 : 8}" class="ref-node-inner" />
        <circle cx="${t.x}" cy="${t.y}" r="${isMobile ? 2 : 3.5}" class="ref-node-core" />
      </g>
    `).join('');

    const length = Math.ceil(pathMain.getTotalLength());
    pathMain.style.strokeDasharray = length;
    if (!container.classList.contains('is-animated')) {
      pathMain.style.strokeDashoffset = length;
    }
    pathPulse.style.strokeDasharray = `180 ${length}`;
    container.style.setProperty('--ref-track-len', length);
  }

  update();
  if (!window.__refTrackResizeBound) {
    window.__refTrackResizeBound = true;
    window.addEventListener('resize', update, { passive: true });
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          container.classList.add('is-animated');
          io.disconnect();
        }
      });
    }, { threshold: 0.1 });
    io.observe(wrap);
  } else {
    container.classList.add('is-animated');
  }

  // Kártyák és képek fokozatos (staggered) beúszó animációja betöltéskor és görgetéskor
  const allCards = Array.from(board.querySelectorAll('.ref-scatter-item'));
  const unboundCards = [];

  allCards.forEach((card, idx) => {
    if (card.dataset.refAnimBound === '1') return;
    card.dataset.refAnimBound = '1';
    unboundCards.push(card);

    const colDelay = (idx % 4) * 95;
    card.style.setProperty('--ref-delay', `${colDelay}ms`);
    card.classList.add('ref-anim-init');

    card.addEventListener('animationend', (ev) => {
      if (ev.animationName === 'refCardReveal') {
        card.classList.remove('ref-anim-init', 'ref-anim-in');
        card.style.removeProperty('--ref-delay');
      }
    });

    const img = card.querySelector('img:not(.ref-video-badge img)');
    if (img) {
      if (img.complete && img.naturalWidth > 0) {
        img.classList.add('ref-img-loaded');
      } else {
        img.classList.add('ref-img-loading');
        const markLoaded = () => {
          img.classList.remove('ref-img-loading');
          img.classList.add('ref-img-loaded');
        };
        img.addEventListener('load', markLoaded, { once: true });
        img.addEventListener('error', markLoaded, { once: true });
      }
    }
  });

  if (unboundCards.length > 0) {
    if ('IntersectionObserver' in window) {
      const cardIo = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('ref-anim-in');
            cardIo.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -20px 0px' });

      unboundCards.forEach((c) => cardIo.observe(c));
    } else {
      unboundCards.forEach((c) => c.classList.remove('ref-anim-init'));
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReferencesTrack);
} else {
  initReferencesTrack();
}

// ---------------- ADMIN ÁLTAL FELTÖLTÖTT REFERENCIÁK & GALÉRIA KÉPEK BETÖLTÉSE ----------------
async function loadDynamicGalleryItems() {
  const refBoard = document.getElementById('referencesBoard');
  const homeSpread = document.getElementById('gallerySpread');

  try {
    const res = await fetch('/api/gallery');
    if (!res.ok) return;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) return;

    // A legrégebben feltöltött új képtől a legfrissebbig fűzzük hozzá
    const sorted = [...items].sort((a, b) => a.id - b.id);

    sorted.forEach((item) => {
      const src = item.src || item.image_url || `/api/gallery-image/${item.id}/${item.filename}`;
      const city = item.city || 'HawkStone Referencia';
      const name = item.name || '';
      const alt = name ? `${city} – ${name}` : city;

      if (!ALL_HAWKSTONE_GALLERY_IMAGES.some(img => img.src === src)) {
        ALL_HAWKSTONE_GALLERY_IMAGES.push({
          src,
          alt,
          city,
          name: name || city
        });
      }

      if (!refBoard && !homeSpread) return;

      if (item.target === 'references' && refBoard) {
        const count = refBoard.querySelectorAll('.ref-scatter-item').length + 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `ref-scatter-item rsi-${count}`;
        btn.setAttribute('data-src', src);
        btn.setAttribute('data-city', city);
        btn.setAttribute('data-name', name);
        btn.setAttribute('aria-label', `${alt} megnyitása`);

        const img = document.createElement('img');
        img.src = src;
        img.alt = alt;
        img.loading = 'lazy';

        const cap = document.createElement('div');
        cap.className = 'ref-scatter-caption';
        const citySpan = document.createElement('span');
        citySpan.className = 'ref-scatter-city';
        citySpan.textContent = city;
        cap.appendChild(citySpan);
        if (name) {
          const nameSpan = document.createElement('span');
          nameSpan.className = 'ref-scatter-name';
          nameSpan.textContent = name;
          cap.appendChild(nameSpan);
        }

        btn.appendChild(img);
        btn.appendChild(cap);
        refBoard.appendChild(btn);
      } else if (item.target === 'home_gallery' && homeSpread) {
        const count = homeSpread.querySelectorAll('.gs-item').length + 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `gs-item gs-${((count - 1) % 6) + 1}`;
        btn.setAttribute('data-src', src);
        btn.setAttribute('data-city', city);
        btn.setAttribute('data-name', name);
        btn.setAttribute('aria-label', `${alt} megnyitása`);

        const img = document.createElement('img');
        img.src = src;
        img.alt = alt;
        img.loading = 'lazy';

        btn.appendChild(img);
        homeSpread.appendChild(btn);
      }
    });

    if (refBoard || homeSpread) {
      initGalleryLightbox();
    }
    if (refBoard) {
      initReferencesTrack();
    }
  } catch (err) {
    console.warn('Dinamikus galéria elemek betöltése sikertelen:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadDynamicGalleryItems);
} else {
  loadDynamicGalleryItems();
}

// ---------------- ADMIN PANEL: REFERENCIÁK & GALÉRIA KEZELÉSE ----------------
let currentAdminRefDataUrl = null;
let currentAdminRefFilter = 'all';
window.adminReferencesList = [];

function toWebFriendlySlug(str) {
  if (!str) return '';
  const map = {
    'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ö': 'o', 'ő': 'o', 'ú': 'u', 'ü': 'u', 'ű': 'u',
    'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ö': 'o', 'Ő': 'o', 'Ú': 'u', 'Ü': 'u', 'Ű': 'u'
  };
  return String(str)
    .replace(/[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g, ch => map[ch] || ch)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function updateAdminRefTargetUI() {
  const checked =
    document.querySelector('input[name="admin-ref-target"]:checked')?.value ||
    document.querySelector('input[name="ref-target"]:checked')?.value ||
    'references';
  const lblRef = document.getElementById('ref-target-card-references') || document.getElementById('ref-target-label-references');
  const lblHome = document.getElementById('ref-target-card-home') || document.getElementById('ref-target-label-home');

  if (lblRef && lblHome) {
    if (checked === 'references') {
      lblRef.style.border = '1.5px solid var(--primary)';
      lblRef.style.background = 'rgba(242, 118, 32, 0.12)';
      lblHome.style.border = '1.5px solid var(--border-color)';
      lblHome.style.background = 'rgba(255, 255, 255, 0.02)';
    } else {
      lblHome.style.border = '1.5px solid var(--primary)';
      lblHome.style.background = 'rgba(242, 118, 32, 0.12)';
      lblRef.style.border = '1.5px solid var(--border-color)';
      lblRef.style.background = 'rgba(255, 255, 255, 0.02)';
    }
  }
}

function updateAdminRefPreviewAndSlug() {
  const cityInput = document.getElementById('admin-ref-city') || document.getElementById('ref-city-input');
  const nameInput = document.getElementById('admin-ref-name') || document.getElementById('ref-name-input');
  const slugInput = document.getElementById('admin-ref-slug') || document.getElementById('ref-slug-input');
  const previewCity = document.getElementById('admin-ref-preview-city') || document.getElementById('ref-preview-city');
  const previewName = document.getElementById('admin-ref-preview-name') || document.getElementById('ref-preview-name');

  const cityVal = cityInput ? cityInput.value.trim() : '';
  const nameVal = nameInput ? nameInput.value.trim() : '';

  if (previewCity) previewCity.textContent = cityVal || 'VÁROS / FŐCÍM';
  if (previewName) previewName.textContent = nameVal || 'Intézmény vagy mászófal neve';

  if (slugInput && !slugInput.dataset.manual && !slugInput.dataset.userEdited) {
    const autoSlug = toWebFriendlySlug(`${cityVal} ${nameVal}`) || 'hawkstone-referencia';
    slugInput.value = (cityVal || nameVal) ? `${autoSlug}.jpg` : '';
  }
}

function handleAdminRefFileChange(inputOrEvent) {
  const inputEl = inputOrEvent?.target ? inputOrEvent.target : inputOrEvent;
  const file = inputEl?.files?.[0];
  const optInfo = document.getElementById('admin-ref-opt-info') || document.getElementById('ref-file-label');
  const previewImg = document.getElementById('admin-ref-preview-img') || document.getElementById('ref-preview-img');

  if (!file) {
    currentAdminRefDataUrl = null;
    if (optInfo) optInfo.style.display = 'none';
    return;
  }

  if (!file.type.startsWith('image/')) {
    showToast('Kérjük, érvényes képfájlt (JPG, PNG, WEBP) válassz ki!', 'error');
    if (inputEl) inputEl.value = '';
    return;
  }

  if (optInfo) {
    optInfo.style.display = 'block';
    optInfo.innerHTML = `<strong style="color:#10b981;">⏳ Feldolgozás:</strong> ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB) – optimalizálás...`;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX_DIM = 2048;
      let width = img.width;
      let height = img.height;

      if (width > MAX_DIM || height > MAX_DIM) {
        if (width >= height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0c0e17';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.84);
      currentAdminRefDataUrl = optimizedDataUrl;

      const approxBytes = Math.round((optimizedDataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
      const kb = Math.round(approxBytes / 1024);

      if (previewImg) previewImg.src = optimizedDataUrl;
      if (optInfo) {
        optInfo.style.display = 'block';
        optInfo.innerHTML = `✓ Optimalizálva és feltöltésre kész: <strong>${width}×${height} px (~${kb} KB JPG)</strong>`;
      }
      updateAdminRefPreviewAndSlug();
    };
    img.onerror = () => {
      showToast('Nem sikerült beolvasni a képfájlt.', 'error');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function handleAdminReferenceUpload(event) {
  event.preventDefault();

  const target =
    document.querySelector('input[name="admin-ref-target"]:checked')?.value ||
    document.querySelector('input[name="ref-target"]:checked')?.value ||
    'references';
  const cityEl = document.getElementById('admin-ref-city') || document.getElementById('ref-city-input');
  const nameEl = document.getElementById('admin-ref-name') || document.getElementById('ref-name-input');
  const slugEl = document.getElementById('admin-ref-slug') || document.getElementById('ref-slug-input');
  const submitBtn = document.getElementById('admin-ref-submit-btn') || document.getElementById('ref-upload-submit-btn');

  const city = cityEl?.value?.trim() || '';
  const name = nameEl?.value?.trim() || '';
  const customSlug = slugEl?.value?.trim() || '';

  if (!city) {
    showToast('A város / főcím megadása kötelező!', 'error');
    return;
  }

  if (!currentAdminRefDataUrl) {
    showToast('Kérjük, válassz ki egy feltöltendő képet!', 'error');
    return;
  }

  const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Konvertálás és mentés...';
  }

  try {
    const res = await fetch('/api/admin/references', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        target,
        city,
        name,
        filename: customSlug,
        customSlug,
        imageData: currentAdminRefDataUrl,
        imageBase64: currentAdminRefDataUrl
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Hiba történt a kép feltöltésekor.');
    }

    showToast(
      `Kép sikeresen feltöltve (${data.item.filename}) a ${target === 'home_gallery' ? 'Főoldali galériába' : 'Referenciák oldalra'}!`,
      'success'
    );

    // Reset form
    const form = document.getElementById('admin-reference-form') || document.getElementById('admin-reference-upload-form');
    if (form) form.reset();
    if (slugEl) {
      delete slugEl.dataset.manual;
      delete slugEl.dataset.userEdited;
    }
    currentAdminRefDataUrl = null;
    const previewImg = document.getElementById('admin-ref-preview-img');
    if (previewImg) previewImg.src = 'pictures/minta.png';
    const optInfo = document.getElementById('admin-ref-opt-info');
    if (optInfo) {
      optInfo.style.display = 'none';
      optInfo.innerHTML = '';
    }
    updateAdminRefTargetUI();
    updateAdminRefPreviewAndSlug();

    await loadAdminReferences();
  } catch (err) {
    showToast(err.message || 'Nem sikerült feltölteni a képet.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText || 'Kép konvertálása és hozzáadása';
    }
  }
}

async function loadAdminReferences() {
  const container = document.getElementById('admin-references-list');
  if (!container) return;

  container.innerHTML = '<p style="color: var(--text-muted); text-align: center; grid-column: 1/-1; padding: 30px;">Feltöltött képek betöltése...</p>';

  try {
    const res = await fetch('/api/admin/references', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    const items = await res.json();
    window.adminReferencesList = Array.isArray(items) ? items : [];
    renderAdminReferencesList();
  } catch (err) {
    console.error('Error loading admin references:', err);
    container.innerHTML = '<p style="color: var(--danger); text-align: center; grid-column: 1/-1; padding: 30px;">Nem sikerült betölteni a feltöltött referenciákat.</p>';
  }
}

function filterAdminReferences(filter) {
  currentAdminRefFilter = filter || 'all';
  const buttons = {
    all: document.getElementById('admin-ref-filter-all') || document.getElementById('ref-filter-all'),
    references: document.getElementById('admin-ref-filter-references') || document.getElementById('ref-filter-references'),
    home_gallery: document.getElementById('admin-ref-filter-home') || document.getElementById('ref-filter-home')
  };
  Object.entries(buttons).forEach(([key, btn]) => {
    if (!btn) return;
    if (key === currentAdminRefFilter) {
      btn.classList.remove('btn-secondary', 'btn-outline');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
    }
  });
  renderAdminReferencesList();
}

function renderAdminReferencesList() {
  const container = document.getElementById('admin-references-list');
  if (!container) return;

  const allItems = window.adminReferencesList || [];
  const filtered = currentAdminRefFilter === 'all'
    ? allItems
    : allItems.filter(item => item.target === currentAdminRefFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 36px 20px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px;">
        <p style="margin: 0 0 6px 0; color: #fff; font-weight: 600;">Még nincs admin felületről feltöltött kép ebben a kategóriában.</p>
        <p style="margin: 0; font-size: 12px; color: var(--text-muted);">A fenti űrlappal bármikor feltölthetsz új képet a Referenciák oldalra vagy a Főoldali galériába.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const isHome = item.target === 'home_gallery';
    const badgeText = isHome ? '🏠 Főoldali Galéria' : '🧗 Referenciák oldal';
    const badgeColor = isHome ? '#38bdf8' : 'var(--primary)';
    const badgeBg = isHome ? 'rgba(56, 189, 248, 0.14)' : 'rgba(242, 118, 32, 0.16)';
    const imgSrc = item.src || item.image_url || `/api/gallery-image/${item.id}/${item.filename}`;
    const createdDate = item.created_at ? String(item.created_at).substring(0, 16).replace('T', ' ') : '';

    return `
      <div style="background: rgba(15, 19, 32, 0.85); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 10px 26px rgba(0,0,0,0.4);">
        <div style="position: relative; aspect-ratio: 4 / 3; background: #090c14; overflow: hidden;">
          <img src="${imgSrc}" alt="${(item.city || '').replace(/"/g, '&quot;')}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;">
          <span style="position: absolute; top: 10px; left: 10px; background: ${badgeBg}; border: 1px solid ${badgeColor}; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; backdrop-filter: blur(8px);">
            ${badgeText}
          </span>
        </div>
        <div style="padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; flex: 1;">
          <strong style="color: #fff; font-size: 15px; line-height: 1.3;">${item.city || '-'}</strong>
          <span style="color: var(--text-secondary); font-size: 12.5px; line-height: 1.4;">${item.name || '<em style="color:var(--text-muted);">Nincs alcím megadva</em>'}</span>
          <div style="margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.07); display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-muted);">
            <span style="word-break: break-all;">📄 <code style="color: var(--primary);">${item.filename}</code></span>
            ${createdDate ? `<span>🕒 ${createdDate}</span>` : ''}
          </div>
          <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <a href="${isHome ? 'index.html#gallery' : 'referenciak.html'}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 10px; text-decoration: none;">Megtekintés</a>
            <button type="button" onclick="deleteAdminReference(${item.id})" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 12px; border-color: rgba(239,68,68,0.4); color: #f87171;">Törlés</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteAdminReference(id) {
  const confirmed = await showConfirmModal({
    title: 'Kép törlése',
    message: 'Biztosan törölni szeretnéd ezt a feltöltött képet a weboldalról?',
    confirmText: 'Törlés',
    cancelText: 'Mégse',
    variant: 'danger'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/references/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a törlés során.');
    showToast('Kép sikeresen eltávolítva!', 'success');
    await loadAdminReferences();
  } catch (err) {
    showToast(err.message || 'Nem sikerült törölni a képet.', 'error');
    showAlertModal(err.message || 'Nem sikerült törölni a képet.', 'Törlési hiba');
  }
}

window.updateAdminRefTargetUI = updateAdminRefTargetUI;
window.updateAdminRefPreviewAndSlug = updateAdminRefPreviewAndSlug;
window.handleAdminRefFileChange = handleAdminRefFileChange;
window.handleAdminReferenceUpload = handleAdminReferenceUpload;
window.loadAdminReferences = loadAdminReferences;
window.filterAdminReferences = filterAdminReferences;
window.deleteAdminReference = deleteAdminReference;

// ---------------- KÖZPONTI WEBOLDAL ADMIN PANEL (webadmin.html) & KAPCSOLATI ADATOK ----------------
async function loadDynamicContactInfo() {
  try {
    const res = await fetch('/api/site-settings/contact');
    if (!res.ok) return;
    const contact = await res.json();
    if (!contact || typeof contact !== 'object') return;

    window.siteContactInfo = contact;
    try {
      sessionStorage.setItem('hawkstone_contact_info', JSON.stringify(contact));
    } catch (_) {}

    // Frissítjük a fejlécben megjelenő telefonszámot és e-mail címet
    const phoneDisplay = contact.phone_display || '(+36) 30 574 6946';
    const phoneTel = contact.phone_tel || '+36305746946';
    const emailPrimary = contact.email_primary || 'orangeramp.info@gmail.com';

    document.querySelectorAll('.header-contact-desktop a[href^="tel:"]').forEach(a => {
      a.href = `tel:${phoneTel}`;
      a.title = `Telefonszám: ${phoneDisplay}`;
      const txt = a.querySelector('.header-contact-text');
      if (txt) txt.textContent = phoneDisplay;
    });
    document.querySelectorAll('.header-contact-desktop a[href^="mailto:"]').forEach(a => {
      a.href = `mailto:${emailPrimary}`;
      a.title = `E-mail: ${emailPrimary}`;
      const txt = a.querySelector('.header-contact-text');
      if (txt) txt.textContent = emailPrimary;
    });
    document.querySelectorAll('.menu-contact-mobile a[href^="tel:"]').forEach(a => {
      a.href = `tel:${phoneTel}`;
      const val = a.querySelector('.menu-contact-val');
      if (val) val.textContent = phoneDisplay;
    });
    document.querySelectorAll('.menu-contact-mobile a[href^="mailto:"]').forEach(a => {
      a.href = `mailto:${emailPrimary}`;
      const val = a.querySelector('.menu-contact-val');
      if (val) val.textContent = emailPrimary;
    });

    // Frissítjük a kapcsolat.html kártyáját (ha az aktuális oldalon jelen van)
    const contactMainCard = document.querySelector('.contact-info-col .contact-card-main');
    if (contactMainCard) {
      const compHeading = contactMainCard.querySelector('.contact-company');
      if (compHeading && contact.company_name) {
        compHeading.textContent = contact.company_name;
      }
      const listItems = contactMainCard.querySelectorAll('.contact-list > li');
      // 1. Cím
      if (listItems[0]) {
        const val = listItems[0].querySelector('.contact-value');
        if (val) {
          val.innerHTML = `${contact.company_name || 'HOVI-TECH Kft.'}<br>${contact.address || ''}`;
        }
      }
      // 2. Telefon
      if (listItems[1]) {
        const telLink = listItems[1].querySelector('a.contact-link');
        if (telLink) {
          telLink.href = `tel:${phoneTel}`;
          telLink.textContent = phoneDisplay;
        }
      }
      // 3. E-mail
      if (listItems[2]) {
        const emailDiv = listItems[2].querySelector('div');
        if (emailDiv) {
          let html = `<span class="contact-label">E-mail</span>`;
          if (contact.email_primary) {
            html += `<a class="contact-value contact-link" href="mailto:${contact.email_primary}">${contact.email_primary}</a>`;
          }
          if (contact.email_secondary) {
            html += `<a class="contact-value contact-link" href="mailto:${contact.email_secondary}">${contact.email_secondary}</a>`;
          }
          emailDiv.innerHTML = html;
        }
      }
      // 4. Web
      if (listItems[3]) {
        const webVal = listItems[3].querySelector('.contact-value');
        if (webVal) {
          const webs = [contact.web_primary, contact.web_secondary].filter(Boolean);
          webVal.innerHTML = webs.join('<br>');
        }
      }
    }
  } catch (err) {
    console.warn('Kapcsolati adatok betöltése sikertelen:', err);
  }
}

function switchWebAdminTab(tab) {
  const validTabs = ['references', 'home-types', 'walls', 'news', 'contact'];
  const cleanTab = validTabs.includes(tab) ? tab : 'references';
  const titleEl = document.getElementById('webadmin-active-tab-title');
  const refContent = document.getElementById('webadmin-references-content');
  const homeTypesContent = document.getElementById('webadmin-home-types-content');
  const wallsContent = document.getElementById('webadmin-walls-content');
  const newsContent = document.getElementById('webadmin-news-content');
  const contactContent = document.getElementById('webadmin-contact-content');
  const btnRef = document.getElementById('webadmin-tab-btn-references');
  const btnHomeTypes = document.getElementById('webadmin-tab-btn-home-types');
  const btnWalls = document.getElementById('webadmin-tab-btn-walls');
  const btnNews = document.getElementById('webadmin-tab-btn-news');
  const btnContact = document.getElementById('webadmin-tab-btn-contact');

  if (titleEl) {
    if (cleanTab === 'contact') {
      titleEl.textContent = 'KAPCSOLATI ADATOK SZERKESZTÉSE';
    } else if (cleanTab === 'home-types') {
      titleEl.textContent = 'MÁSZÓFAL TÍPUSAINK KÁRTYÁK KEZELÉSE';
    } else if (cleanTab === 'walls') {
      titleEl.textContent = 'MÁSZÓFALAINK OLDAL KÁRTYÁK KEZELÉSE';
    } else if (cleanTab === 'news') {
      titleEl.textContent = 'ÜZENŐFAL KEZELÉSE';
    } else {
      titleEl.textContent = 'REFERENCIÁK ÉS GALÉRIA KEZELÉSE';
    }
  }

  if (refContent) refContent.style.display = cleanTab === 'references' ? 'block' : 'none';
  if (homeTypesContent) homeTypesContent.style.display = cleanTab === 'home-types' ? 'block' : 'none';
  if (wallsContent) wallsContent.style.display = cleanTab === 'walls' ? 'block' : 'none';
  if (newsContent) newsContent.style.display = cleanTab === 'news' ? 'block' : 'none';
  if (contactContent) contactContent.style.display = cleanTab === 'contact' ? 'block' : 'none';

  const tabBtns = {
    references: btnRef,
    'home-types': btnHomeTypes,
    walls: btnWalls,
    news: btnNews,
    contact: btnContact
  };
  Object.entries(tabBtns).forEach(([key, btn]) => {
    if (!btn) return;
    if (key === cleanTab) {
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
    }
  });

  if (history.replaceState) {
    history.replaceState(null, null, '#' + cleanTab);
  }
  renderHeader();
}

async function initWebAdminPanel() {
  const loginView = document.getElementById('webadmin-login-view');
  const panelView = document.getElementById('webadmin-panel-view');
  const token = localStorage.getItem('token');
  const hasAccess = hasRole('ADMIN') || hasRole('STAFF');

  if (!token || !hasAccess) {
    if (loginView) loginView.style.display = 'block';
    if (panelView) panelView.style.display = 'none';
    renderHeader();
    return;
  }

  if (loginView) loginView.style.display = 'none';
  if (panelView) panelView.style.display = 'block';

  const resolveHashTab = (h) => {
    if (h === '#contact') return 'contact';
    if (h === '#walls') return 'walls';
    if (h === '#home-types') return 'home-types';
    if (h === '#news') return 'news';
    return 'references';
  };

  switchWebAdminTab(resolveHashTab(window.location.hash));

  window.addEventListener('hashchange', () => {
    switchWebAdminTab(resolveHashTab(window.location.hash));
  });

  await Promise.all([
    loadAdminReferences(),
    loadWebAdminHomeWallTypes(),
    loadWebAdminWalls(),
    loadWebAdminNews(),
    loadWebAdminContactForm()
  ]);

  updateWebAdminWallPreview();
}

async function handleWebAdminLogin(event) {
  event.preventDefault();
  const email = document.getElementById('webadmin-email')?.value?.trim() || '';
  const password = document.getElementById('webadmin-password')?.value || '';
  const btn = document.getElementById('webadmin-login-btn');

  if (!email || !password) {
    showToast('Kérjük, add meg a felhasználónevet és a jelszót!', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Bejelentkezés...';
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Sikertelen bejelentkezés.');
    }

    const loginRoles = (data.user?.role || '').split(',').map(r => r.trim().toUpperCase());
    if (!data.user || (!loginRoles.includes('ADMIN') && !loginRoles.includes('STAFF'))) {
      throw new Error('Ehhez a felülethez adminisztrátori jogosultság szükséges!');
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    localStorage.setItem('hawkstone_last_activity', String(Date.now()));
    showToast('Sikeres belépés a Weboldal Adminisztrációba!', 'success');
    await initWebAdminPanel();
  } catch (err) {
    showToast(err.message || 'Belépési hiba.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Belépés a Weboldal Adminba';
    }
  }
}

function logoutWebAdmin() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('hawkstone_last_activity');
  showToast('Sikeres kijelentkezés!');
  setTimeout(() => {
    window.location.href = 'webadmin.html';
  }, 500);
}

async function loadWebAdminContactForm() {
  try {
    const res = await fetch('/api/site-settings/contact');
    if (!res.ok) return;
    const c = await res.json();
    window.siteContactInfo = c;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('wc-company-name', c.company_name);
    setVal('wc-address', c.address);
    setVal('wc-phone-display', c.phone_display);
    setVal('wc-email-primary', c.email_primary);
    setVal('wc-email-secondary', c.email_secondary);
    setVal('wc-web-primary', c.web_primary);
    setVal('wc-web-secondary', c.web_secondary);

    updateWebAdminContactPreview();
  } catch (err) {
    console.warn('Hiba a kapcsolati űrlap betöltésekor:', err);
  }
}

function updateWebAdminContactPreview() {
  const company = document.getElementById('wc-company-name')?.value?.trim() || 'HOVI-TECH Kft.';
  const address = document.getElementById('wc-address')?.value?.trim() || '4531 Nyírpazony, Árpád u. 139.';
  const phone = document.getElementById('wc-phone-display')?.value?.trim() || '(+36) 30 574 6946';
  const email1 = document.getElementById('wc-email-primary')?.value?.trim() || 'orangeramp.info@gmail.com';
  const email2 = document.getElementById('wc-email-secondary')?.value?.trim() || '';
  const web1 = document.getElementById('wc-web-primary')?.value?.trim() || '';
  const web2 = document.getElementById('wc-web-secondary')?.value?.trim() || '';

  const pComp = document.getElementById('wc-preview-company');
  const pAddr = document.getElementById('wc-preview-address');
  const pPhone = document.getElementById('wc-preview-phone');
  const pEmail1 = document.getElementById('wc-preview-email1');
  const pEmail2 = document.getElementById('wc-preview-email2');
  const pWeb = document.getElementById('wc-preview-web');

  if (pComp) pComp.textContent = company;
  if (pAddr) pAddr.innerHTML = `${company}<br>${address}`;
  if (pPhone) pPhone.textContent = phone;
  if (pEmail1) pEmail1.textContent = email1;
  if (pEmail2) {
    pEmail2.textContent = email2;
    pEmail2.style.display = email2 ? 'block' : 'none';
  }
  if (pWeb) {
    pWeb.innerHTML = [web1, web2].filter(Boolean).join('<br>');
  }
}

async function handleSaveWebAdminContact(event) {
  event.preventDefault();
  const btn = document.getElementById('wc-save-btn');
  const payload = {
    company_name: document.getElementById('wc-company-name')?.value?.trim() || '',
    address: document.getElementById('wc-address')?.value?.trim() || '',
    phone_display: document.getElementById('wc-phone-display')?.value?.trim() || '',
    email_primary: document.getElementById('wc-email-primary')?.value?.trim() || '',
    email_secondary: document.getElementById('wc-email-secondary')?.value?.trim() || '',
    web_primary: document.getElementById('wc-web-primary')?.value?.trim() || '',
    web_secondary: document.getElementById('wc-web-secondary')?.value?.trim() || ''
  };

  if (!payload.company_name || !payload.address || !payload.phone_display || !payload.email_primary) {
    showToast('A cégnév, a cím, a telefonszám és az elsődleges e-mail cím megadása kötelező!', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Mentés...';
  }

  try {
    const res = await fetch('/api/admin/site-settings/contact', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a mentés során.');

    window.siteContactInfo = data.contact;
    try {
      sessionStorage.setItem('hawkstone_contact_info', JSON.stringify(data.contact));
    } catch (_) {}

    showToast('Kapcsolati adatok sikeresen frissítve a weboldalon!', 'success');
    await loadDynamicContactInfo();
  } catch (err) {
    showToast(err.message || 'Nem sikerült menteni a kapcsolati adatokat.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Kapcsolati adatok mentése';
    }
  }
}

window.switchWebAdminTab = switchWebAdminTab;
window.handleWebAdminLogin = handleWebAdminLogin;
window.logoutWebAdmin = logoutWebAdmin;
window.updateWebAdminContactPreview = updateWebAdminContactPreview;
window.handleSaveWebAdminContact = handleSaveWebAdminContact;

// ---------------- MÁSZÓFALAINK OLDAL KÁRTYÁK DINAMIKUS BETÖLTÉSE ÉS ADMIN KEZELÉSE ----------------
let currentWebAdminWallDataUrl = null;
let currentWebAdminWallFilter = 'all';

const WALL_CATEGORY_LABELS = {
  iskolai: 'Iskolai mászófalak',
  boulder: 'Boulder mászófalak',
  jatszoter: 'Játszóterekre, parkokba',
  egyeb: 'Egyéb mászófalak'
};

const WALL_CATEGORY_DEFAULT_TITLES = {
  iskolai: 'Iskolai Mászófal',
  boulder: 'Boulder Mászófal',
  jatszoter: 'Játszótéri Mászófal',
  egyeb: 'Egyedi Mászófal'
};

function buildSchoolCardHTML(item) {
  const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const imgSrc = item.src || `pictures/iskolai/${item.filename}`;
  const altText = `${esc(item.title)} ${esc(item.code)}`;
  const anchorsHtml = item.anchor_points && String(item.anchor_points).trim()
    ? `<li><span>Felsőbiztosítási pontok</span><strong>${esc(item.anchor_points)}</strong></li>`
    : '';

  const surfaceVal = String(item.surface || '').trim();
  const surfaceFormatted = (surfaceVal && !surfaceVal.includes('m²') && !surfaceVal.toLowerCase().includes('m2'))
    ? `${surfaceVal} m²`
    : surfaceVal;

  return `
    <article class="glass-card school-card">
      <div class="school-card-img"><img src="${imgSrc}" alt="${altText}" loading="lazy"></div>
      <div class="school-card-body">
        <span class="school-nr">${esc(item.code)}</span>
        <h3>${esc(item.title)}</h3>
        <ul>
          <li><span>Magasság</span><strong>${esc(item.height)}</strong></li>
          <li><span>Szélesség</span><strong>${esc(item.width)}</strong></li>
          <li><span>Felülete*</span><strong>${esc(surfaceFormatted)}</strong></li>
          ${anchorsHtml}
        </ul>
      </div>
    </article>
  `;
}

async function loadDynamicWallProducts() {
  const sections = ['iskolai', 'boulder', 'jatszoter', 'egyeb'];
  const grids = {};
  let hasAnyGrid = false;

  sections.forEach(cat => {
    const grid = document.querySelector(`#${cat} .school-grid`);
    if (grid) {
      grids[cat] = grid;
      hasAnyGrid = true;
    }
  });

  try {
    const res = await fetch('/api/wall-products');
    if (!res.ok) return;
    const items = await res.json();
    if (!Array.isArray(items)) return;

    window.ALL_WALL_PRODUCTS = items;
    if (!hasAnyGrid) return;

    sections.forEach(cat => {
      const grid = grids[cat];
      if (!grid) return;
      const catItems = items.filter(item => item.category === cat);
      if (catItems.length === 0) {
        grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1/-1; text-align: center; padding: 24px;">Jelenleg nincs megjeleníthető mászófal ebben a kategóriában.</p>`;
      } else {
        grid.innerHTML = catItems.map(item => buildSchoolCardHTML(item)).join('');
      }
    });
  } catch (err) {
    console.warn('Mászófalaink dinamikus betöltése sikertelen (statikus kártyák maradnak):', err);
  }
}

function slugifyReferenceFilename(str) {
  if (typeof toWebFriendlySlug === 'function') {
    return toWebFriendlySlug(str);
  }
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function resizeAndConvertImageFile(file, maxDim = 1600, quality = 0.88) {
  return new Promise((resolve, reject) => {
    if (!file) {
      return reject(new Error('Nincs fájl kiválasztva.'));
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ dataUrl, width, height });
      };
      img.onerror = () => reject(new Error('Nem sikerült beolvasni a képet.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Nem sikerült beolvasni a fájlt.'));
    reader.readAsDataURL(file);
  });
}

function updateWebAdminWallCategoryDefaults() {
  const cat = document.getElementById('ww-category')?.value || 'iskolai';
  const anchorsEl = document.getElementById('ww-anchors');
  if (anchorsEl && (cat === 'boulder' || cat === 'jatszoter')) {
    if (!anchorsEl.dataset.userTouched) {
      anchorsEl.value = '';
    }
  }
  updateWebAdminWallPreview();
}

function updateWebAdminWallPreview() {
  const code = document.getElementById('ww-code')?.value?.trim() || '';
  const title = document.getElementById('ww-title')?.value?.trim() || '';
  const height = document.getElementById('ww-height')?.value?.trim() || '';
  const width = document.getElementById('ww-width')?.value?.trim() || '';
  const surface = document.getElementById('ww-surface')?.value?.trim() || '';
  const anchors = document.getElementById('ww-anchors')?.value?.trim() || '';

  const pCode = document.getElementById('ww-preview-code');
  const pTitle = document.getElementById('ww-preview-title');
  const pHeight = document.getElementById('ww-preview-height');
  const pWidth = document.getElementById('ww-preview-width');
  const pSurface = document.getElementById('ww-preview-surface');
  const pAnchors = document.getElementById('ww-preview-anchors');

  const pHeightRow = document.getElementById('ww-preview-height-row');
  const pWidthRow = document.getElementById('ww-preview-width-row');
  const pSurfaceRow = document.getElementById('ww-preview-surface-row');
  const pAnchorsRow = document.getElementById('ww-preview-anchors-row');
  const pHint = document.getElementById('ww-preview-empty-hint');

  if (pCode) {
    pCode.textContent = code;
    pCode.style.display = code ? '' : 'none';
  }
  if (pTitle) {
    pTitle.textContent = title;
    pTitle.style.display = title ? '' : 'none';
  }
  if (pHeight && pHeightRow) {
    pHeight.textContent = height;
    pHeightRow.style.display = height ? '' : 'none';
  }
  if (pWidth && pWidthRow) {
    pWidth.textContent = width;
    pWidthRow.style.display = width ? '' : 'none';
  }

  let surfaceDisplay = surface;
  if (surfaceDisplay && !surfaceDisplay.includes('m²') && !surfaceDisplay.toLowerCase().includes('m2')) {
    surfaceDisplay = `${surfaceDisplay} m²`;
  }
  if (pSurface && pSurfaceRow) {
    pSurface.textContent = surfaceDisplay;
    pSurfaceRow.style.display = surface ? '' : 'none';
  }
  if (pAnchors && pAnchorsRow) {
    pAnchors.textContent = anchors;
    pAnchorsRow.style.display = anchors ? '' : 'none';
  }

  if (pHint) {
    const hasAnyContent = code || title || height || width || surface || anchors;
    pHint.style.display = hasAnyContent ? 'none' : 'block';
  }

  const slugEl = document.getElementById('ww-slug');
  if (slugEl && !slugEl.dataset.manual) {
    if (title || code) {
      const rawSlug = slugifyReferenceFilename(`${title}-${code}`);
      slugEl.value = rawSlug ? `${rawSlug}.jpg` : '';
    } else {
      slugEl.value = '';
    }
  }
}

async function handleWebAdminWallFileChange(inputOrEvent) {
  const fileInput = (inputOrEvent && inputOrEvent.files)
    ? inputOrEvent
    : (inputOrEvent && inputOrEvent.target && inputOrEvent.target.files ? inputOrEvent.target : document.getElementById('ww-file'));
  const file = fileInput && fileInput.files && fileInput.files[0];
  const optInfo = document.getElementById('ww-opt-info');
  const previewImg = document.getElementById('ww-preview-img');

  if (!file) {
    currentWebAdminWallDataUrl = null;
    if (optInfo) optInfo.style.display = 'none';
    return;
  }

  if (!file.type.startsWith('image/')) {
    showToast('Kérjük, képfájlt (JPG, PNG, WEBP) válassz ki!', 'error');
    fileInput.value = '';
    return;
  }

  try {
    if (optInfo) {
      optInfo.style.display = 'block';
      optInfo.style.color = 'var(--text-secondary)';
      optInfo.textContent = '⏳ Kép optimalizálása és átméretezése folyamatban...';
    }
    const result = await resizeAndConvertImageFile(file, 1600, 0.88);
    currentWebAdminWallDataUrl = result.dataUrl;
    if (previewImg) previewImg.src = result.dataUrl;

    const origKB = Math.round(file.size / 1024);
    const newKB = Math.round((result.dataUrl.length * 3) / 4 / 1024);
    if (optInfo) {
      optInfo.style.display = 'block';
      optInfo.style.color = '#22c55e';
      optInfo.innerHTML = `✓ Optimalizálva: <strong>${result.width}×${result.height} px</strong> JPEG (${origKB} KB → <strong>${newKB} KB</strong>)`;
    }
    updateWebAdminWallPreview();
  } catch (err) {
    console.error('Wall image conversion error:', err);
    showToast('Nem sikerült feldolgozni a kiválasztott képet.', 'error');
  }
}

async function handleWebAdminWallSubmit(event) {
  event.preventDefault();
  const idEl = document.getElementById('ww-id');
  const editId = idEl ? idEl.value.trim() : '';

  const category = document.getElementById('ww-category')?.value || 'iskolai';
  const code = document.getElementById('ww-code')?.value?.trim() || '';
  const title = document.getElementById('ww-title')?.value?.trim() || '';
  const height = document.getElementById('ww-height')?.value?.trim() || '';
  const width = document.getElementById('ww-width')?.value?.trim() || '';
  const surface = document.getElementById('ww-surface')?.value?.trim() || '';
  const anchor_points = document.getElementById('ww-anchors')?.value?.trim() || '';
  const slugEl = document.getElementById('ww-slug');
  const customSlug = slugEl ? slugEl.value.trim().replace(/\.jpe?g$/i, '') : '';
  const submitBtn = document.getElementById('ww-submit-btn');

  if (!code || !title || !height || !width || !surface) {
    showToast('A kód, megnevezés, magasság, szélesség és felület megadása kötelező!', 'error');
    return;
  }

  let cleanSurface = surface;
  if (cleanSurface && !cleanSurface.includes('m²') && !cleanSurface.toLowerCase().includes('m2')) {
    cleanSurface = `${cleanSurface} m²`;
  }

  if (!editId && !currentWebAdminWallDataUrl) {
    showToast('Kérjük, válassz ki egy képet a mászófal kártyához!', 'error');
    return;
  }

  const origText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = editId ? 'Mentés folyamatban...' : 'Hozzáadás folyamatban...';
  }

  try {
    const url = editId ? `/api/admin/wall-products/${editId}` : '/api/admin/wall-products';
    const method = editId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(),
      body: JSON.stringify({
        category,
        code,
        title,
        height,
        width,
        surface: cleanSurface,
        anchor_points,
        customSlug,
        filename: slugEl ? slugEl.value.trim() : '',
        imageData: currentWebAdminWallDataUrl || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a mászófal kártya mentésekor.');

    if (editId) {
      showToast(`Mászófal kártya (${code}) sikeresen módosítva!`, 'success');
    } else {
      showToast(`Mászófal kártya (${code}) sikeresen hozzáadva a Mászófalaink oldalhoz!`, 'success');
    }

    cancelWebAdminWallEdit();
    await loadWebAdminWalls();
  } catch (err) {
    showToast(err.message || 'Nem sikerült menteni a mászófal kártyát.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origText || (editId ? 'Módosítások mentése' : 'Mászófal kártya hozzáadása');
    }
  }
}

function editWebAdminWall(id) {
  const item = (window.webAdminWallsList || []).find(w => w.id === id);
  if (!item) {
    showToast('A kiválasztott kártya nem található.', 'error');
    return;
  }

  const idEl = document.getElementById('ww-id');
  const catEl = document.getElementById('ww-category');
  const codeEl = document.getElementById('ww-code');
  const titleEl = document.getElementById('ww-title');
  const heightEl = document.getElementById('ww-height');
  const widthEl = document.getElementById('ww-width');
  const surfaceEl = document.getElementById('ww-surface');
  const anchorsEl = document.getElementById('ww-anchors');
  const slugEl = document.getElementById('ww-slug');
  const fileEl = document.getElementById('ww-file');
  const submitBtn = document.getElementById('ww-submit-btn');
  const cancelBtn = document.getElementById('ww-cancel-btn');
  const optInfo = document.getElementById('ww-opt-info');
  const previewImg = document.getElementById('ww-preview-img');

  if (idEl) idEl.value = item.id;
  if (catEl) catEl.value = item.category || 'iskolai';
  if (codeEl) codeEl.value = item.code || '';
  if (titleEl) titleEl.value = item.title || '';
  if (heightEl) heightEl.value = item.height || '';
  if (widthEl) widthEl.value = item.width || '';
  if (surfaceEl) surfaceEl.value = item.surface || '';
  if (anchorsEl) anchorsEl.value = item.anchor_points || '';
  if (slugEl) {
    slugEl.value = item.filename || '';
    slugEl.dataset.manual = '1';
  }
  if (fileEl) fileEl.value = '';

  currentWebAdminWallDataUrl = null;

  if (previewImg) {
    previewImg.src = item.src || `pictures/iskolai/${item.filename}`;
  }

  if (optInfo) {
    optInfo.style.display = 'block';
    optInfo.style.color = 'var(--text-secondary)';
    optInfo.textContent = 'A kép cseréje opcionális. Ha nem választasz új képet, az eredeti kép marad érvényben.';
  }

  if (submitBtn) {
    submitBtn.textContent = 'Módosítások mentése';
  }
  if (cancelBtn) {
    cancelBtn.style.display = 'inline-block';
  }

  updateWebAdminWallPreview();

  const formCard = document.getElementById('webadmin-wall-form');
  if (formCard) {
    formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  showToast(`Szerkesztés: ${item.code} (${item.title}) betöltve.`, 'info');
}

function cancelWebAdminWallEdit() {
  const idEl = document.getElementById('ww-id');
  const form = document.getElementById('webadmin-wall-form');
  const slugEl = document.getElementById('ww-slug');
  const submitBtn = document.getElementById('ww-submit-btn');
  const cancelBtn = document.getElementById('ww-cancel-btn');
  const optInfo = document.getElementById('ww-opt-info');
  const previewImg = document.getElementById('ww-preview-img');

  if (idEl) idEl.value = '';
  if (form) form.reset();
  if (slugEl) delete slugEl.dataset.manual;
  currentWebAdminWallDataUrl = null;

  if (previewImg) {
    previewImg.src = 'pictures/maszominta.png';
  }

  if (optInfo) {
    optInfo.style.display = 'none';
    optInfo.innerHTML = '';
  }

  if (submitBtn) {
    submitBtn.textContent = 'Mászófal kártya hozzáadása';
  }
  if (cancelBtn) {
    cancelBtn.style.display = 'none';
  }

  updateWebAdminWallPreview();
}

async function loadWebAdminWalls() {
  const container = document.getElementById('webadmin-walls-list');
  if (!container) return;

  container.innerHTML = '<p style="color: var(--text-muted); text-align: center; grid-column: 1/-1; padding: 30px;">Mászófal kártyák betöltése...</p>';

  try {
    const res = await fetch('/api/wall-products');
    if (!res.ok) throw new Error();
    const items = await res.json();
    window.webAdminWallsList = Array.isArray(items) ? items : [];
    const countEl = document.getElementById('ww-total-count');
    if (countEl) countEl.textContent = window.webAdminWallsList.length;
    renderWebAdminWallsList();
  } catch (err) {
    console.error('Error loading wall products:', err);
    container.innerHTML = '<p style="color: var(--danger); text-align: center; grid-column: 1/-1; padding: 30px;">Nem sikerült betölteni a mászófal kártyákat.</p>';
  }
}

function filterWebAdminWalls(filter) {
  currentWebAdminWallFilter = filter || 'all';
  const buttons = {
    all: document.getElementById('ww-filter-all'),
    iskolai: document.getElementById('ww-filter-iskolai'),
    boulder: document.getElementById('ww-filter-boulder'),
    jatszoter: document.getElementById('ww-filter-jatszoter'),
    egyeb: document.getElementById('ww-filter-egyeb')
  };
  Object.entries(buttons).forEach(([key, btn]) => {
    if (!btn) return;
    if (key === currentWebAdminWallFilter) {
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
    }
  });
  renderWebAdminWallsList();
}

function renderWebAdminWallsList() {
  const container = document.getElementById('webadmin-walls-list');
  if (!container) return;

  const allItems = window.webAdminWallsList || [];
  const filtered = currentWebAdminWallFilter === 'all'
    ? allItems
    : allItems.filter(item => item.category === currentWebAdminWallFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 36px 20px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px;">
        <p style="margin: 0 0 6px 0; color: #fff; font-weight: 600;">Nincs mászófal kártya ebben a kategóriában.</p>
        <p style="margin: 0; font-size: 12px; color: var(--text-muted);">A fenti űrlappal bármikor hozzáadhatsz új mászófal kártyát.</p>
      </div>
    `;
    return;
  }

  const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  container.innerHTML = filtered.map(item => {
    const imgSrc = item.src || `pictures/iskolai/${item.filename}`;
    const catLabel = WALL_CATEGORY_LABELS[item.category] || item.category;
    const anchorsHtml = item.anchor_points && String(item.anchor_points).trim()
      ? `<li><span>Felsőbiztosítási pontok</span><strong>${esc(item.anchor_points)}</strong></li>`
      : '';

    const surfaceVal = String(item.surface || '').trim();
    const surfaceDisplay = (surfaceVal && !surfaceVal.includes('m²') && !surfaceVal.toLowerCase().includes('m2'))
      ? `${surfaceVal} m²`
      : surfaceVal;

    return `
      <article class="glass-card school-card" style="display: flex; flex-direction: column;">
        <div class="school-card-img" style="position: relative;">
          <img src="${imgSrc}" alt="${esc(item.title)} ${esc(item.code)}" loading="lazy">
          <span style="position: absolute; top: 10px; left: 10px; background: rgba(15, 19, 32, 0.85); border: 1px solid var(--primary); color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; backdrop-filter: blur(6px);">
            ${esc(catLabel)}
          </span>
        </div>
        <div class="school-card-body" style="display: flex; flex-direction: column; flex: 1;">
          <span class="school-nr">${esc(item.code)}</span>
          <h3>${esc(item.title)}</h3>
          <ul style="margin-bottom: 14px;">
            <li><span>Magasság</span><strong>${esc(item.height)}</strong></li>
            <li><span>Szélesség</span><strong>${esc(item.width)}</strong></li>
            <li><span>Felülete*</span><strong>${esc(surfaceDisplay)}</strong></li>
            ${anchorsHtml}
          </ul>
          <div style="margin-top: auto; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
            <a href="maszofalaink.html#${esc(item.category)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 10px; text-decoration: none;">Megtekintés</a>
            <div style="display: flex; gap: 6px;">
              <button type="button" onclick="editWebAdminWall(${item.id})" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 12px; border-color: rgba(242,118,32,0.6); color: var(--primary);">Szerkesztés</button>
              <button type="button" onclick="deleteWebAdminWall(${item.id})" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 12px; border-color: rgba(239,68,68,0.45); color: #f87171;">Törlés</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function deleteWebAdminWall(id) {
  const confirmed = await showConfirmModal({
    title: 'Mászófal kártya törlése',
    message: 'Biztosan törölni szeretnéd ezt a mászófal kártyát a Mászófalaink oldalról?',
    confirmText: 'Kártya törlése',
    cancelText: 'Mégse',
    variant: 'danger'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/wall-products/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a törlés során.');
    showToast('Mászófal kártya sikeresen törölve!', 'success');
    await loadWebAdminWalls();
  } catch (err) {
    showToast(err.message || 'Nem sikerült törölni a mászófal kártyát.', 'error');
    showAlertModal(err.message || 'Nem sikerült törölni a mászófal kártyát.', 'Törlési hiba');
  }
}

// ---------------- WEBOLDAL ADMIN ÜZENŐFAL (target = 'web') ----------------
function formatWebAdminEditorText(tag) {
  const textarea = document.getElementById('webadmin-news-content-text');
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selectedText = text.substring(start, end);

  const formatted = `<${tag}>${selectedText}</${tag}>`;
  textarea.value = text.substring(0, start) + formatted + text.substring(end);

  textarea.focus();
  textarea.selectionStart = start;
  textarea.selectionEnd = start + formatted.length;
  updateWebAdminNewsPreview();
}

function updateWebAdminNewsPreview() {
  const titleVal = document.getElementById('webadmin-news-title')?.value?.trim() || 'Közlemény Címe';
  const contentVal = document.getElementById('webadmin-news-content-text')?.value?.trim() || 'Írd be bal oldalon a közlemény címét és szövegét az élő előnézethez!';
  const pTitle = document.getElementById('webadmin-news-preview-title');
  const pContent = document.getElementById('webadmin-news-preview-content');
  if (pTitle) pTitle.textContent = titleVal;
  if (pContent) pContent.innerHTML = contentVal;
}
window.updateWebAdminNewsPreview = updateWebAdminNewsPreview;

async function loadWebAdminNews() {
  const container = document.getElementById('webadmin-news-list');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--text-muted); text-align:center; width:100%;">Közlemények betöltése...</p>';

  try {
    const res = await fetch('/api/announcements?target=web', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    const list = await res.json();

    container.innerHTML = '';
    if (!Array.isArray(list) || list.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); padding:15px; text-align:center; width:100%;">Nincs még közzétett közlemény a weboldalon.</p>';
      return;
    }

    window.webAdminAnnouncements = list;

    const grid = document.createElement('div');
    grid.className = 'news-cards-grid';

    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'news-card';
      card.style.cursor = 'default';

      const activeBadge = item.is_active ? '<span class="badge badge-green">Aktív</span>' : '<span class="badge badge-red">Inaktív</span>';

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = item.content;
      const cleanContent = tempDiv.textContent || tempDiv.innerText || '';
      const preview = cleanContent.length > 140 ? cleanContent.substring(0, 140) + '...' : cleanContent;

      card.innerHTML = `
        <div style="flex-grow: 1; text-align: center;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap: 10px;">
            <div style="font-weight:700; color:#fff; font-size:16px; flex:1; text-align:center;">${item.title}</div>
            ${activeBadge}
          </div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px; text-align:center;">
            ${item.created_at ? item.created_at.substring(0, 16).replace('T', ' ') : '-'}
          </div>
          <div style="font-size:13px; color:var(--text-secondary); margin-top:8px; line-height:1.5; text-align:center;">
            ${preview}
          </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:15px; border-top: 1px solid rgba(255,255,255,0.05); padding-top:12px;">
          <button type="button" onclick="editWebAdminNews(${item.id})" class="btn btn-secondary btn-sm" style="flex:1; padding:6px;">Szerkesztés</button>
          <button type="button" onclick="deleteWebAdminNews(${item.id})" class="btn btn-danger btn-sm" style="flex:1; padding:6px; background:#ef4444; border-color:#ef4444;">Törlés</button>
        </div>
      `;
      grid.appendChild(card);
    });

    container.appendChild(grid);
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger); text-align:center; width:100%;">Nem sikerült betölteni a weboldal üzenőfalát.</p>';
  }
}

async function saveWebAdminNews(e) {
  if (e) e.preventDefault();

  const id = document.getElementById('webadmin-news-id')?.value || '';
  const title = document.getElementById('webadmin-news-title')?.value?.trim() || '';
  const content = document.getElementById('webadmin-news-content-text')?.value?.trim() || '';
  const imageUrl = document.getElementById('webadmin-news-image')?.value || '';
  const isActive = Boolean(document.getElementById('webadmin-news-active')?.checked);

  if (!title || !content) {
    showToast('Kérjük, töltsd ki a címet és a közlemény szövegét!', 'error');
    return;
  }

  const payload = { title, content, imageUrl, isActive, target: 'web' };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/announcements/${id}` : '/api/announcements';

  try {
    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a mentés során.');

    showToast(id ? 'Weboldal közlemény sikeresen frissítve!' : 'Új weboldal közlemény sikeresen közzétéve!', 'success');
    cancelWebAdminNewsEdit();
    await loadWebAdminNews();
  } catch (err) {
    showToast(err.message || 'Nem sikerült menteni a közleményt.', 'error');
    showAlertModal(err.message || 'Nem sikerült menteni a közleményt.', 'Mentési hiba');
  }
}

function editWebAdminNews(id) {
  if (!window.webAdminAnnouncements) return;
  const item = window.webAdminAnnouncements.find(ann => ann.id === id);
  if (!item) return;

  document.getElementById('webadmin-news-id').value = item.id;
  document.getElementById('webadmin-news-title').value = item.title;
  document.getElementById('webadmin-news-content-text').value = item.content;
  document.getElementById('webadmin-news-image').value = item.image_url || '';
  document.getElementById('webadmin-news-active').checked = !!item.is_active;

  document.getElementById('webadmin-news-form-title').textContent = 'Weboldal Közlemény Szerkesztése';
  document.getElementById('webadmin-news-submit-btn').textContent = 'Módosítás Mentése';
  document.getElementById('webadmin-news-cancel-btn').style.display = 'block';
  updateWebAdminNewsPreview();

  document.getElementById('webadmin-news-form').scrollIntoView({ behavior: 'smooth' });
}

async function deleteWebAdminNews(id) {
  const confirmed = await showConfirmModal({
    title: 'Közlemény törlése',
    message: 'Biztosan törlöd ezt a közleményt a weboldal üzenőfaláról?',
    confirmText: 'Törlés',
    cancelText: 'Mégse',
    variant: 'danger'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/announcements/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a törlés során.');

    showToast('Közlemény sikeresen törölve!');
    await loadWebAdminNews();
  } catch (err) {
    showToast(err.message || 'Nem sikerült törölni a közleményt.', 'error');
    showAlertModal(err.message || 'Nem sikerült törölni a közleményt.', 'Törlési hiba');
  }
}

function cancelWebAdminNewsEdit() {
  const idEl = document.getElementById('webadmin-news-id');
  const formEl = document.getElementById('webadmin-news-form');
  const titleEl = document.getElementById('webadmin-news-form-title');
  const submitEl = document.getElementById('webadmin-news-submit-btn');
  const cancelEl = document.getElementById('webadmin-news-cancel-btn');

  if (idEl) idEl.value = '';
  if (formEl) formEl.reset();
  if (titleEl) titleEl.textContent = 'Új közlemény közzététele a weboldalon';
  if (submitEl) submitEl.textContent = 'Közzététel';
  if (cancelEl) cancelEl.style.display = 'none';
  updateWebAdminNewsPreview();
}

window.loadDynamicWallProducts = loadDynamicWallProducts;
window.updateWebAdminWallCategoryDefaults = updateWebAdminWallCategoryDefaults;
window.updateWebAdminWallPreview = updateWebAdminWallPreview;
window.handleWebAdminWallFileChange = handleWebAdminWallFileChange;
window.handleWebAdminWallSubmit = handleWebAdminWallSubmit;
window.editWebAdminWall = editWebAdminWall;
window.cancelWebAdminWallEdit = cancelWebAdminWallEdit;
window.loadWebAdminWalls = loadWebAdminWalls;
window.filterWebAdminWalls = filterWebAdminWalls;
window.deleteWebAdminWall = deleteWebAdminWall;
window.formatWebAdminEditorText = formatWebAdminEditorText;
window.loadWebAdminNews = loadWebAdminNews;
window.saveWebAdminNews = saveWebAdminNews;
window.editWebAdminNews = editWebAdminNews;
window.deleteWebAdminNews = deleteWebAdminNews;
window.cancelWebAdminNewsEdit = cancelWebAdminNewsEdit;
window.testInactivityWarning = () => showInactivityWarningModal(60);
window.playInactivityWarningSound = playInactivityWarningSound;

// ---------------- MÁSZÓFAL TÍPUSAINK (FŐOLDAL) DINAMIKUS BETÖLTÉSE ÉS ADMIN KEZELÉSE ----------------
const DEFAULT_CLIENT_HOME_WALL_TYPES = [
  {
    id: 1,
    nr: '01',
    badge: 'Beltéri & Kültéri',
    title: 'Mászófalak',
    desc: 'A mászófal felülete 21 mm vastag rétegelt lemez, amely kellő felületi keménységet és tartósságot ad a mászófalnak. Felületüket magas kopásállóságú festékkel festjük. Gazdag színvilág. A háromszög alakokkal tudjuk a legjobban imitálni az áthajlásokat és töréseket.',
    note_title: '',
    note: ''
  },
  {
    id: 2,
    nr: '02',
    badge: '2.5 – 3 méter',
    title: 'Boulder mászófalak',
    desc: 'A fal magassága 2.5–3 méter. A mászó biztosítás nélkül használja a falat. Esés esetén a fal alatt elhelyezett vastag szőnyeg, kültéren esésfelfogó homok védi a mászót. A mászás le-föl és oldalirányban történhet. Használata nem igényel szakmai felügyeletet.',
    note_title: '',
    note: ''
  },
  {
    id: 3,
    nr: '03',
    badge: 'EN 1176 szabvány',
    title: 'Játszótéri mászófalak (Tulip-play.com)',
    desc: 'Időjárásálló, UV-álló alapanyagok felhasználásával készülnek. A mászófalak élei, sarkai lekerekítettek. Építésnél, tervezésnél az EN 1176 játszótéri szabványt vesszük figyelembe. Áraink az esésfelfogó zónák költségeit és kialakításait nem tartalmazzák.',
    note_title: '',
    note: ''
  },
  {
    id: 4,
    nr: '04',
    badge: 'Kompozit textúra',
    title: 'Sziklahű felületű mászófal',
    desc: 'A mászófal felületével teljesen imitálni tudjuk a természetes szikla alakjait, formáit, a fal töréseit és repedéseit. Látványos, mászása nagy élményt nyújt. Műgyanta, üvegszövet és finom kvarchomok egységéből álló prémium felület.',
    note_title: '',
    note: ''
  },
  {
    id: 5,
    nr: '05',
    badge: 'Fa + Sziklahű',
    title: 'Kombinált felületű mászófal',
    desc: 'A mászófal felülete átmenetet képez a sziklahű és a rétegelt lemezes sík fal felülete között. A fafelületre kész formákat dolgozunk fel, felületét a sziklahű mászófal felületéhez hasonlóan kezeljük.',
    note_title: '',
    note: ''
  },
  {
    id: 6,
    nr: '06',
    badge: 'Bérelhető & Brandingelhető',
    title: 'Egyedi mobil mászófalak',
    desc: 'A falmászás és a legújabb technikák ötvözete! Legyen Ön a következő, aki a rendezvényére bérli vagy brandingeli a forgó mászófalunkat. Kiváló reklámfelület! Felülete: 6 m x 2.4 m.',
    note_title: 'Működési elve:',
    note: 'A fal végtelenített alumínium redőnye egy motor segítségével körbeforog. A mászó biztosítás nélkül mászhat a falon. Az esés esetén a fal alatt elhelyezett védőszőnyegek nyújtanak biztonságot. A fal alján és tetején elhelyezett fotocellás érzékelők jeleire a számítógép gyorsítja és lassítja a forgó redőnyt. Ha a mászó karjával beér a felső fotocellába, a redőny forgása gyorsul; ha a mászó lába az alsó fotocella útjába kerül, a forgás lassul.'
  }
];

window.loadedHomeWallTypes = null;

async function loadDynamicHomeWallTypes() {
  const container = document.getElementById('home-walls-grid');
  if (!container) return;

  try {
    const res = await fetch('/api/site-settings/wall-types');
    if (!res.ok) return;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) return;

    window.loadedHomeWallTypes = items;

    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Dinamikus intelligens elrendezés:
    // 1-3. kártya: felső sor (span 2-2-2)
    // 4-5. kártya: középső sor (span 3-3), szépen KÖZÉPRE igazítva
    // 6+ vagy kiemelt kártyák: teljes szélességű kártyaként (span 6), egymás alatt
    const count = items.length;

    container.innerHTML = items.map((item, idx) => {
      const cardNr = item.nr || (idx + 1 < 10 ? `0${idx + 1}` : `${idx + 1}`);
      const isFeatured = Boolean(item.note_title || item.note) || (idx >= 5);

      let cardClass = 'wt-card wt-card-third';
      if (isFeatured) {
        cardClass = 'wt-card wt-card-featured';
      } else if (idx === 3 || idx === 4) {
        cardClass = 'wt-card wt-card-half';
      }

      const formattedTitle = item.title && item.title.includes('Tulip-play.com')
        ? esc(item.title).replace('(Tulip-play.com)', '<small>(Tulip-play.com)</small>')
        : esc(item.title);

      const formattedDesc = item.desc && item.desc.includes('6 m x 2.4 m')
        ? esc(item.desc).replace('6 m x 2.4 m', '<strong>6 m x 2.4 m</strong>')
        : esc(item.desc);

      const badgeHtml = item.badge
        ? `<span class="badge ${isFeatured ? 'badge-primary' : 'badge-secondary'}">${esc(item.badge)}</span>`
        : '';

      if (isFeatured) {
        return `
          <article class="glass-card wt-card wt-card-featured" data-wall-type-id="${item.id || (idx + 1)}">
            <div class="wall-featured-main">
              <div class="wt-card-icon">${esc(cardNr)}</div>
              ${badgeHtml}
              <h3>${formattedTitle}</h3>
              <p>${formattedDesc}</p>
            </div>
            ${(item.note_title || item.note) ? `
              <div class="wall-featured-note">
                ${item.note_title ? `<strong>${esc(item.note_title)}</strong>` : ''}
                ${item.note ? `<p>${esc(item.note)}</p>` : ''}
              </div>
            ` : ''}
          </article>
        `;
      }

      return `
        <article class="glass-card ${cardClass}" data-wall-type-id="${item.id || (idx + 1)}">
          <div class="wt-card-icon">${esc(cardNr)}</div>
          ${badgeHtml}
          <h3>${formattedTitle}</h3>
          <p>${formattedDesc}</p>
        </article>
      `;
    }).join('');

    // Re-init scroll animációk az újonnan renderelt kártyákra
    if (typeof initScrollAnimations === 'function') {
      initScrollAnimations();
    }
  } catch (err) {
    console.warn('Hiba a Mászófal Típusaink kártyák dinamikus betöltésekor:', err);
  }
}

async function loadWebAdminHomeWallTypes() {
  const container = document.getElementById('webadmin-home-types-cards-container');
  if (!container) return;

  try {
    const res = await fetch('/api/site-settings/wall-types');
    let items = DEFAULT_CLIENT_HOME_WALL_TYPES;
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) items = data;
    }

    window.loadedHomeWallTypes = items;
    renderWebAdminHomeWallTypesCards(items);
  } catch (err) {
    console.warn('Nem sikerült betölteni a típus kártyákat:', err);
    renderWebAdminHomeWallTypesCards(DEFAULT_CLIENT_HOME_WALL_TYPES);
  }
}

function renderWebAdminHomeWallTypesCards(items) {
  const container = document.getElementById('webadmin-home-types-cards-container');
  if (!container) return;

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const count = items.length;

  container.innerHTML = items.map((item, idx) => {
    const isFeatured = Boolean(item.note_title || item.note) || (count === 6 && idx === 5);
    const cardNr = item.nr || (idx + 1 < 10 ? `0${idx + 1}` : `${idx + 1}`);

    return `
      <div class="glass-card" data-wht-index="${idx}" style="padding: 24px; border: 1px solid var(--border-color); border-radius: 14px; background: rgba(255, 255, 255, 0.02); position: relative;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 18px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 8px; background: rgba(242, 118, 32, 0.15); color: var(--primary); font-weight: 800; font-size: 14px;">${esc(cardNr)}</span>
            <h5 style="margin: 0; font-size: 16px; color: #ffffff;">${idx + 1}. Kártya – <span style="color: var(--primary);">${esc(item.title || 'Új Mászófal Típus')}</span></h5>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="badge ${isFeatured ? 'badge-primary' : 'badge-secondary'}" style="font-size: 11px;">
              ${isFeatured ? 'Kiemelt kártya (Működési elv blokkal)' : 'Normál kártya'}
            </span>
            ${count > 1 ? `
              <button type="button" onclick="deleteWebAdminHomeWallType(${idx})" class="btn btn-danger btn-sm" style="padding: 4px 12px; font-size: 11px; font-weight: 600;" title="Kártya törlése">
                Törlés
              </button>
            ` : ''}
          </div>
        </div>

        <input type="hidden" class="wht-item-id" value="${item.id || (idx + 1)}">

        <div style="display: grid; grid-template-columns: 80px 1fr 1fr; gap: 14px; margin-bottom: 14px;">
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 12px;">Szám</label>
            <input type="text" class="form-control wht-item-nr" value="${esc(cardNr)}" required style="text-align: center; font-weight: 700;">
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 12px;">Kártya Címe</label>
            <input type="text" class="form-control wht-item-title" value="${esc(item.title || '')}" placeholder="pl. Boulder mászófalak" required>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label" style="font-size: 12px;">Jelvény / Badge (pl. EN szabvány, méret)</label>
            <input type="text" class="form-control wht-item-badge" value="${esc(item.badge || '')}" placeholder="pl. 2.5 – 3 méter">
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 14px;">
          <label class="form-label" style="font-size: 12px;">Kártya Főszövege / Leírása</label>
          <textarea class="form-control wht-item-desc" rows="3" style="resize: vertical; font-size: 13px; line-height: 1.6;" placeholder="A mászófal leírása, anyaga, előnyei..." required>${esc(item.desc || '')}</textarea>
        </div>

        <div style="background: rgba(242, 118, 32, 0.04); border: 1px solid rgba(242, 118, 32, 0.16); border-radius: 10px; padding: 14px; margin-top: 10px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-size: 12px; font-weight: 700; color: var(--primary);">Kiemelt kiegészítő blokk (opcionális – pl. Működési elv):</span>
            <small style="font-size: 11px; color: var(--text-muted);">Ha kitöltöd, a kártya kiemelt, teljes szélességű elrendezést kap</small>
          </div>
          <div style="display: grid; grid-template-columns: 200px 1fr; gap: 14px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" style="font-size: 11px;">Kiemelt blokk címe</label>
              <input type="text" class="form-control wht-item-note-title" value="${esc(item.note_title || '')}" placeholder="pl. Működési elve:">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" style="font-size: 11px;">Kiemelt blokk részletező szövege</label>
              <textarea class="form-control wht-item-note" rows="2" style="resize: vertical; font-size: 12px; line-height: 1.5;" placeholder="pl. A fal végtelenített redőnye egy motor segítségével körbeforog...">${esc(item.note || '')}</textarea>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function collectWebAdminHomeWallTypesFromForm() {
  const container = document.getElementById('webadmin-home-types-cards-container');
  if (!container) return [];

  const cardEls = container.querySelectorAll('.glass-card');
  const items = [];

  cardEls.forEach((card, idx) => {
    const id = Number(card.querySelector('.wht-item-id')?.value) || (idx + 1);
    const nr = card.querySelector('.wht-item-nr')?.value?.trim() || (idx + 1 < 10 ? `0${idx + 1}` : `${idx + 1}`);
    const title = card.querySelector('.wht-item-title')?.value?.trim() || '';
    const badge = card.querySelector('.wht-item-badge')?.value?.trim() || '';
    const desc = card.querySelector('.wht-item-desc')?.value?.trim() || '';
    const note_title = card.querySelector('.wht-item-note-title')?.value?.trim() || '';
    const note = card.querySelector('.wht-item-note')?.value?.trim() || '';

    items.push({ id, nr, title, badge, desc, note_title, note });
  });

  return items;
}

function addNewWebAdminHomeWallType() {
  const currentItems = collectWebAdminHomeWallTypesFromForm();
  const nextNrNum = currentItems.length + 1;
  const nextNr = nextNrNum < 10 ? `0${nextNrNum}` : `${nextNrNum}`;

  currentItems.push({
    id: Date.now(),
    nr: nextNr,
    badge: 'Új Típus',
    title: 'Új mászófal típus',
    desc: 'Add meg a kártya részletes leírását, felületét és jellemzőit.',
    note_title: '',
    note: ''
  });

  window.loadedHomeWallTypes = currentItems;
  renderWebAdminHomeWallTypesCards(currentItems);
  showToast('Új kártya hozzáadva az űrlaphoz a lista végén! Töltsd ki az adatokat és mentsd el.', 'info');

  // Legörgetés az új kártyához
  setTimeout(() => {
    const cards = document.querySelectorAll('#webadmin-home-types-cards-container .glass-card');
    if (cards.length > 0) {
      cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

async function deleteWebAdminHomeWallType(index) {
  const currentItems = collectWebAdminHomeWallTypesFromForm();
  if (index < 0 || index >= currentItems.length) return;
  const targetItem = currentItems[index];

  const confirmed = await showConfirmModal({
    title: 'Kártya törlése',
    message: `Biztosan törölni szeretnéd a(z) "${targetItem.title || (index + 1) + '. kártya'}" elemet?`,
    confirmText: 'Törlés',
    cancelText: 'Mégse',
    variant: 'danger'
  });

  if (!confirmed) return;

  currentItems.splice(index, 1);
  currentItems.forEach((it, i) => {
    if (/^\d{2}$/.test(it.nr)) {
      it.nr = (i + 1 < 10 ? `0${i + 1}` : `${i + 1}`);
    }
  });

  window.loadedHomeWallTypes = currentItems;
  renderWebAdminHomeWallTypesCards(currentItems);

  // Azonnal elmentjük a törlést a szerverre is, hogy ne kelljen külön a Mentés gombra kattintani
  await saveWebAdminHomeWallTypes();
  showToast('Kártya sikeresen törölve a weboldalról!', 'success');
}

async function handleWebAdminHomeWallTypesSubmit(event) {
  if (event) event.preventDefault();
  await saveWebAdminHomeWallTypes();
}

async function saveWebAdminHomeWallTypes() {
  const container = document.getElementById('webadmin-home-types-cards-container');
  const btn = document.getElementById('webadmin-home-types-save-btn');
  const btnTop = document.getElementById('webadmin-home-types-save-top-btn');
  if (!container) return;

  const items = collectWebAdminHomeWallTypesFromForm();

  if (items.length === 0) {
    showToast('Legalább 1 kártyának lennie kell a listában!', 'error');
    return;
  }

  if (items.some(it => !it.title || !it.desc)) {
    showToast('A cím és a leírás mező kitöltése minden kártyánál kötelező!', 'error');
    return;
  }

  const setBtnState = (loading) => {
    if (btn) {
      btn.disabled = loading;
      btn.textContent = loading ? 'Mentés folyamatban...' : 'Összes kártya mentése';
    }
    if (btnTop) {
      btnTop.disabled = loading;
      btnTop.textContent = loading ? 'Mentés...' : 'Módosítások mentése';
    }
  };

  setBtnState(true);

  try {
    const res = await fetch('/api/admin/site-settings/wall-types', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ items })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hiba a mentés során.');

    window.loadedHomeWallTypes = data.items;
    showToast('A Mászófal Típusaink kártyák sikeresen elmentve!', 'success');
    renderWebAdminHomeWallTypesCards(data.items);
  } catch (err) {
    showToast(err.message || 'Nem sikerült menteni a kártyák adatait.', 'error');
    showAlertModal(err.message || 'Nem sikerült menteni a kártyák adatait.', 'Mentési hiba');
  } finally {
    setBtnState(false);
  }
}

async function resetWebAdminHomeWallTypes() {
  const confirmed = await showConfirmModal({
    title: 'Visszaállítás megerősítése',
    message: 'Biztosan visszaállítod a Mászófal Típusaink kártyák eredeti, gyári szövegeit?',
    confirmText: 'Visszaállítás',
    cancelText: 'Mégse',
    variant: 'warning'
  });

  if (!confirmed) return;

  renderWebAdminHomeWallTypesCards(DEFAULT_CLIENT_HOME_WALL_TYPES);
  showToast('Alapértelmezett szövegek betöltve az űrlapba. Ne felejts el a mentésre kattintani!', 'info');
}

window.loadDynamicHomeWallTypes = loadDynamicHomeWallTypes;
window.loadWebAdminHomeWallTypes = loadWebAdminHomeWallTypes;
window.saveWebAdminHomeWallTypes = saveWebAdminHomeWallTypes;
window.resetWebAdminHomeWallTypes = resetWebAdminHomeWallTypes;
window.handleWebAdminHomeWallTypesSubmit = handleWebAdminHomeWallTypesSubmit;
window.addNewWebAdminHomeWallType = addNewWebAdminHomeWallType;
window.deleteWebAdminHomeWallType = deleteWebAdminHomeWallType;

// Statistics & Withdrawals Exports & Filters
window.loadAdminStats = loadAdminStats;
window.changeStatsRange = changeStatsRange;
window.renderAdminStats = renderAdminStats;
window.exportAdminStatsToPDF = exportAdminStatsToPDF;
window.exportWithdrawalsToExcel = exportWithdrawalsToExcel;
window.exportWithdrawalsToPDF = exportWithdrawalsToPDF;
window.applyWithdrawalsFilters = applyWithdrawalsFilters;
window.debounceWithdrawalsSearch = debounceWithdrawalsSearch;
window.switchWithdrawalFilter = switchWithdrawalFilter;
