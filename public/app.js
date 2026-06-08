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
  const isAdminPage = path.endsWith('admin.html') || path.endsWith('scanner.html');

  // Set admin classes for fix header layout
  if (isAdminPage && isConfiguredAdmin) {
    headerEl.className = 'admin-header';
    document.body.className = 'admin-body';
  } else {
    headerEl.className = '';
    document.body.className = '';
  }

  let navItems = '';

  if (isAdminPage && isConfiguredAdmin) {
    // Admin / Staff Specific Menu (Order requested by USER)
    const activeClass = (page, hash = '') => {
      const isPage = path.endsWith(page);
      const isHash = hash ? window.location.hash === hash : !window.location.hash;
      return isPage && isHash ? 'active' : '';
    };

    navItems = `
      <li><a href="scanner.html" class="nav-link ${activeClass('scanner.html')}">Beléptetés / Scanner</a></li>
      <li><a href="admin.html#schedule" class="nav-link ${activeClass('admin.html', '#schedule')}">Órarend kezelése</a></li>
      <li><a href="admin.html#users" class="nav-link ${activeClass('admin.html', '#users')}">Felhasználók kezelése</a></li>
      <li><a href="admin.html#bookings" class="nav-link ${activeClass('admin.html', '#bookings')}">Foglalások</a></li>
      <li><a href="admin.html#news" class="nav-link ${activeClass('admin.html', '#news')}">Üzenőfal</a></li>
      <li><a href="dashboard.html" class="nav-link">Profilom</a></li>
      <li><a href="index.html" target="_blank" class="nav-link">Weboldal ↗</a></li>
    `;
  } else {
    // Public / User Menu (Rólunk, Helyszínek, Áraink, Szabályzatunk, Kapcsolat)
    const indexLink = (hash) => {
      const isIndex = path.endsWith('index.html') || path === '/' || path.endsWith('/');
      return isIndex ? hash : `index.html${hash}`;
    };

    navItems = `
      <li><a href="${indexLink('#about')}" class="nav-link">Rólunk</a></li>
      <li><a href="${indexLink('#locations')}" class="nav-link">Helyszínek</a></li>
      <li><a href="${indexLink('#prices')}" class="nav-link">Áraink</a></li>
      <li><a href="${indexLink('#rules')}" class="nav-link">Szabályzatunk</a></li>
      <li><a href="${indexLink('#contact')}" class="nav-link">Kapcsolat</a></li>
    `;
    if (token) {
      if (user.role === 'USER') {
        navItems += `<li><a href="dashboard.html" class="nav-link ${isActive('dashboard.html')}">Profilom</a></li>`;
      } else if (user.role === 'STAFF' || user.role === 'ADMIN') {
        navItems += `
          <li><a href="dashboard.html" class="nav-link ${isActive('dashboard.html')}">Profilom</a></li>
          <li><a href="admin.html" class="nav-link ${isActive('admin.html')}">Adminisztráció</a></li>
          <li><a href="scanner.html" class="nav-link ${isActive('scanner.html')}">Scanner</a></li>
        `;
      }
    }
  }

  let authSection = '';
  let authSectionMobile = '';
  const userName = user.name || 'Fiókom';

  if (token) {
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

    authSectionMobile = `
      <div class="nav-auth-mobile">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
          <span style="font-weight:600; font-size:14px; color:#ffffff;">${userName}</span>
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

  headerEl.innerHTML = `
    <div class="container">
      <nav class="navbar">
        <a href="index.html" class="logo" style="display: flex; align-items: center; gap: 0; height: 100%;" onclick="if(window.location.pathname.endsWith('index.html') || window.location.pathname==='/' || window.location.pathname.endsWith('/')){ window.scrollTo({top:0, behavior:'smooth'}); event.preventDefault(); }">
          <img src="pictures/logos/header_logo.png" alt="HawkStone Logo" style="height: 100%; max-height: 100%; width: auto; object-fit: contain; display: block;" />
        </a>

        <!-- Hamburger Icon for Mobile -->
        <button class="hamburger-btn" id="hamburger-toggle" aria-label="Menü megnyitása">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>

        <!-- Menu overlay background -->
        <div class="menu-overlay" id="menu-overlay"></div>

        <!-- Navigation Menu -->
        <ul class="nav-menu" id="nav-menu">
          <!-- Close Button in Menu (Mobile only) -->
          <button class="menu-close-btn" id="menu-close" aria-label="Menü bezárása">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          
          <li class="menu-title-mobile">MENÜ</li>
          ${navItems}
          ${authSectionMobile}
        </ul>

        ${authSection}
      </nav>
    </div>

    <!-- Search Bar Dropdown -->
    <div class="search-dropdown-bar" id="search-dropdown-bar">
      <div class="search-bar-inner">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: var(--text-muted);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" placeholder="Keresés a mászófalak, hírek vagy órarendek között..." id="header-search-input" oninput="handleHeaderSearch(this.value)" />
        <button class="search-clear-btn" onclick="clearHeaderSearch()" aria-label="Keresés törlése">&times;</button>
      </div>
      <div class="search-results-dropdown" id="search-results-dropdown" style="display:none;"></div>
    </div>
  `;

  // Hamburger Menu toggle events
  const hamburger = document.getElementById('hamburger-toggle');
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
}

// ---------------- HEADER SEARCH UTILITIES ----------------
const searchIndex = [
  { title: "Rólunk", desc: "Ismerd meg a HawkStone csapatát és küldetésünket.", link: "#about", tags: ["rolunk", "csapat", "bemutatkozas", "mászás", "terem"] },
  { title: "Helyszínek", desc: "Három helyszínünk: Eötvös mászófal, Kossuth mászófal, Zrínyi mászófal.", link: "#locations", tags: ["helyszin", "helyek", "eötvös", "kossuth", "zrínyi", "nyitvatartás", "cim", "címek"] },
  { title: "Áraink", desc: "Tekintsd meg jegyeink és bérleteink árait.", link: "#prices", tags: ["arak", "araink", "jegy", "berlet", "bérlet", "napijegy", "vasarlas", "fizetes"] },
  { title: "Szabályzatunk", desc: "Mászófal biztonsági és házirend szabályzatunk.", link: "#rules", tags: ["szabalyzat", "vizsga", "biztonsag", "zöld", "piros", "kartya", "kártya"] },
  { title: "Kapcsolat", desc: "Vedd fel velünk a kapcsolatot, vagy küldj üzenetet.", link: "#contact", tags: ["kapcsolat", "email", "telefon", "terkep", "térkép", "uzenet"] },
  { title: "Profilom", desc: "Személyes profil, megvásárolt jegyek és időpontfoglalások kezelése.", link: "dashboard.html", tags: ["profilom", "dashboard", "vezérlőpult", "foglalas", "jegyek", "qr", "kod"] }
];

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

  const filtered = searchIndex.filter(item => {
    return item.title.toLowerCase().includes(cleanQuery) ||
           item.desc.toLowerCase().includes(cleanQuery) ||
           item.tags.some(tag => tag.includes(cleanQuery));
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

function isActive(page) {
  const path = window.location.pathname;
  return path.endsWith(page) ? 'active' : '';
}

// ---------------- PUBLIC LANDING PAGE (INDEX) ----------------
async function initPublicLanding() {
  const video = document.querySelector('.hero-video-bg');
  const heroContent = document.querySelector('.hero-content');
  if (video) {
    video.playbackRate = 0.85;
    video.loop = false;
    
    // Prepare initial position of text on startup (desktop only)
    const isMobileInit = window.innerWidth <= 768;
    if (!isMobileInit && heroContent) {
      heroContent.classList.add('prepare-text');
    }
    
    let hasFadedInText = false;
    let hasZoomedText = false;
    let hasFadedOutText = false;
    let hasFadedOutVideo = false;
    
    // Fade in on first play and reset flags at loop start
    video.addEventListener('play', () => {
      video.classList.remove('video-ended');
      if (video.currentTime < 1) {
        hasFadedInText = false;
        hasZoomedText = false;
        hasFadedOutText = false;
        hasFadedOutVideo = false;
        // 'grow' class is now cleaned up inside the ended loop delay to prevent premature size reduction during fade-out
      }
    });
    
    // Listen to timeupdate to trigger text fade-in, grow zoom, and video fade-out before the end
    video.addEventListener('timeupdate', () => {
      const isMobile = window.innerWidth <= 768;

      // 1. Text fade-in (3 seconds before end)
      if (video.duration && (video.duration - video.currentTime <= 3)) {
        if (!hasFadedInText) {
          hasFadedInText = true;
          if (heroContent) {
            heroContent.classList.remove('prepare-text'); // Remove Y=80px translate reset
            heroContent.classList.add('visible-title');
            heroContent.classList.add('visible-text');
          }
        }
      }
      
      // 2. Text grow zoom (2.5 seconds before end)
      if (video.duration && (video.duration - video.currentTime <= 2.5)) {
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
          
          // Remove paragraph class 500 ms after video starts playing!
          // This makes the text fade out exactly 1.5 seconds (1500 ms) after the title
          setTimeout(() => {
            if (heroContent) {
              heroContent.classList.remove('visible-text');
              // Delay removing grow class and resetting translateY position until the slow 2.4s fade-out is completely finished
              setTimeout(() => {
                heroContent.classList.remove('grow');
                heroContent.classList.add('prepare-text'); // Instantly reset translateY to 80px while invisible
              }, 2500);
            }
          }, 500);
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
    const { user, tickets, bookings } = data;
    
    // Save data to window for tab switching
    window.dashboardTickets = tickets;
    window.dashboardBookings = bookings;
    
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

    ticketCard.innerHTML = `
      <div class="ticket-info">
        <div class="ticket-info-details">
          <h4 style="display:flex; align-items:center; gap: 10px; flex-wrap: wrap;">
            ${hungarianType} 
            <span class="badge ${statusLabelClass}" style="font-size:9px; padding:3px 8px;">${statusText}</span>
          </h4>
          <p style="margin-top: 4px;">${usageText}</p>
          <p class="ticket-dates" style="margin-top:4px; font-size:11px; color:var(--text-muted);">Vásárlás: ${t.purchase_date} | Lejárat: ${t.expires_date}</p>
        </div>
        <div style="margin-top: auto; padding-top: 15px;">
          <button onclick="downloadRulesPDF(${t.id})" class="btn btn-secondary btn-sm" style="padding: 10px 15px; width: fit-content;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            PDF jegy & szabályzat
          </button>
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
      : '<p style="color:var(--text-muted);">Nincsenek múltbéli helyfoglalásaid.</p>';
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
    showToast('Szabályzat PDF generálása folyamatban...', 'success');
    const res = await fetch(`/api/tickets/${ticketId}/rules-pdf`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Nem sikerült a PDF generálása a szerveren');
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `HawkStone_Hasznalati_Szabalyzat_${ticketId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  if (!billingName || !billingZip || !billingCity || !billingAddress) {
    showToast('Kérjük, minden kötelező számlázási mezőt tölts ki!', 'error');
    return;
  }

  closeBillingModal();

  try {
    showToast('Fizetés kezdeményezése a Barion rendszerében...', 'info');
    const res = await fetch('/api/barion/start-payment', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ticketType: window.selectedTicketType,
        billingName,
        billingZip,
        billingCity,
        billingAddress,
        billingTaxNumber
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
  
  // Try to pre-fill user name from local storage details
  const userJson = localStorage.getItem('user');
  if (userJson) {
    try {
      const user = JSON.parse(userJson);
      const nameInput = document.getElementById('billing-name');
      if (nameInput) nameInput.value = user.name || '';
    } catch (e) {
      console.error('Error pre-filling billing name:', e);
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
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('hu-HU', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type) => parts.find(p => p.type === type).value;
    const todayStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;

    const formatTime = (t) => t ? t.substring(0, 5) : '';

    let hasBookingToday = false;

    if (hasLocation) {
      const selectedLocationName = locSelect.options[locSelect.selectedIndex].text;
      
      // Look for a matching booking TODAY at the SELECTED location
      const matchingBooking = bookings.find(b => b.booking_date === todayStr && String(b.location_id) === String(selectedLocation));
      hasBookingToday = !!matchingBooking;
      
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
                  <strong>${b.booking_date}</strong> | ${formatTime(b.start_time)} - ${formatTime(b.end_time)} (${b.location_name})
                </li>
              `).join('')}
            </ul>
          </div>
        `;
      }

      if (matchingBooking) {
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
            <div class="scan-booking-match">
              ✅ Foglalás ma: ${formatTime(matchingBooking.start_time)} - ${formatTime(matchingBooking.end_time)} (${matchingBooking.location_name})
            </div>
            ${otherBookingsHtml}
          </div>
        `;
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
        <button id="confirm-checkin-btn" onclick="processCheckIn('${ticket.qr_code_uuid}', ${hasBookingToday})" class="btn btn-primary" style="margin-top: 20px; width: 100%;" data-ticket-valid="${isValid}" ${hasLocation ? '' : 'disabled'}>
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

