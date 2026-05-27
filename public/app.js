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
      <li><a href="admin.html#news" class="nav-link ${activeClass('admin.html', '#news')}">Üzenőfal</a></li>
      <li><a href="dashboard.html" class="nav-link">Mászói fiók</a></li>
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
        navItems += `<li><a href="dashboard.html" class="nav-link ${isActive('dashboard.html')}">Vezérlőpult</a></li>`;
      } else if (user.role === 'STAFF' || user.role === 'ADMIN') {
        navItems += `
          <li><a href="dashboard.html" class="nav-link ${isActive('dashboard.html')}">Mászói fiók</a></li>
          <li><a href="admin.html" class="nav-link ${isActive('admin.html')}">Adminisztráció</a></li>
          <li><a href="scanner.html" class="nav-link ${isActive('scanner.html')}">Scanner</a></li>
        `;
      }
    }
  }

  let authSection = '';
  let authSectionMobile = '';

  if (token) {
    const tooltipText = user.card_type === 'ZÖLD' ? 
      'Sikeres mászóvizsgával rendelkezik, önállóan biztosíthatja társát a falon.' : 
      'Nem rendelkezik mászóvizsgával. Biztosítóként nem tevékenykedhet, kizárólag önbiztosítóval vagy zöld kártyás kísérővel mászhat.';
    
    const cardBadge = user.role === 'USER' || user.role === 'ADMIN' ? 
      `<span class="badge ${user.card_type === 'ZÖLD' ? 'badge-green' : 'badge-red'}" data-tooltip="${tooltipText}" style="margin-right: 10px;">${user.card_type} KÁRTYA</span>` : '';
    
    authSection = `
      <div class="nav-auth">
        ${cardBadge}
        <span style="font-weight:600; font-size:14px; color:#ffffff; margin-right: 15px;">${user.name}</span>
        <button onclick="logout()" class="btn btn-secondary btn-sm">Kijelentkezés</button>
      </div>
    `;

    authSectionMobile = `
      <div class="nav-auth-mobile">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
          <span style="font-weight:600; font-size:14px; color:#ffffff;">${user.name}</span>
          ${cardBadge}
        </div>
        <button onclick="logout()" class="btn btn-secondary btn-sm" style="width:100%;">Kijelentkezés</button>
      </div>
    `;
  } else {
    authSection = `
      <div class="nav-auth">
        <a href="auth.html" class="btn btn-primary btn-sm">Bejelentkezés</a>
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

function isActive(page) {
  const path = window.location.pathname;
  return path.endsWith(page) ? 'active' : '';
}

// ---------------- PUBLIC LANDING PAGE (INDEX) ----------------
async function initPublicLanding() {
  const video = document.querySelector('.hero-video-bg');
  if (video) {
    video.playbackRate = 0.65;
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

// ---------------- CLIENT DASHBOARD (DASHBOARD) ----------------
async function initDashboard() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = 'auth.html';
    return;
  }

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
    
    // Save count of active tickets
    window.activeTicketsCount = tickets.filter(t => t.status === 'ACTIVE').length;
    
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

    // Render active tickets
    const ticketsContainer = document.getElementById('dashboard-tickets');
    if (ticketsContainer) {
      if (tickets.length === 0) {
        ticketsContainer.innerHTML = '<p style="color:var(--text-muted);">Még nincs megvásárolt aktív jegyed vagy bérleted.</p>';
      } else {
        ticketsContainer.innerHTML = '';
        tickets.forEach(t => {
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

          const isExpired = new Date(t.expires_date) < new Date();
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
            // Async draw large QR code
            setTimeout(() => {
              const largeDiv = document.getElementById(`large-qr-${t.id}`);
              if (largeDiv) {
                if (typeof qrcode !== 'undefined' && qrcode && typeof qrcode.toDataURL === 'function') {
                  const qrUrl = window.location.origin + '/scanner.html?uuid=' + t.qr_code_uuid;
                  qrcode.toDataURL(qrUrl, { width: 100, margin: 1 }, (err, url) => {
                    if (!err) largeDiv.innerHTML = `<img src="${url}" alt="QR" />`;
                  });
                } else {
                  largeDiv.innerHTML = '<span style="font-size:10px;color:var(--danger);">Nincs könyvtár</span>';
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
    }

    // Render bookings
    const bookingsContainer = document.getElementById('dashboard-bookings');
    if (bookingsContainer) {
      if (bookings.length === 0) {
        bookingsContainer.innerHTML = '<p style="color:var(--text-muted);">Nincsenek aktív helyfoglalásaid.</p>';
      } else {
        bookingsContainer.innerHTML = '';
        bookings.forEach(b => {
          const item = document.createElement('div');
          item.className = 'schedule-item';
          item.style.padding = '15px 20px';
          
          item.innerHTML = `
            <div>
              <h4 style="font-size: 16px; margin-bottom: 4px;">${b.location_name}</h4>
              <p style="font-size: 13px; color: var(--text-secondary);">
                Időpont: <strong>${b.booking_date}</strong> | <strong>${b.start_time} - ${b.end_time}</strong>
              </p>
            </div>
            <button onclick="cancelBooking(${b.booking_id})" class="btn btn-danger btn-sm">Lemondás</button>
          `;
          bookingsContainer.appendChild(item);
        });
      }
    }

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
        const today = new Date().toISOString().split('T')[0];
        bookingDate.value = today;
        bookingDate.min = today;
        bookingDate.addEventListener('change', loadBookingSchedules);
      }
    }

  } catch (err) {
    showToast(err.message, 'error');
  }
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

// Buy Ticket Simulation
async function buyTicket(ticketType) {
  try {
    const res = await fetch('/api/tickets/purchase', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ ticketType })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Vásárlási hiba');

    showToast('Sikeres jegyvásárlás! A QR kód és a PDF letölthető.');
    loadProfileAndDashboard();
  } catch (err) {
    showToast(err.message, 'error');
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
let html5QrcodeScanner = null;
let lastScannedUuid = null;

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

  // Only setup camera scanner if there is NO uuid in the URL
  if (!urlUuid) {
    try {
      if (typeof Html5QrcodeScanner !== 'undefined') {
        html5QrcodeScanner = new Html5QrcodeScanner(
          "qr-reader-viewport", 
          { 
            fps: 10, 
            qrbox: 250,
            aspectRatio: 1.0,
            supportedScanTypes: [Html5QrcodeSupportedScanTypes.CAMERA]
          }
        );
        html5QrcodeScanner.render(onScanSuccess, onScanError);
      } else {
        showToast('A QR kód olvasó könyvtár nem töltődött be!', 'error');
      }
    } catch (cameraErr) {
      console.warn('Nem sikerült elindítani a kamerát (lehet, hogy nincs engedély vagy eszköz):', cameraErr);
    }
  } else {
    // If scanning via URL, hide camera scanner viewport or show a helpful message
    const readerViewport = document.getElementById('qr-reader-viewport');
    if (readerViewport) {
      readerViewport.innerHTML = '<p style="text-align:center; padding:15px; color:var(--text-secondary); font-size: 14px;">Kód beolvasva a külső kamerából. Jegy adatok lekérdezése folyamatban...</p>';
    }
  }
}

async function onScanSuccess(decodedText, decodedResult) {
  if (html5QrcodeScanner) {
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

    if (hasLocation) {
      const selectedLocationName = locSelect.options[locSelect.selectedIndex].text;
      const matchingBooking = bookings.find(b => String(b.location_id) === String(selectedLocation));

      const formatTime = (t) => t ? t.substring(0, 5) : '';

      if (matchingBooking) {
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
            <div class="scan-booking-match">
              ✅ Foglalás ma: ${formatTime(matchingBooking.start_time)} - ${formatTime(matchingBooking.end_time)} (${matchingBooking.location_name})
            </div>
          </div>
        `;
      } else if (bookings.length > 0) {
        const otherBooking = bookings[0];
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
            <div class="scan-booking-warning">
              ⚠️ A mászó a ${otherBooking.location_name} mászófalra jelentkezett ma (${formatTime(otherBooking.start_time)} - ${formatTime(otherBooking.end_time)}), de te az ${selectedLocationName} helyszínen olvasod be!
            </div>
          </div>
        `;
      } else {
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
            <div class="scan-booking-error">
              ❌ Nincs mára foglalása ezen a helyszínen!
            </div>
          </div>
        `;
      }
    } else {
      // No location selected yet
      const formatTime = (t) => t ? t.substring(0, 5) : '';
      if (bookings.length > 0) {
        const bookingList = bookings.map(b => `${formatTime(b.start_time)} - ${formatTime(b.end_time)} (${b.location_name})`).join(', ');
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Mai foglalások</div>
            <div style="font-size:13px; color:var(--text-secondary);">
              Mára foglalva: ${bookingList} (Válassz helyszínt a fejlécben az ellenőrzéshez)
            </div>
          </div>
        `;
      } else {
        bookingInfoHtml = `
          <div class="scan-booking-info">
            <div class="scan-booking-title">Mai foglalás ellenőrzése</div>
            <div style="font-size:13px; color:var(--text-secondary);">
              Nincs mára foglalása. (Válassz helyszínt a fejlécben az ellenőrzéshez)
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
        <button id="confirm-checkin-btn" onclick="processCheckIn('${ticket.qr_code_uuid}')" class="btn btn-primary" style="margin-top: 20px; width: 100%;" data-ticket-valid="${isValid}" ${hasLocation ? '' : 'disabled'}>
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

async function processCheckIn(uuid) {
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

    resultCard.innerHTML = `
      <div class="scan-status-indicator scan-status-valid">
        <span>✅</span>
        <span>Sikeres Beléptetés!</span>
      </div>
      
      <p style="font-size:16px; font-weight:700; margin: 25px 0; color: var(--success); text-align: center;">${message}</p>

      <div class="scan-details-grid" style="margin-bottom: 20px;">
        <div class="scan-detail-item">
          <div class="scan-detail-label">Mászó neve</div>
          <div class="scan-detail-value">${climber.name || 'Ismeretlen'}</div>
        </div>
        <div class="scan-detail-item">
          <div class="scan-detail-label">Új Egyenleg</div>
          <div class="scan-detail-value">${sessionsVal}</div>
        </div>
      </div>

      <button onclick="resetScannerUI()" class="btn btn-primary" style="margin-top: 15px; width: 100%;">Kész / Új beolvasás</button>
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

    const daysHungarian = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szomb'];

    list.innerHTML = '';
    
    // Group slots by location and day
    const grouped = {};
    slots.forEach(s => {
      const locKey = s.location_name;
      if (!grouped[locKey]) grouped[locKey] = {};
      
      const dayName = daysHungarian[s.day_of_week];
      if (!grouped[locKey][dayName]) grouped[locKey][dayName] = [];
      
      grouped[locKey][dayName].push(s);
    });

    for (const locName in grouped) {
      const locDiv = document.createElement('div');
      locDiv.style.marginBottom = '30px';
      
      let daysHtml = '';
      for (const dayName in grouped[locName]) {
        let slotItemsHtml = '';
        grouped[locName][dayName].forEach(s => {
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
