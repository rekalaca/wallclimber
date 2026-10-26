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

// Logout function
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showToast('Sikeres kijelentkezés!');
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 800);
}

// ---------------- DYNAMIC HEADER/NAV ----------------
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

  const isConfiguredAdmin = token && (user.role === 'ADMIN' || user.role === 'STAFF');
  const path = window.location.pathname;
  const hostname = (window.location.hostname || '').toLowerCase();
  const isClubHost = hostname.startsWith('klub.') || hostname.startsWith('maszoklub.') || hostname.startsWith('foglalas.');
  const isClubPage = isClubHost || path.endsWith('klub.html') || path.endsWith('maszoklub.html') || path.endsWith('foglalas.html') || path.endsWith('szabalyzat.html');
  const isContactPage = path.endsWith('kapcsolat.html') || path.endsWith('iso9001.html') || path.endsWith('maszofalaink.html') || path.endsWith('404.html') || path.includes('404');
  const isCompanyIndex = !isClubHost && (path.endsWith('index.html') || path === '/' || path.endsWith('webpage/') || path.endsWith('/'));
  const isAdminPage = path.endsWith('admin.html') || path.endsWith('scanner.html');

  // Set admin classes for fix header layout
  if (isAdminPage && isConfiguredAdmin) {
    headerEl.className = 'admin-header';
    document.body.classList.add('admin-body');
  } else {
    headerEl.className = isClubPage ? 'club-header' : ((isAdminPage) ? '' : 'no-auth-mobile');
    if (isClubPage) document.body.classList.add('club-page');
    document.body.classList.remove('admin-body');
  }

  let navItems = '';

  const contactMobileSnippet = `
    <li class="menu-contact-mobile">
      <div class="menu-contact-box">
        <span class="menu-contact-title">Elérhetőség</span>
        <a href="tel:+36305746946" class="menu-contact-item" title="Telefonszám hívása">
          <div class="menu-contact-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
            </svg>
          </div>
          <div class="menu-contact-details">
            <span class="menu-contact-label">Telefon</span>
            <span class="menu-contact-val">(+36) 30 574 6946</span>
          </div>
        </a>
        <a href="mailto:orangeramp.info@gmail.com" class="menu-contact-item" title="E-mail küldése">
          <div class="menu-contact-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="20" height="16" x="2" y="4" rx="2"></rect>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
            </svg>
          </div>
          <div class="menu-contact-details">
            <span class="menu-contact-label">E-mail</span>
            <span class="menu-contact-val">orangeramp.info@gmail.com</span>
          </div>
        </a>
      </div>
    </li>
  `;

  if (isConfiguredAdmin) {
    // Admin / Staff Specific Menu (Order requested by USER)
    const activeClass = (page, hash = '') => {
      const isPage = path.endsWith(page);
      let isHash = false;
      if (hash === '#dashboard') {
        isHash = (window.location.hash === '#dashboard' || !window.location.hash);
      } else {
        isHash = hash ? window.location.hash === hash : !window.location.hash;
      }
      return isPage && isHash ? 'active' : '';
    };

    navItems = `
      <li><a href="admin.html#dashboard" class="nav-link ${activeClass('admin.html', '#dashboard')}">Kezdőlap</a></li>
      <li><a href="scanner.html" class="nav-link ${activeClass('scanner.html')}">Beléptetés / Scanner</a></li>
      <li><a href="admin.html#schedule" class="nav-link ${activeClass('admin.html', '#schedule')}">Órarend kezelése</a></li>
      <li><a href="admin.html#users" class="nav-link ${activeClass('admin.html', '#users')}">Felhasználók kezelése</a></li>
      <li><a href="admin.html#bookings" class="nav-link ${activeClass('admin.html', '#bookings')}">Foglalások</a></li>
      <li><a href="admin.html#news" class="nav-link ${activeClass('admin.html', '#news')}">Üzenőfal</a></li>
      <li><a href="admin.html#withdrawals" class="nav-link ${activeClass('admin.html', '#withdrawals')}">Elállások</a></li>
      <li><a href="index.html" class="nav-link">Weboldal ↗</a></li>
    `;
  } else {
    const profileItem = token ? `<li><a href="dashboard.html" class="nav-link ${isActive('dashboard.html')}">Profilom</a></li>` : '';

    if (isClubPage) {
      // Climbing Club (Nyíregyháza) Menu
      const isSub = path.endsWith('szabalyzat.html');
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
      // Kapcsolat oldal: a főoldal szekcióira mutató menü
      navItems = `
        <li><a href="index.html#about" class="nav-link">Bemutatkozunk</a></li>
        <li><a href="index.html#walls" class="nav-link">Mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html" class="nav-link nav-sublink">Iskolai mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#boulder" class="nav-link nav-sublink">Boulder mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#jatszoter" class="nav-link nav-sublink">Játszótéri mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#egyeb" class="nav-link nav-sublink">Egyéb mászófalak</a></li>
        <li><a href="index.html#gallery" class="nav-link">Galéria</a></li>
        <li><a href="iso9001.html" class="nav-link ${isActive('iso9001.html')}">ISO 9001</a></li>
        <li><a href="kapcsolat.html" class="nav-link ${isActive('kapcsolat.html')}">Kapcsolat</a></li>
        ${profileItem}
        <li><a href="klub.html" class="nav-link nav-pulse-btn"><span>Próbáld ki!</span><img src="pictures/logos/header_logo.png" alt="HawkStone Logo" class="nav-pulse-logo" /></a></li>
        ${contactMobileSnippet}
      `;
    } else if (isCompanyIndex) {
      // Company Main Page (HawkStone Mászófalak Tervezés & Gyártás) Menu
      navItems = `
        <li><a href="#about" class="nav-link">Bemutatkozunk</a></li>
        <li><a href="#walls" class="nav-link">Mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html" class="nav-link nav-sublink">Iskolai mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#boulder" class="nav-link nav-sublink">Boulder mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#jatszoter" class="nav-link nav-sublink">Játszótéri mászófalak</a></li>
        <li class="nav-sub-item"><a href="maszofalaink.html#egyeb" class="nav-link nav-sublink">Egyéb mászófalak</a></li>
        <li><a href="#gallery" class="nav-link">Galéria</a></li>
        <li><a href="iso9001.html" class="nav-link">ISO 9001</a></li>
        <li><a href="kapcsolat.html" class="nav-link">Kapcsolat</a></li>
        ${profileItem}
        <li><a href="klub.html" class="nav-link nav-pulse-btn"><span>Próbáld ki!</span><img src="pictures/logos/header_logo.png" alt="HawkStone Logo" class="nav-pulse-logo" /></a></li>
        ${contactMobileSnippet}
      `;
    } else {
      // Generic Subpages (Szabályzat, ÁSZF, etc.)
      navItems = `
        <li><a href="index.html" class="nav-link">Főoldal</a></li>
        <li><a href="klub.html" class="nav-link">Városi Mászóklub</a></li>
        <li><a href="klub.html#prices" class="nav-link">Árak</a></li>
        <li><a href="szabalyzat.html" class="nav-link ${isActive('szabalyzat.html')}">Szabályzatunk</a></li>
        <li><a href="klub.html#contact" class="nav-link">Kapcsolat</a></li>
        ${profileItem}
        <li><a href="klub.html" class="nav-link nav-pulse-btn"><span>Próbáld ki!</span><img src="pictures/logos/header_logo.png" alt="HawkStone Logo" class="nav-pulse-logo" /></a></li>
        ${contactMobileSnippet}
      `;
    }
  }

  let authSection = '';
  let authSectionMobile = '';
  const userName = user.name || 'Fiókom';

  if (token) {
    if (isConfiguredAdmin) {
      authSection = `
        <div class="nav-auth" style="display: flex; align-items: center; gap: 15px;">
          <div class="profile-header-widget" style="border-left: 1px solid rgba(255,255,255,0.08); padding-left: 15px;">
            <a href="dashboard.html" class="profile-trigger-link">
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
            <a href="dashboard.html" class="profile-trigger-link">
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
    }

    authSectionMobile = `
      <div class="nav-auth-mobile">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
          <a href="dashboard.html" style="font-weight:600; font-size:14px; color:#ffffff; text-decoration:none;">${userName}</a>
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

  const contactDesktopSnippet = !isAdminPage ? `
    <div class="header-contact-desktop">
      <a href="tel:+36305746946" class="header-contact-item" title="Telefonszám: (+36) 30 574 6946">
        <span class="header-contact-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
          </svg>
        </span>
        <span class="header-contact-text">(+36) 30 574 6946</span>
      </a>
      <span class="header-contact-divider">•</span>
      <a href="mailto:orangeramp.info@gmail.com" class="header-contact-item" title="E-mail: orangeramp.info@gmail.com">
        <span class="header-contact-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="20" height="16" x="2" y="4" rx="2"></rect>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
          </svg>
        </span>
        <span class="header-contact-text">orangeramp.info@gmail.com</span>
      </a>
    </div>
  ` : '';

  headerEl.innerHTML = `
    <div class="container">
      <nav class="navbar ${isClubPage ? 'club-navbar' : ''}">
        <a href="${isClubPage ? (isClubHost ? '/' : 'klub.html') : 'index.html'}" class="logo ${isClubPage ? 'club-logo-link' : 'company-logo-link'}" style="display: flex; align-items: center; gap: 0; height: 100%;">
          <img src="${(isClubPage || !document.body.classList.contains('theme-silver')) ? 'pictures/logos/klub_logo_transp.png' : 'pictures/logos/header_logo.png'}" alt="HawkStone Logo" class="${isClubPage ? 'club-header-logo-img' : 'header-logo-img'}" style="width: auto; object-fit: contain; display: block;" />
        </a>

        ${isConfiguredAdmin ? `
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
        <div class="menu-overlay" id="menu-overlay"></div>

        <!-- Navigation Menu -->
        <ul class="nav-menu" id="nav-menu">
          <!-- Close Button in Menu (Mobile / Admin Drawer Close) -->
          <button class="menu-close-btn" id="menu-close" aria-label="Menü bezárása">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          
          <li class="menu-title-mobile">MENÜ</li>
          ${(isClubPage || isAdminPage) ? authSectionMobile : ''}
          ${navItems}
        </ul>

        ${authSection}
      </nav>
    </div>

    ${isConfiguredAdmin ? '' : `
      <!-- Search Bar Dropdown -->
      <div class="search-dropdown-bar" id="search-dropdown-bar">
        <div class="search-bar-inner">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: var(--text-muted);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" placeholder="Keresés a mászófalak, hírek vagy órarendek között..." id="header-search-input" oninput="handleHeaderSearch(this.value)" />
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
    const toggleMenu = (open) => {
      navMenu.classList.toggle('open', open);
      overlay.classList.toggle('active', open);
      document.body.style.overflow = open ? 'hidden' : ''; // Prevent scroll when menu open
    };

    hamburger.addEventListener('click', () => toggleMenu(true));
    closeBtn.addEventListener('click', () => toggleMenu(false));
    overlay.addEventListener('click', () => toggleMenu(false));

    // Close menu when clicking on links
    navMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => toggleMenu(false));
    });
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
// ---------------- HEADER SEARCH UTILITIES ----------------
const searchIndex = [
  // --- Cégoldal ---
  { title: "Bemutatkozunk", desc: "Ismerd meg a HawkStone mászófalgyártó csapatát és küldetésünket.", link: "index.html#about", tags: "rolunk bemutatkozas csapat hovi-tech tervezes gyartas" },
  { title: "Mászófal típusaink", desc: "Mászófalaink típusai, működési elve és előnyei.", link: "index.html#walls", tags: "tipusok mászófalak tipusaink mukodesi elv" },
  { title: "Galéria", desc: "Képgaléria elkészült mászófalainkból.", link: "index.html#gallery", tags: "kepgaleria kepek fotok munkaink referencia" },
  { title: "Iskolai mászófalak", desc: "Iskolai mászófalak M1104, M1106, M1105 – méretek, felület.", link: "maszofalaink.html#iskolai", tags: "iskola iskolai tornaterem m1104 m1106 m1105 magassag szelesseg" },
  { title: "Boulder mászófalak", desc: "Boulder mászófalak M1101, M1102, M1103 – méretek, felület.", link: "maszofalaink.html#boulder", tags: "boulder bouldering m1101 m1102 m1103 kis magassagu" },
  { title: "Játszóterekre, parkokba – Játszótéri kültéri mászófal", desc: "Játszótéri kültéri mászófal M1109, 3 m magas, kb. 11 m².", link: "maszofalaink.html#jatszoter", tags: "jatszoter jatszoteri kulteri park parkok m1109 szabadteri" },
  { title: "Egyéb mászófalak", desc: "Nagy felületű mászófalak M1107 és M1108, felsőbiztosítási pontokkal.", link: "maszofalaink.html#egyeb", tags: "egyeb nagy m1107 m1108 felsobiztositas felso biztositasi pontok" },
  { title: "ISO 9001", desc: "Hovi-Tech Kft. minőségpolitikája és ISO 9001 tanúsítványai (HU, EN, DE).", link: "iso9001.html", tags: "iso minosegpolitika tanusitvany certificate zertifikat minosites en 9001 minoseg" },
  { title: "Kapcsolat", desc: "Elérhetőségeink és kapcsolati űrlap – írj nekünk!", link: "kapcsolat.html", tags: "kapcsolat email telefon uzenet urlap ajanlatkeres cim nyirpazony" },
  // --- Városi Mászóklub ---
  { title: "Városi Mászóklub", desc: "Nyíregyházi Városi Mászóklub – próbáld ki a falainkat!", link: "klub.html", tags: "klub maszoklub nyiregyhaza proba probald ki idopontfoglalas foglalas" },
  { title: "Helyszínek", desc: "Eötvös, Kossuth és Zrínyi iskolai mászófalak Nyíregyházán.", link: "klub.html#locations", tags: "helyszin helyek eotvos kossuth zrinyi nyitvatartas cimek" },
  { title: "Áraink", desc: "Jegyek és bérletek árai a mászóklubban.", link: "klub.html#prices", tags: "arak jegy berlet napijegy vasarlas fizetes" },
  { title: "Szabályzatunk", desc: "Mászófal biztonsági és házirend szabályzatunk.", link: "szabalyzat.html", tags: "szabalyzat vizsga biztonsag zold piros kartya hazirend" },
  { title: "Mászófal használati szabályok", desc: "A mászófalak biztonságos használatának szabályai.", link: "hasznalati-szabalyok.html", tags: "hasznalati szabalyok biztonsag" },
  { title: "Profilom", desc: "Személyes profil, megvásárolt jegyek és időpontfoglalások.", link: "dashboard.html", tags: "profil dashboard vezerlopult foglalas jegyek qr kod belepes bejelentkezes" },
  // --- Jogi oldalak ---
  { title: "Adatkezelési Tájékoztató", desc: "Személyes adatok kezelése, GDPR.", link: "adatvedelem.html", tags: "adatvedelem adatkezeles gdpr adatok" },
  { title: "Süti Tájékoztató", desc: "Cookie-k (sütik) használata az oldalon.", link: "cookie-szabalyzat.html", tags: "suti cookie sutik" },
  { title: "ÁSZF", desc: "Általános Szerződési Feltételek.", link: "aszf.html", tags: "aszf szerzodesi feltetelek" },
  { title: "Elállás a szerződéstől", desc: "Online elállási nyilatkozat.", link: "withdrawal.html", tags: "elallas visszaterites szerzodestol" },
  { title: "Impresszum", desc: "Cégadatok, Hovi-Tech Kft.", link: "impresszum.html", tags: "impresszum cegadatok" }
];

// Ékezet- és kisbetű-független normalizálás a kereséshez
function normalizeSearchText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ő/g, 'o').replace(/ű/g, 'u');
}

function resolveSearchLink(link) {
  if (link.startsWith('#')) {
    const isIndex = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
    return isIndex ? link : `index.html${link}`;
  }
  return link;
}

function toggleHeaderSearch() {
  const bar = document.getElementById('search-dropdown-bar');
  if (!bar) return;
  const isOpen = bar.classList.toggle('open');
  if (isOpen) {
    const input = document.getElementById('header-search-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    const results = document.getElementById('search-results-dropdown');
    if (results) {
      results.style.display = 'none';
      results.innerHTML = '';
    }
  }
}

function clearHeaderSearch() {
  const input = document.getElementById('header-search-input');
  if (input) {
    input.value = '';
    input.focus();
  }
  const results = document.getElementById('search-results-dropdown');
  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
}

function handleHeaderSearch(query) {
  const resultsDiv = document.getElementById('search-results-dropdown');
  if (!resultsDiv) return;

  const cleanQuery = query.toLowerCase().trim();
  if (!cleanQuery) {
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = '';
    return;
  }

  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const filtered = searchIndex.filter(item => {
    const hay = normalizeSearchText(item.title + ' ' + item.desc + ' ' + item.tags);
    return terms.every(t => hay.includes(t));
  });

  resultsDiv.style.display = 'block';
  if (filtered.length === 0) {
    resultsDiv.innerHTML = `<div class="search-no-results">Nincs találat a következőre: "${query}"</div>`;
    return;
  }

  resultsDiv.innerHTML = filtered.map(item => {
    const resolvedLink = resolveSearchLink(item.link);
    return `
      <a href="${resolvedLink}" class="search-result-item" onclick="toggleHeaderSearch()">
        <span class="search-result-title">${item.title}</span>
        <span class="search-result-desc">${item.desc}</span>
      </a>
    `;
  }).join('');
}

// Click outside to close search bar
document.addEventListener('click', (event) => {
  const bar = document.getElementById('search-dropdown-bar');
  const trigger = document.querySelector('.search-trigger-btn');
  if (bar && bar.classList.contains('open') && !bar.contains(event.target) && (!trigger || !trigger.contains(event.target))) {
    bar.classList.remove('open');
  }
});

// Bind search utilities to window
window.toggleHeaderSearch = toggleHeaderSearch;
window.clearHeaderSearch = clearHeaderSearch;
window.handleHeaderSearch = handleHeaderSearch;

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
  if (!confirm('Biztosan lemondod ezt a foglalást?')) return;
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
          btn.innerHTML = '<span>❌</span> Kamera bezárása';
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
      btn.innerHTML = '<span>📷</span> Kamera megnyitása';
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
  const role = getUserRole();
  if (role !== 'STAFF' && role !== 'ADMIN') {
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
    const confirmCheckin = confirm('⚠️ A mászó ma már egyszer belépett erre az időpontra ezen a helyszínen! Ennek ellenére belépteted?');
    if (!confirmCheckin) return;
  } else if (!hasBookingToday) {
    const confirmCheckin = confirm('⚠️ A mászónak nincs mára érvényes foglalása erre a helyszínre. Ennek ellenére belépteted?');
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

// ---------------- ADMIN PANEL (ADMIN) ----------------
async function initAdminPanel() {
  const role = getUserRole();
  if (role !== 'ADMIN') {
    window.location.href = 'auth.html';
    return;
  }

  // Switch tab instantly on load to prevent flickering showing the wrong default tab
  const hash = window.location.hash || '#dashboard';
  let initialTab = 'dashboard';
  if (hash === '#users') initialTab = 'users';
  else if (hash === '#news') initialTab = 'news';
  else if (hash === '#schedule') initialTab = 'slots';
  else if (hash === '#bookings') initialTab = 'bookings';
  else if (hash === '#withdrawals') initialTab = 'withdrawals';

  if (typeof window.switchAdminTab === 'function') {
    window.switchAdminTab(initialTab);
  }

  // Load administrative data in parallel to avoid sequential blocks/flickers
  Promise.all([
    loadAdminUsers(),
    loadAdminSlots(),
    loadNewsAnnouncements(),
    loadAdminBookings(),
    loadAdminWithdrawals()
  ]).catch(err => {
    console.error('Error loading admin panel resources in parallel:', err);
  });

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
    if (currentHash === '#users') tab = 'users';
    else if (currentHash === '#news') tab = 'news';
    else if (currentHash === '#schedule') tab = 'slots';
    else if (currentHash === '#bookings') tab = 'bookings';
    else if (currentHash === '#withdrawals') tab = 'withdrawals';

    if (typeof window.switchAdminTab === 'function') window.switchAdminTab(tab);
    renderHeader();
  });
}

async function loadAdminUsers() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; color: var(--text-muted); width: 100%; grid-column: 1/-1;">Tagok betöltése...</p>';

  try {
    const res = await fetch('/api/admin/users', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    const users = await res.json();

    window.adminUsers = users; // Store globally for details modal lookup and sorting
    renderAdminUsers();
  } catch (err) {
    container.innerHTML = '<p style="text-align:center; color:var(--danger); width: 100%; grid-column: 1/-1;">Nem sikerült a felhasználók betöltése.</p>';
  }
}

function renderAdminUsers() {
  const container = document.getElementById('admin-users-list');
  if (!container || !window.adminUsers) return;

  const sortSelect = document.getElementById('admin-users-sort');
  const sortBy = sortSelect ? sortSelect.value : 'name-asc';

  let sortedUsers = [...window.adminUsers];

  if (sortBy === 'name-asc') {
    sortedUsers.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  } else if (sortBy === 'name-desc') {
    sortedUsers.sort((a, b) => b.name.localeCompare(a.name, 'hu'));
  } else if (sortBy === 'reg-desc') {
    sortedUsers.sort((a, b) => b.id - a.id); // Newest first
  } else if (sortBy === 'reg-asc') {
    sortedUsers.sort((a, b) => a.id - b.id); // Oldest first
  }

  container.innerHTML = '';
  
  if (sortedUsers.length === 0) {
    container.innerHTML = '<p style="text-align:center; color: var(--text-muted); width: 100%; grid-column: 1/-1;">Nem található regisztrált tag.</p>';
    return;
  }

  sortedUsers.forEach(u => {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.setAttribute('onclick', `openUserDetailsModal(${u.id})`);
    
    const badgeClass = u.card_type === 'ZÖLD' ? 'badge-green' : 'badge-red';
    const roleBadge = u.role === 'ADMIN' ? 'badge-primary' : (u.role === 'STAFF' ? 'badge-secondary' : '');
    const roleLabel = u.role === 'ADMIN' ? 'Admin' : (u.role === 'STAFF' ? 'Staff' : 'Mászó');

    card.innerHTML = `
      <div class="user-card-header">
        <div>
          <div class="user-card-name">${u.name}</div>
          <div class="user-card-email" style="font-size:12px; color:var(--text-secondary); margin-top:3px; word-break:break-all;">${u.email}</div>
          <div class="user-card-phone" style="font-size:12px; color:var(--text-muted); margin-top:2px;">${u.phone || '-'}</div>
        </div>
      </div>
      <div class="user-card-badges" style="display:flex; gap:5px; flex-wrap:wrap; margin-top:8px;">
        <span class="badge ${badgeClass}">${u.card_type} KÁRTYA</span>
        ${roleBadge ? `<span class="badge" style="background:#4f46e5;">${roleLabel}</span>` : ''}
      </div>
    `;
    container.appendChild(card);
  });
}

function sortAdminUsers() {
  renderAdminUsers();
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
    
    bookingDiv.innerHTML = `
      <div>
        <span style="font-weight:600; color:#fff;">${b.booking_date}</span> | 
        <span>${b.start_time.substring(0,5)} - ${b.end_time.substring(0,5)}</span> 
        <span style="color:var(--primary);">(${b.location_name})</span>
      </div>
      ${isAttended ? '<span class="badge badge-secondary" style="font-size: 9px; padding: 1px 4px; opacity: 0.6;">Megjelent</span>' : ''}
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
  const viewEl = document.getElementById('user-details-subpage-view-mode');
  const editEl = document.getElementById('user-details-subpage-edit-mode');
  if (viewEl) viewEl.style.display = 'none';
  if (editEl) editEl.style.display = 'block';
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
    showToast('Nem törölheted a saját adminisztrátori fiókodat!', 'error');
    return;
  }

  if (currentViewedUser && currentViewedUser.email === 'admin@hawkstone.hu') {
    showToast('Az Admin Főnök felhasználó nem törölhető az admin felületről!', 'error');
    return;
  }

  if (currentViewedUser && currentViewedUser.role === 'ADMIN') {
    showToast('Biztonsági okokból adminisztrátori fiókot nem lehet törölni!', 'error');
    return;
  }

  if (!confirm('Biztosan törlöd ezt a felhasználót és minden hozzá tartozó adatot (jegyek, foglalások)?')) return;
  
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
    
    if (!confirm(`Biztosan be akarsz importálni ${users.length} felhasználót? A meglévő tagok adatai frissülni fognak.`)) {
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
  const cancelOnlyThisWeek = confirm(`Csak erről a hétről szeretnéd lemondani az idősávot (${dateStr})?\n\nHa a "Mégse"-re kattintasz, megkérdezzük, hogy véglegesen le akarod-e törölni.`);
  
  if (cancelOnlyThisWeek) {
    // Cancel for specific date only
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
    }
  } else {
    const deletePermanently = confirm(`Biztosan törölni szeretnéd ezt az idősávot véglegesen a heti sablonból?\n\nEz minden hétről törli ezt az időpontot.`);
    if (deletePermanently) {
      try {
        const res = await fetch(`/api/admin/slots/${slotId}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('Idősáv véglegesen törölve a sablonból.');
        loadAdminSlots();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  }
}

async function uncancelAdminSlot(slotId, dateStr) {
  if (!confirm(`Biztosan visszaállítod ezt az idősávot a megadott dátumra (${dateStr})?`)) return;
  
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
}

// Load all announcements in Admin view
async function loadNewsAnnouncements() {
  const container = document.getElementById('admin-news-list');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--text-muted); text-align:center; width:100%;">Hírek betöltése...</p>';

  try {
    const res = await fetch('/api/announcements', { headers: getAuthHeaders() });
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
        <div style="flex-grow: 1;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 10px;">
            <div style="font-weight:700; color:#fff; font-size:16px;">${item.title}</div>
            ${activeBadge}
          </div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
            ${item.created_at ? item.created_at.substring(0, 16).replace('T', ' ') : '-'}
          </div>
          ${imagePreviewHtml}
          <div class="text-justify" style="font-size:13px; color:var(--text-secondary); margin-top:8px; line-height:1.4;">
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

  const payload = { title, content, imageUrl, isActive };
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

  document.getElementById('admin-news-form').scrollIntoView({ behavior: 'smooth' });
}

// Delete announcement
async function deleteNewsAnnouncement(id) {
  if (!confirm('Biztosan törlöd ezt a közleményt?')) return;

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
  }
}

// Cancel news editing and clear form
function cancelNewsEdit() {
  document.getElementById('admin-news-id').value = '';
  document.getElementById('admin-news-form').reset();

  document.getElementById('news-form-title').textContent = 'Új közlemény közzététele';
  document.getElementById('news-submit-btn').textContent = 'Közzététel';
  document.getElementById('news-cancel-btn').style.display = 'none';
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
window.adminWithdrawals = [];

async function loadAdminWithdrawals() {
  const container = document.getElementById('admin-withdrawals-list');
  if (!container) return;

  container.innerHTML = '<p style="text-align:center; color: var(--text-muted); padding: 20px;">Elállások lekérése...</p>';

  try {
    const res = await fetch('/api/admin/withdrawals', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Hiba a naplózott elállások lekérésekor.');
    const data = await res.json();

    window.adminWithdrawals = data;
    renderAdminWithdrawals();
  } catch (err) {
    container.innerHTML = `<p style="text-align:center; color: var(--danger); padding: 20px;">Hiba történt az elállások betöltésekor: ${err.message}</p>`;
  }
}

function renderAdminWithdrawals() {
  const container = document.getElementById('admin-withdrawals-list');
  if (!container || !window.adminWithdrawals) return;

  const currentFilter = window.currentWithdrawalFilter || 'pending';
  
  // Filter the withdrawals:
  // 'pending' -> w.refund_status is PENDING or UNDER_REVIEW or missing
  // 'completed' -> w.refund_status is REFUNDED or REJECTED
  const filtered = window.adminWithdrawals.filter(w => {
    const status = w.refund_status || 'PENDING';
    if (currentFilter === 'pending') {
      return status === 'PENDING' || status === 'UNDER_REVIEW';
    } else {
      return status === 'REFUNDED' || status === 'REJECTED';
    }
  });

  const tabPending = document.getElementById('withdrawal-tab-pending');
  const tabCompleted = document.getElementById('withdrawal-tab-completed');
  if (tabPending && tabCompleted) {
    if (currentFilter === 'pending') {
      tabPending.className = 'btn btn-primary btn-sm';
      tabCompleted.className = 'btn btn-secondary btn-sm';
    } else {
      tabPending.className = 'btn btn-secondary btn-sm';
      tabCompleted.className = 'btn btn-primary btn-sm';
    }
  }

  if (filtered.length === 0) {
    container.innerHTML = `<p style="text-align:center; color: var(--text-muted); padding: 40px 20px;">Nincsenek ${currentFilter === 'pending' ? 'folyamatban lévő' : 'kivizsgált'} elállási igények.</p>`;
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
            <span style="font-size: 15px; font-weight: 700; color: #fff;">${w.customer_name}</span>
            <span style="font-size: 11px; background: ${rf.bg}; border: 1px solid ${rf.border}; color: ${rf.color}; padding: 3px 9px; border-radius: 20px; font-weight: 600;">${rf.label}</span>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">${w.customer_email}</div>
          <div style="font-size: 13px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 3px;">
            <span>🎫 <strong style="color:#fff;">${typeLabel}</strong> &nbsp;|&nbsp; ID: <code style="font-size:12px; color: var(--primary);">#${w.ticket_id}</code></span>
            <span>💰 Vételár (becsült): <strong style="color:#fff;">${priceText}</strong></span>
            <span>📅 Vásárlás: <strong style="color:#fff;">${purchaseDisplay}</strong></span>
            <span>⏱️ Elállás: <strong style="color: var(--primary);">${formattedWithdrawal}</strong></span>
            ${w.admin_note ? `<span style="margin-top:6px; font-size:11px; color:#94a3b8; font-style:italic;">📝 Megjegyzés: ${w.admin_note.substring(0,80)}${w.admin_note.length > 80 ? '...' : ''}</span>` : ''}
          </div>
        </div>

        <!-- Right: Contract ID + Actions -->
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 10px; min-width: 180px;">
          <div style="font-size: 11px; color: var(--text-muted); text-align: right;">
            Szerz. azonosító:<br><code style="font-size:12px; color:#fff;">${w.contract_id}</code>
          </div>
          <button onclick="openWithdrawalInvestigationModal(${JSON.stringify(w).replace(/"/g, '&quot;')})" class="btn btn-primary btn-sm" style="padding: 9px 16px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
            🔍 Vizsgálat indítása
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
          ✉️ Üzenet írása
        </button>
        <button onclick="initiateWithdrawalRefund(${w.id})" style="background:linear-gradient(135deg,#10b981,#059669);border:none;color:#fff;border-radius:10px;padding:11px 20px;cursor:pointer;font-size:13px;font-weight:700;transition:all 0.2s;display:flex;align-items:center;gap:7px;box-shadow:0 4px 14px rgba(16,185,129,0.3);" onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 20px rgba(16,185,129,0.4)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 14px rgba(16,185,129,0.3)'">
          💸 Visszatérítés indítása
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
        <button onclick="sendWithdrawalMessage(${withdrawalId})" style="background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;color:#fff;border-radius:9px;padding:10px 22px;cursor:pointer;font-size:13px;font-weight:700;box-shadow:0 4px 14px rgba(99,102,241,0.35);">📤 Küldés</button>
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
    if (btn) { btn.disabled = false; btn.textContent = '📤 Küldés'; }
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
        const attendedBadge = b.attended > 0 ? `<span class="badge badge-green" style="font-size: 9px; padding: 2px 6px; opacity: 0.8; margin-left: 8px;">Megjelent</span>` : '';
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
  if (!confirm('Biztosan törölni szeretnéd ezt a foglalást?')) return;
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
  }
}

// Check if there is an active announcement and display modal on landing/dashboard
async function checkActiveAnnouncement() {
  const path = window.location.pathname;
  const isTargetPage = path.endsWith('index.html') || path === '/' || path.endsWith('webpage/') || path.endsWith('dashboard.html');
  if (!isTargetPage) return;

  try {
    const res = await fetch('/api/announcements/active');
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
  checkActiveAnnouncement();
  initScrollAnimations();

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
  } else if (path.endsWith('admin.html')) {
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

// Explicit window bindings to ensure inline HTML onClick triggers resolve properly
window.openQRModal = openQRModal;
window.closeQRModal = closeQRModal;
window.openNoTicketModal = openNoTicketModal;
window.closeNoTicketModal = closeNoTicketModal;
window.buyTicket = buyTicket;
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




// ---------------- GALÉRIA LIGHTBOX (kattintható + lapozható) ----------------
function initGalleryLightbox() {
  const spread = document.getElementById('gallerySpread');
  if (!spread) return;

  const items = Array.from(spread.querySelectorAll('.gs-item'));
  const images = items.map(btn => {
    const img = btn.querySelector('img');
    return { src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' };
  });
  if (!images.length) return;

  const box = document.createElement('div');
  box.className = 'gallery-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Képgaléria');
  box.innerHTML = `
    <button type="button" class="gl-btn gl-close" aria-label="Bezárás">✕</button>
    <button type="button" class="gl-btn gl-prev" aria-label="Előző kép">❮</button>
    <div class="gl-stage"><img class="gl-img" src="" alt=""></div>
    <button type="button" class="gl-btn gl-next" aria-label="Következő kép">❯</button>
    <div class="gl-counter"><span class="gl-cur">1</span> / ${images.length}</div>
  `;
  document.body.appendChild(box);

  const imgEl = box.querySelector('.gl-img');
  const curEl = box.querySelector('.gl-cur');
  let index = 0;

  const show = (i, animate) => {
    index = (i + images.length) % images.length;
    const apply = () => {
      imgEl.src = images[index].src;
      imgEl.alt = images[index].alt;
      curEl.textContent = index + 1;
      imgEl.classList.remove('switching');
    };
    if (animate) {
      imgEl.classList.add('switching');
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
    box.classList.remove('open');
    document.body.style.overflow = '';
  };
  const next = () => show(index + 1, true);
  const prev = () => show(index - 1, true);

  items.forEach((btn, i) => btn.addEventListener('click', () => open(i)));
  box.querySelector('.gl-close').addEventListener('click', close);
  box.querySelector('.gl-next').addEventListener('click', (e) => { e.stopPropagation(); next(); });
  box.querySelector('.gl-prev').addEventListener('click', (e) => { e.stopPropagation(); prev(); });
  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.classList.contains('gl-stage')) close();
  });

  document.addEventListener('keydown', (e) => {
    if (!box.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
  });

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