async function processCheckIn(uuid, hasBookingToday = true) {
  if (!hasBookingToday) {
    const confirmCheckin = confirm('A mászónak nincs mára érvényes foglalása erre a helyszínre. Ennek ellenére belépteted?');
    if (!confirmCheckin) return;
  }

  const locationId = document.getElementById('scanner-location-select').value;
  if (!locationId) {
    showToast('Kérjük, válassz beléptetési helyszínt!', 'error');
    return;
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

    // Stop camera scanner on successful checkin
    if (html5QrCode) {
      try {
        await html5QrCode.stop();
        html5QrCode = null;
      } catch (clearErr) {
        console.error('Hiba a kamera leállításakor:', clearErr);
        html5QrCode = null;
      }
    }

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

  await loadAdminUsers();
  await loadAdminSlots();
  await loadNewsAnnouncements();
  await loadAdminBookings();

  // News Form submission
  const newsForm = document.getElementById('admin-news-form');
  if (newsForm) {
    newsForm.addEventListener('submit', saveNewsAnnouncement);
  }

  // Hash-based Tab activation on load
  const hash = window.location.hash;
  if (hash === '#users') {
    if (typeof window.switchAdminTab === 'function') window.switchAdminTab('users');
  } else if (hash === '#news') {
    if (typeof window.switchAdminTab === 'function') window.switchAdminTab('news');
  } else if (hash === '#schedule') {
    if (typeof window.switchAdminTab === 'function') window.switchAdminTab('slots');
  } else if (hash === '#bookings') {
    if (typeof window.switchAdminTab === 'function') window.switchAdminTab('bookings');
  }

  // Global hash change listener for admin page tabs
  window.addEventListener('hashchange', () => {
    const currentHash = window.location.hash;
    if (currentHash === '#users') {
      if (typeof window.switchAdminTab === 'function') window.switchAdminTab('users');
    } else if (currentHash === '#news') {
      if (typeof window.switchAdminTab === 'function') window.switchAdminTab('news');
    } else if (currentHash === '#schedule') {
      if (typeof window.switchAdminTab === 'function') window.switchAdminTab('slots');
    } else if (currentHash === '#bookings') {
      if (typeof window.switchAdminTab === 'function') window.switchAdminTab('bookings');
    }
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

function openUserDetailsModal(userId) {
  const user = (window.adminUsers || []).find(u => u.id === userId);
  if (!user) return;
  
  document.getElementById('edit-user-id').value = user.id;
  
  // Populate View Mode
  document.getElementById('view-user-name-title').textContent = user.name;
  document.getElementById('view-user-email').textContent = user.email;
  document.getElementById('view-user-phone').textContent = user.phone || '-';
  document.getElementById('view-user-license').textContent = user.license_number || 'Nincs megadva';
  
  const cardBadge = document.getElementById('view-user-card');
  cardBadge.textContent = user.card_type + ' KÁRTYA';
  cardBadge.className = 'badge ' + (user.card_type === 'ZÖLD' ? 'badge-green' : 'badge-red');
  
  const roleLabel = user.role === 'ADMIN' ? 'Admin' : (user.role === 'STAFF' ? 'Staff' : 'Mászó');
  document.getElementById('view-user-role').textContent = roleLabel;
  
  // Populate Edit Mode
  document.getElementById('edit-user-name').value = user.name;
  document.getElementById('edit-user-email').value = user.email;
  document.getElementById('edit-user-phone').value = user.phone || '';
  document.getElementById('edit-user-license').value = user.license_number || '';
  document.getElementById('edit-user-card').value = user.card_type;
  document.getElementById('edit-user-role').value = user.role;
  
  switchUserModalToView();
  
  const backdrop = document.getElementById('edit-user-modal-backdrop');
  if (backdrop) backdrop.classList.add('open');
}

function openEditUserModal(userId) {
  openUserDetailsModal(userId);
  switchUserModalToEdit();
}

function closeEditUserModal() {
  const backdrop = document.getElementById('edit-user-modal-backdrop');
  if (backdrop) backdrop.classList.remove('open');
}

function switchUserModalToView() {
  const viewEl = document.getElementById('user-details-view-mode');
  const editEl = document.getElementById('user-details-edit-mode');
  if (viewEl) viewEl.style.display = 'block';
  if (editEl) editEl.style.display = 'none';
}

function switchUserModalToEdit() {
  const viewEl = document.getElementById('user-details-view-mode');
  const editEl = document.getElementById('user-details-edit-mode');
  if (viewEl) viewEl.style.display = 'none';
  if (editEl) editEl.style.display = 'block';
}

function triggerUserDeleteFromDetails() {
  const userIdVal = document.getElementById('edit-user-id').value;
  if (userIdVal) {
    deleteUser(parseInt(userIdVal));
  }
}

async function handleEditUserSubmit(e) {
  if (e) e.preventDefault();
  
  const id = document.getElementById('edit-user-id').value;
  const name = document.getElementById('edit-user-name').value;
  const email = document.getElementById('edit-user-email').value;
  const phone = document.getElementById('edit-user-phone').value;
  const license_number = document.getElementById('edit-user-license').value;
  const card_type = document.getElementById('edit-user-card').value;
  const role = document.getElementById('edit-user-role').value;
  
  try {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name, email, phone, license_number, card_type, role })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Mentési hiba');
    
    showToast('Felhasználó adatai sikeresen frissítve!');
    closeEditUserModal();
    loadAdminUsers();
    
    // If the edited user is the current logged-in admin, update local storage
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

async function deleteUser(userId) {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  if (currentUser.id === userId) {
    showToast('Nem törölheted a saját adminisztrátori fiókodat!', 'error');
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
    closeEditUserModal();
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAdminSlots() {
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

    for (const locName in grouped) {
      const locDiv = document.createElement('div');
      locDiv.style.marginBottom = '30px';
      
      let daysHtml = '';
      dayOrder.forEach(dayIdx => {
        if (grouped[locName][dayIdx] && grouped[locName][dayIdx].length > 0) {
          const dayName = daysHungarian[dayIdx];
          let slotItemsHtml = '';
          grouped[locName][dayIdx].forEach(s => {
            slotItemsHtml += `
              <div style="display:inline-flex; align-items:center; gap:8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-color); padding:6px 12px; border-radius:30px; margin:4px; font-size:13px;">
                <strong>${s.start_time} - ${s.end_time}</strong> (${s.max_capacity} fő)
                <span onclick="deleteAdminSlot(${s.id})" style="color:var(--danger); cursor:pointer; font-weight:bold; padding-left:4px;" title="Idősáv törlése">×</span>
              </div>
            `;
          });

          daysHtml += `
            <div style="margin-bottom:12px;">
              <span style="font-weight:600; font-size:14px; width:100px; display:inline-block; color:var(--text-secondary);">${dayName}:</span>
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

async function deleteAdminSlot(slotId) {
  if (!confirm('Biztosan törlöd ezt az idősávot a heti órarendből?')) return;
  try {
    const res = await fetch(`/api/admin/slots/${slotId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Idősáv törölve!');
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
  const day = currentBudapest.getDay();
  // Calculate distance to current week's Monday
  // If today is Sunday (0), distance is -6 days. Otherwise distance is -(day - 1) days.
  const distanceToMonday = day === 0 ? -6 : -(day - 1);
  
  const monday1 = new Date(currentBudapest);
  monday1.setDate(currentBudapest.getDate() + distanceToMonday);
  
  const sunday1 = new Date(monday1);
  sunday1.setDate(monday1.getDate() + 6);
  
  const monday2 = new Date(monday1);
  monday2.setDate(monday1.getDate() + 7);
  const sunday2 = new Date(monday2);
  sunday2.setDate(monday2.getDate() + 6);

  const monday3 = new Date(monday1);
  monday3.setDate(monday1.getDate() + 14);
  const sunday3 = new Date(monday3);
  sunday3.setDate(monday3.getDate() + 6);

  const formatDate = (d) => {
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
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

async function loadAdminBookings() {
  const container = document.getElementById('admin-bookings-list');
  if (!container) return;

  container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 20px;">Foglalások betöltése...</p>';

  try {
    const res = await fetch('/api/admin/bookings', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error();
    const bookings = await res.json();
    window.adminBookings = bookings;

    renderAdminBookings();
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p style="color:var(--danger); text-align:center; padding: 20px;">Nem sikerült betölteni a foglalásokat.</p>';
  }
}

function renderAdminBookings() {
  const container = document.getElementById('admin-bookings-list');
  const weekSelector = document.getElementById('admin-bookings-week-selector');
  if (!container || !window.adminBookings) return;

  const weeks = getWeeksData();

  // Render Week Selector Buttons
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
        renderAdminBookings();
      };
      weekSelector.appendChild(btn);
    });
  }

  const activeWeek = weeks[currentSelectedWeekIdx];
  
  // Filter bookings for the active week
  const filteredBookings = window.adminBookings.filter(b => {
    return b.booking_date >= activeWeek.start && b.booking_date <= activeWeek.end;
  });

  container.innerHTML = '';
  if (filteredBookings.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding: 35px; font-size:15px;">Nincs aktív foglalás erre a hétre (${activeWeek.label}).</p>`;
    return;
  }

  // Group bookings by date, then by location name, then by slot time range
  const grouped = {};
  filteredBookings.forEach(b => {
    const date = b.booking_date;
    const loc = b.location_name;
    const slotTime = `${b.start_time.substring(0, 5)} - ${b.end_time.substring(0, 5)}`;

    if (!grouped[date]) grouped[date] = {};
    if (!grouped[date][loc]) grouped[date][loc] = {};
    if (!grouped[date][loc][slotTime]) grouped[date][loc][slotTime] = [];

    grouped[date][loc][slotTime].push(b);
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

    for (const locName in grouped[date]) {
      dateHtml += `
        <div style="margin-top: 15px; margin-bottom: 20px;">
          <div style="font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
            <span style="color: var(--primary);">📍</span> ${locName}
          </div>
      `;

      for (const slotTime in grouped[date][locName]) {
        dateHtml += `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 12px; margin-bottom: 10px; margin-left: 10px;">
            <div style="font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; font-size: 13px; display: flex; align-items: center; gap: 6px;">
              <span style="color: var(--primary); font-size: 11px;">🕒</span> ${slotTime}
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
        `;

        grouped[date][locName][slotTime].forEach(b => {
          dateHtml += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; font-size: 13px;">
              <div>
                <strong style="color: #fff; font-size: 14px;">${b.user_name}</strong> 
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

      dateHtml += `</div>`;
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

// ---------------- INITIALIZATION CHECK ----------------
document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  checkActiveAnnouncement();

  const path = window.location.pathname;
  if (path.endsWith('index.html') || path === '/' || path.endsWith('webpage/')) {
    initPublicLanding();
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
window.openEditUserModal = openEditUserModal;
window.closeEditUserModal = closeEditUserModal;
window.switchUserModalToView = switchUserModalToView;
window.switchUserModalToEdit = switchUserModalToEdit;
window.triggerUserDeleteFromDetails = triggerUserDeleteFromDetails;
window.handleEditUserSubmit = handleEditUserSubmit;
window.deleteUser = deleteUser;
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
window.loadAdminBookings = loadAdminBookings;
window.cancelAdminBooking = cancelAdminBooking;
window.resetScannerAfterSuccess = resetScannerAfterSuccess;
window.toggleCamera = toggleCamera;

