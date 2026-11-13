const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const qrcode = require('qrcode');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'hawkstone-secret-key-2026-super-secure';

// Barion configuration (strip any inline # comments or trailing whitespace from .env)
const cleanEnvValue = (val) => (val ? String(val).split('#')[0].trim() : '');
const BARION_POS_KEY = cleanEnvValue(process.env.BARION_POS_KEY);
const BARION_PAYEE_EMAIL = cleanEnvValue(process.env.BARION_PAYEE_EMAIL);
const BARION_ENV_CLEAN = cleanEnvValue(process.env.BARION_ENVIRONMENT).toLowerCase();
// Strictly use Barion Sandbox (https://api.test.barion.com) unless BARION_ENVIRONMENT is explicitly 'production'
const BARION_BASE_URL = BARION_ENV_CLEAN === 'production'
  ? 'https://api.barion.com'
  : 'https://api.test.barion.com';

// Translate Barion API errors into clear, actionable Hungarian messages
function formatBarionErrorMessage(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return 'Ismeretlen Barion hiba történt.';
  const first = errors[0] || {};
  const code = first.ErrorCode || '';
  const title = first.Title || 'Barion hiba';
  const desc = first.Description || '';

  if (code === 'ShopIsInDraftState') {
    return 'A Barion elfogadóhely (bolt) még "Piszkozat" (Draft) státuszban van a Barion fiókban. Nyisd meg a test.barion.com tárcádat, és véglegesítsd / hagyd jóvá a teszt boltot!';
  }
  if (code === 'AuthenticationFailed' || title.includes('User authentication failed')) {
    return 'Barion Sandbox hitelesítési hiba (User authentication failed): A .env fájlban megadott BARION_POS_KEY vagy BARION_PAYEE_EMAIL az éles (barion.com) fiókhoz tartozik, nem a teszt (https://test.barion.com) homokozóhoz! Kérjük, lépj be a https://test.barion.com oldalra, és az ottani teszt bolt POSKey kulcsát írd be a .env-be!';
  }
  return desc ? `${title} (${desc})` : title;
}


// SMTP Transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: parseInt(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Log every 5xx response with method + URL (helps pinpointing "500 Internal Server Error" in the browser console)
app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      console.error(`[HTTP ${res.statusCode}] ${req.method} ${req.originalUrl}`);
    }
  });
  next();
});
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Subdomain Routing & SEO / AI Crawler Middleware for hawkstone.hu and klub.hawkstone.hu
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  const isClubSubdomain = host.startsWith('klub.') || host.startsWith('maszoklub.') || host.startsWith('foglalas.');
  const reqPath = req.path || '/';

  // Security & Trust Headers (HSTS, XFO, COOP, nosniff) for Lighthouse Best Practices
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Private pages: prevent search & AI indexing
  if (reqPath === '/admin.html' || reqPath === '/webadmin.html' || reqPath === '/webadmin' || reqPath === '/scanner.html' || reqPath === '/dashboard.html') {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  } else if (reqPath === '/' || reqPath.endsWith('.html')) {
    res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
  }

  // Ensure UTF-8 content-type for .txt AI fact files (llms.txt, robots.txt, IndexNow key)
  if (reqPath.endsWith('.txt')) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }

  if (isClubSubdomain) {
    // If root or index.html is requested on the club subdomain, serve the club page
    if (reqPath === '/' || reqPath === '/index.html') {
      return res.sendFile(path.join(__dirname, 'public', 'klub.html'));
    }
    // Subdomain-specific robots.txt, sitemap.xml, and AI RAG fact libraries (llms.txt / llms-full.txt)
    if (reqPath === '/robots.txt') {
      return res.sendFile(path.join(__dirname, 'public', 'robots-klub.txt'));
    }
    if (reqPath === '/sitemap.xml') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.sendFile(path.join(__dirname, 'public', 'sitemap-klub.xml'));
    }
    if (reqPath === '/llms.txt') {
      return res.sendFile(path.join(__dirname, 'public', 'llms-klub.txt'));
    }
    if (reqPath === '/llms-full.txt') {
      return res.sendFile(path.join(__dirname, 'public', 'llms-klub-full.txt'));
    }
  } else if (reqPath === '/klub.html' || reqPath === '/maszoklub.html') {
    // When accessed as https://hawkstone.hu/klub.html, rewrite canonical & og:url dynamically so both hawkstone.hu/klub.html and klub.hawkstone.hu/ have accurate self-referential URLs
    try {
      const fileName = reqPath === '/maszoklub.html' ? 'maszoklub.html' : 'klub.html';
      let html = fs.readFileSync(path.join(__dirname, 'public', fileName), 'utf8');
      const targetUrl = `https://hawkstone.hu/${fileName}`;
      html = html
        .replace('<link rel="canonical" href="https://klub.hawkstone.hu/">', `<link rel="canonical" href="${targetUrl}">`)
        .replace('<link rel="alternate" hreflang="hu" href="https://klub.hawkstone.hu/">', `<link rel="alternate" hreflang="hu" href="${targetUrl}">`)
        .replace('<link rel="alternate" hreflang="hu-HU" href="https://klub.hawkstone.hu/">', `<link rel="alternate" hreflang="hu-HU" href="${targetUrl}">`)
        .replace('<link rel="alternate" hreflang="x-default" href="https://klub.hawkstone.hu/">', `<link rel="alternate" hreflang="x-default" href="${targetUrl}">`)
        .replace('<meta property="og:url" content="https://klub.hawkstone.hu/">', `<meta property="og:url" content="${targetUrl}">`)
        .replace('<meta name="twitter:url" content="https://klub.hawkstone.hu/">', `<meta name="twitter:url" content="${targetUrl}">`);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (e) {
      // Fallback to static file
    }
  }
  next();
});

// IndexNow API Endpoint for instant Bing, Yandex & Copilot indexing (main site + club site)
const INDEXNOW_KEY = 'hawkstone2026indexnowkey';
app.all('/api/seo/indexnow', async (req, res) => {
  const mainUrls = [
    'https://hawkstone.hu/',
    'https://hawkstone.hu/maszofalaink.html',
    'https://hawkstone.hu/referenciak.html',
    'https://hawkstone.hu/iso9001.html',
    'https://hawkstone.hu/kapcsolat.html',
    'https://hawkstone.hu/klub.html',
    'https://hawkstone.hu/szabalyzat.html',
    'https://hawkstone.hu/llms.txt',
    'https://hawkstone.hu/llms-full.txt'
  ];
  const clubUrls = [
    'https://klub.hawkstone.hu/',
    'https://klub.hawkstone.hu/szabalyzat.html',
    'https://klub.hawkstone.hu/auth.html',
    'https://klub.hawkstone.hu/llms.txt',
    'https://klub.hawkstone.hu/llms-full.txt'
  ];
  const results = [];
  for (const payload of [
    { host: 'hawkstone.hu', key: INDEXNOW_KEY, keyLocation: `https://hawkstone.hu/${INDEXNOW_KEY}.txt`, urlList: mainUrls },
    { host: 'klub.hawkstone.hu', key: INDEXNOW_KEY, keyLocation: `https://klub.hawkstone.hu/${INDEXNOW_KEY}.txt`, urlList: clubUrls }
  ]) {
    try {
      const r = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload)
      });
      results.push({ host: payload.host, status: r.status, ok: r.ok });
    } catch (err) {
      results.push({ host: payload.host, error: err.message });
    }
  }
  return res.json({ success: true, key: INDEXNOW_KEY, results });
});

app.use(express.static(path.join(__dirname, 'public')));

// Database connection
let dbClient;
let isCloudDB = false;
let localDb = null;

if (process.env.DATABASE_URL) {
  try {
    const { createClient } = require('@libsql/client');
    let url = process.env.DATABASE_URL;
    if (url.startsWith('libsql://')) {
      url = url.replace('libsql://', 'https://');
    }
    dbClient = createClient({
      url: url,
      authToken: process.env.DATABASE_AUTH_TOKEN || ''
    });
    isCloudDB = true;
    console.log('[DATABASE] Connecting to cloud database (Turso) via HTTP...');
  } catch (err) {
    console.error('[DATABASE ERROR] Failed to load libSQL client. Falling back to local SQLite...', err);
  }
}

if (!isCloudDB) {
  if (process.env.VERCEL) {
    console.warn('[DATABASE] Running on Vercel but DATABASE_URL is not set! Database queries will fail.');
  } else {
    const dbPath = path.join(__dirname, 'database.db');
    localDb = new sqlite3.Database(dbPath);
    console.log('[DATABASE] Connecting to local database.db (SQLite3)...');
  }
}

// Database helpers supporting both local SQLite and Turso (libSQL)
const dbRun = async (sql, params = []) => {
  if (isCloudDB) {
    const result = await dbClient.execute({ sql, args: params });
    return {
      lastID: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : null,
      changes: result.rowsAffected
    };
  } else {
    if (!localDb) {
      throw new Error('Adatbázis nincs konfigurálva ezen a környezeten.');
    }
    return new Promise((resolve, reject) => {
      localDb.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }
};

const dbAll = async (sql, params = []) => {
  if (isCloudDB) {
    const result = await dbClient.execute({ sql, args: params });
    return result.rows;
  } else {
    if (!localDb) {
      throw new Error('Adatbázis nincs konfigurálva ezen a környezeten.');
    }
    return new Promise((resolve, reject) => {
      localDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
};

const dbGet = async (sql, params = []) => {
  if (isCloudDB) {
    const result = await dbClient.execute({ sql, args: params });
    return result.rows[0] || null;
  } else {
    if (!localDb) {
      throw new Error('Adatbázis nincs konfigurálva ezen a környezeten.');
    }
    return new Promise((resolve, reject) => {
      localDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
};

// Initialize database schema
async function initDB() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      license_number TEXT,
      card_type TEXT DEFAULT 'PIROS',
      role TEXT DEFAULT 'USER',
      is_verified INTEGER DEFAULT 0,
      verification_token TEXT,
      must_change_password INTEGER DEFAULT 0,
      billing_name TEXT,
      billing_zip TEXT,
      billing_city TEXT,
      billing_address TEXT,
      billing_tax_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: Add must_change_password column if it doesn't exist on existing DBs
  try {
    await dbRun("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0");
    console.log("[DATABASE MIGRATION] Added column 'must_change_password' to 'users' table.");
  } catch (err) {
    // Ignore error if column already exists
  }

  // Migration: Add billing columns if they don't exist
  const billingColumns = [
    { name: 'billing_name', type: 'TEXT' },
    { name: 'billing_zip', type: 'TEXT' },
    { name: 'billing_city', type: 'TEXT' },
    { name: 'billing_address', type: 'TEXT' },
    { name: 'billing_tax_number', type: 'TEXT' }
  ];
  for (const col of billingColumns) {
    try {
      await dbRun(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
      console.log(`[DATABASE MIGRATION] Added column '${col.name}' to 'users' table.`);
    } catch (err) {
      // Ignore error if column already exists
    }
  }

  // Migration: Add partner school columns to users table
  const schoolColumns = [
    { name: 'school_role', type: "TEXT DEFAULT 'NONE'" },
    { name: 'school_name', type: 'TEXT' },
    { name: 'school_id_number', type: 'TEXT' },
    { name: 'school_discount_verified', type: 'INTEGER DEFAULT 0' },
    { name: 'school_discount_verified_until', type: 'TEXT' },
    { name: 'school_discount_verified_by', type: 'TEXT' },
    { name: 'school_discount_verified_at', type: 'TEXT' }
  ];
  for (const col of schoolColumns) {
    try {
      await dbRun(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
      console.log(`[DATABASE MIGRATION] Added column '${col.name}' to 'users' table.`);
    } catch (err) {
      // Ignore error if column already exists
    }
  }

  // Reset expired school verifications (past October 31 of their validity year)
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    await dbRun(
      "UPDATE users SET school_discount_verified = 0 WHERE school_discount_verified = 1 AND school_discount_verified_until IS NOT NULL AND school_discount_verified_until < ?",
      [todayStr]
    );
  } catch (err) {
    // Ignore error
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      address TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 15
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      max_capacity INTEGER NOT NULL DEFAULT 15,
      FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      slot_id INTEGER NOT NULL,
      booking_date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(slot_id) REFERENCES slots(id) ON DELETE CASCADE,
      UNIQUE(user_id, slot_id, booking_date)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ticket_type TEXT NOT NULL,
      purchase_date TEXT NOT NULL,
      expires_date TEXT NOT NULL,
      sessions_remaining INTEGER DEFAULT 0,
      qr_code_uuid TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'ACTIVE',
      payment_id TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add payment_id column to tickets table if it doesn't exist on existing DBs
  try {
    await dbRun("ALTER TABLE tickets ADD COLUMN payment_id TEXT");
    console.log("[DATABASE MIGRATION] Added column 'payment_id' to 'tickets' table.");
  } catch (err) {
    // Ignore error if column already exists
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS entry_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      scan_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      location_id INTEGER,
      status TEXT NOT NULL,
      message TEXT,
      staff_id INTEGER,
      staff_name TEXT,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add staff columns and indexes to entry_logs
  try {
    await dbRun("ALTER TABLE entry_logs ADD COLUMN staff_id INTEGER");
  } catch (err) {}
  try {
    await dbRun("ALTER TABLE entry_logs ADD COLUMN staff_name TEXT");
  } catch (err) {}
  try {
    await dbRun("ALTER TABLE entry_logs ADD COLUMN staff_email TEXT");
  } catch (err) {}

  await dbRun("CREATE INDEX IF NOT EXISTS idx_entry_logs_ticket ON entry_logs(ticket_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_entry_logs_scan_time ON entry_logs(scan_time)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_entry_logs_staff ON entry_logs(staff_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_entry_logs_location ON entry_logs(location_id)");

  // Migration: Add heads_count, booking_type, adult_count, child_count to bookings table
  try {
    await dbRun("ALTER TABLE bookings ADD COLUMN heads_count INTEGER DEFAULT 1");
  } catch (err) {}
  try {
    await dbRun("ALTER TABLE bookings ADD COLUMN booking_type TEXT DEFAULT 'SELF'");
  } catch (err) {}
  try {
    await dbRun("ALTER TABLE bookings ADD COLUMN adult_count INTEGER DEFAULT 1");
  } catch (err) {}
  try {
    await dbRun("ALTER TABLE bookings ADD COLUMN child_count INTEGER DEFAULT 0");
  } catch (err) {}

  await dbRun("CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_withdrawals_time ON withdrawals(withdrawal_time)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(refund_status)");

  await dbRun(`
    CREATE TABLE IF NOT EXISTS slot_cancellations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL,
      cancelled_date TEXT NOT NULL,
      FOREIGN KEY(slot_id) REFERENCES slots(id) ON DELETE CASCADE,
      UNIQUE(slot_id, cancelled_date)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      is_active INTEGER DEFAULT 0,
      target TEXT DEFAULT 'club',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbRun("ALTER TABLE announcements ADD COLUMN target TEXT DEFAULT 'club'").catch(() => {});

  await dbRun(`
    CREATE TABLE IF NOT EXISTS barion_payments (
      payment_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      ticket_type TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed INTEGER DEFAULT 0,
      invoice_number TEXT,
      billing_name TEXT,
      billing_zip TEXT,
      billing_city TEXT,
      billing_address TEXT,
      billing_tax_number TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Migrate existing barion_payments table - add columns if missing
  try {
    await dbRun("ALTER TABLE barion_payments ADD COLUMN invoice_number TEXT");
    console.log("[DATABASE MIGRATION] Added column 'invoice_number' to 'barion_payments' table.");
  } catch (_) { /* column already exists */ }
  try {
    await dbRun("ALTER TABLE barion_payments ADD COLUMN billing_name TEXT");
  } catch (_) {}
  try {
    await dbRun("ALTER TABLE barion_payments ADD COLUMN billing_zip TEXT");
  } catch (_) {}
  try {
    await dbRun("ALTER TABLE barion_payments ADD COLUMN billing_city TEXT");
  } catch (_) {}
  try {
    await dbRun("ALTER TABLE barion_payments ADD COLUMN billing_address TEXT");
  } catch (_) {}
  try {
    await dbRun("ALTER TABLE barion_payments ADD COLUMN billing_tax_number TEXT");
  } catch (_) {}
  try {
    await dbRun("ALTER TABLE barion_payments ADD COLUMN quantity INTEGER DEFAULT 1");
  } catch (_) {}

  await dbRun(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      ticket_id INTEGER NOT NULL,
      ticket_type TEXT NOT NULL,
      purchase_date TEXT NOT NULL,
      sessions_remaining INTEGER DEFAULT 0,
      withdrawal_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'PROCESSED',
      refund_status TEXT DEFAULT 'PENDING',
      admin_note TEXT DEFAULT '',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

  // Migrate existing withdrawals table – add columns if missing
  try {
    await dbRun("ALTER TABLE withdrawals ADD COLUMN refund_status TEXT DEFAULT 'PENDING'");
  } catch (_) { /* column already exists */ }
  try {
    await dbRun("ALTER TABLE withdrawals ADD COLUMN admin_note TEXT DEFAULT ''");
  } catch (_) { /* column already exists */ }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS gallery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL DEFAULT 'references',
      city TEXT NOT NULL,
      name TEXT NOT NULL,
      alt TEXT NOT NULL,
      filename TEXT NOT NULL,
      image_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS site_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS wall_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL DEFAULT 'iskolai',
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      height TEXT NOT NULL,
      width TEXT NOT NULL,
      surface TEXT NOT NULL,
      anchor_points TEXT DEFAULT '',
      filename TEXT NOT NULL,
      image_data TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const wallSeeded = await dbGet('SELECT setting_value FROM site_settings WHERE setting_key = ?', ['wall_products_seeded']);
  if (!wallSeeded) {
    const existingWallsCount = await dbGet('SELECT COUNT(*) as count FROM wall_products');
    if (!existingWallsCount || existingWallsCount.count === 0) {
      const defaultWalls = [
        { category: 'iskolai', code: 'M1104', title: 'Iskolai Mászófal', height: '6 m', width: '3 m', surface: 'kb. 24 m²', anchor_points: '', filename: 'fal1-1.jpg', sort_order: 1 },
        { category: 'iskolai', code: 'M1106', title: 'Iskolai Mászófal', height: '6 m', width: '3 m', surface: 'kb. 24 m²', anchor_points: '', filename: 'fal2-1.jpg', sort_order: 2 },
        { category: 'iskolai', code: 'M1105', title: 'Iskolai Mászófal', height: '3 m', width: '6 m', surface: 'kb. 28 m²', anchor_points: '', filename: 'fal3-1.jpg', sort_order: 3 },
        { category: 'boulder', code: 'M1101', title: 'Boulder mászófal', height: '3 m', width: '6 m', surface: 'kb. 22 m²', anchor_points: '', filename: 'fal5-1.jpg', sort_order: 4 },
        { category: 'boulder', code: 'M1102', title: 'Boulder mászófal', height: '3 m', width: '6 m', surface: 'kb. 20 m²', anchor_points: '', filename: 'fal6-1.jpg', sort_order: 5 },
        { category: 'boulder', code: 'M1103', title: 'Boulder mászófal', height: '3 m', width: '8 m', surface: 'kb. 32 m²', anchor_points: '', filename: 'fal7-1.jpg', sort_order: 6 },
        { category: 'jatszoter', code: 'M1109', title: 'Játszótéri kültéri mászófal', height: '3 m', width: '1,5 - 1,5 - 1,5 m', surface: 'kb. 11 m²', anchor_points: '', filename: 'fal4-1.jpg', sort_order: 7 },
        { category: 'egyeb', code: 'M1107', title: 'Mászófal', height: '8,8 m', width: '9,8 m', surface: 'kb. 101 m²', anchor_points: '6 db', filename: 'fal8-1.jpg', sort_order: 8 },
        { category: 'egyeb', code: 'M1108', title: 'Mászófal', height: '6 m', width: '5 m', surface: 'kb. 58 m²', anchor_points: '5 db', filename: 'fal9-1.jpg', sort_order: 9 }
      ];
      for (const w of defaultWalls) {
        await dbRun(
          'INSERT INTO wall_products (category, code, title, height, width, surface, anchor_points, filename, image_data, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [w.category, w.code, w.title, w.height, w.width, w.surface, w.anchor_points, w.filename, '', w.sort_order]
        );
      }
    }
    await dbRun("INSERT INTO site_settings (setting_key, setting_value) VALUES ('wall_products_seeded', '1')");
  }

  // Seed Homepage Wall Types if not yet seeded
  const wallTypesSeeded = await dbGet('SELECT setting_value FROM site_settings WHERE setting_key = ?', ['wall_types_seeded']);
  if (!wallTypesSeeded) {
    const existingWallTypes = await dbGet('SELECT setting_value FROM site_settings WHERE setting_key = ?', ['home_wall_types']);
    if (!existingWallTypes || !existingWallTypes.setting_value) {
      const defaultTypesJson = JSON.stringify(DEFAULT_HOME_WALL_TYPES);
      await dbRun('INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)', ['home_wall_types', defaultTypesJson]);
    }
    await dbRun("INSERT INTO site_settings (setting_key, setting_value) VALUES ('wall_types_seeded', '1')");
  }

  // Seed Locations
  const locationsCount = await dbGet('SELECT COUNT(*) as count FROM locations');
  if (locationsCount.count === 0) {
    await dbRun("INSERT INTO locations (name, address, capacity) VALUES ('Eötvös mászófal', 'Nyíregyháza, Eötvös u. 12.', 15)");
    await dbRun("INSERT INTO locations (name, address, capacity) VALUES ('Kossuth mászófal', 'Nyíregyháza, Kossuth u. 56.', 15)");
    await dbRun("INSERT INTO locations (name, address, capacity) VALUES ('Zrínyi boulder fal', 'Nyíregyháza, Zrínyi u. 34.', 15)");

    // Seed default slots
    // 0: Sunday, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
    // Eötvös (location 1)
    for (let day = 0; day <= 6; day++) {
      if (day === 0 || day === 6) {
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (1, ?, '09:00', '12:00', 15)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (1, ?, '13:00', '16:00', 15)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (1, ?, '16:00', '19:00', 15)", [day]);
      } else {
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (1, ?, '10:00', '12:30', 15)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (1, ?, '14:00', '16:30', 15)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (1, ?, '17:00', '19:30', 15)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (1, ?, '19:30', '22:00', 15)", [day]);
      }
    }

    // Kossuth (location 2)
    for (let day = 0; day <= 6; day++) {
      if (day === 0 || day === 6) {
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (2, ?, '10:00', '13:00', 15)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (2, ?, '14:00', '17:00', 15)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (2, ?, '17:00', '20:00', 15)", [day]);
      } else {
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (2, ?, '14:00', '16:30', 15)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (2, ?, '17:00', '19:30', 15)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (2, ?, '19:30', '22:00', 15)", [day]);
      }
    }

    // Zrínyi (location 3)
    for (let day = 0; day <= 6; day++) {
      if (day === 0 || day === 6) {
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (3, ?, '10:00', '13:00', 12)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (3, ?, '14:00', '17:00', 12)", [day]);
      } else {
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (3, ?, '15:00', '17:30', 12)", [day]);
        await dbRun("INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (3, ?, '18:00', '20:30', 12)", [day]);
      }
    }
  }

  // Seed default users
  const usersCount = await dbGet('SELECT COUNT(*) as count FROM users');
  if (usersCount.count === 0) {
    const adminHash = await bcrypt.hash('HaW%s69T?', 10);
    const staffHash = await bcrypt.hash('staffhawk', 10);
    const zoldHash = await bcrypt.hash('zoldhawk', 10);
    const pirosHash = await bcrypt.hash('piroshawk', 10);

    await dbRun("INSERT INTO users (name, email, phone, password_hash, license_number, card_type, role, is_verified) VALUES ('Admin Főnök', 'admin@hawkstone.hu', '06201112222', ?, 'SMV-00001', 'ZÖLD', 'ADMIN', 1)", [adminHash]);
    await dbRun("INSERT INTO users (name, email, phone, password_hash, license_number, card_type, role, is_verified) VALUES ('Mászómester Staff', 'staff@hawkstone.hu', '06301112222', ?, 'SMV-00002', 'ZÖLD', 'STAFF', 1)", [staffHash]);
    await dbRun("INSERT INTO users (name, email, phone, password_hash, license_number, card_type, role, is_verified) VALUES ('Kovács Péter (Zöld)', 'zold@hawkstone.hu', '06703334444', ?, 'SMV-99887', 'ZÖLD', 'USER', 1)", [zoldHash]);
    await dbRun("INSERT INTO users (name, email, phone, password_hash, license_number, card_type, role, is_verified) VALUES ('Szabó Anna (Piros)', 'piros@hawkstone.hu', '06704445555', ?, '', 'PIROS', 'USER', 1)", [pirosHash]);
  }
}

// Ensure admin user password is updated to new credentials
async function updateAdminCredentials() {
  try {
    const adminHash = await bcrypt.hash('HaW%s69T?', 10);
    await dbRun("UPDATE users SET password_hash = ? WHERE email = 'admin@hawkstone.hu' OR role LIKE '%ADMIN%'", [adminHash]);
    console.log('[DB MIGRATION] Updated admin password hash.');
  } catch (e) {
    console.error('[DB MIGRATION] Admin credentials update failed:', e.message);
  }
}

// Migrate existing phone numbers from 06... to +36... format
async function migratePhoneNumbers() {
  try {
    const users = await dbAll("SELECT id, phone FROM users WHERE phone LIKE '06%'");
    for (const u of users) {
      const newPhone = '+36' + u.phone.slice(2);
      await dbRun('UPDATE users SET phone = ? WHERE id = ?', [newPhone, u.id]);
    }
    if (users.length > 0) {
      console.log(`[DB MIGRATION] Converted ${users.length} phone number(s) from 06 to +36 format.`);
    }
  } catch (e) {
    console.error('[DB MIGRATION] Phone normalization failed:', e.message);
  }
}

// Ensure checkout & temporary booking columns exist in both local SQLite and Vercel Turso DB
let checkoutSchemaEnsured = false;
async function ensureCheckoutSchema() {
  if (checkoutSchemaEnsured) return;
  const migrations = [
    "ALTER TABLE barion_payments ADD COLUMN child_quantity INTEGER DEFAULT 0",
    "ALTER TABLE barion_payments ADD COLUMN temp_booking_id INTEGER",
    "ALTER TABLE barion_payments ADD COLUMN companion_type TEXT",
    "ALTER TABLE barion_payments ADD COLUMN companion_quantity INTEGER DEFAULT 0",
    "ALTER TABLE bookings ADD COLUMN status TEXT DEFAULT 'CONFIRMED'",
    "ALTER TABLE bookings ADD COLUMN payment_id TEXT",
    "ALTER TABLE bookings ADD COLUMN temp_expires_at DATETIME"
  ];
  for (const sql of migrations) {
    try {
      await dbRun(sql);
    } catch (_) {
      // Column already exists
    }
  }
  checkoutSchemaEnsured = true;
}

async function cleanupExpiredTempBookings() {
  try {
    await ensureCheckoutSchema();
    await dbRun(
      "DELETE FROM bookings WHERE status = 'PENDING' AND temp_expires_at IS NOT NULL AND temp_expires_at < datetime('now')"
    );
  } catch (e) {
    // Ignore if table not ready yet
  }
}

// Bypassing database initializations and migrations on Vercel
// since it runs in a serverless environment where DB schema is already migrated in the cloud
if (!process.env.VERCEL) {
  initDB().then(() => ensureCheckoutSchema()).then(() => updateAdminCredentials()).catch(console.error);
  migratePhoneNumbers();
} else {
  ensureCheckoutSchema().catch(() => {});
}

// Helper function to generate unique QR string
function generateUUID() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// ---------------- MIDDLEWARE ----------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Bejelentkezés szükséges!' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Érvénytelen vagy lejárt token!' });
    req.user = user;
    next();
  });
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ error: 'Nincs jogosultságod ehhez a művelethez!' });
    }
    const userRoleStr = (req.user.role || 'USER').toUpperCase();
    const userRoles = userRoleStr.split(',').map(r => r.trim());
    // Ha a felhasználó ADMIN jogosultsággal rendelkezik, mindenhez hozzáfér
    if (userRoles.includes('ADMIN')) {
      return next();
    }
    const hasAccess = roles.some(r => userRoles.includes(r.toUpperCase()));
    if (!hasAccess) {
      return res.status(403).json({ error: 'Nincs jogosultságod ehhez a művelethez!' });
    }
    next();
  };
}

// ---------------- AUTH ROUTES ----------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password, licenseNumber, schoolRole, schoolName, schoolIdNumber } = req.body;
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'Minden mező kitöltése kötelező!' });
    }

    // Server-Side Password Complexity check (aligned with client-side pattern)
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: 'A jelszó nem felel meg a biztonsági követelményeknek! Legalább 8 karakter, kisbetű, nagybetű, szám és speciális karakter szükséges.' });
    }

    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Ez az email cím már regisztrálva van!' });
    }

    const cardType = (licenseNumber && licenseNumber.trim().length > 0) ? 'ZÖLD' : 'PIROS';
    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = generateUUID();

    // Normalize phone: convert 06... to +36... if needed
    let normalizedPhone = phone.trim();
    if (normalizedPhone.startsWith('06')) {
      normalizedPhone = '+36' + normalizedPhone.slice(2);
    }

    // Normalize partner school details
    const validRoles = ['NONE', 'STUDENT', 'TEACHER'];
    const cleanSchoolRole = validRoles.includes(schoolRole) ? schoolRole : 'NONE';
    let cleanSchoolName = (schoolName || '').trim();
    if (cleanSchoolRole === 'NONE') {
      cleanSchoolName = '';
    }
    const cleanSchoolId = (schoolIdNumber || '').trim();

    await dbRun(
      'INSERT INTO users (name, email, phone, password_hash, license_number, card_type, is_verified, verification_token, school_role, school_name, school_id_number, school_discount_verified) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0)',
      [name, email, normalizedPhone, passwordHash, licenseNumber || '', cardType, verificationToken, cleanSchoolRole, cleanSchoolName, cleanSchoolId]
    );

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const domain = `${protocol}://${host}`;
    const activationLink = `${domain}/api/auth/verify?token=${verificationToken}`;

    // Send real SMTP email synchronously in serverless to ensure it is not frozen before sending
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || `"HawkStone" <noreply@hawkstone.hu>`,
          to: email,
          subject: 'HawkStone Regisztráció Aktiválás',
          text: `Kedves ${name}!\n\nKöszönjük regisztrációdat a HawkStone Városi Mászóklubban.\n\nA fiókod aktiválásához kattints az alábbi linkre:\n${activationLink}\n\nÜdvözlettel,\nHawkStone Csapata`,
          html: `
            <div style="font-family: 'Inter', sans-serif; background-color: #0c0e17; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.08);">
              <img src="cid:mail_header_image" alt="HawkStone" style="width: 100%; max-width: 600px; display: block; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #ff6b00; font-family: 'Outfit', sans-serif; margin-bottom: 15px; text-align: center;">Kedves ${name}!</h2>
              <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; text-align: center;">Köszönjük regisztrációdat a <strong>HawkStone Városi Mászóklubban</strong>.</p>
              <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; margin-bottom: 25px; text-align: center;">A fiókod aktiválásához és a belépéshez kérjük, kattints az alábbi gombra:</p>
              <div style="text-align: center; margin-bottom: 30px;">
                <a href="${activationLink}" style="background: linear-gradient(135deg, #ff6b00 0%, #ff8c00 100%); color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; box-shadow: 0 4px 15px rgba(255, 107, 0, 0.4);">Fiók Aktiválása</a>
              </div>
              <p style="font-size: 13px; color: #64748b; text-align: center;">Ha a fenti gomb nem működik, másold be ezt a linket a böngésződbe:<br><a href="${activationLink}" style="color: #ff6b00; text-decoration: none;">${activationLink}</a></p>
              <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 25px 0;">
              <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">Üdvözlettel,<br><strong>HawkStone Csapata</strong></p>
            </div>
          `,
          attachments: [{
            filename: 'mail_header.png',
            path: path.join(__dirname, 'public', 'pictures', 'letter', 'mail_header.png'),
            cid: 'mail_header_image'
          }]
        });
        console.log(`[EMAIL] Actual activation email sent successfully to ${email}`);
      } catch (mailError) {
        console.error('[EMAIL ERROR] Failed to send email via SMTP, logging fallback link instead:', mailError);
        console.log(`\n==================================================`);
        console.log(`[EMAIL MOCK FALLBACK] Verification email sent to: ${email}`);
        console.log(`Link: ${activationLink}`);
        console.log(`==================================================\n`);
      }
    } else {
      console.log(`\n==================================================`);
      console.log(`[EMAIL MOCK] Verification email sent to: ${email}`);
      console.log(`Subject: HawkStone Regisztráció Aktiválás`);
      console.log(`Link: ${activationLink}`);
      console.log(`==================================================\n`);
    }

    res.status(201).json({ message: 'Regisztráció sikeres! Megerősítő e-mailt küldtünk az aktiválási linkkel.' });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a regisztráció során: ' + error.message });
  }
});


// Verification Endpoint
app.get('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send('Hiányzó aktivációs token!');
    }

    const user = await dbGet('SELECT id FROM users WHERE verification_token = ?', [token]);
    if (!user) {
      return res.status(400).send('Érvénytelen vagy lejárt aktivációs token!');
    }

    await dbRun('UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?', [user.id]);
    
    // Redirect to login page with verified parameter
    res.redirect('/auth.html?verified=true');
  } catch (error) {
    res.status(500).send('Aktiválási hiba: ' + error.message);
  }
});

function generateTempPassword() {
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const numbers = "23456789";
  const special = "!@#$%^&*";
  let pass = "";
  // Ensure at least one of each to meet complexity requirements
  pass += lowercase[Math.floor(Math.random() * lowercase.length)];
  pass += uppercase[Math.floor(Math.random() * uppercase.length)];
  pass += numbers[Math.floor(Math.random() * numbers.length)];
  pass += special[Math.floor(Math.random() * special.length)];
  
  const all = lowercase + uppercase + numbers + special;
  for (let i = 0; i < 6; i++) {
    pass += all[Math.floor(Math.random() * all.length)];
  }
  // Shuffle the password
  return pass.split('').sort(() => 0.5 - Math.random()).join('');
}

// ---------------- KAPCSOLATI ŰRLAP ----------------
const CONTACT_RECIPIENT = process.env.CONTACT_TO || 'gava.tibor74@gmail.com';
const contactRateMap = new Map(); // ip -> [timestamps]
const contactEmailMap = new Map();   // email -> [timestamps]
const contactHashMap = new Map();    // üzenet hash -> timestamp (duplikáció ellen)
const contactUsedNonces = new Map(); // felhasznált tokenek (egyszer használatos)
const contactGlobalLog = [];         // összes elfogadott üzenet időpontja
const CONTACT_SECRET = process.env.CONTACT_SECRET || (JWT_SECRET + '-contact-form');
const CONTACT_MIN_AGE_MS = 4000;              // ennél gyorsabban ember nem tölti ki
const CONTACT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // a token 2 óráig érvényes
const cryptoContact = require('crypto');

function contactSign(payload) {
  return cryptoContact.createHmac('sha256', CONTACT_SECRET).update(payload).digest('hex');
}

function createContactToken() {
  const ts = Date.now();
  const nonce = cryptoContact.randomBytes(8).toString('hex');
  return `${ts}.${nonce}.${contactSign(`${ts}.${nonce}`)}`;
}

// Visszatér: { ok:true, nonce } vagy { ok:false, code }
function checkContactToken(token) {
  if (typeof token !== 'string') return { ok: false, code: 'INVALID' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, code: 'INVALID' };
  const [ts, nonce, sig] = parts;
  const expected = contactSign(`${ts}.${nonce}`);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !cryptoContact.timingSafeEqual(a, b)) return { ok: false, code: 'INVALID' };
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > CONTACT_MAX_AGE_MS) return { ok: false, code: 'EXPIRED' };
  if (age < CONTACT_MIN_AGE_MS) return { ok: false, code: 'TOO_FAST' };
  if (contactUsedNonces.has(nonce)) return { ok: false, code: 'USED' };
  return { ok: true, nonce };
}

// Memória-tisztítás (régi bejegyzések törlése)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of contactUsedNonces) if (now - v > CONTACT_MAX_AGE_MS) contactUsedNonces.delete(k);
  for (const [k, v] of contactHashMap) if (now - v > 60 * 60 * 1000) contactHashMap.delete(k);
  for (const [k, arr] of contactRateMap) { const f = arr.filter(x => now - x < 10 * 60 * 1000); if (f.length) contactRateMap.set(k, f); else contactRateMap.delete(k); }
  for (const [k, arr] of contactEmailMap) { const f = arr.filter(x => now - x < 60 * 60 * 1000); if (f.length) contactEmailMap.set(k, f); else contactEmailMap.delete(k); }
  while (contactGlobalLog.length && now - contactGlobalLog[0] > 60 * 60 * 1000) contactGlobalLog.shift();
}, 10 * 60 * 1000).unref();

app.get('/api/contact/token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ token: createContactToken() });
});

function escapeHtmlContact(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

app.post('/api/contact', async (req, res) => {
  try {
    const body = req.body || {};

    // Honeypot: a robotok kitöltik a rejtett mezőt, az emberek nem
    if (body.website) {
      return res.json({ success: true });
    }

    // Egyszerű IP alapú limit: 3 üzenet / 10 perc
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
    // Origin ellenőrzés: csak a saját oldalról érkezhet beküldés
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch (e) { originHost = ''; }
      if (originHost !== req.headers.host) {
        console.warn(`[CONTACT] Idegen Origin elutasítva: ${origin}`);
        return res.status(403).json({ error: 'Érvénytelen kérés.' });
      }
    }
    const now = Date.now();
    const recent = (contactRateMap.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
    if (recent.length >= 3) {
      return res.status(429).json({ error: 'Túl sok üzenetet küldtél rövid idő alatt. Kérjük, próbáld újra később!' });
    }

    const clean = (v, max) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
    const name = clean(body.name, 100);
    const email = clean(body.email, 150);
    const phone = clean(body.phone, 40);
    const topic = clean(body.topic, 80) || 'Egyéb';
    const message = String(body.message || '').trim().slice(0, 5000);

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'A név, az e-mail cím és az üzenet megadása kötelező!' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Kérjük, érvényes e-mail címet adj meg!' });
    }
    if (message.length < 5) {
      return res.status(400).json({ error: 'Az üzenet túl rövid!' });
    }
    if (!body.consent) {
      return res.status(400).json({ error: 'Az adatkezelési tájékoztató elfogadása kötelező!' });
    }

    // Emberi beküldés igazolása: aláírt, időbélyeges, egyszer használatos token
    const tokenCheck = checkContactToken(body.token);
    if (!tokenCheck.ok) {
      const msgs = {
        TOO_FAST: 'Kérjük, várjon egy pillanatot, majd küldje el újra az üzenetet.',
        EXPIRED: 'Az űrlap lejárt. Kérjük, töltse újra az oldalt, majd küldje el az üzenetet.',
        USED: 'Ezt az űrlapot már elküldték. Kérjük, töltse újra az oldalt.',
        INVALID: 'Az űrlap ellenőrzése sikertelen. Kérjük, töltse újra az oldalt.'
      };
      console.warn(`[CONTACT] Token elutasítva (${tokenCheck.code}) IP: ${ip}`);
      return res.status(400).json({ error: msgs[tokenCheck.code] || msgs.INVALID, code: tokenCheck.code });
    }

    // Tartalmi szűrés: link-áradat, URL a névben, ismétlődő karakterek
    const linkCount = (message.match(/https?:\/\/|www\./gi) || []).length;
    if (linkCount > 2) {
      return res.status(400).json({ error: 'Az üzenet túl sok hivatkozást tartalmaz.' });
    }
    if (/https?:\/\/|www\./i.test(name) || /(.)\1{14,}/.test(message)) {
      return res.status(400).json({ error: 'Az üzenet tartalma nem fogadható el.' });
    }

    // Ugyanaz az üzenet ne mehessen el újra (1 órán belül)
    const msgHash = cryptoContact.createHash('sha256').update(`${email.toLowerCase()}|${message.toLowerCase()}`).digest('hex');
    if (contactHashMap.has(msgHash)) {
      return res.status(429).json({ error: 'Ezt az üzenetet már elküldte. Hamarosan válaszolunk!' });
    }

    // E-mail címenként óránként legfeljebb 3 üzenet
    const emailKey = email.toLowerCase();
    const emailRecent = (contactEmailMap.get(emailKey) || []).filter(t => now - t < 60 * 60 * 1000);
    if (emailRecent.length >= 3) {
      return res.status(429).json({ error: 'Erről az e-mail címről túl sok üzenet érkezett. Kérjük, próbálja később.' });
    }

    // Globális védőkorlát: óránként legfeljebb 30 üzenet az egész oldalról
    while (contactGlobalLog.length && now - contactGlobalLog[0] > 60 * 60 * 1000) contactGlobalLog.shift();
    if (contactGlobalLog.length >= 30) {
      console.warn('[CONTACT] Globális óránkénti limit elérve.');
      return res.status(429).json({ error: 'Jelenleg túl sok üzenet érkezett. Kérjük, hívjon minket telefonon!' });
    }
    if (!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)) {
      console.error('[CONTACT] SMTP nincs beállítva, az üzenet nem küldhető el.');
      return res.status(503).json({ error: 'Az üzenetküldés jelenleg nem elérhető. Kérjük, hívj minket telefonon!' });
    }

    const sentAt = new Date().toLocaleString('hu-HU', {
      timeZone: 'Europe/Budapest',
      year: 'numeric', month: 'long', day: 'numeric',
      weekday: 'long',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const safeName = escapeHtmlContact(name);
    const safeEmail = escapeHtmlContact(email);
    const safePhone = escapeHtmlContact(phone);
    const safeTopic = escapeHtmlContact(topic);
    const safeMessage = escapeHtmlContact(message).replace(/\r?\n/g, '<br>');

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"HawkStone" <noreply@hawkstone.hu>`,
      to: CONTACT_RECIPIENT,
      replyTo: `"${name.replace(/"/g, '')}" <${email}>`,
      subject: `[HawkStone] Üzenet az oldalról – ${name}`,
      text: `Üzenet a hawkstone.hu oldalról\nBeérkezett: ${sentAt}\n\nNév: ${name}\nE-mail: ${email}\nTelefon: ${phone || '-'}\nTéma: ${topic}\n\nÜzenet:\n${message}\n`,
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; background-color: #0c0e17; color: #ffffff; padding: 28px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.08);">
          <div style="text-align: center; margin-bottom: 18px;">
            <img src="cid:contact_logo" alt="HawkStone" style="height: 70px; width: auto; display: inline-block;">
          </div>
          <h2 style="color: #ff6b00; margin: 0 0 6px 0; text-align: center; font-size: 20px;">Üzenet az oldalról</h2>
          <p style="margin: 0 0 22px 0; text-align: center; color: #94a3b8; font-size: 13px;">Beérkezett: <strong style="color:#ffffff;">${sentAt}</strong></p>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
            <tr><td style="padding: 8px 10px; color: #94a3b8; width: 90px; border-bottom: 1px solid rgba(255,255,255,0.08);">Név</td><td style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);"><strong>${safeName}</strong></td></tr>
            <tr><td style="padding: 8px 10px; color: #94a3b8; border-bottom: 1px solid rgba(255,255,255,0.08);">E-mail</td><td style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);"><a href="mailto:${safeEmail}" style="color: #ff6b00; text-decoration: none;">${safeEmail}</a></td></tr>
            <tr><td style="padding: 8px 10px; color: #94a3b8; border-bottom: 1px solid rgba(255,255,255,0.08);">Telefon</td><td style="padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);">${safePhone || '-'}</td></tr>
            <tr><td style="padding: 8px 10px; color: #94a3b8;">Téma</td><td style="padding: 8px 10px;">${safeTopic}</td></tr>
          </table>

          <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 16px 18px; font-size: 14px; line-height: 1.6; color: #e2e8f0;">
            ${safeMessage}
          </div>

          <p style="font-size: 11px; color: #64748b; text-align: center; margin: 22px 0 0 0;">Erre a levélre közvetlenül válaszolhatsz, a válasz a feladónak megy. • hawkstone.hu kapcsolati űrlap</p>
        </div>
      `,
      attachments: [{
        filename: 'header_logo.png',
        path: path.join(__dirname, 'public', 'pictures', 'logos', 'header_logo.png'),
        cid: 'contact_logo'
      }]
    });

    contactUsedNonces.set(tokenCheck.nonce, now);
    contactHashMap.set(msgHash, now);
    emailRecent.push(now);
    contactEmailMap.set(emailKey, emailRecent);
    contactGlobalLog.push(now);
    recent.push(now);
    contactRateMap.set(ip, recent);
    console.log(`[CONTACT] Üzenet elküldve (${email}) -> ${CONTACT_RECIPIENT}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[CONTACT ERROR]', err);
    res.status(500).json({ error: 'Az üzenetet nem sikerült elküldeni. Kérjük, próbáld újra később!' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email megadása kötelező!' });
    }

    const user = await dbGet('SELECT id, name, email FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(400).json({ error: 'Ezzel az e-mail címmel nem létezik regisztrált felhasználó!' });
    }

    const tempPassword = generateTempPassword();
    const tempHash = await bcrypt.hash(tempPassword, 10);

    // Save temporary password hash and flag force reset
    await dbRun('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [tempHash, user.id]);

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const domain = `${protocol}://${host}`;
    const loginLink = `${domain}/auth.html`;

    // Send email using real SMTP or print log mockup
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || `"HawkStone" <noreply@hawkstone.hu>`,
          to: user.email,
          subject: 'HawkStone - Ideiglenes jelszó igénylése',
          text: `Kedves ${user.name}!\n\nKérésedre generáltunk egy új ideiglenes jelszót.\n\nIdeiglenes jelszó: ${tempPassword}\n\nKérjük, lépj be az alábbi linken, majd változtasd meg a jelszavadat a profilodban:\n${loginLink}\n\nÜdvözlettel,\nHawkStone Csapata`,
          html: `
            <div style="font-family: 'Inter', sans-serif; background-color: #0c0e17; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.08);">
              <img src="cid:mail_header_image" alt="HawkStone" style="width: 100%; max-width: 600px; display: block; border-radius: 8px; margin-bottom: 25px;">
              <h2 style="color: #ff6b00; font-family: 'Outfit', sans-serif; margin-bottom: 15px; text-align: center;">Kedves ${user.name}!</h2>
              <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; text-align: center;">Kérésedre generáltunk számodra egy új ideiglenes jelszót, amivel be tudsz lépni a fiókodba.</p>
              
              <!-- Temporary Password Info Card -->
              <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); padding: 20px; border-radius: 10px; margin: 25px 0; text-align: center;">
                <p style="margin: 0 0 10px 0; color: #94a3b8; font-size: 14px;">Ideiglenes jelszó:</p>
                <div style="font-family: 'Courier New', monospace; font-size: 24px; color: #ff6b00; font-weight: 700; letter-spacing: 2px; background: rgba(255, 107, 0, 0.08); display: inline-block; padding: 10px 25px; border-radius: 8px; border: 1px dashed rgba(255, 107, 0, 0.3); margin-bottom: 15px;">
                  ${tempPassword}
                </div>
                <p style="margin: 0; font-size: 12px; color: #ef4444; font-weight: 600;">Figyelem! Az első sikeres belépés után a rendszer azonnal kötelezni fog a jelszó megváltoztatására!</p>
              </div>

              <div style="text-align: center; margin-bottom: 30px;">
                <a href="${loginLink}" style="background: linear-gradient(135deg, #ff6b00 0%, #ff8c00 100%); color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; box-shadow: 0 4px 15px rgba(255, 107, 0, 0.4);">Belépés a fiókba</a>
              </div>
              
              <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 25px 0;">
              <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">Üdvözlettel,<br><strong>HawkStone Csapata</strong></p>
            </div>
          `,
          attachments: [{
            filename: 'mail_header.png',
            path: path.join(__dirname, 'public', 'pictures', 'letter', 'mail_header.png'),
            cid: 'mail_header_image'
          }]
        });
        console.log(`[EMAIL] Temporary password email sent successfully to ${email}`);
      } catch (mailError) {
        console.error('[EMAIL ERROR] Failed to send email via SMTP, logging fallback instead:', mailError);
        console.log(`\n==================================================`);
        console.log(`[EMAIL MOCK FALLBACK] Temp password sent to: ${email}`);
        console.log(`Temp Password: ${tempPassword}`);
        console.log(`Link: ${loginLink}`);
        console.log(`==================================================\n`);
      }
    } else {
      console.log(`\n==================================================`);
      console.log(`[EMAIL MOCK] Temp password sent to: ${email}`);
      console.log(`Subject: HawkStone - Ideiglenes jelszó igénylése`);
      console.log(`Temp Password: ${tempPassword}`);
      console.log(`Link: ${loginLink}`);
      console.log(`==================================================\n`);
    }

    res.json({ message: 'Ideiglenes jelszó generálása sikeres! Kérjük, ellenőrizze az e-mail fiókját.' });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a jelszó visszaállítása során: ' + error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email és jelszó megadása kötelező!' });
    }

    const cleanEmail = (email || '').trim().toLowerCase();

    // Admin credentials shortcut check (hsadmin, admin, or admin@hawkstone.hu with password HaW%s69T?)
    if ((cleanEmail === 'hsadmin' || cleanEmail === 'admin' || cleanEmail === 'admin@hawkstone.hu') && password === 'HaW%s69T?') {
      const adminUser = await dbGet("SELECT * FROM users WHERE email = 'admin@hawkstone.hu' OR role LIKE '%ADMIN%' LIMIT 1");
      if (adminUser) {
        const userPayload = { id: adminUser.id, email: adminUser.email, name: adminUser.name, role: adminUser.role, card_type: adminUser.card_type };
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, user: userPayload, mustChangePassword: false });
      }
    }

    let user = await dbGet('SELECT * FROM users WHERE LOWER(TRIM(email)) = ?', [cleanEmail]);
    if (!user && (cleanEmail === 'hsadmin' || cleanEmail === 'admin')) {
      user = await dbGet("SELECT * FROM users WHERE email = 'admin@hawkstone.hu' OR role LIKE '%ADMIN%' LIMIT 1");
    }
    if (!user && (cleanEmail === 'staff' || cleanEmail === 'hsstaff')) {
      user = await dbGet("SELECT * FROM users WHERE email = 'staff@hawkstone.hu' OR role LIKE '%STAFF%' LIMIT 1");
    }
    if (!user) {
      return res.status(400).json({ error: 'Hibás email cím vagy jelszó!' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Hibás email cím vagy jelszó!' });
    }

    // Verification check
    if (user.is_verified !== 1) {
      return res.status(400).json({ error: 'Kérjük, előbb igazold vissza a regisztrációdat az e-mailben küldött linkkel!' });
    }

    const userPayload = { id: user.id, email: user.email, name: user.name, role: user.role, card_type: user.card_type };
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, user: userPayload, mustChangePassword: user.must_change_password === 1 });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a bejelentkezés során: ' + error.message });
  }
});

app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const user = await dbGet('SELECT id, name, email, phone, license_number, card_type, role, must_change_password, billing_name, billing_zip, billing_city, billing_address, billing_tax_number, school_role, school_name, school_id_number, school_discount_verified, school_discount_verified_until, school_discount_verified_by FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(444).json({ error: 'Felhasználó nem található!' });

    // Check if annual school discount verification has expired (past October 31 of verification year)
    const todayStr = new Date().toISOString().split('T')[0];
    if (user.school_discount_verified === 1 && user.school_discount_verified_until && user.school_discount_verified_until < todayStr) {
      user.school_discount_verified = 0;
      await dbRun('UPDATE users SET school_discount_verified = 0 WHERE id = ?', [user.id]);
    }

    // Fetch user's active/unused tickets
    const tickets = await dbAll("SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC", [user.id]);

    // Fetch user's bookings (upcoming or past) with attendance log check
    const bookings = await dbAll(`
      SELECT b.id as booking_id, b.booking_date, b.heads_count, b.booking_type, b.adult_count, b.child_count, s.start_time, s.end_time, l.name as location_name,
             (SELECT COUNT(*) FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
             ) as attended
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN locations l ON s.location_id = l.id
      WHERE b.user_id = ?
      ORDER BY b.booking_date ASC, s.start_time ASC
    `, [user.id]);

    // Fetch user's entry logs
    const logs = await dbAll(`
      SELECT el.scan_time, el.status, el.message, l.name as location_name, t.ticket_type
      FROM entry_logs el
      JOIN tickets t ON el.ticket_id = t.id
      LEFT JOIN locations l ON el.location_id = l.id
      WHERE t.user_id = ?
      ORDER BY el.scan_time DESC
    `, [user.id]);

    res.json({ user, tickets, bookings, logs });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a profil betöltésekor: ' + error.message });
  }
});

// Update user's partner school status from user dashboard
app.post('/api/auth/school-status', authenticateToken, async (req, res) => {
  try {
    const { schoolRole, schoolName, schoolIdNumber } = req.body;
    const validRoles = ['NONE', 'STUDENT', 'TEACHER'];
    const cleanRole = validRoles.includes(schoolRole) ? schoolRole : 'NONE';
    
    let cleanSchool = (schoolName || '').trim();
    if (cleanRole === 'NONE') {
      cleanSchool = '';
    } else {
      if (cleanSchool.includes('Eötvös')) cleanSchool = 'Eötvös József Gyakorlóiskola és Gimnázium';
      else if (cleanSchool.includes('Kossuth')) cleanSchool = 'Evangélikus Kossuth Lajos Gimnázium';
      else if (cleanSchool.includes('Zrínyi')) cleanSchool = 'Zrínyi Ilona Gimnázium';
    }
    const cleanIdNumber = cleanRole === 'NONE' ? '' : (schoolIdNumber || '').trim();

    // Updating/changing school declaration resets verification so staff must verify the ID at entry
    await dbRun(
      `UPDATE users SET 
        school_role = ?, 
        school_name = ?, 
        school_id_number = ?, 
        school_discount_verified = 0, 
        school_discount_verified_until = NULL, 
        school_discount_verified_by = NULL 
      WHERE id = ?`,
      [cleanRole, cleanSchool, cleanIdNumber, req.user.id]
    );

    const updatedUser = await dbGet(
      'SELECT id, name, email, phone, license_number, card_type, role, school_role, school_name, school_id_number, school_discount_verified, school_discount_verified_until FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      message: 'Partneriskolai státusz sikeresen rögzítve! Az első belépésnél a falmester ellenőrzi az igazolványodat.',
      user: updatedUser
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a partneriskolai státusz mentésekor: ' + error.message });
  }
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'A régi és az új jelszó megadása is kötelező!' });
    }

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'Felhasználó nem található!' });
    }

    const validPassword = await bcrypt.compare(oldPassword, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'A jelenlegi jelszó helytelen!' });
    }

    // Validate complexity of new password
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ error: 'Az új jelszó nem felel meg a biztonsági követelményeknek! Legalább 8 karakter, kisbetű, nagybetű, szám és speciális karakter szükséges.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await dbRun('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [newHash, req.user.id]);

    res.json({ message: 'Jelszó sikeresen megváltoztatva!' });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a jelszó módosítása során: ' + error.message });
  }
});

app.post('/api/auth/billing', authenticateToken, async (req, res) => {
  try {
    const { billingName, billingZip, billingCity, billingAddress, billingTaxNumber } = req.body;
    if (!billingName || !billingZip || !billingCity || !billingAddress) {
      return res.status(400).json({ error: 'Kérjük, minden kötelező számlázási mezőt tölts ki!' });
    }

    await dbRun(
      `UPDATE users SET 
        billing_name = ?, 
        billing_zip = ?, 
        billing_city = ?, 
        billing_address = ?, 
        billing_tax_number = ? 
       WHERE id = ?`,
      [billingName, billingZip, billingCity, billingAddress, billingTaxNumber || '', req.user.id]
    );

    res.json({ message: 'Számlázási adatok sikeresen elmentve!' });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a számlázási adatok mentése során: ' + error.message });
  }
});

// ---------------- LOCATIONS & BOOKINGS ----------------
app.get('/api/locations', async (req, res) => {
  try {
    const locations = await dbAll('SELECT * FROM locations');
    res.json(locations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get slots for a location on a specific date with booked headcounts
app.get('/api/schedule', authenticateToken, async (req, res) => {
  try {
    const { locationId, date } = req.query;
    if (!locationId || !date) {
      return res.status(400).json({ error: 'Hiányzó paraméterek (locationId, date)!' });
    }

    await cleanupExpiredTempBookings();

    // day_of_week from date: 0 = Sun, 1 = Mon ... 6 = Sat
    const parsedDate = new Date(date);
    if (isNaN(parsedDate)) {
      return res.status(400).json({ error: 'Érvénytelen dátum formátum!' });
    }
    const dayOfWeek = parsedDate.getDay();

    const slots = await dbAll(`
      SELECT s.*, l.name as location_name,
        (SELECT COALESCE(SUM(COALESCE(b.heads_count, 1)), 0) FROM bookings b WHERE b.slot_id = s.id AND b.booking_date = ?) as booked_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.booking_date = ? AND b.user_id = ? AND COALESCE(b.status, 'CONFIRMED') = 'CONFIRMED') as user_booked,
        (SELECT id FROM bookings b WHERE b.slot_id = s.id AND b.booking_date = ? AND b.user_id = ? AND b.status = 'PENDING' LIMIT 1) as user_temp_booking_id
      FROM slots s
      JOIN locations l ON s.location_id = l.id
      WHERE s.location_id = ? 
        AND s.day_of_week = ?
        AND s.id NOT IN (SELECT slot_id FROM slot_cancellations WHERE cancelled_date = ?)
      ORDER BY s.start_time ASC
    `, [date, date, req.user.id, date, req.user.id, locationId, dayOfWeek, date]);

    // Get current Budapest date and time to filter out past slots
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
    const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    const timeStr = `${getPart('hour')}:${getPart('minute')}`;

    const slotsWithPastInfo = slots.map(slot => {
      let isPast = false;
      if (date < dateStr) {
        isPast = true;
      } else if (date === dateStr) {
        // If the slot's start_time has already passed
        if (slot.start_time < timeStr) {
          isPast = true;
        }
      }
      return { ...slot, is_past: isPast };
    });

    res.json(slotsWithPastInfo);
  } catch (error) {
    res.status(500).json({ error: 'Hiba az órarend betöltésekor: ' + error.message });
  }
});

// Create temporary reservation during ticket checkout (held for 20 minutes until payment completes)
app.post('/api/bookings/temp', authenticateToken, async (req, res) => {
  try {
    await cleanupExpiredTempBookings();

    const { slotId, date, adultCount = 1, childCount = 0, headsCount, previousTempBookingId } = req.body;
    if (!slotId || !date) {
      return res.status(400).json({ error: 'Hiányzó paraméterek (slotId, date)!' });
    }

    // Remove previous unlinked temporary booking for this user so switching slots releases the old one immediately
    if (previousTempBookingId) {
      await dbRun("DELETE FROM bookings WHERE id = ? AND user_id = ? AND status = 'PENDING'", [previousTempBookingId, req.user.id]);
    }
    await dbRun("DELETE FROM bookings WHERE user_id = ? AND status = 'PENDING' AND payment_id IS NULL", [req.user.id]);

    const slot = await dbGet('SELECT s.*, l.name as location_name FROM slots s JOIN locations l ON s.location_id = l.id WHERE s.id = ?', [slotId]);
    if (!slot) return res.status(404).json({ error: 'A választott időpont nem létezik!' });

    // Validate if the slot is in the past
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
    const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    const timeStr = `${getPart('hour')}:${getPart('minute')}`;

    if (date < dateStr || (date === dateStr && slot.start_time < timeStr)) {
      return res.status(400).json({ error: 'Múltbeli időpontra nem lehet foglalni!' });
    }

    const maxBookingDate = new Date();
    maxBookingDate.setDate(now.getDate() + 21);
    const maxDateStr = maxBookingDate.toISOString().split('T')[0];
    if (date > maxDateStr) {
      return res.status(400).json({ error: 'Csak legfeljebb 3 hétre előre lehet időpontot foglalni!' });
    }

    // Check if user already has a CONFIRMED booking for this slot & date
    const existingConfirmed = await dbGet(
      "SELECT id FROM bookings WHERE user_id = ? AND slot_id = ? AND booking_date = ? AND COALESCE(status, 'CONFIRMED') = 'CONFIRMED'",
      [req.user.id, slotId, date]
    );
    if (existingConfirmed) {
      return res.status(400).json({ error: 'Erre az időpontra már van véglegesített foglalásod!' });
    }

    const cleanAdult = Math.max(0, Math.min(4, parseInt(adultCount) || 0));
    const cleanChild = Math.max(0, Math.min(4, parseInt(childCount) || 0));
    const actualHeads = Math.max(1, Math.min(8, parseInt(headsCount) || (cleanAdult + cleanChild) || 1));

    let cleanBookingType = 'SELF';
    if (cleanAdult === 0 && cleanChild > 0) cleanBookingType = 'CHILD_ONLY';
    else if (cleanAdult > 0 && cleanChild > 0) cleanBookingType = 'SELF_AND_CHILD';

    // Check capacity including active + non-expired temporary bookings
    const bookedCountRow = await dbGet(
      'SELECT COALESCE(SUM(COALESCE(heads_count, 1)), 0) as total FROM bookings WHERE slot_id = ? AND booking_date = ?',
      [slotId, date]
    );
    const currentOccupancy = bookedCountRow.total || 0;
    if (currentOccupancy + actualHeads > slot.max_capacity) {
      const remaining = slot.max_capacity - currentOccupancy;
      return res.status(400).json({
        error: remaining > 0
          ? `Ebben az idősávban már csak ${remaining} szabad hely van, de a foglaláshoz ${actualHeads} hely szükséges!`
          : 'Ez az időpont már betelt (telt ház)!'
      });
    }

    const result = await dbRun(
      `INSERT INTO bookings (user_id, slot_id, booking_date, heads_count, booking_type, adult_count, child_count, status, temp_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', datetime('now', '+20 minutes'))`,
      [req.user.id, slotId, date, actualHeads, cleanBookingType, cleanAdult, cleanChild]
    );

    res.status(201).json({
      message: 'Időpont ideiglenesen lefoglalva a fizetés idejére!',
      booking: {
        id: result.lastID,
        slot_id: slot.id,
        booking_date: date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        location_name: slot.location_name,
        heads_count: actualHeads,
        adult_count: cleanAdult,
        child_count: cleanChild,
        status: 'PENDING'
      }
    });
  } catch (error) {
    console.error('[TEMP BOOKING ERROR]:', error);
    res.status(500).json({ error: 'Hiba az ideiglenes foglalás során: ' + error.message });
  }
});

// Release temporary reservation
app.delete('/api/bookings/temp/:id', authenticateToken, async (req, res) => {
  try {
    await ensureCheckoutSchema();
    const bookingId = req.params.id;
    await dbRun("DELETE FROM bookings WHERE id = ? AND user_id = ? AND status = 'PENDING'", [bookingId, req.user.id]);
    res.json({ message: 'Ideiglenes foglalás feloldva.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create booking
app.post('/api/bookings', authenticateToken, async (req, res) => {
  try {
    await cleanupExpiredTempBookings();
    const { slotId, date, bookingType = 'SELF', headsCount } = req.body;
    if (!slotId || !date) {
      return res.status(400).json({ error: 'Hiányzó paraméterek (slotId, date)!' });
    }

    // Validate slot existence and capacity
    const slot = await dbGet('SELECT * FROM slots WHERE id = ?', [slotId]);
    if (!slot) return res.status(404).json({ error: 'A választott időpont nem létezik!' });

    // Validate if the slot is in the past
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
    const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    const timeStr = `${getPart('hour')}:${getPart('minute')}`;

    let isPast = false;
    if (date < dateStr) {
      isPast = true;
    } else if (date === dateStr) {
      if (slot.start_time < timeStr) {
        isPast = true;
      }
    }

    if (isPast) {
      return res.status(400).json({ error: 'Múltbeli időpontra nem lehet foglalni!' });
    }

    // Max booking in advance is 3 weeks (21 days)
    const maxBookingDate = new Date();
    maxBookingDate.setDate(now.getDate() + 21);
    const maxDateStr = maxBookingDate.toISOString().split('T')[0];
    if (date > maxDateStr) {
      return res.status(400).json({ error: 'Csak legfeljebb 3 hétre előre lehet időpontot foglalni!' });
    }

    // Determine actual heads count, adult count, child count and booking type
    let adultCount = 1;
    let childCount = 0;

    if (req.body.adultCount !== undefined) {
      adultCount = parseInt(req.body.adultCount) === 0 ? 0 : 1;
    } else if (bookingType === 'CHILD_ONLY') {
      adultCount = 0;
    }

    if (req.body.childCount !== undefined) {
      childCount = Math.max(0, Math.min(3, parseInt(req.body.childCount) || 0));
    } else if (bookingType === 'SELF_AND_CHILD') {
      childCount = 1;
    } else if (bookingType === 'CHILD_ONLY') {
      childCount = 1;
    }

    const actualHeads = adultCount + childCount;
    if (actualHeads < 1 || actualHeads > 4) {
      return res.status(400).json({ error: 'A mászók száma legalább 1 és legfeljebb 4 fő lehet (1 felnőtt/diák + legfeljebb 3 gyermek)!' });
    }

    let cleanBookingType = 'SELF';
    if (adultCount === 0 && childCount > 0) {
      cleanBookingType = 'CHILD_ONLY';
    } else if (adultCount > 0 && childCount > 0) {
      cleanBookingType = 'SELF_AND_CHILD';
    }

    // Check active tickets in account
    const todayStr = dateStr;
    const userTickets = await dbAll(
      "SELECT * FROM tickets WHERE user_id = ? AND status = 'ACTIVE' AND expires_date >= ?",
      [req.user.id, todayStr]
    );

    const childTickets = userTickets.filter(t => (t.ticket_type || '').includes('GYEREK'));
    const adultTickets = userTickets.filter(t => !(t.ticket_type || '').includes('GYEREK'));

    // Count available child ticket usages
    let childAvailableSessions = 0;
    for (const ct of childTickets) {
      if ((ct.ticket_type || '').includes('HAVI')) {
        childAvailableSessions += 999;
      } else {
        childAvailableSessions += Math.max(0, parseInt(ct.sessions_remaining) || 1);
      }
    }

    if (childCount > 0 && childAvailableSessions < childCount) {
      return res.status(400).json({
        error: `A(z) ${childCount} gyermek számára történő foglaláshoz legalább ${childCount} db érvényes Gyermek jegy vagy bérletalkalom szükséges a fiókodban (jelenleg elérhető: ${childAvailableSessions})!`
      });
    }

    if (adultCount > 0 && adultTickets.length === 0) {
      return res.status(400).json({
        error: 'A saját mászásodhoz legalább egy érvényes felnőtt vagy diák jegyre vagy bérletre van szükséged!'
      });
    }

    // Check capacity using SUM(COALESCE(heads_count, 1))
    const bookedCountRow = await dbGet(
      'SELECT COALESCE(SUM(COALESCE(heads_count, 1)), 0) as total FROM bookings WHERE slot_id = ? AND booking_date = ?',
      [slotId, date]
    );
    const currentOccupancy = bookedCountRow.total || 0;
    if (currentOccupancy + actualHeads > slot.max_capacity) {
      const remaining = slot.max_capacity - currentOccupancy;
      return res.status(400).json({
        error: remaining > 0 
          ? `Ebben az idősávban már csak ${remaining} szabad hely van, de a foglaláshoz ${actualHeads} hely szükséges!` 
          : 'Ez az időpont már betelt (telt ház)!'
      });
    }

    // Insert booking (handles unique constraint per user-slot-date automatically)
    try {
      const bookingInsert = await dbRun(
        'INSERT INTO bookings (user_id, slot_id, booking_date, heads_count, booking_type, adult_count, child_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.user.id, slotId, date, actualHeads, cleanBookingType, adultCount, childCount]
      );

      // Confirmation e-mail with calendar (.ics) attachment
      try {
        const bookingClimber = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
        const bookingLoc = await dbGet('SELECT name, address FROM locations WHERE id = ?', [slot.location_id]);
        if (bookingClimber && bookingLoc) {
          const mailProto = req.headers['x-forwarded-proto'] || 'http';
          const mailDomain = `${mailProto}://${req.headers.host}`;
          const mailInfo = {
            id: bookingInsert.lastID,
            location_name: bookingLoc.name,
            location_address: bookingLoc.address,
            booking_date: date,
            start_time: slot.start_time,
            end_time: slot.end_time,
            heads_count: actualHeads,
            details_text: describeBookingAttendees(cleanBookingType, adultCount, childCount, actualHeads)
          };
          const mailPromise = sendBookingConfirmationEmail(bookingClimber, mailInfo, mailDomain);
          if (process.env.VERCEL) await mailPromise;
        }
      } catch (mailErr) {
        console.error('[BOOKING EMAIL ERROR]:', mailErr);
      }
      let successMsg = 'Sikeres foglalás!';
      if (adultCount === 0 && childCount > 0) {
        successMsg = `Sikeres foglalás ${childCount} gyermek számára! (Ne feledd: kísérőként kötelező személyesen megjelenned a gyermekekkel).`;
      } else if (adultCount > 0 && childCount > 0) {
        successMsg = `Sikeres közös foglalás (${actualHeads} fő: Te + ${childCount} gyermek)!`;
      }
      res.status(201).json({
        message: successMsg
      });
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Erre az időpontra már van foglalásod!' });
      }
      throw dbErr;
    }
  } catch (error) {
    console.error('[BOOKING ERROR] Details:', error);
    res.status(500).json({ error: 'Hiba a foglalás során: ' + error.message });
  }
});

// Delete booking
app.delete('/api/bookings/:id', authenticateToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const booking = await dbGet('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (!booking) return res.status(404).json({ error: 'A foglalás nem található!' });

    const userRoles = (req.user.role || '').split(',').map(r => r.trim().toUpperCase());
    const isPrivileged = userRoles.includes('ADMIN') || userRoles.includes('STAFF');

    // Users can delete their own booking; Admin/Staff can delete any
    if (booking.user_id !== req.user.id && !isPrivileged) {
      return res.status(403).json({ error: 'Nincs jogosultságod törölni ezt a foglalást!' });
    }

    // Regular users cannot delete expired or attended bookings
    if (!isPrivileged) {
      const slot = await dbGet('SELECT * FROM slots WHERE id = ?', [booking.slot_id]);
      if (slot) {
        // Get current Budapest time
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
        const bookingBudapestStr = `${booking.booking_date}T${slot.end_time}`;
        
        if (currentBudapestStr > bookingBudapestStr) {
          return res.status(400).json({ error: 'Ezt a foglalást már nem mondhatod le, mert a foglalás időpontja már lejárt!' });
        }
      }

      // Check if they attended
      const attendedRow = await dbGet(`
        SELECT COUNT(*) as count FROM entry_logs el 
        JOIN tickets t ON el.ticket_id = t.id 
        JOIN slots s ON s.id = ?
        WHERE t.user_id = ? 
          AND el.status = 'SUCCESS' 
          AND el.location_id = s.location_id
          AND date(el.scan_time) = ?
      `, [booking.slot_id, booking.user_id, booking.booking_date]);

      if (attendedRow && attendedRow.count > 0) {
        return res.status(400).json({ error: 'Ezt a foglalást már nem mondhatod le, mert már megjelentél a mászófalnál!' });
      }
    }

    await dbRun('DELETE FROM bookings WHERE id = ?', [bookingId]);
    res.json({ message: 'Foglalás sikeresen lemondva!' });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a lemondás során: ' + error.message });
  }
});

// ---------------- TICKET TYPES & PRICING CONFIGURATION ----------------
const TICKET_CONFIG = {
  // 1. Felnőtt kategória
  'NAPI': {
    code: 'NAPI',
    category: 'Felnőtt',
    name: 'Egyszeri Napijegy',
    fullName: 'Egyszeri Napijegy (Felnőtt)',
    price: 2800,
    sessions: 1,
    baseType: 'NAPI',
    desc: 'Egyszeri belépésre jogosító felnőtt jegy a HawkStone Városi Mászóklubban.'
  },
  'NAPI_FELNOTT': {
    code: 'NAPI_FELNOTT',
    category: 'Felnőtt',
    name: 'Egyszeri Napijegy',
    fullName: 'Egyszeri Napijegy (Felnőtt)',
    price: 2800,
    sessions: 1,
    baseType: 'NAPI',
    desc: 'Egyszeri belépésre jogosító felnőtt jegy a HawkStone Városi Mászóklubban.'
  },
  'TIZ_ALKALMAS': {
    code: 'TIZ_ALKALMAS',
    category: 'Felnőtt',
    name: '10 Alkalmas Bérlet',
    fullName: '10 Alkalmas Bérlet (Felnőtt)',
    price: 22000,
    sessions: 10,
    baseType: 'TIZ_ALKALMAS',
    desc: '10 alkalmas felnőtt bérlet a HawkStone Városi Mászóklubban.'
  },
  'TIZ_ALKALMAS_FELNOTT': {
    code: 'TIZ_ALKALMAS_FELNOTT',
    category: 'Felnőtt',
    name: '10 Alkalmas Bérlet',
    fullName: '10 Alkalmas Bérlet (Felnőtt)',
    price: 22000,
    sessions: 10,
    baseType: 'TIZ_ALKALMAS',
    desc: '10 alkalmas felnőtt bérlet a HawkStone Városi Mászóklubban.'
  },
  'HAVI': {
    code: 'HAVI',
    category: 'Felnőtt',
    name: '30 Napos Korlátlan Bérlet',
    fullName: '30 Napos Korlátlan Bérlet (Felnőtt)',
    price: 28000,
    sessions: 9999,
    baseType: 'HAVI',
    desc: '30 napig korlátlan belépésre jogosító felnőtt bérlet a HawkStone Városi Mászóklubban.'
  },
  'HAVI_FELNOTT': {
    code: 'HAVI_FELNOTT',
    category: 'Felnőtt',
    name: '30 Napos Korlátlan Bérlet',
    fullName: '30 Napos Korlátlan Bérlet (Felnőtt)',
    price: 28000,
    sessions: 9999,
    baseType: 'HAVI',
    desc: '30 napig korlátlan belépésre jogosító felnőtt bérlet a HawkStone Városi Mászóklubban.'
  },

  // 2. Diák / Nyugdíjas kategória (2400, 18500, 23600)
  'NAPI_DIAK': {
    code: 'NAPI_DIAK',
    category: 'Diák / Nyugdíjas',
    name: 'Egyszeri Napijegy (Diák/Nyugdíjas)',
    fullName: 'Egyszeri Napijegy (Diák / Nyugdíjas)',
    price: 2400,
    sessions: 1,
    baseType: 'NAPI',
    desc: 'Kedvezményes diák/nyugdíjas egyszeri belépésre jogosító jegy a HawkStone Mászóklubban.'
  },
  'TIZ_ALKALMAS_DIAK': {
    code: 'TIZ_ALKALMAS_DIAK',
    category: 'Diák / Nyugdíjas',
    name: '10 Alkalmas Bérlet (Diák/Nyugdíjas)',
    fullName: '10 Alkalmas Bérlet (Diák / Nyugdíjas)',
    price: 18500,
    sessions: 10,
    baseType: 'TIZ_ALKALMAS',
    desc: 'Kedvezményes diák/nyugdíjas 10 alkalmas bérlet a HawkStone Mászóklubban.'
  },
  'HAVI_DIAK': {
    code: 'HAVI_DIAK',
    category: 'Diák / Nyugdíjas',
    name: '30 Napos Korlátlan Bérlet (Diák/Nyugdíjas)',
    fullName: '30 Napos Korlátlan Bérlet (Diák / Nyugdíjas)',
    price: 23600,
    sessions: 9999,
    baseType: 'HAVI',
    desc: 'Kedvezményes diák/nyugdíjas 30 napig korlátlan belépésre jogosító bérlet.'
  },

  // 3. Gyerek kategória 10 éves kor alatt (2100, 16600, 21200)
  'NAPI_GYEREK': {
    code: 'NAPI_GYEREK',
    category: 'Gyerek (10 éves kor alatt)',
    name: 'Egyszeri Napijegy (10 éves kor alatt)',
    fullName: 'Egyszeri Napijegy (Gyerek 10 éves kor alatt)',
    price: 2100,
    sessions: 1,
    baseType: 'NAPI',
    desc: 'Gyermek (10 éves korig) egyszeri belépésre jogosító jegy a HawkStone Mászóklubban.'
  },
  'TIZ_ALKALMAS_GYEREK': {
    code: 'TIZ_ALKALMAS_GYEREK',
    category: 'Gyerek (10 éves kor alatt)',
    name: '10 Alkalmas Bérlet (10 éves kor alatt)',
    fullName: '10 Alkalmas Bérlet (Gyerek 10 éves kor alatt)',
    price: 16600,
    sessions: 10,
    baseType: 'TIZ_ALKALMAS',
    desc: 'Gyermek (10 éves korig) 10 alkalmas bérlet a HawkStone Mászóklubban.'
  },
  'HAVI_GYEREK': {
    code: 'HAVI_GYEREK',
    category: 'Gyerek (10 éves kor alatt)',
    name: '30 Napos Korlátlan Bérlet (10 éves kor alatt)',
    fullName: '30 Napos Korlátlan Bérlet (Gyerek 10 éves kor alatt)',
    price: 21200,
    sessions: 9999,
    baseType: 'HAVI',
    desc: 'Gyermek (10 éves korig) 30 napig korlátlan belépésre jogosító bérlet.'
  },

  // 4. Partneriskolai Diák kategória (-20% a diák árból: 1920, 14800, 18880)
  'NAPI_PARTNER_DIAK': {
    code: 'NAPI_PARTNER_DIAK',
    category: 'Partneriskola - Diák (-20%)',
    name: 'Egyszeri Napijegy (Partneriskolai Diák)',
    fullName: 'Egyszeri Napijegy (Partner Diák -20%)',
    price: 1920,
    sessions: 1,
    baseType: 'NAPI',
    isPartner: true,
    partnerRole: 'STUDENT',
    desc: '20% partneriskolai kedvezményes napijegy Eötvös, Kossuth és Zrínyi diákoknak.'
  },
  'TIZ_ALKALMAS_PARTNER_DIAK': {
    code: 'TIZ_ALKALMAS_PARTNER_DIAK',
    category: 'Partneriskola - Diák (-20%)',
    name: '10 Alkalmas Bérlet (Partneriskolai Diák)',
    fullName: '10 Alkalmas Bérlet (Partner Diák -20%)',
    price: 14800,
    sessions: 10,
    baseType: 'TIZ_ALKALMAS',
    isPartner: true,
    partnerRole: 'STUDENT',
    desc: '20% partneriskolai kedvezményes 10 alkalmas bérlet Eötvös, Kossuth és Zrínyi diákoknak.'
  },
  'HAVI_PARTNER_DIAK': {
    code: 'HAVI_PARTNER_DIAK',
    category: 'Partneriskola - Diák (-20%)',
    name: '30 Napos Korlátlan Bérlet (Partneriskolai Diák)',
    fullName: '30 Napos Korlátlan Bérlet (Partner Diák -20%)',
    price: 18880,
    sessions: 9999,
    baseType: 'HAVI',
    isPartner: true,
    partnerRole: 'STUDENT',
    desc: '20% partneriskolai kedvezményes 30 napos korlátlan bérlet Eötvös, Kossuth és Zrínyi diákoknak.'
  },

  // 5. Partneriskolai Tanár kategória (-20% a felnőtt teljes árból: 2240, 17600, 22400)
  'NAPI_PARTNER_TANAR': {
    code: 'NAPI_PARTNER_TANAR',
    category: 'Partneriskola - Tanár (-20%)',
    name: 'Egyszeri Napijegy (Partneriskolai Tanár)',
    fullName: 'Egyszeri Napijegy (Partner Tanár -20%)',
    price: 2240,
    sessions: 1,
    baseType: 'NAPI',
    isPartner: true,
    partnerRole: 'TEACHER',
    desc: '20% partneriskolai kedvezményes napijegy Eötvös, Kossuth és Zrínyi tanároknak és oktatóknak.'
  },
  'TIZ_ALKALMAS_PARTNER_TANAR': {
    code: 'TIZ_ALKALMAS_PARTNER_TANAR',
    category: 'Partneriskola - Tanár (-20%)',
    name: '10 Alkalmas Bérlet (Partneriskolai Tanár)',
    fullName: '10 Alkalmas Bérlet (Partner Tanár -20%)',
    price: 17600,
    sessions: 10,
    baseType: 'TIZ_ALKALMAS',
    isPartner: true,
    partnerRole: 'TEACHER',
    desc: '20% partneriskolai kedvezményes 10 alkalmas bérlet Eötvös, Kossuth és Zrínyi tanároknak és oktatóknak.'
  },
  'HAVI_PARTNER_TANAR': {
    code: 'HAVI_PARTNER_TANAR',
    category: 'Partneriskola - Tanár (-20%)',
    name: '30 Napos Korlátlan Bérlet (Partneriskolai Tanár)',
    fullName: '30 Napos Korlátlan Bérlet (Partner Tanár -20%)',
    price: 22400,
    sessions: 9999,
    baseType: 'HAVI',
    isPartner: true,
    partnerRole: 'TEACHER',
    desc: '20% partneriskolai kedvezményes 30 napos korlátlan bérlet Eötvös, Kossuth és Zrínyi tanároknak és oktatóknak.'
  }
};

// Calculate Hungarian school student/teacher ID verification expiry date
// Rules: Valid until October 31 of current school year cycle.
// If checked/registered in Nov/Dec, valid until next year's Oct 31.
// If checked/registered Jan-Oct, valid until current year's Oct 31.
function calculateSchoolDiscountExpiry() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  if (month >= 11) {
    return `${year + 1}-10-31`;
  } else {
    return `${year}-10-31`;
  }
}

function isSchoolDiscountActive(user) {
  if (!user) return false;
  if (!user.school_role || user.school_role === 'NONE') return false;
  if (!user.school_name) return false;
  if (user.school_discount_verified !== 1) return false;
  if (!user.school_discount_verified_until) return false;
  const todayStr = new Date().toISOString().split('T')[0];
  return user.school_discount_verified_until >= todayStr;
}

function getTicketConfig(ticketType) {
  if (!ticketType) return null;
  return TICKET_CONFIG[ticketType] || null;
}

function getTicketBaseType(ticketType) {
  if (!ticketType) return 'NAPI';
  const conf = getTicketConfig(ticketType);
  if (conf) return conf.baseType;
  if (ticketType.startsWith('NAPI')) return 'NAPI';
  if (ticketType.startsWith('TIZ')) return 'TIZ_ALKALMAS';
  if (ticketType.startsWith('HAVI')) return 'HAVI';
  return ticketType;
}

// Public API endpoint for current pricing & ticket catalog
app.get('/api/tickets/pricing', (req, res) => {
  res.json({
    categories: ['Felnőtt', 'Diák / Nyugdíjas', 'Gyerek (10 éves kor alatt)', 'Partneriskolák (-20%)'],
    tickets: TICKET_CONFIG
  });
});

// ---------------- BARION ONLINE PAYMENT ----------------
// Helper to query and process Barion payment state
async function processBarionPayment(paymentId, domain) {
  await ensureCheckoutSchema();

  if (!BARION_POS_KEY) {
    throw new Error('A Barion nincs konfigurálva a szerveren.');
  }

  // Get current payment state from DB first
  const localPayment = await dbGet('SELECT * FROM barion_payments WHERE payment_id = ?', [paymentId]);
  if (!localPayment) {
    throw new Error('A tranzakció nem található az adatbázisban.');
  }

  if (localPayment.processed === 1) {
    console.log(`[BARION] Payment ${paymentId} already processed.`);
    return { success: true, alreadyProcessed: true };
  }

  // Fetch payment state from Barion
  let response, stateData;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch(`${BARION_BASE_URL}/v2/Payment/GetPaymentState?PosKey=${BARION_POS_KEY}&PaymentId=${paymentId}`);
      const rawState = await response.text();
      stateData = JSON.parse(rawState);
      break;
    } catch (fetchErr) {
      console.warn(`[BARION] GetPaymentState attempt ${attempt} failed: ${fetchErr.message}`);
      if (attempt === 3) throw new Error('A Barion átmenetileg nem válaszolt érvényesen, kérjük próbáld újra pár másodperc múlva.');
      await new Promise(r => setTimeout(r, 1200 * attempt));
    }
  }

  if (!response.ok || (stateData.Errors && stateData.Errors.length > 0)) {
    const errorMsg = formatBarionErrorMessage(stateData.Errors);
    throw new Error(`Barion hiba a lekéréskor: ${errorMsg}`);
  }

  console.log(`[BARION] Checked state for payment ${paymentId}. Status: ${stateData.Status}`);

  if (stateData.Status === 'Succeeded') {
    // Set processed = 1 and status = Succeeded only if it was 0 (concurrency lock)
    const updateResult = await dbRun(
      'UPDATE barion_payments SET status = ?, processed = 1 WHERE payment_id = ? AND processed = 0',
      ['Succeeded', paymentId]
    );

    if (updateResult.changes === 0) {
      console.log(`[BARION] Payment ${paymentId} was already processed by a concurrent request.`);
      return { success: true, alreadyProcessed: true };
    }

    const userId = localPayment.user_id;
    const ticketType = localPayment.ticket_type;

    const today = new Date();
    const purchaseDate = today.toISOString();
    
    const expires = new Date();
    expires.setDate(today.getDate() + 30);
    const expiresDate = expires.toISOString().split('T')[0];

    const conf = getTicketConfig(ticketType);
    let sessions = conf ? conf.sessions : (ticketType.startsWith('NAPI') ? 1 : ticketType.startsWith('TIZ_ALKALMAS') ? 10 : 9999);

    const qty = Math.max(1, parseInt(localPayment.quantity) || 1);
    const childQty = Math.max(0, Math.min(4, parseInt(localPayment.child_quantity) || 0));
    const createdTickets = [];

    for (let i = 0; i < qty; i++) {
      const qrUuid = generateUUID();
      const result = await dbRun(
        'INSERT INTO tickets (user_id, ticket_type, purchase_date, expires_date, sessions_remaining, qr_code_uuid, payment_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, ticketType, purchaseDate, expiresDate, sessions, qrUuid, paymentId]
      );
      createdTickets.push({
        id: result.lastID,
        ticket_type: ticketType,
        purchase_date: purchaseDate,
        expires_date: expiresDate,
        sessions_remaining: sessions,
        qr_code_uuid: qrUuid
      });
    }

    // Issue additional Child Daily Tickets (NAPI_GYEREK) if purchased together
    if (childQty > 0) {
      for (let c = 0; c < childQty; c++) {
        const childQrUuid = generateUUID();
        const childRes = await dbRun(
          'INSERT INTO tickets (user_id, ticket_type, purchase_date, expires_date, sessions_remaining, qr_code_uuid, payment_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, 'NAPI_GYEREK', purchaseDate, expiresDate, 1, childQrUuid, paymentId]
        );
        createdTickets.push({
          id: childRes.lastID,
          ticket_type: 'NAPI_GYEREK',
          purchase_date: purchaseDate,
          expires_date: expiresDate,
          sessions_remaining: 1,
          qr_code_uuid: childQrUuid
        });
      }
    }

    // Issue companion (adult / student) tickets bought together with a child ticket
    const companionQty = Math.max(0, Math.min(4, parseInt(localPayment.companion_quantity) || 0));
    const companionType = localPayment.companion_type;
    if (companionQty > 0 && companionType) {
      const compConf = getTicketConfig(companionType);
      const compSessions = compConf ? compConf.sessions : 1;
      for (let k = 0; k < companionQty; k++) {
        const compQr = generateUUID();
        const compRes = await dbRun(
          'INSERT INTO tickets (user_id, ticket_type, purchase_date, expires_date, sessions_remaining, qr_code_uuid, payment_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, companionType, purchaseDate, expiresDate, compSessions, compQr, paymentId]
        );
        createdTickets.push({
          id: compRes.lastID,
          ticket_type: companionType,
          purchase_date: purchaseDate,
          expires_date: expiresDate,
          sessions_remaining: compSessions,
          qr_code_uuid: compQr
        });
      }
    }

    // Finalize temporary booking if one was attached to this payment
    let bookingFinalized = false;
    try {
      if (localPayment.temp_booking_id) {
        const finalizeRes = await dbRun(
          "UPDATE bookings SET status = 'CONFIRMED', temp_expires_at = NULL WHERE (id = ? OR payment_id = ?) AND user_id = ?",
          [localPayment.temp_booking_id, paymentId, userId]
        );
        if (finalizeRes && finalizeRes.changes > 0) {
          bookingFinalized = true;
        }
      } else {
        const finalizeRes = await dbRun(
          "UPDATE bookings SET status = 'CONFIRMED', temp_expires_at = NULL WHERE payment_id = ? AND user_id = ?",
          [paymentId, userId]
        );
        if (finalizeRes && finalizeRes.changes > 0) {
          bookingFinalized = true;
        }
      }
    } catch (bErr) {
      console.error('[BARION BOOKING FINALIZE ERROR]:', bErr);
    }

    const ticketObj = createdTickets[0];

    // Invoice + confirmation e-mail: awaited on serverless (Vercel freezes after response), background locally
    const postPaymentWork = (async () => {
    try {
      const climber = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
      if (climber) {
        // Fetch latest payment details (which includes the billing columns)
        const paymentDetails = await dbGet('SELECT * FROM barion_payments WHERE payment_id = ?', [paymentId]);
        
        let invoiceBuffer = null;
        let invoiceNumber = null;
        
        if (paymentDetails && paymentDetails.billing_name) {
          const invoiceResult = await createSzamlazzInvoice(paymentDetails, climber);
          if (invoiceResult && invoiceResult.success) {
            invoiceBuffer = invoiceResult.pdfBuffer;
            invoiceNumber = invoiceResult.szamlaszam;
            // Save invoice number in database
            await dbRun(
              'UPDATE barion_payments SET invoice_number = ? WHERE payment_id = ?',
              [invoiceNumber, paymentId]
            );
            console.log(`[SZAMLAZZ] Saved invoice number ${invoiceNumber} to database for payment ${paymentId}`);
          }
        }
        
        // Fetch confirmed booking details if finalized
        let bookingInfo = null;
        if (bookingFinalized) {
          const bookingRow = await dbGet(
            `SELECT b.*, s.start_time, s.end_time, l.name as location_name, l.address as location_address
             FROM bookings b
             JOIN slots s ON b.slot_id = s.id
             JOIN locations l ON s.location_id = l.id
             WHERE (b.id = ? OR b.payment_id = ?) AND b.user_id = ?`,
            [localPayment.temp_booking_id || 0, paymentId, userId]
          );
          if (bookingRow) {
            let detailsText = `${bookingRow.heads_count} fő`;
            if (bookingRow.booking_type === 'CHILD_ONLY') {
              detailsText = `${bookingRow.child_count} gyermek (kísérővel)`;
            } else if (bookingRow.booking_type === 'SELF_AND_CHILD') {
              detailsText = `1 felnőtt + ${bookingRow.child_count} gyermek`;
            } else {
              detailsText = `${bookingRow.adult_count || bookingRow.heads_count} felnőtt`;
            }
            bookingInfo = {
              id: bookingRow.id,
              location_name: bookingRow.location_name,
              location_address: bookingRow.location_address,
              booking_date: bookingRow.booking_date,
              start_time: bookingRow.start_time,
              end_time: bookingRow.end_time,
              heads_count: bookingRow.heads_count,
              details_text: detailsText
            };
          }
        }

        await sendTicketConfirmationEmail(ticketObj, climber, domain, invoiceBuffer, invoiceNumber, createdTickets, bookingInfo);
      }
    } catch (err) {
      console.error('[EMAIL/BILLING ERROR] Error processing post-payment email/invoice:', err);
    }
    })();
    if (process.env.VERCEL) { await postPaymentWork; } else { postPaymentWork.catch(() => {}); }

    return { success: true, ticket: ticketObj, tickets: createdTickets, bookingFinalized };
  } else {
    // Update local status with the non-success status
    await dbRun(
      'UPDATE barion_payments SET status = ? WHERE payment_id = ?',
      [stateData.Status, paymentId]
    );

    // If payment ended in a terminal failure/cancellation state, delete the temporary reservation!
    const terminalFailedStates = ['Failed', 'Canceled', 'Expired', 'Rejected'];
    if (terminalFailedStates.includes(stateData.Status)) {
      try {
        if (localPayment.temp_booking_id) {
          await dbRun("DELETE FROM bookings WHERE status = 'PENDING' AND (id = ? OR payment_id = ?)", [localPayment.temp_booking_id, paymentId]);
        } else {
          await dbRun("DELETE FROM bookings WHERE status = 'PENDING' AND payment_id = ?", [paymentId]);
        }
        console.log(`[BARION] Released temporary booking for failed/canceled payment ${paymentId} (${stateData.Status})`);
      } catch (cleanupErr) {
        console.error('[BARION TEMP BOOKING CLEANUP ERROR]:', cleanupErr);
      }
    }

    return { success: false, status: stateData.Status };
  }
}

// Start Barion Payment (returns GatewayUrl)
app.post('/api/barion/start-payment', authenticateToken, async (req, res) => {
  try {
    await ensureCheckoutSchema();
    const {
      ticketType,
      quantity = 1,
      childQuantity = 0,
      companionType = null,
      companionQuantity = 0,
      tempBookingId = null,
      billingName,
      billingZip,
      billingCity,
      billingAddress,
      billingTaxNumber
    } = req.body;

    const conf = getTicketConfig(ticketType);
    if (!conf) {
      return res.status(400).json({ error: 'Érvénytelen jegytípus!' });
    }

    // Determine allowed quantity: 1 to 4 for daily tickets, strictly 1 for partner or passes
    let qty = 1;
    if (conf.isPartner || conf.baseType === 'HAVI' || conf.baseType === 'TIZ_ALKALMAS') {
      qty = 1;
    } else {
      qty = Math.max(1, Math.min(4, parseInt(quantity) || 1));
    }

    // Child ticket add-on (1-4 db NAPI_GYEREK) allowed for Adult / Student / Partner purchases
    const isMainChildTicket = (ticketType || '').includes('GYEREK');
    const childQty = isMainChildTicket ? 0 : Math.max(0, Math.min(4, parseInt(childQuantity) || 0));
    const childConf = getTicketConfig('NAPI_GYEREK');
    const childUnitPrice = childConf ? childConf.price : 2100;
    const childTotal = childQty * childUnitPrice;

    // Companion ticket (adult / student) offered together with a child ticket
    let companionConf = null;
    let companionTypeClean = null;
    let companionQty = 0;
    if (isMainChildTicket && companionType && ['NAPI', 'NAPI_DIAK'].includes(companionType)) {
      companionConf = getTicketConfig(companionType);
      if (companionConf) {
        companionTypeClean = companionType;
        companionQty = Math.max(1, Math.min(4, parseInt(companionQuantity) || 1));
      }
    }
    const companionTotal = companionConf ? companionQty * companionConf.price : 0;

    // Partner discount eligibility and companion abuse check
    if (conf.isPartner) {
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
      if (!user || !user.school_role || user.school_role === 'NONE' || !user.school_name) {
        return res.status(400).json({
          error: 'A partneriskolai 20%-os kedvezmény igénybevételéhez kérjük, jelöld be a profilodban a partneriskoládat (Eötvös, Kossuth vagy Zrínyi)!'
        });
      }
      if (conf.partnerRole && conf.partnerRole !== user.school_role) {
        const expectedRoleName = conf.partnerRole === 'TEACHER' ? 'tanári' : 'diák';
        return res.status(400).json({
          error: `Ez a partnerjegy kizárólag a partneriskolák ${expectedRoleName} státuszú tagjai számára érhető el!`
        });
      }

      // Duplikált párhuzamos korlátlan havi bérlet kiszűrése (különböző napijegyeket és alkalmakat előre megvehet)
      if (conf.baseType === 'HAVI') {
        const todayStr = new Date().toISOString().split('T')[0];
        const existingMonthly = await dbGet(
          "SELECT id, expires_date FROM tickets WHERE user_id = ? AND status = 'ACTIVE' AND expires_date >= ? AND ticket_type LIKE '%HAVI%PARTNER%'",
          [req.user.id, todayStr]
        );
        if (existingMonthly) {
          return res.status(400).json({
            error: `Már rendelkezel aktív korlátlan havi partnerbérlettel (érvényes: ${existingMonthly.expires_date}-ig)! Párhuzamosan futó második havi bérlet nem szükséges. Kísérőd vagy barátod számára kérjük, válaszd a megfelelő normál kategóriájú jegyet.`
          });
        }
      }
    }

    if (!BARION_POS_KEY || !BARION_PAYEE_EMAIL) {
      return res.status(500).json({ error: 'A Barion fizetés nincs konfigurálva a szerveren.' });
    }

    const price = conf.price;
    const mainItemTotal = price * qty;
    const totalPrice = mainItemTotal + childTotal + companionTotal;
    const ticketName = conf.fullName;
    const ticketDesc = conf.desc;

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const domain = `${protocol}://${host}`;

    // For Barion callbacks, always use the public production URL.
    // If the request comes from localhost, Barion cannot reach it → CallbackFailed.
    // BARION_CALLBACK_DOMAIN should be set in .env (e.g. https://webpage-tau-roan.vercel.app)
    const callbackDomain = cleanEnvValue(process.env.BARION_CALLBACK_DOMAIN) || domain;

    const items = [
      {
        Name: ticketName,
        Description: ticketDesc,
        Quantity: qty,
        Unit: 'db',
        UnitPrice: price,
        ItemTotal: mainItemTotal
      }
    ];

    if (childQty > 0) {
      items.push({
        Name: childConf ? childConf.fullName : 'Egyszeri Napijegy (Gyerek - 10 év alatt)',
        Description: childConf ? childConf.desc : 'Kedvezményes gyermek napijegy 10 éves kor alatt.',
        Quantity: childQty,
        Unit: 'db',
        UnitPrice: childUnitPrice,
        ItemTotal: childTotal
      });
    }

    if (companionConf && companionQty > 0) {
      items.push({
        Name: companionConf.fullName,
        Description: companionConf.desc,
        Quantity: companionQty,
        Unit: 'db',
        UnitPrice: companionConf.price,
        ItemTotal: companionTotal
      });
    }

    const paymentRequest = {
      POSKey: BARION_POS_KEY,
      PaymentType: 'Immediate',
      GuestCheckout: true,
      FundingSources: ['All'],
      PaymentRequestId: `hawk_${Date.now()}_${req.user.id}`,
      RedirectUrl: `${domain}/dashboard.html`,
      CallbackUrl: `${callbackDomain}/api/barion/callback`,
      Currency: 'HUF',
      Locale: 'hu-HU',
      SendPaymentMail: true,
      Transactions: [
        {
          POSTransactionId: `tx_${Date.now()}_${req.user.id}`,
          Payee: BARION_PAYEE_EMAIL,
          Total: totalPrice,
          Items: items
        }
      ]
    };

    console.log('[BARION] Initiating payment for user:', req.user.id, ticketType, 'Qty:', qty, 'ChildQty:', childQty, 'Total:', totalPrice);

    const response = await fetch(`${BARION_BASE_URL}/v2/Payment/Start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paymentRequest)
    });

    const responseData = await response.json();

    if (!response.ok || (responseData.Errors && responseData.Errors.length > 0)) {
      const errorMsg = formatBarionErrorMessage(responseData.Errors);
      console.error('[BARION ERROR] Failed to start payment:', responseData.Errors);
      // Release temporary reservation if payment failed to start
      if (tempBookingId) {
        await dbRun("DELETE FROM bookings WHERE id = ? AND user_id = ? AND status = 'PENDING'", [tempBookingId, req.user.id]);
      }
      return res.status(400).json({ error: `Barion hiba: ${errorMsg}` });
    }

    // Save payment details in database with Prepared status, child_quantity, temp_booking_id, and billing details
    await dbRun(
      `INSERT INTO barion_payments (
        payment_id, user_id, ticket_type, status, amount, quantity, child_quantity, temp_booking_id, companion_type, companion_quantity, processed,
        billing_name, billing_zip, billing_city, billing_address, billing_tax_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        responseData.PaymentId,
        req.user.id,
        ticketType,
        'Prepared',
        totalPrice,
        qty,
        childQty,
        tempBookingId ? parseInt(tempBookingId) : null,
        companionTypeClean,
        companionQty,
        billingName || '',
        billingZip || '',
        billingCity || '',
        billingAddress || '',
        billingTaxNumber || ''
      ]
    );

    // Link the temporary booking to this payment_id and refresh its expiration window
    if (tempBookingId) {
      await dbRun(
        "UPDATE bookings SET payment_id = ?, temp_expires_at = datetime('now', '+25 minutes') WHERE id = ? AND user_id = ? AND status = 'PENDING'",
        [responseData.PaymentId, tempBookingId, req.user.id]
      );
    }

    res.json({
      PaymentId: responseData.PaymentId,
      GatewayUrl: responseData.GatewayUrl
    });
  } catch (error) {
    console.error('[BARION EXCEPTION] Error starting payment:', error);
    res.status(500).json({ error: 'Belső szerverhiba a fizetés indításakor: ' + error.message });
  }
});

// Verify Barion Payment (called by client upon redirect callback)
app.post('/api/barion/verify-payment', authenticateToken, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) {
      return res.status(400).json({ error: 'Hiányzó fizetés azonosító!' });
    }

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const domain = `${protocol}://${host}`;

    const result = await processBarionPayment(paymentId, domain);
    if (result.success) {
      res.json({
        message: 'Fizetés sikeresen igazolva!',
        ticket: result.ticket,
        tickets: result.tickets,
        bookingFinalized: !!result.bookingFinalized
      });
    } else {
      res.status(400).json({ error: `Sikertelen fizetés! Státusz: ${result.status}. Az esetlegesen kiválasztott ideiglenes időpontfoglalás törlésre került.` });
    }
  } catch (error) {
    console.error('[BARION VERIFY ERROR]:', error);
    res.status(500).json({ error: 'Hiba az ellenőrzés során: ' + error.message });
  }
});

// Barion Webhook IPN Callback (Support both POST and GET callbacks)
// We must await the execution of processBarionPayment BEFORE sending the response.
// If we return 200 OK immediately and do fire-and-forget processing, serverless environments (like Vercel)
// will freeze execution, leading to truncated connections or 502/504 errors on Barion's end (CallbackFailed).
const handleBarionCallback = async (req, res) => {
  const paymentId = (req.body && (req.body.PaymentId || req.body.paymentId)) || 
                    (req.query && (req.query.PaymentId || req.query.paymentId));
  if (!paymentId) {
    console.warn('[BARION CALLBACK] Received callback without paymentId');
    return res.status(400).send('Missing paymentId');
  }

  console.log('[BARION CALLBACK] Received IPN for payment:', paymentId, '— processing payment state.');

  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host;
  const domain = `${protocol}://${host}`;

  try {
    const result = await processBarionPayment(paymentId, domain);
    if (result.alreadyProcessed) {
      console.log(`[BARION CALLBACK] Payment ${paymentId} was already processed — no action needed.`);
    } else if (result.success) {
      console.log(`[BARION CALLBACK] Payment ${paymentId} successfully processed.`);
    } else {
      console.log(`[BARION CALLBACK] Payment ${paymentId} not succeeded — status: ${result.status}`);
    }
    // Respond with 200 OK after successful processing
    res.status(200).send('OK');
  } catch (err) {
    console.error(`[BARION CALLBACK ERROR] Processing failed for payment ${paymentId}:`, err.message);
    // Return 500 error so Barion knows it failed and will retry
    res.status(500).send('Error processing callback: ' + err.message);
  }
};

app.post('/api/barion/callback', handleBarionCallback);
app.get('/api/barion/callback', handleBarionCallback);

// Barion Webhook IPN Callback
// We must await the execution of processBarionPayment BEFORE sending the response.
// If we return 200 OK immediately and do fire-and-forget processing, serverless environments (like Vercel)
// will freeze execution, leading to truncated connections or 502/504 errors on Barion's end (CallbackFailed).
app.post('/api/barion/callback', async (req, res) => {
  const paymentId = (req.body && (req.body.PaymentId || req.body.paymentId)) || 
                    (req.query && (req.query.PaymentId || req.query.paymentId));
  if (!paymentId) {
    console.warn('[BARION CALLBACK] Received callback without paymentId');
    return res.status(400).send('Missing paymentId');
  }

  console.log('[BARION CALLBACK] Received IPN for payment:', paymentId, '— processing payment state.');

  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host;
  const domain = `${protocol}://${host}`;

  try {
    const result = await processBarionPayment(paymentId, domain);
    if (result.alreadyProcessed) {
      console.log(`[BARION CALLBACK] Payment ${paymentId} was already processed — no action needed.`);
    } else if (result.success) {
      console.log(`[BARION CALLBACK] Payment ${paymentId} successfully processed.`);
    } else {
      console.log(`[BARION CALLBACK] Payment ${paymentId} not succeeded — status: ${result.status}`);
    }
    // Respond with 200 OK after successful processing
    res.status(200).send('OK');
  } catch (err) {
    console.error(`[BARION CALLBACK ERROR] Processing failed for payment ${paymentId}:`, err.message);
    // Return 500 error so Barion knows it failed and will retry
    res.status(500).send('Error processing callback: ' + err.message);
  }
});

// ---------------- TICKETS ----------------
// Purchase ticket simulation
app.post('/api/tickets/purchase', authenticateToken, async (req, res) => {
  try {
    const { ticketType } = req.body;
    const conf = getTicketConfig(ticketType);
    if (!conf) {
      return res.status(400).json({ error: 'Érvénytelen jegytípus!' });
    }

    // Partner discount eligibility and companion abuse check
    if (conf.isPartner) {
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
      if (!user || !user.school_role || user.school_role === 'NONE' || !user.school_name) {
        return res.status(400).json({
          error: 'A partneriskolai 20%-os kedvezmény igénybevételéhez kérjük, jelöld be a profilodban a partneriskoládat (Eötvös, Kossuth vagy Zrínyi)!'
        });
      }
      if (conf.partnerRole && conf.partnerRole !== user.school_role) {
        const expectedRoleName = conf.partnerRole === 'TEACHER' ? 'tanári' : 'diák';
        return res.status(400).json({
          error: `Ez a partnerjegy kizárólag a partneriskolák ${expectedRoleName} státuszú tagjai számára érhető el!`
        });
      }

      // Duplikált párhuzamos korlátlan havi bérlet kiszűrése (különböző napijegyeket és alkalmakat előre megvehet)
      if (conf.baseType === 'HAVI') {
        const todayStr = new Date().toISOString().split('T')[0];
        const existingMonthly = await dbGet(
          "SELECT id, expires_date FROM tickets WHERE user_id = ? AND status = 'ACTIVE' AND expires_date >= ? AND ticket_type LIKE '%HAVI%PARTNER%'",
          [req.user.id, todayStr]
        );
        if (existingMonthly) {
          return res.status(400).json({
            error: `Már rendelkezel aktív korlátlan havi partnerbérlettel (érvényes: ${existingMonthly.expires_date}-ig)! Párhuzamosan futó második havi bérlet nem szükséges. Kísérőd vagy barátod számára kérjük, válaszd a megfelelő normál kategóriájú jegyet.`
          });
        }
      }
    }

    const today = new Date();
    const purchaseDate = today.toISOString();
    
    // Calculate expiration date (30 days validity for all)
    const expires = new Date();
    expires.setDate(today.getDate() + 30);
    const expiresDate = expires.toISOString().split('T')[0];

    const sessions = conf.sessions;

    const qrUuid = generateUUID();

    const result = await dbRun(
      'INSERT INTO tickets (user_id, ticket_type, purchase_date, expires_date, sessions_remaining, qr_code_uuid) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, ticketType, purchaseDate, expiresDate, sessions, qrUuid]
    );

    const ticketId = result.lastID;
    const ticketObj = {
      id: ticketId,
      ticket_type: ticketType,
      purchase_date: purchaseDate,
      expires_date: expiresDate,
      sessions_remaining: sessions,
      qr_code_uuid: qrUuid
    };

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const domain = `${protocol}://${host}`;

    // Send confirmation email with PDF attached synchronously
    const climber = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (climber) {
      await sendTicketConfirmationEmail(ticketObj, climber, domain);
    }


    res.status(201).json({
      message: 'Sikeres jegyvásárlás!',
      ticketId: result.lastID,
      qr_code_uuid: qrUuid
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a vásárlás során: ' + error.message });
  }
});

// Helper to generate PDF buffer with solid background QR code
function generatePDFBuffer(ticket, climber, domain = 'https://wallclimber.vercel.app') {
  return new Promise(async (resolve, reject) => {
    try {
      const qrUrl = `${domain}/scanner.html?uuid=${ticket.qr_code_uuid}`;
      const qrBuffer = await qrcode.toBuffer(qrUrl, {
        type: 'png',
        width: 200,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });

      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve({ pdfData, qrBuffer });
      });

      // Register Arial font to support Hungarian accented characters (bundled inside project)
      const fontRegular = path.join(__dirname, 'public', 'fonts', 'arial.ttf');
      const fontBold = path.join(__dirname, 'public', 'fonts', 'arialbd.ttf');
      let fontName = 'Helvetica';
      let fontBoldName = 'Helvetica-Bold';
      
      if (fs.existsSync(fontRegular) && fs.existsSync(fontBold)) {
        doc.registerFont('Arial', fontRegular);
        doc.registerFont('Arial-Bold', fontBold);
        fontName = 'Arial';
        fontBoldName = 'Arial-Bold';
      } else {
        console.warn('[PDF] Arial fonts not found in public/fonts. Accents might be corrupted.');
      }


      // Draw branding header
      doc.fillColor('#ff6b00')
         .rect(0, 0, doc.page.width, 15)
         .fill();

      doc.moveDown(1);
      doc.fillColor('#0f111a')
         .fontSize(22)
         .font(fontBoldName)
         .text('HAWKSTONE VÁROSI MÁSZÓKLUB', { align: 'center' });
      
      doc.fontSize(10)
         .fillColor('#666666')
         .text('Web: hawkstone.hu | Helyszínek: Eötvös, Kossuth, Zrínyi', { align: 'center' });

      doc.moveDown(1.5);
      
      // Draw card background
      doc.strokeColor('#e2e8f0')
         .lineWidth(1)
         .rect(50, 95, doc.page.width - 100, 160)
         .stroke();

      // User and ticket credentials
      doc.fillColor('#000000')
         .fontSize(12)
         .font(fontBoldName)
         .text('BELÉPŐ KÁRTYA & IGAZOLÁS', 65, 110);

      doc.font(fontName)
         .fontSize(10)
         .text(`Név: ${climber.name}`, 65, 135)
         .text(`E-mail: ${climber.email}`, 65, 150)
         .text(`Telefon: ${climber.phone}`, 65, 165)
         .text(`Mászóengedély szám: ${climber.license_number || 'Nincs regisztrálva'}`, 65, 180);

      // Render Green/Red badge
      const badgeText = climber.card_type === 'ZÖLD' ? 'ZÖLD KÁRTYA (Biztosíthat)' : 'PIROS KÁRTYA (NEM biztosíthat)';
      const badgeColor = climber.card_type === 'ZÖLD' ? '#10b981' : '#ef4444';
      
      doc.fillColor(badgeColor)
         .rect(65, 200, 220, 20)
         .fill();
      doc.fillColor('#ffffff')
         .font(fontBoldName)
         .text(badgeText, 70, 206, { width: 210, align: 'center' });

      // Ticket details
      const conf = getTicketConfig(ticket.ticket_type);
      const HungarianType = conf ? conf.fullName : ticket.ticket_type;

      doc.fillColor('#000000')
         .font(fontName)
         .text(`Jegytípus: ${HungarianType}`, 65, 230)
         .text(`Lejárat dátuma: ${ticket.expires_date}`, 65, 242);

      // Embed QR code on the right side of the card
      doc.image(qrBuffer, 380, 105, { width: 140 });

      doc.moveDown(7.5);

      // Climbing rules section
      doc.fillColor('#000000')
         .fontSize(14)
         .font(fontBoldName)
         .text('MÁSZÓFAL HASZNÁLATI SZABÁLYZAT & FELELŐSSÉGNYILATKOZAT');

      doc.fontSize(8.5)
         .font(fontName)
         .fillColor('#333333')
         .moveDown(0.5);

      const rules = [
        '1. A mászófalat mindenki kizárólag a saját felelősségére használhatja.',
        '2. A zöld kártyával rendelkező tagok jogosultak mások biztosítására. A piros kártyás tagok nem biztosíthatnak, kizárólag önbiztosító (auto-belay) rendszeren, vagy zöld kártyás kísérő felügyelete mellett mászhatnak.',
        '3. A mászóterületen tiszta váltócipő és magnézia por mérsékelt használata engedélyezett.',
        '4. Bármilyen biztonsági kockázatot, sérülést vagy technikai hibát azonnal jelenteni kell a falmesternek (staff).',
        '5. Belépéskor a kapott QR kódot be kell mutatni a leolvasónál a teremben tartózkodó személyzetnek ellenőrzés céljából.',
        '6. A 10 alkalmas bérlet alkalmai a QR kód minden beolvasásakor 1 egységgel csökkennek. Az egyszer használatos jegy leolvasást követően érvénytelenné válik.',
        '7. A házirend megsértése a mászóklubból való azonnali kizárást vonhatja maga után.'
      ];

      rules.forEach(rule => {
        doc.text(rule, { align: 'justify' });
        doc.moveDown(0.3);
      });

      doc.moveDown(2);
      
      // Signatures
      doc.fontSize(9)
         .fillColor('#666666')
         .text('Dátum: ..................................', 50, 480)
         .text('Aláírás: ..................................', 350, 480);

       doc.end();
     } catch (e) {
       reject(e);
     }
   });
 }
 
 // ---------- Közös e-mail arculat (sötét háttér, bézs szöveg, az oldal narancs színe) ----------
const MAIL_THEME = {
  bg: '#12141d',
  panel: 'rgba(233, 223, 204, 0.06)',
  border: 'rgba(233, 223, 204, 0.16)',
  text: '#e9dfcc',
  muted: '#b3a68f',
  strong: '#f6eedd',
  accent: '#f27620'
};

function mailHeaderAttachment() {
  return {
    filename: 'mail_header.png',
    path: path.join(__dirname, 'public', 'pictures', 'letter', 'mail_header.png'),
    cid: 'mail_header_image'
  };
}

function mailRow(label, value, accent) {
  const T = MAIL_THEME;
  return `<tr>
    <td style="padding: 7px 0; color: ${T.muted}; font-size: 14px;">${label}</td>
    <td style="padding: 7px 0; text-align: right; color: ${accent ? T.accent : T.strong}; font-size: 15px; font-weight: 600;"><a style="color: ${accent ? T.accent : T.strong}; text-decoration: none; pointer-events: none;">${value}</a></td>
  </tr>`;
}

function brandedMail({ title, subtitle, bodyHtml, footerHtml }) {
  const T = MAIL_THEME;
  return `
  <div style="background: ${T.bg}; padding: 24px 12px;">
    <div style="font-family: Arial, Helvetica, sans-serif; background: ${T.bg}; color: ${T.text}; max-width: 600px; margin: 0 auto; border: 1px solid ${T.border}; border-radius: 12px; padding: 28px;">
      <img src="cid:mail_header_image" alt="HawkStone" style="width: 100%; max-width: 600px; display: block; border-radius: 8px; margin-bottom: 24px;">
      <h2 style="color: ${T.accent}; font-weight: 600; font-size: 22px; letter-spacing: 0.02em; text-align: center; margin: 0 0 6px 0;">${title}</h2>
      ${subtitle ? `<p style="text-align: center; margin: 0 0 22px 0; color: ${T.muted}; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;">${subtitle}</p>` : '<div style="height: 14px;"></div>'}
      ${bodyHtml}
      <hr style="border: 0; border-top: 1px solid ${T.border}; margin: 26px 0 16px 0;">
      <div style="font-size: 12px; line-height: 1.6; color: ${T.muted}; text-align: center;">
        ${footerHtml || 'Üdvözlettel,<br>HawkStone Csapata'}
      </div>
    </div>
  </div>`;
}

function buildBookingEmailHtml(climber, info, domain, gcal, weekday) {
  const T = MAIL_THEME;
  const body = `
    <p style="font-size: 15px; line-height: 1.65; color: ${T.text}; margin: 0 0 20px 0;">
      Kedves ${climber.name}, a helyed a falon biztosított – várunk a HawkStone Városi Mászóklubban!
    </p>
    <div style="background: ${T.panel}; border: 1px solid ${T.border}; border-radius: 10px; padding: 16px 20px; margin: 0 0 22px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        ${mailRow('Helyszín', info.location_name)}
        ${info.location_address ? mailRow('Cím', info.location_address) : ''}
        ${mailRow('Dátum', info.booking_date + ' (' + weekday + ')')}
        ${mailRow('Idősáv', info.start_time + ' – ' + info.end_time, true)}
        ${mailRow('Létszám', info.heads_count + ' fő (' + info.details_text + ')')}
      </table>
    </div>
    <div style="text-align: center; margin: 0 0 10px 0;">
      <a href="${gcal}" style="background: transparent; border: 1.5px solid ${T.accent}; color: ${T.accent}; padding: 11px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;"><span style="font-family: Arial, Helvetica, sans-serif; font-weight: 700; font-size: 17px; margin-right: 8px; vertical-align: middle;"><span style="color:#4285F4;">G</span></span><span style="vertical-align: middle;">Hozzáadás a Google Naptárhoz</span></a>
    </div>
    <p style="font-size: 12px; line-height: 1.6; color: ${T.muted}; text-align: center; margin: 0 0 22px 0;">
      Apple vagy Outlook naptárhoz használd a csatolt .ics fájlt – egy kattintással bekerül az esemény egy 2 órás emlékeztetővel.
    </p>
    <div style="background: ${T.panel}; border: 1px solid ${T.border}; border-radius: 8px; padding: 14px 16px; font-size: 13px; line-height: 1.6; color: ${T.text};">
      Belépéskor mutasd be a jegyed QR kódját (a Mászói Fiókban is megtalálod). A foglalást a fiókodban az Időpontfoglalás fülön tudod megtekinteni vagy lemondani.
    </div>
    <div style="text-align: center; margin: 22px 0 0 0;">
      <a href="${domain}/dashboard.html" style="color: ${T.accent}; font-weight: 600; font-size: 15px; text-decoration: none;">Mászói Fiók megnyitása →</a>
    </div>`;
  return brandedMail({ title: 'Időpontfoglalás rögzítve', subtitle: 'Foglalás visszaigazolása', bodyHtml: body });
}

// ---------- Booking calendar (.ics) + booking confirmation e-mail ----------
function icsEscape(t) {
  return String(t == null ? '' : t)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function icsLocalStamp(dateStr, timeStr) {
  const d = String(dateStr).replace(/-/g, '');
  const t = String(timeStr || '00:00').replace(':', '').padEnd(4, '0').slice(0, 4);
  return d + 'T' + t + '00';
}

function buildBookingIcs(info) {
  const uid = 'booking-' + (info.id || Date.now()) + '@hawkstone.hu';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const place = info.location_name + (info.location_address ? ', ' + info.location_address : '');
  const description = [
    'HawkStone Városi Mászóklub – időpontfoglalás',
    'Létszám: ' + info.heads_count + ' fő (' + info.details_text + ')',
    'Belépéskor mutasd be a jegyed QR kódját (a Mászói Fiókban is megtalálod).'
  ].join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HawkStone//Maszoklub//HU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Budapest',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + stamp,
    'DTSTART;TZID=Europe/Budapest:' + icsLocalStamp(info.booking_date, info.start_time),
    'DTEND;TZID=Europe/Budapest:' + icsLocalStamp(info.booking_date, info.end_time),
    'SUMMARY:' + icsEscape('HawkStone mászás – ' + info.location_name),
    'LOCATION:' + icsEscape(place),
    'DESCRIPTION:' + icsEscape(description),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + icsEscape('HawkStone mászás 2 óra múlva'),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.join('\r\n') + '\r\n';
}

function buildGoogleCalendarUrl(info) {
  const place = info.location_name + (info.location_address ? ', ' + info.location_address : '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'HawkStone mászás – ' + info.location_name,
    dates: icsLocalStamp(info.booking_date, info.start_time) + '/' + icsLocalStamp(info.booking_date, info.end_time),
    ctz: 'Europe/Budapest',
    location: place,
    details: 'HawkStone Városi Mászóklub – ' + info.heads_count + ' fő (' + info.details_text + '). Belépéskor mutasd be a jegyed QR kódját.'
  });
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function describeBookingAttendees(bookingType, adultCount, childCount, headsCount) {
  if (bookingType === 'CHILD_ONLY') return childCount + ' gyermek (kísérővel)';
  if (bookingType === 'SELF_AND_CHILD') return (adultCount || 1) + ' felnőtt + ' + childCount + ' gyermek';
  return (adultCount || headsCount || 1) + ' felnőtt';
}

async function sendBookingConfirmationEmail(climber, info, domain) {
  try {
    if (!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)) {
      console.log('[EMAIL MOCK] SMTP not configured. Booking email would be sent to ' + climber.email);
      return;
    }
    const weekday = new Date(info.booking_date + 'T12:00:00').toLocaleDateString('hu-HU', { weekday: 'long' });
    const gcal = buildGoogleCalendarUrl(info);
    const icsContent = buildBookingIcs(info);
    const subject = 'HawkStone időpontfoglalás – ' + info.booking_date + ' ' + info.start_time;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"HawkStone" <noreply@hawkstone.hu>',
      to: climber.email,
      subject,
      text: 'Kedves ' + climber.name + '!\n\nIdőpontfoglalásodat rögzítettük.\n\nHelyszín: ' + info.location_name + (info.location_address ? ' (' + info.location_address + ')' : '') + '\nDátum: ' + info.booking_date + ' (' + weekday + ')\nIdősáv: ' + info.start_time + ' – ' + info.end_time + '\nLétszám: ' + info.heads_count + ' fő (' + info.details_text + ')\n\nA csatolt .ics fájllal hozzáadhatod a naptáradhoz, vagy használd ezt a linket (Google Naptár): ' + gcal + '\n\nBelépéskor mutasd be a jegyed QR kódját. A foglalást a Mászói Fiókban kezelheted: ' + domain + '/dashboard.html\n\nÜdvözlettel,\nHawkStone Csapata',
      html: buildBookingEmailHtml(climber, info, domain, gcal, weekday),
      attachments: [
        mailHeaderAttachment(),
        { filename: 'hawkstone-foglalas.ics', content: icsContent, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }
      ]
    });
    console.log('[EMAIL] Booking confirmation sent to ' + climber.email);
  } catch (err) {
    console.error('[EMAIL ERROR] Failed to send booking confirmation email:', err);
  }
}

// Send ticket purchase confirmation email with dynamic domain and inline QR code
 async function sendTicketConfirmationEmail(ticket, climber, domain, invoiceBuffer = null, invoiceNumber = null, allTickets = [], bookingInfo = null) {
  try {
    const { pdfData, qrBuffer } = await generatePDFBuffer(ticket, climber, domain);

    const conf = getTicketConfig(ticket.ticket_type);
    const HungarianType = conf ? conf.fullName : ticket.ticket_type;
    const baseType = getTicketBaseType(ticket.ticket_type);

    const ticketsList = (allTickets && allTickets.length > 0) ? allTickets : [ticket];
    const totalAmount = ticketsList.reduce((sum, t) => {
      const c = getTicketConfig(t.ticket_type);
      return sum + (c ? c.price : 0);
    }, 0);
    const totalAmountText = `${totalAmount.toLocaleString('hu-HU')} Ft`;

    let sessionsText = '';
    if (baseType === 'NAPI') {
      sessionsText = '1 alkalom (felhasználható)';
    } else if (baseType === 'TIZ_ALKALMAS') {
      sessionsText = '10 alkalom';
    } else if (baseType === 'HAVI') {
      sessionsText = 'Korlátlan (30 napig)';
    }

    const ticketsRowsHtml = ticketsList.map(t => {
      const c = getTicketConfig(t.ticket_type);
      const name = c ? c.fullName : t.ticket_type;
      const price = c ? `${c.price.toLocaleString('hu-HU')} Ft` : '';
      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 8px 6px; color: #ff6b00; font-weight: 700;">🎫 #${t.id}</td>
          <td style="padding: 8px 6px; color: #ffffff;">${name}</td>
          <td style="padding: 8px 6px; color: #ffffff; text-align: right; font-weight: 600;">${price}</td>
        </tr>
      `;
    }).join('');

    const ticketIdsText = ticketsList.map(t => `#${t.id}`).join(', ');

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"HawkStone" <noreply@hawkstone.hu>`,
        to: climber.email,
        subject: `HawkStone Jegyvásárlás - ${HungarianType}${ticketsList.length > 1 ? ` (+${ticketsList.length - 1} db jegy)` : ''}`,
        text: `Kedves ${climber.name}!\n\nKöszönjük jegyvásárlásodat a HawkStone Városi Mászóklubban.\n\nA vásárolt jegyek:\n${ticketsList.map(t => {
          const c = getTicketConfig(t.ticket_type);
          return `- #${t.id}: ${c ? c.fullName : t.ticket_type} (${c ? c.price.toLocaleString('hu-HU') : ''} Ft)`;
        }).join('\n')}\n\nÖsszesen fizetve: ${totalAmountText}\nVásárlás dátuma: ${ticket.purchase_date.substring(0, 10)}\nLejárat dátuma: ${ticket.expires_date}\n\nELÁLLÁSI / FELMONDÁSI JOG: A vásárlástól számított 14 napon belül elállhatsz a szerződéstől. Tájékoztatjuk, hogy a 45/2014. (II. 26.) Korm. rendelet értelmében a vásárlással kifejezetten kérte a szolgáltatás teljesítésének megkezdését az elállási határidő lejárta előtt. Tudomásul veszi, hogy az azonnali megkezdés miatt elállás (szerződés felmondás) esetén köteles megtéríteni számunkra a szerződés megszűnésének időpontjáig arányosan teljesített szolgáltatásért járó összeget, illetve napijegy esetén a szolgáltatás teljes egészének teljesítését követően (a terembe való belépéssel) elállási/felmondási jogát elveszíti. Az elálláshoz szükséges a Jegy azonosítója (${ticketIdsText}), melyet megadhatsz az elállási oldalon: ${domain}/withdrawal.html\n\nA belépő QR kódot és a szabályzatot tartalmazó PDF igazolást csatoltuk ehhez a levélhez.\n\nÜdvözlettel,\nHawkStone Csapata`,
        html: `
          <div style="font-family: 'Inter', sans-serif; background-color: #0c0e17; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.08);">
            <img src="cid:mail_header_image" alt="HawkStone" style="width: 100%; max-width: 600px; display: block; border-radius: 8px; margin-bottom: 25px;">
            <h2 style="color: #ff6b00; font-family: 'Outfit', sans-serif; margin-bottom: 15px; text-align: center; font-size: 24px;">Sikeres vásárlás!</h2>
            <p style="font-size: 15px; line-height: 1.6; color: #f27620; text-align: center;">Kedves ${climber.name}, köszönjük a vásárlást a <strong>HawkStone Városi Mászóklubban</strong>.</p>
            
            <!-- Ticket Info Card -->
            <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); padding: 20px; border-radius: 10px; margin: 25px 0;">
              <h3 style="margin: 0 0 15px 0; color: #ff6b00; font-family: 'Outfit', sans-serif; font-size: 19px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">Vásárolt Jegyek (${ticketsList.length} db)</h3>
              <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 15px;">
                <thead>
                  <tr style="color: #f27620; font-size: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <th style="padding: 6px;">ID</th>
                    <th style="padding: 6px;">Jegytípus</th>
                    <th style="padding: 6px; text-align: right;">Ár</th>
                  </tr>
                </thead>
                <tbody>
                  ${ticketsRowsHtml}
                </tbody>
              </table>

              <table style="width: 100%; border-collapse: collapse; font-size: 14px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
                <tr style="background: rgba(255, 107, 0, 0.08); border-radius: 6px;">
                  <td style="padding: 10px 8px; color: #ff6b00; font-weight: 600;">Fizetett végösszeg:</td>
                  <td style="padding: 10px 8px; color: #ff6b00; text-align: right; font-weight: 600; font-size: 19px;">${totalAmountText}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 8px; color: #f27620;">Vásárlás időpontja:</td>
                  <td style="padding: 6px 8px; color: #ffffff; text-align: right;">${ticket.purchase_date.substring(0, 10)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 8px; color: #f27620;">Lejárat dátuma:</td>
                  <td style="padding: 6px 8px; color: #ffffff; text-align: right;">${ticket.expires_date}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 8px; color: #f27620;">Alkalmak száma:</td>
                  <td style="padding: 6px 8px; color: #ffffff; text-align: right;">${sessionsText}</td>
                </tr>
              </table>
            </div>

            <!-- Withdrawal Info Box -->
            <div style="background: rgba(255, 107, 0, 0.05); border: 1px solid rgba(255, 107, 0, 0.2); padding: 15px 18px; border-radius: 8px; margin: 0 0 20px 0;">
               <p style="margin: 0 0 6px 0; font-size: 13px; color: #ff6b00; font-weight: 600;">⚠️ Elállási és Felmondási jog (45/2014. Korm. rendelet)</p>
               <p style="margin: 0; font-size: 12px; color: #f27620; line-height: 1.5;">A vásárlástól számított <strong style="color:#fff;">14 napon belül</strong> online elállhatsz a szerződéstől (szolgáltatás megkezdése után felmondás). Az elálláshoz szükséges a fenti jegyazonosító(k): <strong style="color:#ff6b00;">${ticketIdsText}</strong>, amelyet add meg az <a href="${domain}/withdrawal.html" style="color:#2ecc71;">elállási oldalon</a>.</p>
               <p style="margin: 8px 0 0 0; font-size: 11px; color: #f27620; line-height: 1.4; border-top: 1px solid rgba(255,107,0,0.15); padding-top: 8px;"><em>Tájékoztatás: A vásárlással kifejezetten kérted a szolgáltatás teljesítésének megkezdését az elállási határidő lejárta előtt. Tudomásul veszed, hogy elállás (szerződés felmondás) esetén köteles vagy megtéríteni számunkra a szerződés megszűnésének időpontjáig arányosan teljesített szolgáltatásért járó összeget, illetve napijegy esetén a szolgáltatás teljes egészének teljesítését követően (a terembe történő belépéssel) elállási jogodat elveszíted.</em></p>
             </div>

            ${bookingInfo ? `
            <!-- Confirmed Booking Card -->
            <div style="background: rgba(233, 223, 204, 0.06); border: 1px solid rgba(233, 223, 204, 0.16); padding: 18px; border-radius: 10px; margin: 20px 0;">
              <h3 style="margin: 0 0 10px 0; color: #f27620; font-family: 'Outfit', sans-serif; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                Véglegesített időpontfoglalás
              </h3>
              <p style="margin: 0 0 8px 0; font-size: 13.5px; color: #e9dfcc; line-height: 1.5;">
                A vásárláshoz kiválasztott mászóidőpontodat sikeresen véglegesítettük a naptárunkban:
              </p>
              <div style="background: rgba(0,0,0,0.20); padding: 10px 14px; border-radius: 6px; font-size: 13px; line-height: 1.6; color: #e9dfcc;">
                <div><strong>Helyszín:</strong> ${bookingInfo.location_name}</div>
                <div><strong>Dátum:</strong> ${bookingInfo.booking_date}</div>
                <div><strong>Idősáv:</strong> ${bookingInfo.start_time} - ${bookingInfo.end_time}</div>
                <div><strong>Létszám:</strong> ${bookingInfo.heads_count} fő (${bookingInfo.details_text})</div>
                <div style="margin-top:8px; font-size:12px; color:#b3a68f;">A csatolt <strong>.ics</strong> fájllal egy kattintással hozzáadhatod a naptáradhoz.</div>
              </div>
            </div>` : ''}

            ${invoiceNumber ? `
            <!-- Invoice Box -->
            <div style="background: rgba(46, 204, 113, 0.05); border: 1px solid rgba(46, 204, 113, 0.2); padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <p style="margin: 0; font-size: 14px; color: #2ecc71;"><strong>A kiállított e-számla (${invoiceNumber}) elkészült és csatolva van ehhez a levélhez.</strong></p>
            </div>` : ''}

            <!-- QR Code Section -->
            <div style="text-align: center; margin: 30px 0;">
              <p style="font-size: 15px; color: #f27620; margin-bottom: 15px;"><strong>Fő Belépő QR kódod:</strong></p>
              <div style="display: inline-block; background: #ffffff; padding: 15px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
                <img src="cid:qr_code_image" alt="QR kód a belépéshez" style="width: 160px; height: 160px; display: block;">
              </div>
              <p style="font-size: 12px; color: #f27620; margin-top: 10px;">Mutasd be ezt a QR kódot a leolvasónál a belépéshez.</p>
            </div>

            <!-- Action Button -->
            <div style="text-align: center; margin: 30px 0;">
              <a href="${domain}/dashboard.html" style="background: linear-gradient(135deg, #ff6b00 0%, #ff8c00 100%); color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; box-shadow: 0 4px 15px rgba(255, 107, 0, 0.4);">Mászói Fiók megnyitása</a>
            </div>

            <p style="font-size: 14px; line-height: 1.6; color: #f27620; text-align: center;">A belépéshez szükséges szabályzatot és az aláírandó felelősségnyilatkozatot tartalmazó PDF igazolást csatoltuk ehhez a levélhez.</p>
            <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 25px 0;">
            <p style="font-size: 12px; color: #f27620; text-align: center; margin: 0;">Üdvözlettel,<br><strong>HawkStone Csapata</strong></p>
          </div>
        `,
        attachments: [
          {
            filename: 'mail_header.png',
            path: path.join(__dirname, 'public', 'pictures', 'letter', 'mail_header.png'),
            cid: 'mail_header_image'
          },
          {
            filename: 'qr_code.png',
            content: qrBuffer,
            cid: 'qr_code_image'
          },
          {
            filename: `HawkStone_Szabalyzat_${ticket.id}.pdf`,
            content: pdfData
          },
          ...(bookingInfo ? [{ filename: 'hawkstone-foglalas.ics', content: buildBookingIcs(bookingInfo), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] : []),
...(invoiceBuffer ? [{
            filename: `Szamla_${invoiceNumber}.pdf`,
            content: invoiceBuffer
          }] : [])
        ]
      });
    console.log(`[EMAIL] Trendy purchase confirmation email sent successfully to ${climber.email}`);
     } else {
       console.log(`[EMAIL MOCK] SMTP not configured. Purchase email for ticket ${ticket.id} would be sent to ${climber.email}`);
     }
   } catch (err) {
     console.error('[EMAIL ERROR] Failed to send ticket confirmation email:', err);
   }
 }
 
 // Generate e-invoice using Számlázz.hu Számla Agent XML API
 async function createSzamlazzInvoice(payment, climber) {
  const SZAMLAZZ_KEY = process.env.SZAMLAZZ_KEY;
  if (!SZAMLAZZ_KEY) {
    console.log('[SZAMLAZZ] Agent key (SZAMLAZZ_KEY) not configured. Skipping invoice generation.');
    return null;
  }

  const today = new Date().toISOString().split('T')[0];
  
  const conf = getTicketConfig(payment.ticket_type);
  let itemName = conf ? conf.fullName : (payment.ticket_type || 'HawkStone Szolgáltatás');
  const qty = Math.max(1, parseInt(payment.quantity) || 1);
  const totalBrutto = payment.amount;

  // Build invoice lines from what was actually purchased (main + child + companion tickets)
  const rawLines = [];
  const mainUnit = conf ? conf.price : totalBrutto / qty;
  rawLines.push({ name: itemName, qty, unit: mainUnit });
  const invChildQty = parseInt(payment.child_quantity) || 0;
  if (invChildQty > 0) {
    const cc = getTicketConfig('NAPI_GYEREK');
    rawLines.push({ name: cc ? cc.fullName : 'Egyszeri Napijegy (Gyerek)', qty: invChildQty, unit: cc ? cc.price : 2100 });
  }
  const invCompQty = parseInt(payment.companion_quantity) || 0;
  if (invCompQty > 0 && payment.companion_type) {
    const pc = getTicketConfig(payment.companion_type);
    if (pc) rawLines.push({ name: pc.fullName, qty: invCompQty, unit: pc.price });
  }
  let linesSum = rawLines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  // Safety: if the computed lines do not match the paid amount, fall back to a single line
  const invoiceLines = (Math.round(linesSum) === Math.round(totalBrutto))
    ? rawLines
    : [{ name: itemName, qty: 1, unit: totalBrutto }];

  const tetelekXml = invoiceLines.map(l => {
    const lineBrutto = Math.round(l.unit * l.qty);
    const unitNetto = (l.unit / 1.27).toFixed(2);
    const lineNetto = (parseFloat(unitNetto) * l.qty).toFixed(2);
    const lineAfa = (lineBrutto - parseFloat(lineNetto)).toFixed(2);
    return '    <tetel>\n' +
      '      <megnevezes><![CDATA[' + l.name + ']]></megnevezes>\n' +
      '      <mennyiseg>' + l.qty + '.0</mennyiseg>\n' +
      '      <mennyisegiEgyseg>db</mennyisegiEgyseg>\n' +
      '      <nettoEgysegar>' + unitNetto + '</nettoEgysegar>\n' +
      '      <afakulcs>27</afakulcs>\n' +
      '      <nettoErtek>' + lineNetto + '</nettoErtek>\n' +
      '      <afaErtek>' + lineAfa + '</afaErtek>\n' +
      '      <bruttoErtek>' + lineBrutto + '</bruttoErtek>\n' +
      '    </tetel>';
  }).join('\n');

  // Build the XML payload strictly matching Számla Agent schema
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
  <beallitasok>
    <szamlaagentkulcs>${SZAMLAZZ_KEY}</szamlaagentkulcs>
    <eszamla>true</eszamla>
    <szamlaLetoltes>true</szamlaLetoltes>
    <valaszVerzio>2</valaszVerzio>
  </beallitasok>
  <fejlec>
    <keltDatum>${today}</keltDatum>
    <teljesitesDatum>${today}</teljesitesDatum>
    <fizetesiHataridoDatum>${today}</fizetesiHataridoDatum>
    <fizmod>Bankkártya</fizmod>
    <penznem>HUF</penznem>
    <szamlaNyelve>hu</szamlaNyelve>
    <megjegyzes>Fizetve a Barion rendszerén keresztül. Tranzakció: ${payment.payment_id}</megjegyzes>
    <fizetve>true</fizetve>
  </fejlec>
  <elado>
  </elado>
  <vevo>
    <nev><![CDATA[${payment.billing_name}]]></nev>
    <irsz>${payment.billing_zip}</irsz>
    <telepules><![CDATA[${payment.billing_city}]]></telepules>
    <cim><![CDATA[${payment.billing_address}]]></cim>
    <email>${climber.email}</email>
    <sendEmail>false</sendEmail>
    ${payment.billing_tax_number ? `<adoszam>${payment.billing_tax_number}</adoszam>` : ''}
  </vevo>
  <tetelek>
${tetelekXml}
  </tetelek>
</xmlszamla>`;

  // Manual multipart/form-data boundary construction for robust serverless support without external libs
  const boundary = '----SzamlazzAgentBoundary' + Math.random().toString(36).substring(2);
  const bodyParts = [];
  bodyParts.push(`--${boundary}\r\n`);
  bodyParts.push(`Content-Disposition: form-data; name="action-xmlagentxmlfile"; filename="request.xml"\r\n`);
  bodyParts.push(`Content-Type: text/xml\r\n\r\n`);
  bodyParts.push(xml);
  bodyParts.push(`\r\n--${boundary}--\r\n`);

  const requestBody = bodyParts.join('');

  try {
    console.log('[SZAMLAZZ] Sending invoice generation request for payment:', payment.payment_id);
    
    const response = await fetch('https://www.szamlazz.hu/szamla/', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(requestBody).toString()
      },
      body: requestBody
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`Számlázz.hu HTTP Error: ${response.status}`);
    }

    const matchesSikeres = responseText.match(/<sikeres>(.*?)<\/sikeres>/);
    const isSuccess = matchesSikeres && matchesSikeres[1] === 'true';

    if (isSuccess) {
      const matchesSzamlaszam = responseText.match(/<szamlaszam>(.*?)<\/szamlaszam>/);
      const szamlaSzam = matchesSzamlaszam ? matchesSzamlaszam[1] : 'ISMERETLEN';
      
      const matchesPdf = responseText.match(/<pdf>([\s\S]*?)<\/pdf>/);
      const pdfBase64 = matchesPdf ? matchesPdf[1] : null;

      console.log(`[SZAMLAZZ] Invoice generated successfully. Invoice Number: ${szamlaSzam}`);
      return {
        success: true,
        szamlaszam: szamlaSzam,
        pdfBuffer: pdfBase64 ? Buffer.from(pdfBase64, 'base64') : null
      };
    } else {
      const matchesHiba = responseText.match(/<hibauzenet>(.*?)<\/hibauzenet>/);
      const errorMsg = matchesHiba ? matchesHiba[1] : 'Ismeretlen számlázási hiba';
      console.error(`[SZAMLAZZ ERROR] Invoice generation failed: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }
  } catch (error) {
     console.error('[SZAMLAZZ EXCEPTION] Invoice request failed:', error);
     return {
       success: false,
       error: error.message
     };
   }
 }

 // Generate refund invoice (stornó or corrective) using Számlázz.hu
 async function createSzamlazzRefundInvoice(payment, originalInvoiceNumber, climber, refundAmount, isFullStorno) {
   const SZAMLAZZ_KEY = process.env.SZAMLAZZ_KEY;
   if (!SZAMLAZZ_KEY) {
     console.log('[SZAMLAZZ] Agent key (SZAMLAZZ_KEY) not configured. Skipping refund invoice generation.');
     return null;
   }

   const today = new Date().toISOString().split('T')[0];
   let xml = '';
   let actionName = '';
   let fileName = '';

   if (isFullStorno) {
     actionName = 'action-szamla_agent_st';
     fileName = 'storno.xml';
     xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlast xmlns="http://www.szamlazz.hu/xmlszamlast" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlast xmlszamlast.xsd">
 <beallitasok>
   <szamlaagentkulcs>${SZAMLAZZ_KEY}</szamlaagentkulcs>
   <eszamla>true</eszamla>
   <szamlaLetoltes>true</szamlaLetoltes>
   <valaszVerzio>2</valaszVerzio>
 </beallitasok>
 <fejlec>
   <szamlaszam>${originalInvoiceNumber}</szamlaszam>
   <keltDatum>${today}</keltDatum>
 </fejlec>
</xmlszamlast>`;
   } else {
     actionName = 'action-xmlagentxmlfile';
     fileName = 'request.xml';

     const conf = getTicketConfig(payment.ticket_type);
     const itemName = conf ? conf.fullName : (payment.ticket_type || 'HawkStone Szolgáltatás');

     // Calculations for pro-rated refund with negative values
     const price = -refundAmount;
     const netto = (price / 1.27).toFixed(2);
     const afa = (price - parseFloat(netto)).toFixed(2);

     xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
 <beallitasok>
   <szamlaagentkulcs>${SZAMLAZZ_KEY}</szamlaagentkulcs>
   <eszamla>true</eszamla>
   <szamlaLetoltes>true</szamlaLetoltes>
   <valaszVerzio>2</valaszVerzio>
 </beallitasok>
 <fejlec>
   <keltDatum>${today}</keltDatum>
   <teljesitesDatum>${today}</teljesitesDatum>
   <fizetesiHataridoDatum>${today}</fizetesiHataridoDatum>
   <fizmod>Bankkártya</fizmod>
   <penznem>HUF</penznem>
   <szamlaNyelve>hu</szamlaNyelve>
   <megjegyzes>Helyesbítés elállás miatt. Eredeti számla: ${originalInvoiceNumber}</megjegyzes>
   <helyesbitoszamla>true</helyesbitoszamla>
   <helyesbitettSzamlaszam>${originalInvoiceNumber}</helyesbitettSzamlaszam>
   <fizetve>true</fizetve>
 </fejlec>
 <elado>
 </elado>
 <vevo>
   <nev><![CDATA[${payment.billing_name}]]></nev>
   <irsz>${payment.billing_zip}</irsz>
   <telepules><![CDATA[${payment.billing_city}]]></telepules>
   <cim><![CDATA[${payment.billing_address}]]></cim>
   <email>${climber.email}</email>
   <sendEmail>false</sendEmail>
   ${payment.billing_tax_number ? `<adoszam>${payment.billing_tax_number}</adoszam>` : ''}
 </vevo>
 <tetelek>
   <tetel>
     <megnevezes><![CDATA[Részleges elállás miatti visszatérítés - ${itemName}]]></megnevezes>
     <mennyiseg>1.0</mennyiseg>
     <mennyisegiEgyseg>db</mennyisegiEgyseg>
     <nettoEgysegar>${netto}</nettoEgysegar>
     <afakulcs>27</afakulcs>
     <nettoErtek>${netto}</nettoErtek>
     <afaErtek>${afa}</afaErtek>
     <bruttoErtek>${price}</bruttoErtek>
   </tetel>
 </tetelek>
</xmlszamla>`;
   }

   const boundary = '----SzamlazzAgentBoundary' + Math.random().toString(36).substring(2);
   const bodyParts = [];
   bodyParts.push(`--${boundary}\r\n`);
   bodyParts.push(`Content-Disposition: form-data; name="${actionName}"; filename="${fileName}"\r\n`);
   bodyParts.push(`Content-Type: text/xml\r\n\r\n`);
   bodyParts.push(xml);
   bodyParts.push(`\r\n--${boundary}--\r\n`);

   const requestBody = bodyParts.join('');

   try {
     console.log(`[SZAMLAZZ] Sending refund invoice (${isFullStorno ? 'stornó' : 'helyesbítő'}) request for original invoice:`, originalInvoiceNumber);
     
     const response = await fetch('https://www.szamlazz.hu/szamla/', {
       method: 'POST',
       headers: {
         'Content-Type': `multipart/form-data; boundary=${boundary}`,
         'Content-Length': Buffer.byteLength(requestBody).toString()
       },
       body: requestBody
     });

     const responseText = await response.text();

     if (!response.ok) {
       throw new Error(`Számlázz.hu HTTP Error: ${response.status}`);
     }

     const matchesSikeres = responseText.match(/<sikeres>(.*?)<\/sikeres>/);
     const isSuccess = matchesSikeres && matchesSikeres[1] === 'true';

     if (isSuccess) {
       const matchesSzamlaszam = responseText.match(/<szamlaszam>(.*?)<\/szamlaszam>/);
       const szamlaSzam = matchesSzamlaszam ? matchesSzamlaszam[1] : 'ISMERETLEN';
       
       const matchesPdf = responseText.match(/<pdf>([\s\S]*?)<\/pdf>/);
       const pdfBase64 = matchesPdf ? matchesPdf[1] : null;

       console.log(`[SZAMLAZZ] Refund invoice generated successfully. Invoice Number: ${szamlaSzam}`);
       return {
         success: true,
         szamlaszam: szamlaSzam,
         pdfBuffer: pdfBase64 ? Buffer.from(pdfBase64, 'base64') : null
       };
     } else {
       const matchesHiba = responseText.match(/<hibauzenet>(.*?)<\/hibauzenet>/);
       const errorMsg = matchesHiba ? matchesHiba[1] : 'Ismeretlen számlázási hiba';
       console.error(`[SZAMLAZZ ERROR] Refund invoice generation failed: ${errorMsg}`);
       return {
         success: false,
         error: errorMsg
       };
     }
   } catch (error) {
     console.error('[SZAMLAZZ EXCEPTION] Refund invoice request failed:', error);
     return {
       success: false,
       error: error.message
     };
   }
 }

 // Send refund confirmation email to customer with refund invoice attached
 async function sendRefundEmail(climber, ticket, refundAmount, invoiceBuffer = null, invoiceNumber = null, isFullStorno = false) {
   try {
     const conf = getTicketConfig(ticket.ticket_type);
     const HungarianType = conf ? conf.fullName : ticket.ticket_type;

     const docType = isFullStorno ? 'Sztornó számla' : 'Helyesbítő számla';
     const docTypeLower = isFullStorno ? 'sztornó számla (érvénytelenítés)' : 'helyesbítő számla';

     if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
       await transporter.sendMail({
         from: process.env.SMTP_FROM || `"HawkStone" <noreply@hawkstone.hu>`,
         to: climber.email,
         subject: `HawkStone Visszatérítés és ${docType} - #${ticket.id}`,
         text: `Kedves ${climber.name}!\n\nSajnálattal értesültünk róla, hogy az elállás mellett döntöttél, és mégsem veszed igénybe szolgáltatásainkat, de természetesen tiszteletben tartjuk a döntésedet.\n\nTájékoztatunk, hogy a(z) #${ticket.id} azonosítójú jegyedre/bérletedre vonatkozó elállási/felmondási igényedet sikeresen feldolgoztuk, és a visszatérítésről gondoskodtunk. A visszatérített összeg: ${refundAmount.toLocaleString('hu-HU')} Ft, melyet a Barion rendszerén keresztül visszautaltunk a fizetéshez használt bankkártyádra.\n\nA tranzakcióról kiállított ${docTypeLower} PDF bizonylatot csatoltuk ehhez az e-mailhez.\n\nBízunk benne, hogy a jövőben még találkozunk a falainkon!\n\nÜdvözlettel,\nHawkStone Csapata`,
         html: `
           <div style="font-family: 'Inter', sans-serif; background-color: #0c0e17; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.08);">
             <div style="text-align: center; margin-bottom: 25px;">
               <h2 style="color: #ff6b00; font-family: 'Outfit', sans-serif; font-size: 24px; margin: 0;">Sikeres visszatérítés</h2>
               <p style="font-size: 14px; color: #94a3b8; margin-top: 8px; line-height: 1.5;">Sajnáljuk, hogy így döntöttél, és mégsem tartasz igényt a jegyedre/bérletedre, de tiszteletben tartjuk a döntésedet. Az elállási igényedet feldolgoztuk és a visszatérítésről gondoskodtunk.</p>
             </div>

             <!-- Refund Card -->
             <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); padding: 20px; border-radius: 10px; margin: 25px 0;">
               <h3 style="margin: 0 0 15px 0; color: #ff6b00; font-family: 'Outfit', sans-serif; font-size: 18px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">Visszatérítés Részletei</h3>
               <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                 <tr>
                   <td style="padding: 6px 0; color: #94a3b8;">Jegy ID:</td>
                   <td style="padding: 6px 0; color: #ffffff; text-align: right; font-weight: 600;">#${ticket.id}</td>
                 </tr>
                 <tr>
                   <td style="padding: 6px 0; color: #94a3b8;">Jegytípus:</td>
                   <td style="padding: 6px 0; color: #ffffff; text-align: right; font-weight: 600;">${HungarianType}</td>
                 </tr>
                 <tr style="background: rgba(239, 68, 68, 0.08); border-radius: 6px;">
                   <td style="padding: 8px 6px; color: #ef4444; font-weight: 700;">💰 Visszatérített összeg:</td>
                   <td style="padding: 8px 6px; color: #ef4444; text-align: right; font-weight: 700; font-size: 16px;">${refundAmount.toLocaleString('hu-HU')} Ft</td>
                 </tr>
               </table>
             </div>

             ${invoiceNumber ? `
             <!-- Invoice Box -->
             <div style="background: rgba(46, 204, 113, 0.05); border: 1px solid rgba(46, 204, 113, 0.2); padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
               <p style="margin: 0; font-size: 14px; color: #2ecc71;"><strong>A kiállított ${docTypeLower} (${invoiceNumber}) elkészült és csatolva van ehhez a levélhez.</strong></p>
             </div>` : ''}

             <p style="font-size: 14px; color: #94a3b8; text-align: center; margin: 20px 0 10px 0;">Bízunk benne, hogy a jövőben még találkozunk a falainkon!</p>
             <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; text-align: center;">A visszautalt összeg jóváírási ideje a bankkártya-kibocsátódtól függően általában 1-5 munkanapot vesz igénybe.</p>
             <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 25px 0;">
             <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">Üdvözlettel,<br><strong>HawkStone Csapata</strong></p>
           </div>
         `,
         attachments: [
           ...(invoiceBuffer ? [{
             filename: `${isFullStorno ? 'Sztorno' : 'Helyesbito'}_Szamla_${invoiceNumber}.pdf`,
             content: invoiceBuffer
           }] : [])
         ]
       });
       console.log(`[EMAIL] Refund confirmation email sent successfully to ${climber.email}`);
     } else {
       console.log(`[EMAIL MOCK] SMTP not configured. Refund email for ticket ${ticket.id} would be sent to ${climber.email}`);
     }
   } catch (err) {
     console.error('[EMAIL ERROR] Failed to send refund email:', err);
   }
 }
 
 // Get rules and ticket validation PDF
app.get('/api/tickets/:id/rules-pdf', authenticateToken, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticket = await dbGet('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return res.status(404).json({ error: 'A jegy nem található!' });

    // Validate ownership
    const userRoles = (req.user.role || '').split(',').map(r => r.trim().toUpperCase());
    const isPrivileged = userRoles.includes('ADMIN') || userRoles.includes('STAFF');
    if (ticket.user_id !== req.user.id && !isPrivileged) {
      return res.status(403).json({ error: 'Nincs jogosultságod letölteni ezt a PDF-et!' });
    }

    const climber = await dbGet('SELECT * FROM users WHERE id = ?', [ticket.user_id]);

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const domain = `${protocol}://${host}`;
    const { pdfData } = await generatePDFBuffer(ticket, climber, domain);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="HawkStone-Szabalyzat-${ticket.ticket_type}.pdf"`);
    res.send(pdfData);
  } catch (error) {
    res.status(500).json({ error: 'Hiba a PDF generálásakor: ' + error.message });
  }
});

// ---------------- SCANNER & VALIDATION ----------------
// Get ticket details and climber info by QR Code UUID (Read-only check)
app.get('/api/tickets/scan-info', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { qrCodeUuid } = req.query;
    if (!qrCodeUuid) {
      return res.status(400).json({ error: 'Hiányzó QR kód azonosító!' });
    }

    const ticket = await dbGet('SELECT * FROM tickets WHERE qr_code_uuid = ?', [qrCodeUuid]);
    if (!ticket) {
      return res.status(404).json({ error: 'Érvénytelen QR kód (nem található az adatbázisban)!' });
    }

    const climber = await dbGet('SELECT id, name, email, phone, license_number, card_type, school_role, school_name, school_id_number, school_discount_verified, school_discount_verified_until FROM users WHERE id = ?', [ticket.user_id]);
    if (!climber) {
      return res.status(404).json({ error: 'A jegyhez tartozó mászó nem található!' });
    }

    const today = new Date().toISOString().split('T')[0];
    let isValid = true;
    let reason = '';

    const isExpired = ticket.expires_date < today;

    if (isExpired) {
      isValid = false;
      reason = 'A bérlet/jegy érvényessége lejárt!';
    } else if (ticket.status !== 'ACTIVE') {
      isValid = false;
      reason = 'Ez a jegy már elhasznált vagy érvénytelenített!';
    } else if (ticket.ticket_type === 'TIZ_ALKALMAS' && ticket.sessions_remaining <= 0) {
      isValid = false;
      reason = 'A 10 alkalmas bérlet minden alkalma elhasználásra került!';
    }

    // Check partner ticket status and school verification requirement
    const ticketConf = getTicketConfig(ticket.ticket_type);
    const isPartnerTicket = !!(ticketConf && ticketConf.isPartner) || ticket.ticket_type.includes('PARTNER');
    let requiresSchoolCheck = false;
    let schoolCheckReason = '';
    const nextSchoolExpiry = calculateSchoolDiscountExpiry();

    if (isPartnerTicket || (climber.school_role && climber.school_role !== 'NONE')) {
      const isVerified = climber.school_discount_verified === 1 && 
                         climber.school_discount_verified_until && 
                         climber.school_discount_verified_until >= today;
      if (!isVerified) {
        requiresSchoolCheck = true;
        const roleText = climber.school_role === 'TEACHER' ? 'Tanár / Oktató' : 'Diák / Tanuló';
        schoolCheckReason = `Partneriskolai (${climber.school_name || 'Iskola'} – ${roleText}) igazolvány ellenőrzése szükséges!`;
      }
    }

    // Get current Budapest date to lookup bookings
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const dateStr = formatter.format(new Date());

    // Get active/future bookings for the user (today and onwards)
    const bookings = await dbAll(`
      SELECT b.id as booking_id, b.booking_date, b.heads_count, b.booking_type, b.adult_count, b.child_count, s.start_time, s.end_time, s.location_id, l.name as location_name,
             (SELECT COUNT(*) FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
             ) as attended
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN locations l ON s.location_id = l.id
      WHERE b.user_id = ? AND b.booking_date >= ?
      ORDER BY b.booking_date ASC, s.start_time ASC
    `, [ticket.user_id, dateStr]);

    res.json({
      isValid,
      reason,
      user: climber,
      bookings: bookings,
      isPartnerTicket,
      requiresSchoolCheck,
      schoolCheckReason,
      nextSchoolExpiry,
      ticket: {
        id: ticket.id,
        ticket_type: ticket.ticket_type,
        purchase_date: ticket.purchase_date,
        expires_date: ticket.expires_date,
        sessions_remaining: ticket.sessions_remaining,
        status: ticket.status,
        qr_code_uuid: ticket.qr_code_uuid
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a QR kód lekérdezésekor: ' + error.message });
  }
});

// Process check-in (deduct session or log entry)
app.post('/api/tickets/validate', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { qrCodeUuid, locationId, verifySchoolDiscount } = req.body;
    if (!qrCodeUuid) {
      return res.status(400).json({ error: 'Hiányzó QR kód azonosító!' });
    }

    const ticket = await dbGet('SELECT * FROM tickets WHERE qr_code_uuid = ?', [qrCodeUuid]);
    if (!ticket) {
      return res.status(404).json({ error: 'Érvénytelen QR kód (nem található az adatbázisban)!' });
    }

    const climber = await dbGet('SELECT id, name, phone, license_number, card_type, school_role, school_name, school_discount_verified, school_discount_verified_until FROM users WHERE id = ?', [ticket.user_id]);
    const today = new Date().toISOString().split('T')[0];

    const staffId = req.user?.id || null;
    let staffUser = null;
    if (staffId) {
      staffUser = await dbGet('SELECT id, name, email FROM users WHERE id = ?', [staffId]);
    }
    const staffName = staffUser?.name || req.user?.name || (staffUser?.email ? staffUser.email.split('@')[0] : 'Falmester');
    const staffEmail = staffUser?.email || req.user?.email || '';

    // If staff checked the school discount checkbox, update verification in database
    let schoolVerificationNote = '';
    if (verifySchoolDiscount === true && climber) {
      const expiryDate = calculateSchoolDiscountExpiry();
      await dbRun(
        `UPDATE users SET 
          school_discount_verified = 1, 
          school_discount_verified_until = ?, 
          school_discount_verified_by = ?, 
          school_discount_verified_at = CURRENT_TIMESTAMP 
        WHERE id = ?`,
        [expiryDate, staffName, ticket.user_id]
      );
      climber.school_discount_verified = 1;
      climber.school_discount_verified_until = expiryDate;
      schoolVerificationNote = ` [Partneriskola igazolvány jóváhagyva: ${expiryDate}-ig]`;
      console.log(`[STAFF VERIFY] Staff ${staffName} verified school discount for user ${climber.name} (${climber.school_name || 'Partneriskola'}) until ${expiryDate}`);
    }

    // Double check-in protection: Check for successful entry in last 10 seconds
    const recentScan = await dbGet(`
      SELECT * FROM entry_logs 
      WHERE ticket_id = ? 
        AND location_id = ? 
        AND status = 'SUCCESS' 
        AND scan_time >= datetime('now', '-10 seconds')
    `, [ticket.id, locationId || null]);

    if (recentScan) {
      return res.json({
        valid: true,
        message: `${recentScan.message} (Ismételt beolvasás kiszűrve)`,
        user: climber,
        ticket: {
          ticket_type: ticket.ticket_type,
          sessions_remaining: ticket.sessions_remaining,
          expires_date: ticket.expires_date,
          status: ticket.status
        }
      });
    }

    // Check expiration date
    if (ticket.expires_date < today) {
      await dbRun("UPDATE tickets SET status = 'EXPIRED' WHERE id = ?", [ticket.id]);
      await dbRun("INSERT INTO entry_logs (ticket_id, status, message, location_id, staff_id, staff_name, staff_email) VALUES (?, 'FAILED', ?, ?, ?, ?, ?)", [ticket.id, 'Jegy/bérlet lejárt', locationId || null, staffId, staffName, staffEmail]);
      return res.status(400).json({
        valid: false,
        reason: 'A bérlet/jegy érvényessége lejárt!',
        user: climber,
        ticket: { ...ticket, status: 'EXPIRED' }
      });
    }

    // Check if status is ACTIVE
    if (ticket.status !== 'ACTIVE') {
      await dbRun("INSERT INTO entry_logs (ticket_id, status, message, location_id, staff_id, staff_name, staff_email) VALUES (?, 'FAILED', ?, ?, ?, ?, ?)", [ticket.id, 'Már felhasznált vagy érvénytelen jegy', locationId || null, staffId, staffName, staffEmail]);
      return res.status(400).json({
        valid: false,
        reason: 'Ez a jegy már elhasznált vagy érvénytelenített!',
        user: climber,
        ticket
      });
    }

    // Handle ticket logic by type
    let message = '';
    let updatedSessions = ticket.sessions_remaining;
    let updatedStatus = 'ACTIVE';

    const baseType = getTicketBaseType(ticket.ticket_type);
    const ticketConf = getTicketConfig(ticket.ticket_type);
    const typeLabel = ticketConf ? ticketConf.fullName : ticket.ticket_type;

    if (baseType === 'NAPI') {
      updatedSessions = 0;
      updatedStatus = 'USED';
      message = `Sikeres belépés! Egyszeri napijegy (${typeLabel}) lekezelve és lezárva.${schoolVerificationNote}`;
    } else if (baseType === 'TIZ_ALKALMAS') {
      if (ticket.sessions_remaining <= 0) {
        updatedStatus = 'USED';
        await dbRun("UPDATE tickets SET status = 'USED' WHERE id = ?", [ticket.id]);
        await dbRun("INSERT INTO entry_logs (ticket_id, status, message, location_id, staff_id, staff_name, staff_email) VALUES (?, 'FAILED', ?, ?, ?, ?, ?)", [ticket.id, 'Bérlet alkalmak elfogytak', locationId || null, staffId, staffName, staffEmail]);
        return res.status(400).json({
          valid: false,
          reason: 'A 10 alkalmas bérlet minden alkalma elhasználásra került!',
          user: climber,
          ticket: { ...ticket, status: 'USED', sessions_remaining: 0 }
        });
      }
      updatedSessions = ticket.sessions_remaining - 1;
      if (updatedSessions === 0) {
        updatedStatus = 'USED';
        message = `Sikeres belépés! Ez volt az utolsó (10.) alkalom (${typeLabel}). A bérlet lejárt.${schoolVerificationNote}`;
      } else {
        message = `Sikeres belépés (${typeLabel})! Fennmaradó alkalmak: ${updatedSessions}/10.${schoolVerificationNote}`;
      }
    } else if (baseType === 'HAVI') {
      message = `Sikeres belépés! Korlátlan havi bérlet (${typeLabel}) érvényes eddig: ${ticket.expires_date}.${schoolVerificationNote}`;
    }

    // Update database
    await dbRun(
      'UPDATE tickets SET sessions_remaining = ?, status = ? WHERE id = ?',
      [updatedSessions, updatedStatus, ticket.id]
    );

    // Log successful scan with staff attribution
    await dbRun("INSERT INTO entry_logs (ticket_id, status, message, location_id, staff_id, staff_name, staff_email) VALUES (?, 'SUCCESS', ?, ?, ?, ?, ?)", [ticket.id, message, locationId || null, staffId, staffName, staffEmail]);

    res.json({
      valid: true,
      message,
      user: climber,
      ticket: {
        ticket_type: ticket.ticket_type,
        sessions_remaining: updatedSessions,
        expires_date: ticket.expires_date,
        status: updatedStatus
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a leolvasás során: ' + error.message });
  }
});

// ---------------- ADMIN PANEL ROUTES ----------------
// View all users
app.get('/api/admin/users', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const users = await dbAll('SELECT id, name, email, phone, license_number, card_type, role, school_role, school_name, school_id_number, school_discount_verified, school_discount_verified_until FROM users ORDER BY name ASC');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// View single user details with tickets, bookings, and entry logs
app.get('/api/admin/users/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await dbGet('SELECT id, name, email, phone, license_number, card_type, role, school_role, school_name, school_id_number, school_discount_verified, school_discount_verified_until, school_discount_verified_by, school_discount_verified_at FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'A keresett felhasználó nem található!' });

    const tickets = await dbAll("SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC", [userId]);
    const bookings = await dbAll(`
      SELECT b.id as booking_id, b.booking_date, b.heads_count, b.booking_type, b.adult_count, b.child_count, s.start_time, s.end_time, l.name as location_name, l.id as location_id,
             (SELECT COUNT(*) FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
             ) as attended,
             (SELECT COALESCE(su.name, el.staff_name, su.email, 'Falmester') FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              LEFT JOIN users su ON el.staff_id = su.id
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_name,
             (SELECT COALESCE(su.email, el.staff_email, '') FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              LEFT JOIN users su ON el.staff_id = su.id
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_email,
             (SELECT el.staff_id FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_id,
             (SELECT el.scan_time FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_at
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN locations l ON s.location_id = l.id
      WHERE b.user_id = ?
      ORDER BY b.booking_date DESC, s.start_time DESC
    `, [userId]);

    const logs = await dbAll(`
      SELECT el.scan_time, el.status, el.message, l.name as location_name, t.ticket_type
      FROM entry_logs el
      JOIN tickets t ON el.ticket_id = t.id
      LEFT JOIN locations l ON el.location_id = l.id
      WHERE t.user_id = ?
      ORDER BY el.scan_time DESC
    `, [userId]);

    res.json({ user, tickets, bookings, logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CRM advanced search across users and payments
app.get('/api/admin/search', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { name, email, phone, paymentId } = req.query;

    let userQuery = `
      SELECT DISTINCT u.id, u.name, u.email, u.phone, u.license_number, u.card_type, u.role, u.created_at
      FROM users u
      LEFT JOIN tickets t ON u.id = t.user_id
      LEFT JOIN barion_payments p ON u.id = p.user_id
      LEFT JOIN withdrawals w ON u.id = w.user_id
      WHERE 1=1
    `;
    let userParams = [];

    if (name && name.trim()) {
      userQuery += ` AND (u.name LIKE ? OR p.billing_name LIKE ? OR w.customer_name LIKE ?)`;
      const val = `%${name.trim()}%`;
      userParams.push(val, val, val);
    }
    if (email && email.trim()) {
      userQuery += ` AND (u.email LIKE ? OR w.customer_email LIKE ?)`;
      const val = `%${email.trim()}%`;
      userParams.push(val, val);
    }
    if (phone && phone.trim()) {
      userQuery += ` AND u.phone LIKE ?`;
      userParams.push(`%${phone.trim()}%`);
    }
    if (paymentId && paymentId.trim()) {
      userQuery += ` AND (t.payment_id LIKE ? OR p.payment_id LIKE ? OR p.invoice_number LIKE ? OR w.contract_id LIKE ?)`;
      const val = `%${paymentId.trim()}%`;
      userParams.push(val, val, val, val);
    }

    userQuery += ` ORDER BY u.name ASC LIMIT 50`;

    let paymentQuery = `
      SELECT DISTINCT p.payment_id, p.user_id, p.ticket_type, p.status, p.amount, p.created_at, p.invoice_number, p.billing_name,
             u.name as user_name, u.email as user_email
      FROM barion_payments p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN tickets t ON p.payment_id = t.payment_id
      LEFT JOIN withdrawals w ON u.id = w.user_id
      WHERE 1=1
    `;
    let paymentParams = [];

    if (name && name.trim()) {
      paymentQuery += ` AND (u.name LIKE ? OR p.billing_name LIKE ? OR w.customer_name LIKE ?)`;
      const val = `%${name.trim()}%`;
      paymentParams.push(val, val, val);
    }
    if (email && email.trim()) {
      paymentQuery += ` AND (u.email LIKE ? OR w.customer_email LIKE ?)`;
      const val = `%${email.trim()}%`;
      paymentParams.push(val, val);
    }
    if (phone && phone.trim()) {
      paymentQuery += ` AND u.phone LIKE ?`; // matched from users table u
      paymentParams.push(`%${phone.trim()}%`);
    }
    if (paymentId && paymentId.trim()) {
      paymentQuery += ` AND (p.payment_id LIKE ? OR p.invoice_number LIKE ? OR t.payment_id LIKE ? OR w.contract_id LIKE ?)`;
      const val = `%${paymentId.trim()}%`;
      paymentParams.push(val, val, val, val);
    }

    paymentQuery += ` ORDER BY p.created_at DESC LIMIT 50`;

    const [users, payments] = await Promise.all([
      dbAll(userQuery, userParams),
      dbAll(paymentQuery, paymentParams)
    ]);

    res.json({ users, payments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk User Import
app.post('/api/admin/users/import', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { users } = req.body;
    if (!Array.isArray(users)) {
      return res.status(400).json({ error: 'Érvénytelen adatformátum!' });
    }

    const defaultPasswordHash = await bcrypt.hash('Hawkstone2026!', 10);
    let insertedCount = 0;
    let updatedCount = 0;

    for (const u of users) {
      const { name, email, phone, license_number, card_type, role } = u;
      if (!name || !email) continue;

      const card = (card_type || 'PIROS').toUpperCase();
      const r = (role || 'USER').toUpperCase();

      const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        await dbRun(`
          UPDATE users 
          SET name = ?, phone = ?, license_number = ?, card_type = ?, role = ?
          WHERE id = ?
        `, [name, phone || '', license_number || '', card, r, existing.id]);
        updatedCount++;
      } else {
        await dbRun(`
          INSERT INTO users (name, email, phone, password_hash, license_number, card_type, role, is_verified)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `, [name, email, phone || '', defaultPasswordHash, license_number || '', card, r]);
        insertedCount++;
      }
    }

    res.json({ message: `Sikeres importálás! Új felhasználó: ${insertedCount}, frissítve: ${updatedCount}.`, insertedCount, updatedCount });
  } catch (error) {
    res.status(500).json({ error: 'Hiba az importálás során: ' + error.message });
  }
});

// View all cancellations
app.get('/api/admin/cancellations', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const cancellations = await dbAll('SELECT * FROM slot_cancellations');
    res.json(cancellations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel a slot on a specific date, deleting any bookings
app.post('/api/admin/slots/cancel', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { slotId, date } = req.body;
    if (!slotId || !date) {
      return res.status(400).json({ error: 'Hiányzó slotId vagy dátum!' });
    }

    // Insert cancellation (ignore if already exists)
    try {
      await dbRun('INSERT INTO slot_cancellations (slot_id, cancelled_date) VALUES (?, ?)', [slotId, date]);
    } catch (err) {
      if (!err.message || !err.message.includes('UNIQUE')) {
        throw err;
      }
    }

    // Delete existing bookings for this slot on this date
    await dbRun('DELETE FROM bookings WHERE slot_id = ? AND booking_date = ?', [slotId, date]);

    res.json({ message: 'Idősáv sikeresen törölve a megadott napról és a foglalások törölve!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Uncancel / restore a slot on a specific date
app.post('/api/admin/slots/uncancel', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { slotId, date } = req.body;
    if (!slotId || !date) {
      return res.status(400).json({ error: 'Hiányzó slotId vagy dátum!' });
    }

    await dbRun('DELETE FROM slot_cancellations WHERE slot_id = ? AND cancelled_date = ?', [slotId, date]);
    res.json({ message: 'Idősáv sikeresen visszaállítva a megadott napra!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle card level (ZÖLD / PIROS)
app.put('/api/admin/users/:id/card-type', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { cardType } = req.body;
    if (!['ZÖLD', 'PIROS'].includes(cardType)) {
      return res.status(400).json({ error: 'Érvénytelen kártyatípus!' });
    }

    // Validation for ZÖLD card type: check if they have a valid sport climber license number
    if (cardType === 'ZÖLD') {
      const user = await dbGet('SELECT license_number FROM users WHERE id = ?', [req.params.id]);
      if (!user || !user.license_number || !user.license_number.trim()) {
        return res.status(400).json({ error: 'Zöld kártya minősítéshez kötelező sportmászó engedélyszám megadása!' });
      }
      const licenseRegex = /^(SMV-\d+|[A-Za-zÖüóőúéáíÖÜÓŐÚÉÁÍ]{2,8}-?\d+(?:\s*\/\s*\d{4})?)$/;
      if (!licenseRegex.test(user.license_number.trim())) {
        return res.status(400).json({ error: 'A felhasználó sportmászó engedélyszámának formátuma érvénytelen! (Elvárt pl. SMV-00001 vagy GSE9999/2025)' });
      }
    }

    await dbRun('UPDATE users SET card_type = ? WHERE id = ?', [cardType, req.params.id]);
    res.json({ message: 'Felhasználó mászókártya státusza sikeresen frissítve!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user details (name, email, phone, license_number, card_type, role)
app.put('/api/admin/users/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    let { name, email, phone, license_number, card_type, role, password, school_role, school_name, school_id_number, school_discount_verified, school_discount_verified_until } = req.body;
    if (!name || !email || !phone || !card_type || !role) {
      return res.status(400).json({ error: 'Minden kötelező mező kitöltése kötelező!' });
    }

    const cardUpper = String(card_type).trim().toUpperCase();
    if (!['ZÖLD', 'PIROS'].includes(cardUpper)) {
      return res.status(400).json({ error: 'Érvénytelen kártyatípus!' });
    }

    // Role handling: support multiple roles (e.g. ['ADMIN', 'STAFF'] or 'ADMIN,STAFF')
    let roleArray = [];
    if (Array.isArray(role)) {
      roleArray = role.map(r => String(r).trim().toUpperCase());
    } else if (typeof role === 'string') {
      roleArray = role.split(',').map(r => r.trim().toUpperCase());
    }
    roleArray = roleArray.filter(r => ['USER', 'STAFF', 'ADMIN'].includes(r));
    if (roleArray.length === 0) {
      roleArray = ['USER'];
    }
    if (roleArray.length > 1) {
      roleArray = roleArray.filter(r => r !== 'USER');
    }
    const normalizedRole = roleArray.join(',');

    // Check target user before updating
    const targetUser = await dbGet('SELECT email, role FROM users WHERE id = ?', [req.params.id]);
    if (!targetUser) {
      return res.status(404).json({ error: 'A felhasználó nem található!' });
    }

    // Protection for Admin Főnök (admin@hawkstone.hu) email and role
    if (targetUser.email === 'admin@hawkstone.hu') {
      if (!roleArray.includes('ADMIN')) {
        return res.status(400).json({ error: 'Az Admin Főnök adminisztrátori jogosultsága nem vonható vissza!' });
      }
      if (email !== 'admin@hawkstone.hu') {
        return res.status(400).json({ error: 'Az Admin Főnök email címe nem módosítható!' });
      }
    }

    // Validation for ZÖLD card type: check if they have a valid sport climber license number
    if (cardUpper === 'ZÖLD') {
      if (!license_number || !license_number.trim()) {
        return res.status(400).json({ error: 'Zöld kártya minősítéshez kötelező sportmászó engedélyszám megadása!' });
      }
      const licenseRegex = /^(SMV-\d+|[A-Za-zÖüóőúéáíÖÜŐÚÉÁÍ]{2,8}-?\d+(?:\s*\/\s*\d{4})?)$/;
      if (!licenseRegex.test(license_number.trim())) {
        return res.status(400).json({ error: 'A megadott sportmászó engedélyszám formátuma érvénytelen! (Elvárt pl. SMV-00001 vagy GSE9999/2025)' });
      }
    }

    const existingUser = await dbGet('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.params.id]);
    if (existingUser) {
      return res.status(400).json({ error: 'Ez az email cím már használatban van!' });
    }

    // Partner school details
    const validSchoolRoles = ['NONE', 'STUDENT', 'TEACHER'];
    const cleanSchoolRole = validSchoolRoles.includes(school_role) ? school_role : 'NONE';
    const cleanSchoolName = cleanSchoolRole === 'NONE' ? '' : (school_name || '').trim();
    const cleanSchoolId = cleanSchoolRole === 'NONE' ? '' : (school_id_number || '').trim();
    const isVerified = (school_discount_verified === 1 || school_discount_verified === true || school_discount_verified === '1') ? 1 : 0;
    let verifiedUntil = (school_discount_verified_until || '').trim();
    if (isVerified && !verifiedUntil) {
      verifiedUntil = calculateSchoolDiscountExpiry();
    }

    await dbRun(
      'UPDATE users SET name = ?, email = ?, phone = ?, license_number = ?, card_type = ?, role = ?, school_role = ?, school_name = ?, school_id_number = ?, school_discount_verified = ?, school_discount_verified_until = ? WHERE id = ?',
      [name, email, phone, license_number || '', cardUpper, normalizedRole, cleanSchoolRole, cleanSchoolName, cleanSchoolId, isVerified, isVerified ? verifiedUntil : null, req.params.id]
    );

    if (password && password.trim().length > 0) {
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
      if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: 'A megadott új jelszó nem felel meg a biztonsági követelményeknek! Legalább 8 karakter, kisbetű, nagybetű, szám és speciális karakter szükséges.' });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await dbRun('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [passwordHash, req.params.id]);
    }

    res.json({ message: 'Felhasználó adatai és jogosultságai sikeresen frissítve!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete user (prevents deleting oneself, Admin Főnök, and users with ADMIN role)
app.delete('/api/admin/users/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Nem törölheted a saját adminisztrátori fiókodat!' });
    }

    const targetUser = await dbGet('SELECT email, role FROM users WHERE id = ?', [req.params.id]);
    if (!targetUser) {
      return res.status(404).json({ error: 'A felhasználó nem található!' });
    }

    // Protect Admin Főnök (admin@hawkstone.hu)
    if (targetUser.email === 'admin@hawkstone.hu') {
      return res.status(400).json({ error: 'Az Admin Főnök felhasználó nem törölhető az admin felületről!' });
    }

    const targetRoles = (targetUser.role || '').split(',').map(r => r.trim().toUpperCase());
    if (targetRoles.includes('ADMIN')) {
      return res.status(400).json({ error: 'Biztonsági okokból adminisztrátori fiókot nem lehet törölni! Előbb vond vissza az Admin jogosultságot a szerkesztésben.' });
    }

    // Delete related records to maintain integrity
    await dbRun('DELETE FROM bookings WHERE user_id = ?', [req.params.id]);
    await dbRun('DELETE FROM tickets WHERE user_id = ?', [req.params.id]);
    await dbRun('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'Felhasználó sikeresen törölve!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get slots for unified admin editor
app.get('/api/admin/slots', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const slots = await dbAll(`
      SELECT s.*, l.name as location_name 
      FROM slots s
      JOIN locations l ON s.location_id = l.id
      ORDER BY s.location_id ASC, s.day_of_week ASC, s.start_time ASC
    `);
    res.json(slots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add weekly slot
app.post('/api/admin/slots', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { locationId, dayOfWeek, startTime, endTime, maxCapacity } = req.body;
    if (!locationId || dayOfWeek === undefined || !startTime || !endTime) {
      return res.status(400).json({ error: 'Hiányzó paraméterek a slot létrehozásához!' });
    }

    const result = await dbRun(
      'INSERT INTO slots (location_id, day_of_week, start_time, end_time, max_capacity) VALUES (?, ?, ?, ?, ?)',
      [locationId, dayOfWeek, startTime, endTime, maxCapacity || 15]
    );

    res.status(201).json({ message: 'Idősáv sikeresen hozzáadva!', slotId: result.lastID });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete weekly slot
app.delete('/api/admin/slots/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    await dbRun('DELETE FROM slots WHERE id = ?', [req.params.id]);
    res.json({ message: 'Idősáv sikeresen törölve!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get location-grouped booking statistics (past and future counts)
app.get('/api/admin/bookings/stats', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const todayStr = formatter.format(new Date());

    const stats = await dbAll(`
      SELECT 
        l.id as location_id, 
        l.name as location_name,
        (SELECT COUNT(*) FROM bookings b JOIN slots s ON b.slot_id = s.id WHERE s.location_id = l.id AND b.booking_date < ?) as past_count,
        (SELECT COUNT(*) FROM bookings b JOIN slots s ON b.slot_id = s.id WHERE s.location_id = l.id AND b.booking_date >= ?) as future_count
      FROM locations l
    `, [todayStr, todayStr]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all bookings for admin panel (supports filters)
app.get('/api/admin/bookings', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { locationId, startDate, endDate } = req.query;

    let query = `
      SELECT b.id as booking_id, b.booking_date, s.start_time, s.end_time, 
             l.name as location_name, l.id as location_id,
             u.name as user_name, u.email as user_email, u.phone as user_phone, u.id as user_id, u.card_type as user_card_type,
             (SELECT COUNT(*) FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
             ) as attended,
             (SELECT COALESCE(su.name, el.staff_name, su.email, 'Falmester') FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              LEFT JOIN users su ON el.staff_id = su.id
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_name,
             (SELECT COALESCE(su.email, el.staff_email, '') FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              LEFT JOIN users su ON el.staff_id = su.id
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_email,
             (SELECT el.staff_id FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_id,
             (SELECT el.scan_time FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_at
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN locations l ON s.location_id = l.id
      JOIN users u ON b.user_id = u.id
    `;
    let params = [];

    if (locationId && startDate && endDate) {
      query += ` WHERE s.location_id = ? AND b.booking_date >= ? AND b.booking_date <= ?`;
      params = [parseInt(locationId), startDate, endDate];
    } else {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Budapest',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const todayStr = formatter.format(new Date());
      query += ` WHERE b.booking_date >= ?`;
      params = [todayStr];
    }

    query += ` ORDER BY b.booking_date ASC, s.start_time ASC, u.name ASC`;

    const bookings = await dbAll(query, params);
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------- ADMIN CHECKINS & PAST BOOKINGS ROUTES ----------------

// Get user specific bookings with full checkin / attendance data
app.get('/api/admin/users/:id/bookings', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const userId = req.params.id;
    const bookings = await dbAll(`
      SELECT b.id as booking_id, b.booking_date, b.heads_count, b.booking_type, b.adult_count, b.child_count, s.start_time, s.end_time, l.name as location_name, l.id as location_id,
             (SELECT COUNT(*) FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
             ) as attended,
             (SELECT COALESCE(su.name, el.staff_name, su.email, 'Falmester') FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              LEFT JOIN users su ON el.staff_id = su.id
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_name,
             (SELECT COALESCE(su.email, el.staff_email, '') FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              LEFT JOIN users su ON el.staff_id = su.id
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_email,
             (SELECT el.staff_id FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_id,
             (SELECT el.scan_time FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_at
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN locations l ON s.location_id = l.id
      WHERE b.user_id = ?
      ORDER BY b.booking_date DESC, s.start_time DESC
    `, [userId]);

    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Hiba a felhasználó foglalásainak lekérésekor: ' + error.message });
  }
});

// Get staff & admin members for checkin filters
app.get('/api/admin/checkins/staff-list', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const staffMembers = await dbAll(`
      SELECT id, name, email, role 
      FROM users 
      WHERE role LIKE '%STAFF%' OR role LIKE '%ADMIN%' 
      ORDER BY name ASC
    `);
    res.json(staffMembers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get paginated checkin entry logs with advanced filters and export support
app.get('/api/admin/checkins', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const { locationId, staffId, status, search, exportType } = req.query;

    let whereConditions = [];
    let params = [];

    if (locationId) {
      whereConditions.push('el.location_id = ?');
      params.push(parseInt(locationId));
    }

    if (staffId) {
      whereConditions.push('el.staff_id = ?');
      params.push(parseInt(staffId));
    }

    if (status && status !== 'ALL') {
      whereConditions.push('el.status = ?');
      params.push(status);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      whereConditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR t.qr_code_uuid LIKE ?)');
      params.push(s, s, s, s);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // If export is requested, return up to 2000 records without pagination
    if (exportType === 'all' || exportType === 'csv') {
      const exportRows = await dbAll(`
        SELECT 
          el.id,
          el.scan_time,
          el.status,
          el.message,
          el.location_id,
          l.name as location_name,
          el.staff_id,
          COALESCE(su.name, el.staff_name, su.email, 'Rendszer') as staff_name,
          COALESCE(su.email, el.staff_email, '') as staff_email,
          t.id as ticket_id,
          t.ticket_type,
          t.qr_code_uuid,
          u.id as user_id,
          u.name as user_name,
          u.email as user_email,
          u.phone as user_phone,
          u.card_type as user_card_type
        FROM entry_logs el
        JOIN tickets t ON el.ticket_id = t.id
        JOIN users u ON t.user_id = u.id
        LEFT JOIN locations l ON el.location_id = l.id
        LEFT JOIN users su ON el.staff_id = su.id
        ${whereClause}
        ORDER BY el.scan_time DESC, el.id DESC
        LIMIT 2000
      `, params);
      return res.json({ checkins: exportRows });
    }

    // Count query
    const countRow = await dbGet(`
      SELECT COUNT(*) as total
      FROM entry_logs el
      JOIN tickets t ON el.ticket_id = t.id
      JOIN users u ON t.user_id = u.id
      LEFT JOIN locations l ON el.location_id = l.id
      LEFT JOIN users su ON el.staff_id = su.id
      ${whereClause}
    `, params);
    const total = countRow ? countRow.total : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // Paginated rows
    const queryParams = [...params, limit, offset];
    const checkins = await dbAll(`
      SELECT 
        el.id,
        el.scan_time,
        el.status,
        el.message,
        el.location_id,
        l.name as location_name,
        el.staff_id,
        COALESCE(su.name, el.staff_name, su.email, 'Rendszer') as staff_name,
        COALESCE(su.email, el.staff_email, '') as staff_email,
        t.id as ticket_id,
        t.ticket_type,
        t.qr_code_uuid,
        u.id as user_id,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone,
        u.card_type as user_card_type
      FROM entry_logs el
      JOIN tickets t ON el.ticket_id = t.id
      JOIN users u ON t.user_id = u.id
      LEFT JOIN locations l ON el.location_id = l.id
      LEFT JOIN users su ON el.staff_id = su.id
      ${whereClause}
      ORDER BY el.scan_time DESC, el.id DESC
      LIMIT ? OFFSET ?
    `, queryParams);

    res.json({
      checkins,
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a beléptetések lekérdezésekor: ' + error.message });
  }
});

// Get available distinct months for bookings
app.get('/api/admin/bookings/months', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT DISTINCT substr(booking_date, 1, 7) as month 
      FROM bookings 
      WHERE booking_date IS NOT NULL 
      ORDER BY month DESC
    `);
    res.json(rows.map(r => r.month));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get paginated past bookings with attendance & staff checkin details
app.get('/api/admin/bookings/past', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    const { locationId, search, attended, staffId, exportType, month } = req.query;

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const todayStr = formatter.format(new Date());

    let whereConditions = ['b.booking_date < ?'];
    let params = [todayStr];

    if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
      whereConditions.push('b.booking_date LIKE ?');
      params.push(`${month.trim()}%`);
    }

    if (locationId) {
      whereConditions.push('s.location_id = ?');
      params.push(parseInt(locationId));
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      whereConditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
      params.push(s, s, s);
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    let baseQuery = `
      SELECT b.id as booking_id, b.booking_date, s.start_time, s.end_time, 
             l.name as location_name, l.id as location_id,
             u.name as user_name, u.email as user_email, u.phone as user_phone, u.id as user_id, u.card_type as user_card_type,
             (SELECT COUNT(*) FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
             ) as attended,
             (SELECT COALESCE(su.name, el.staff_name, su.email, 'Falmester') FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              LEFT JOIN users su ON el.staff_id = su.id
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_name,
             (SELECT COALESCE(su.email, el.staff_email, '') FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              LEFT JOIN users su ON el.staff_id = su.id
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_email,
             (SELECT el.staff_id FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_by_staff_id,
             (SELECT el.scan_time FROM entry_logs el 
              JOIN tickets t ON el.ticket_id = t.id 
              WHERE t.user_id = b.user_id 
                AND el.status = 'SUCCESS' 
                AND el.location_id = s.location_id
                AND date(el.scan_time) = b.booking_date
              ORDER BY el.scan_time DESC LIMIT 1
             ) as scanned_at
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN locations l ON s.location_id = l.id
      JOIN users u ON b.user_id = u.id
      ${whereClause}
    `;

    let outerConditions = [];
    if (attended === 'yes') {
      outerConditions.push('attended > 0');
    } else if (attended === 'no') {
      outerConditions.push('attended = 0');
    }

    if (staffId) {
      outerConditions.push(`scanned_by_staff_id = ${parseInt(staffId)}`);
    }

    const outerWhere = outerConditions.length > 0 ? 'WHERE ' + outerConditions.join(' AND ') : '';

    if (exportType === 'all' || exportType === 'csv') {
      const exportBookings = await dbAll(`SELECT * FROM (${baseQuery}) ${outerWhere} ORDER BY booking_date DESC, start_time DESC LIMIT 2000`, params);
      return res.json({ bookings: exportBookings });
    }

    const countRow = await dbGet(`SELECT COUNT(*) as total FROM (${baseQuery}) ${outerWhere}`, params);
    const total = countRow ? countRow.total : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    const bookings = await dbAll(`SELECT * FROM (${baseQuery}) ${outerWhere} ORDER BY booking_date DESC, start_time DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

    res.json({
      bookings,
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a múltbéli foglalások lekérdezésekor: ' + error.message });
  }
});

// --- ANNOUNCEMENTS / ÜZENŐFAL ---

// Get active announcement (Public)
app.get('/api/announcements/active', async (req, res) => {
  try {
    const target = req.query.target === 'web' ? 'web' : 'club';
    let announcement;
    if (target === 'web') {
      announcement = await dbGet("SELECT * FROM announcements WHERE is_active = 1 AND target = 'web' ORDER BY created_at DESC LIMIT 1");
    } else {
      announcement = await dbGet("SELECT * FROM announcements WHERE is_active = 1 AND (target = 'club' OR target IS NULL) ORDER BY created_at DESC LIMIT 1");
    }
    res.json(announcement || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all announcements (Admin/Staff only)
app.get('/api/announcements', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const target = req.query.target === 'web' ? 'web' : 'club';
    let list;
    if (target === 'web') {
      list = await dbAll("SELECT * FROM announcements WHERE target = 'web' ORDER BY created_at DESC");
    } else {
      list = await dbAll("SELECT * FROM announcements WHERE (target = 'club' OR target IS NULL) ORDER BY created_at DESC");
    }
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new announcement (Admin/Staff only)
app.post('/api/announcements', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { title, content, imageUrl, isActive, target } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'A cím és a tartalom megadása kötelező!' });
    }

    const targetVal = target === 'web' ? 'web' : 'club';
    const activeVal = isActive ? 1 : 0;

    if (activeVal === 1) {
      if (targetVal === 'web') {
        await dbRun("UPDATE announcements SET is_active = 0 WHERE target = 'web'");
      } else {
        await dbRun("UPDATE announcements SET is_active = 0 WHERE target = 'club' OR target IS NULL");
      }
    }

    const result = await dbRun(
      'INSERT INTO announcements (title, content, image_url, is_active, target) VALUES (?, ?, ?, ?, ?)',
      [title, content, imageUrl || null, activeVal, targetVal]
    );

    res.status(201).json({ message: 'Hír sikeresen létrehozva!', id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update announcement (Admin/Staff only)
app.put('/api/announcements/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { title, content, imageUrl, isActive, target } = req.body;
    const { id } = req.params;

    if (!title || !content) {
      return res.status(400).json({ error: 'A cím és a tartalom megadása kötelező!' });
    }

    const existing = await dbGet('SELECT target FROM announcements WHERE id = ?', [id]);
    const targetVal = target === 'web' ? 'web' : (existing && existing.target === 'web' ? 'web' : 'club');
    const activeVal = isActive ? 1 : 0;

    if (activeVal === 1) {
      if (targetVal === 'web') {
        await dbRun("UPDATE announcements SET is_active = 0 WHERE target = 'web'");
      } else {
        await dbRun("UPDATE announcements SET is_active = 0 WHERE target = 'club' OR target IS NULL");
      }
    }

    await dbRun(
      'UPDATE announcements SET title = ?, content = ?, image_url = ?, is_active = ?, target = ? WHERE id = ?',
      [title, content, imageUrl || null, activeVal, targetVal, id]
    );

    res.json({ message: 'Hír sikeresen frissítve!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete announcement (Admin/Staff only)
app.delete('/api/announcements/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    await dbRun('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    res.json({ message: 'Hír sikeresen törölve!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------- CONTRACT WITHDRAWAL (EU 2023/2673) ----------------

// 1. Withdrawal Lookup Endpoint (Public)
app.post('/api/withdrawal/lookup', async (req, res) => {
  try {
    const { email, name, identifier } = req.body;
    if (!email || !name || !identifier) {
      return res.status(400).json({ error: 'Minden mező kitöltése kötelező!' });
    }

    // Lookup user by email (case-insensitive)
    const user = await dbGet('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (!user) {
      return res.status(404).json({ error: 'A megadott e-mail címmel nem található regisztrált felhasználó!' });
    }

    // Compare name
    const normalizedInputName = name.trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizedDbName = user.name.trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalizedInputName !== normalizedDbName) {
      return res.status(400).json({ error: 'A megadott név nem egyezik a regisztrált felhasználó nevével!' });
    }

    // Find matching tickets by: ID, qr_code_uuid, or corresponding barion payment date
    const tickets = await dbAll(`
      SELECT t.id, t.ticket_type, t.purchase_date, t.expires_date, t.sessions_remaining, t.status 
      FROM tickets t
      WHERE t.user_id = ? 
        AND (
          CAST(t.id AS TEXT) = ? 
          OR t.qr_code_uuid = ? 
          OR date(t.purchase_date) = (
            SELECT date(created_at) 
            FROM barion_payments 
            WHERE payment_id = ? AND user_id = ?
          )
        )
    `, [user.id, identifier.trim(), identifier.trim(), identifier.trim(), user.id]);

    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Nem található a megadott azonosítóhoz kapcsolódó aktív vagy lejárt jegy/bérlet ehhez a felhasználóhoz!' });
    }

    // Calculate eligibility (within 14 days and ACTIVE status)
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    const processedTickets = tickets.map(ticket => {
      let eligible = true;
      let reason = '';

      if (ticket.status !== 'ACTIVE') {
        eligible = false;
        if (ticket.status === 'WITHDRAWN') {
          reason = 'Ettől a vásárlástól már korábban elálltál!';
        } else if (ticket.status === 'USED') {
          reason = 'Ez a jegy/bérlet már teljesen felhasznált állapotú!';
        } else if (ticket.status === 'EXPIRED') {
          reason = 'Ez a jegy/bérlet már lejárt érvényességű!';
        } else {
          reason = `A jegy státusza nem teszi lehetővé az elállást (${ticket.status})`;
        }
      } else {
        const purchaseTime = new Date(ticket.purchase_date).getTime();
        const nowTime = new Date().getTime();
        const timeDiffMs = nowTime - purchaseTime;
        const diffDays = timeDiffMs / (1000 * 3600 * 24);

        if (diffDays > 14) {
          eligible = false;
          reason = 'A vásárlástól számított 14 napos törvényi elállási határidő már lejárt!';
        }
      }

      return {
        ...ticket,
        eligible,
        reason
      };
    });

    res.json({
      user: {
        name: user.name,
        email: user.email
      },
      tickets: processedTickets
    });
  } catch (error) {
    console.error('[WITHDRAWAL LOOKUP ERROR]:', error);
    res.status(500).json({ error: 'Hiba az elállás vizsgálata közben: ' + error.message });
  }
});

// 2. Withdrawal Confirm Endpoint (Public)
app.post('/api/withdrawal/confirm', async (req, res) => {
  try {
    const { email, name, identifier, ticketIds, bookingsAck } = req.body;
    if (!email || !name || !identifier || !ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({ error: 'Hiányzó vagy helytelen elállási adatok!' });
    }
    if (bookingsAck !== true) {
      return res.status(400).json({ error: 'Az elálláshoz tudomásul kell venned, hogy a lefoglalt időpontjaid törlődnek!' });
    }

    // Lookup user by email (case-insensitive)
    const user = await dbGet('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (!user) {
      return res.status(404).json({ error: 'A megadott e-mail címmel nem található regisztrált felhasználó!' });
    }

    // Compare name
    const normalizedInputName = name.trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizedDbName = user.name.trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalizedInputName !== normalizedDbName) {
      return res.status(400).json({ error: 'A megadott név nem egyezik a regisztrált felhasználó nevével!' });
    }

    // Fetch selection
    const tickets = await dbAll(`
      SELECT t.id, t.ticket_type, t.purchase_date, t.sessions_remaining, t.status 
      FROM tickets t
      WHERE t.user_id = ? 
        AND t.id IN (${ticketIds.map(() => '?').join(',')})
    `, [user.id, ...ticketIds]);

    if (tickets.length === 0) {
      return res.status(404).json({ error: 'Nem találhatók a kiválasztott jegyek!' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const validTickets = [];
    const invalidReasons = [];

    for (const ticket of tickets) {
      if (ticket.status !== 'ACTIVE') {
        invalidReasons.push(`Jegy #${ticket.id}: Nem aktív (${ticket.status}).`);
        continue;
      }

      const purchaseTime = new Date(ticket.purchase_date).getTime();
      const nowTime = new Date().getTime();
      const timeDiffMs = nowTime - purchaseTime;
      const diffDays = timeDiffMs / (1000 * 3600 * 24);

      if (diffDays > 14) {
        invalidReasons.push(`Jegy #${ticket.id}: 14 nap letelt.`);
        continue;
      }

      validTickets.push(ticket);
    }

    if (validTickets.length === 0) {
      return res.status(400).json({ error: 'Egyik kijelölt jegy sem felel meg az elállás feltételeinek: ' + invalidReasons.join(' ') });
    }

    const withdrawalTime = new Date();
    const hungarianTimeStr = withdrawalTime.toLocaleString('hu-HU', {
      timeZone: 'Europe/Budapest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const processedDetails = [];

    for (const ticket of validTickets) {
      // Set to WITHDRAWN status & 0 remaining sessions immediately
      await dbRun("UPDATE tickets SET status = 'WITHDRAWN', sessions_remaining = 0 WHERE id = ?", [ticket.id]);

      // Record request
      await dbRun(`
        INSERT INTO withdrawals (user_id, customer_name, customer_email, contract_id, ticket_id, ticket_type, purchase_date, sessions_remaining, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSED')
      `, [
        user.id,
        user.name,
        email.trim(),
        identifier.trim(),
        ticket.id,
        ticket.ticket_type,
        ticket.purchase_date,
        ticket.sessions_remaining
      ]);

      const typeCfg = getTicketConfig(ticket.ticket_type);
      const typeLabel = typeCfg ? typeCfg.fullName : ticket.ticket_type;

      processedDetails.push(`
        <li style="margin: 0 0 10px 0; padding: 0 0 10px 0; border-bottom: 1px solid ${MAIL_THEME.border}; color: ${MAIL_THEME.strong}; font-size: 14px; font-weight: 600;">
          ${typeLabel} <span style="font-weight: 400; color: ${MAIL_THEME.muted};">(Azonosító: #${ticket.id})</span><br>
          <span style="color: ${MAIL_THEME.muted}; font-size: 12px; font-weight: 400;">Vásárolva: ${ticket.purchase_date.substring(0, 10)} | Fennmaradó alkalmak: ${ticket.sessions_remaining}</span>
        </li>
      `);
    }

    // Delete the customer's upcoming (not yet finished) bookings – they are void after withdrawal
    let cancelledBookings = [];
    try {
      const nowParts = new Intl.DateTimeFormat('hu-HU', {
        timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(new Date());
      const gp = (t) => nowParts.find(p => p.type === t).value;
      const nowBudapestStr = `${gp('year')}-${gp('month')}-${gp('day')}T${gp('hour') === '24' ? '00' : gp('hour')}:${gp('minute')}`;
      const userBookings = await dbAll(`
        SELECT b.id, b.booking_date, s.start_time, s.end_time
        FROM bookings b JOIN slots s ON s.id = b.slot_id
        WHERE b.user_id = ?
      `, [user.id]);
      cancelledBookings = userBookings.filter(b => `${b.booking_date}T${b.end_time}` >= nowBudapestStr);
      for (const b of cancelledBookings) {
        await dbRun('DELETE FROM bookings WHERE id = ?', [b.id]);
      }
      if (cancelledBookings.length > 0) {
        console.log(`[WITHDRAWAL] Deleted ${cancelledBookings.length} upcoming booking(s) of user #${user.id}`);
      }
    } catch (bookErr) {
      console.error('[WITHDRAWAL] Failed to delete bookings:', bookErr);
    }

    // Send transaction email
    const mailSubject = 'Átvételi elismervény – Elállási nyilatkozat beérkezése';
    const mailText = `Kedves ${user.name}!

Tájékoztatjuk, hogy az alábbi szolgáltatástól/rendeléstől való elállási nyilatkozata sikeresen beérkezett a HawkStone Városi Mászóklub rendszerébe.

Az elállás részletei:
Rendelés azonosítója: #${identifier}
Vásárló neve: ${user.name}
Vásárló e-mail címe: ${email.trim()}
Nyilatkozat beérkezésének pontos ideje: ${hungarianTimeStr}

Érintett szolgáltatások:
${validTickets.map(t => `- Jegy ID: #${t.id}, Típus: ${(getTicketConfig(t.ticket_type) || {}).fullName || t.ticket_type}, Fennmaradó alkalmak: ${t.sessions_remaining}`).join('\n')}

${cancelledBookings.length > 0 ? `Törölt időpontfoglalások:\n${cancelledBookings.map(b => `- ${b.booking_date} ${b.start_time}–${b.end_time}`).join('\n')}\nAz elállással a lefoglalt, még le nem zajlott időpontjaid törlődtek. Új jegy vásárlása esetén új időpontfoglalás szükséges.\n\n` : ''}Mi történik ezután?
Munkatársaink megvizsgálják az elállás jogosságát (pl. fel nem használt alkalmak ellenőrzése). Amennyiben az elállás megfelel az ÁSZF-ben foglalt feltételeknek, a vételárat 14 napon belül visszatérítjük arra a bankkártyára, amellyel a vásárlás történt.

Üdvözlettel,
HawkStone Mászóklub`;

    const mailHtml = brandedMail({
      title: 'Átvételi elismervény',
      subtitle: 'Elállási nyilatkozat beérkezése',
      bodyHtml: `
        <p style="font-size: 15px; line-height: 1.65; color: ${MAIL_THEME.text}; margin: 0 0 8px 0;">Kedves ${user.name}!</p>
        <p style="font-size: 15px; line-height: 1.65; color: ${MAIL_THEME.text}; margin: 0 0 20px 0;">
          Tájékoztatjuk, hogy az alábbi szolgáltatástól/rendeléstől való elállási nyilatkozata sikeresen beérkezett a HawkStone Városi Mászóklub rendszerébe.
        </p>
        <div style="background: ${MAIL_THEME.panel}; border: 1px solid ${MAIL_THEME.border}; border-radius: 10px; padding: 16px 20px; margin: 0 0 22px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            ${mailRow('Rendelés azonosítója', '#' + identifier)}
            ${mailRow('Vásárló neve', user.name)}
            ${mailRow('Vásárló e-mail címe', '<a href="mailto:' + email.trim() + '" style="color: ' + MAIL_THEME.strong + '; text-decoration: none;">' + email.trim() + '</a>')}
            ${mailRow('Nyilatkozat beérkezése', hungarianTimeStr)}
          </table>
          <p style="margin: 16px 0 8px 0; color: ${MAIL_THEME.accent}; font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;">Visszavont szolgáltatások</p>
          <ul style="margin: 0; padding: 0; list-style: none;">
            ${processedDetails.join('')}
          </ul>
        </div>
        ${cancelledBookings.length > 0 ? `
        <div style="background: ${MAIL_THEME.panel}; border: 1px solid ${MAIL_THEME.border}; border-radius: 10px; padding: 16px 20px; margin: 0 0 22px 0;">
          <p style="margin: 0 0 8px 0; color: ${MAIL_THEME.accent}; font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;">Törölt időpontfoglalások</p>
          <ul style="margin: 0 0 10px 0; padding: 0; list-style: none; color: ${MAIL_THEME.strong}; font-size: 14px;">
            ${cancelledBookings.map(b => `<li style="margin: 0 0 4px 0;">${b.booking_date} ${b.start_time}–${b.end_time}</li>`).join('')}
          </ul>
          <p style="margin: 0; font-size: 13px; line-height: 1.5; color: ${MAIL_THEME.text};">Az elállással a lefoglalt, még le nem zajlott időpontjaid törlődtek. Új jegy vásárlása esetén új időpontfoglalás szükséges.</p>
        </div>` : ''}
        <h4 style="color: ${MAIL_THEME.accent}; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 8px 0;">Mi történik ezután?</h4>
        <p style="font-size: 14px; line-height: 1.65; color: ${MAIL_THEME.text}; margin: 0;">
          Munkatársaink megvizsgálják az elállás jogosságát (pl. fel nem használt alkalmak ellenőrzése). Amennyiben az elállás megfelel az ÁSZF-ben foglalt feltételeknek, a vételárat 14 napon belül visszatérítjük arra a bankkártyára, amellyel a vásárlás történt.
        </p>`,
      footerHtml: 'Ez egy automatikus, tartós adathordozón küldött visszaigazolás az új fogyasztóvédelmi előírásoknak megfelelően.<br><br>Üdvözlettel,<br>HawkStone Mászóklub'
    });

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || `"HawkStone" <noreply@hawkstone.hu>`,
          to: email.trim(),
          subject: mailSubject,
          text: mailText,
          html: mailHtml,
          attachments: [mailHeaderAttachment()]
        });
        console.log(`[EMAIL] Withdrawal confirmation sent successfully to ${email}`);
      } catch (mailError) {
        console.error('[EMAIL ERROR] Failed to send email via SMTP:', mailError);
      }
    } else {
      console.log(`\n==================================================`);
      console.log(`[EMAIL MOCK] Withdrawal confirmation sent to: ${email}`);
      console.log(`Subject: ${mailSubject}`);
      console.log(`Link: ${hungarianTimeStr}`);
      console.log(`==================================================\n`);
    }

    res.json({
      message: 'Sikeres elállás! A visszaigazolást e-mailben megküldtük.',
      customerName: user.name,
      customerEmail: email.trim(),
      withdrawalTime: hungarianTimeStr,
      tickets: validTickets.map(t => ({ id: t.id, type: t.ticket_type })),
      cancelledBookings: cancelledBookings.map(b => ({ date: b.booking_date, start: b.start_time, end: b.end_time }))
    });
  } catch (error) {
    console.error('[WITHDRAWAL CONFIRM ERROR]:', error);
    res.status(500).json({ error: 'Hiba az elállási nyilatkozat beküldése során: ' + error.message });
  }
});

// 3. Admin Withdrawals List Endpoint (Admin only) with optional filters
app.get('/api/admin/withdrawals', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { month, status, search } = req.query;
    let whereConditions = [];
    let params = [];

    if (month && /^\d{4}-\d{2}$/.test(month.trim())) {
      whereConditions.push("strftime('%Y-%m', w.withdrawal_time) = ?");
      params.push(month.trim());
    }

    if (status === 'pending') {
      whereConditions.push("(w.refund_status = 'PENDING' OR w.refund_status = 'UNDER_REVIEW' OR w.refund_status IS NULL)");
    } else if (status === 'completed') {
      whereConditions.push("(w.refund_status = 'REFUNDED' OR w.refund_status = 'REJECTED')");
    } else if (status && status !== 'all') {
      whereConditions.push("w.refund_status = ?");
      params.push(status);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      whereConditions.push('(u.name LIKE ? OR u.email LIKE ? OR w.contract_id LIKE ? OR w.customer_name LIKE ?)');
      params.push(s, s, s, s);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const list = await dbAll(`
      SELECT w.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
             t.expires_date as ticket_expires_date
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN tickets t ON w.ticket_id = t.id
      ${whereClause}
      ORDER BY w.withdrawal_time DESC
    `, params);
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Hiba a naplózott elállások lekérésekor: ' + error.message });
  }
});

// Admin Statistics & Analytics for Launch / Management
app.get('/api/admin/stats', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const range = req.query.range || 'all'; // 'all', 'month', '30d', '7d'

    let bookingDateFilter = '';
    let scanDateFilter = '';
    let withdrawalDateFilter = '';

    if (range === 'month') {
      bookingDateFilter = "WHERE strftime('%Y-%m', b.booking_date) = strftime('%Y-%m', 'now')";
      scanDateFilter = "AND strftime('%Y-%m', el.scan_time) = strftime('%Y-%m', 'now')";
      withdrawalDateFilter = "WHERE strftime('%Y-%m', withdrawal_time) = strftime('%Y-%m', 'now')";
    } else if (range === '30d') {
      bookingDateFilter = "WHERE b.booking_date >= date('now', '-30 days')";
      scanDateFilter = "AND el.scan_time >= date('now', '-30 days')";
      withdrawalDateFilter = "WHERE withdrawal_time >= date('now', '-30 days')";
    } else if (range === '7d') {
      bookingDateFilter = "WHERE b.booking_date >= date('now', '-7 days')";
      scanDateFilter = "AND el.scan_time >= date('now', '-7 days')";
      withdrawalDateFilter = "WHERE withdrawal_time >= date('now', '-7 days')";
    }

    const [
      usersStats,
      bookingsStats,
      scansStats,
      locationStats,
      hourlyStats,
      cardStats,
      ticketStats,
      withdrawalStats,
      staffStats
    ] = await Promise.all([
      dbGet(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN created_at >= date('now', '-7 days') THEN 1 END) as new_users_7d,
          COUNT(CASE WHEN created_at >= date('now', '-30 days') THEN 1 END) as new_users_30d
        FROM users
      `),
      dbGet(`
        SELECT 
          COUNT(*) as total_bookings,
          COUNT(CASE WHEN b.booking_date >= date('now') THEN 1 END) as future_bookings,
          COUNT(CASE WHEN b.booking_date < date('now') THEN 1 END) as past_bookings
        FROM bookings b
        ${bookingDateFilter}
      `),
      dbGet(`
        SELECT COUNT(*) as total_scans
        FROM entry_logs el
        WHERE el.status = 'SUCCESS' ${scanDateFilter}
      `),
      dbAll(`
        SELECT 
          l.id as location_id,
          l.name as location_name,
          COUNT(b.id) as booking_count,
          (SELECT COUNT(*) FROM entry_logs el WHERE el.location_id = l.id AND el.status = 'SUCCESS' ${scanDateFilter}) as scan_count
        FROM locations l
        LEFT JOIN slots s ON s.location_id = l.id
        LEFT JOIN bookings b ON b.slot_id = s.id ${bookingDateFilter ? bookingDateFilter.replace('WHERE', 'AND') : ''}
        GROUP BY l.id, l.name
        ORDER BY booking_count DESC
      `),
      dbAll(`
        SELECT 
          substr(s.start_time, 1, 2) || ':00' as hour_slot,
          COUNT(b.id) as count
        FROM bookings b
        JOIN slots s ON b.slot_id = s.id
        ${bookingDateFilter}
        GROUP BY hour_slot
        ORDER BY hour_slot ASC
      `),
      dbAll(`
        SELECT card_type, COUNT(*) as count 
        FROM users 
        GROUP BY card_type
      `),
      dbAll(`
        SELECT ticket_type, COUNT(*) as count, SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active_count 
        FROM tickets 
        GROUP BY ticket_type
      `),
      dbGet(`
        SELECT 
          COUNT(*) as total_withdrawals,
          SUM(CASE WHEN refund_status = 'PENDING' OR refund_status = 'UNDER_REVIEW' OR refund_status IS NULL THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN refund_status = 'REFUNDED' THEN 1 ELSE 0 END) as refunded_count,
          SUM(CASE WHEN refund_status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_count
        FROM withdrawals
        ${withdrawalDateFilter}
      `),
      dbAll(`
        SELECT 
          COALESCE(el.staff_name, u.name, 'Rendszer') as staff_name,
          COUNT(*) as scan_count
        FROM entry_logs el
        LEFT JOIN users u ON el.staff_id = u.id
        WHERE el.status = 'SUCCESS' ${scanDateFilter}
        GROUP BY staff_name
        ORDER BY scan_count DESC
        LIMIT 6
      `)
    ]);

    const totalBookingsCount = bookingsStats?.total_bookings || 0;
    const totalScansCount = scansStats?.total_scans || 0;
    const pastBookingsCount = bookingsStats?.past_bookings || 0;
    let attendanceRate = 0;
    if (pastBookingsCount > 0) {
      attendanceRate = Math.min(100, Math.round((totalScansCount / pastBookingsCount) * 100));
    } else if (totalBookingsCount > 0) {
      attendanceRate = Math.min(100, Math.round((totalScansCount / totalBookingsCount) * 100));
    }

    const totalTicketsSold = (ticketStats || []).reduce((acc, t) => acc + (t.count || 0), 0);
    const totalWithdrawalsCount = withdrawalStats?.total_withdrawals || 0;
    const withdrawalRate = totalTicketsSold > 0 ? Math.round((totalWithdrawalsCount / totalTicketsSold) * 100) : 0;

    const locationsWithPercent = (locationStats || []).map(loc => ({
      ...loc,
      percent: totalBookingsCount > 0 ? Math.round((loc.booking_count / totalBookingsCount) * 100) : 0
    }));

    let cardMap = { 'ZÖLD': 0, 'PIROS': 0, 'NONE': 0 };
    (cardStats || []).forEach(c => {
      const type = (c.card_type || '').toUpperCase();
      if (type.includes('ZÖLD') || type.includes('ZOLD')) cardMap['ZÖLD'] += c.count;
      else if (type.includes('PIROS')) cardMap['PIROS'] += c.count;
      else cardMap['NONE'] += c.count;
    });

    res.json({
      range,
      summary: {
        total_users: usersStats?.total_users || 0,
        new_users_7d: usersStats?.new_users_7d || 0,
        new_users_30d: usersStats?.new_users_30d || 0,
        total_bookings: totalBookingsCount,
        future_bookings: bookingsStats?.future_bookings || 0,
        past_bookings: pastBookingsCount,
        total_scans: totalScansCount,
        attendance_rate: attendanceRate,
        total_withdrawals: totalWithdrawalsCount,
        withdrawal_rate: withdrawalRate,
        total_tickets_sold: totalTicketsSold
      },
      locations: locationsWithPercent,
      hourly_distribution: hourlyStats || [],
      card_distribution: cardMap,
      ticket_types: ticketStats || [],
      withdrawals: {
        total: totalWithdrawalsCount,
        pending: withdrawalStats?.pending_count || 0,
        refunded: withdrawalStats?.refunded_count || 0,
        rejected: withdrawalStats?.rejected_count || 0
      },
      staff_leaderboard: staffStats || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a statisztikai adatok lekérésekor: ' + error.message });
  }
});

// 4. Admin Update Withdrawal Status (refund_status + admin_note)
app.patch('/api/admin/withdrawals/:id', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { refund_status, admin_note } = req.body;
    const withdrawalId = req.params.id;
    const withdrawal = await dbGet('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!withdrawal) return res.status(404).json({ error: 'Elállás nem található.' });

    let triggeredBarionRefund = false;
    let refundErrorMsg = null;
    let ticket = null;
    let refundInvoiceNumber = null;
    let refundInvoiceError = null;
    let refundInvoiceWarning = null;
    let isFullStornoDoc = false;
    let refundAlreadyCovered = false;

    if (refund_status === 'REFUNDED' && withdrawal.refund_status !== 'REFUNDED') {
      ticket = await dbGet('SELECT * FROM tickets WHERE id = ?', [withdrawal.ticket_id]);
      if (ticket && ticket.payment_id) {
        const paymentId = ticket.payment_id;
        
        // Find payment amount and details
        const payment = await dbGet('SELECT * FROM barion_payments WHERE payment_id = ?', [paymentId]);
        if (payment) {
          try {
            if (!BARION_POS_KEY) {
              throw new Error('A Barion nincs konfigurálva a szerveren.');
            }

            // A. Fetch payment state from Barion to get TransactionId and POSTransactionId
            console.log(`[REFUND] Querying state for payment ${paymentId} from Barion...`);
            const stateResponse = await fetch(`${BARION_BASE_URL}/v2/Payment/GetPaymentState?PosKey=${BARION_POS_KEY}&PaymentId=${paymentId}`);
            const stateData = await stateResponse.json();

            if (!stateResponse.ok || (stateData.Errors && stateData.Errors.length > 0)) {
              const errorMsg = stateData.Errors && stateData.Errors[0] ? stateData.Errors[0].Title : 'Barion hiba';
              throw new Error(`Nem sikerült lekérdezni a tranzakció részleteit a Bariontól: ${errorMsg}`);
            }

            if (stateData.Status !== 'Succeeded') {
              throw new Error(`A fizetés státusza a Barionnál nem sikeres (${stateData.Status}), nem téríthető vissza.`);
            }

            if (!stateData.Transactions || stateData.Transactions.length === 0) {
              throw new Error('Nem található tranzakció a Barion fizetésben.');
            }

            const transaction = stateData.Transactions.find(t => !t.RelatedId && !/fee/i.test(t.TransactionType || '')) || stateData.Transactions[0];
            const transactionId = transaction.TransactionId;
            const posTransactionId = transaction.POSTransactionId;

            // B. Refund amount = what THIS ticket cost (not the whole payment), based on unused sessions
            const refundBaseType = getTicketBaseType(withdrawal.ticket_type);
            const ticketCfgForRefund = getTicketConfig(withdrawal.ticket_type);
            const ticketPaid = ticketCfgForRefund ? ticketCfgForRefund.price : payment.amount;
            let refundAmount = ticketPaid;
            if (refundBaseType === 'NAPI') {
              refundAmount = withdrawal.sessions_remaining > 0 ? ticketPaid : 0;
            } else if (refundBaseType === 'TIZ_ALKALMAS') {
              const ratio = Math.max(0, Math.min(1, withdrawal.sessions_remaining / 10));
              refundAmount = Math.round(ticketPaid * ratio);
            } else if (refundBaseType === 'HAVI') {
              // Proportional to remaining days out of 30 days validity
              const purchaseDate = new Date(withdrawal.purchase_date);
              const withdrawalDate = new Date(withdrawal.withdrawal_time);
              const diffDays = (withdrawalDate.getTime() - purchaseDate.getTime()) / (1000 * 3600 * 24);
              const daysRemaining = Math.max(0, 30 - diffDays);
              const ratio = Math.max(0, Math.min(1, daysRemaining / 30));
              refundAmount = Math.round(ticketPaid * ratio);
            }

            // Never refund more than what is still refundable on the Barion transaction
            const alreadyRefunded = stateData.Transactions
              .filter(t => /^Refund/i.test(t.TransactionType || '') && t.Status === 'Succeeded')
              .reduce((sum, t) => sum + (Number(t.Total) || 0), 0);
            const refundableLeft = Math.max(0, (Number(transaction.Total) || payment.amount) - alreadyRefunded);
            if (refundableLeft <= 0) {
              refundAlreadyCovered = true;
            } else if (refundAmount > refundableLeft) {
              refundAmount = refundableLeft;
            }

            console.log(`[REFUND] Calculated refund amount: ${refundAmount} HUF (ticket price: ${ticketPaid} HUF, payment: ${payment.amount} HUF, already refunded: ${alreadyRefunded} HUF, unused: ${withdrawal.sessions_remaining} sessions)`);

            if (refundAlreadyCovered) {
              console.log(`[REFUND] Payment ${paymentId} has already been fully refunded on Barion – no new refund needed.`);
            } else {
            if (refundAmount <= 0) {
              throw new Error('A kiszámolt visszatérítési összeg 0 Ft, nincs mit visszatéríteni.');
            }

            // C. Call Barion Refund API
            console.log(`[REFUND] Sending Refund request to Barion for transaction ${transactionId} with amount ${refundAmount} HUF...`);
            const refundResponse = await fetch(`${BARION_BASE_URL}/v2/Payment/Refund`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                POSKey: BARION_POS_KEY,
                PaymentId: paymentId,
                TransactionsToRefund: [
                  {
                    TransactionId: transactionId,
                    POSTransactionId: posTransactionId,
                    AmountToRefund: refundAmount,
                    Comment: `Refund for withdrawal request #${withdrawalId}`
                  }
                ]
              })
            });

            const refundData = await refundResponse.json();
            if (!refundResponse.ok || (refundData.Errors && refundData.Errors.length > 0)) {
              const errorMsg = refundData.Errors && refundData.Errors[0] ? refundData.Errors[0].Title : 'Visszatérítési hiba';
              throw new Error(`Barion visszatérítés sikertelen: ${errorMsg}`);
            }

            console.log(`[REFUND] Successfully completed Barion refund for payment ${paymentId}. Refunded: ${refundAmount} HUF.`);
            triggeredBarionRefund = true;

            // Trigger refund invoicing
            if (payment.invoice_number) {
              try {
                const climber = await dbGet('SELECT * FROM users WHERE id = ?', [payment.user_id]);
                if (climber) {
                  const isFullStorno = (refundAmount === payment.amount);
                  isFullStornoDoc = isFullStorno;
                  console.log(`[REFUND INVOICE] Triggering Számlázz.hu refund invoice. isFullStorno = ${isFullStorno}`);
                  const refundInvoiceResult = await createSzamlazzRefundInvoice(payment, payment.invoice_number, climber, refundAmount, isFullStorno);
                  if (refundInvoiceResult && refundInvoiceResult.success) {
                    refundInvoiceNumber = refundInvoiceResult.szamlaszam;
                    // Send refund email
                    await sendRefundEmail(climber, ticket || { id: withdrawal.ticket_id, ticket_type: withdrawal.ticket_type }, refundAmount, refundInvoiceResult.pdfBuffer, refundInvoiceResult.szamlaszam, isFullStorno);
                  } else {
                    refundInvoiceError = refundInvoiceResult ? refundInvoiceResult.error : 'ismeretlen hiba';
                  }
                }
              } catch (invErr) {
                console.error('[REFUND INVOICE ERROR]: Failed to generate/send refund invoice:', invErr);
                refundInvoiceError = invErr.message;
              }
            } else {
              refundInvoiceWarning = 'Nem található eredeti számlaszám az adatbázisban, ezért a sztornó/helyesbítő számlát manuálisan kell kiállítani.';
            }
            }
          } catch (err) {
            console.error('[REFUND ERROR]:', err);
            refundErrorMsg = err.message;
          }
        } else {
          console.warn(`[REFUND] Payment record not found in database for payment_id: ${paymentId}`);
        }
      } else {
        console.log(`[REFUND] Ticket #${withdrawal.ticket_id} is not associated with a Barion payment_id. Proceeding with manual/offline status update.`);
      }
    }

    if (refundErrorMsg) {
      // Save error message to admin note and abort
      const errorNote = `[VISSZATÉRÍTÉSI HIBA] ${new Date().toISOString().substring(0, 16).replace('T', ' ')}: ${refundErrorMsg}\n` + (admin_note || withdrawal.admin_note || '');
      await dbRun(
        'UPDATE withdrawals SET admin_note = ? WHERE id = ?',
        [errorNote, withdrawalId]
      );
      return res.status(400).json({ error: refundErrorMsg });
    }

    const newRefundStatus = refund_status || withdrawal.refund_status;
    
    let finalNote = admin_note !== undefined ? admin_note : (withdrawal.admin_note || '');
    if (triggeredBarionRefund) {
      finalNote = `[BARION VISSZATÉRÍTÉS] Sikeresen visszautalva a felhasználónak. (${new Date().toLocaleString('hu-HU')})\n` + finalNote;
      if (refundInvoiceNumber) {
        const docName = isFullStornoDoc ? 'sztornó' : 'helyesbítő';
        finalNote = `[SZÁMLÁZÁS] Sikeresen kiállítva a ${docName} számla (${refundInvoiceNumber}).\n` + finalNote;
      } else if (refundInvoiceError) {
        finalNote = `[SZÁMLÁZÁSI HIBA] A sztornó/helyesbítő számla kiállítása sikertelen: ${refundInvoiceError}\n` + finalNote;
      } else if (refundInvoiceWarning) {
        finalNote = `[SZÁMLÁZÁS FIGYELMEZTETÉS] ${refundInvoiceWarning}\n` + finalNote;
      }
    } else if (refundAlreadyCovered) {
      finalNote = `[BARION] A fizetés teljes összege már visszautalásra került egy korábbi elállásnál – új visszatérítés nem történt. (${new Date().toLocaleString('hu-HU')})\n` + finalNote;
    } else if (refund_status === 'REFUNDED' && (!ticket || !ticket.payment_id)) {
      finalNote = `[MANUÁLIS VISSZATÉRÍTÉS] Manuálisan elszámolva (nem Barionos fizetés).\n` + finalNote;
    }

    await dbRun(
      'UPDATE withdrawals SET refund_status = ?, admin_note = ? WHERE id = ?',
      [newRefundStatus, finalNote, withdrawalId]
    );

    const updated = await dbGet('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    res.json({ success: true, withdrawal: updated });
  } catch (error) {
    res.status(500).json({ error: 'Hiba az elállás frissítésekor: ' + error.message });
  }
});

// 5. Admin Send Message to Customer about Withdrawal
app.post('/api/admin/withdrawals/:id/message', authenticateToken, requireRole(['ADMIN']), async (req, res) => {
  try {
    const withdrawalId = req.params.id;
    const { subject, message } = req.body;
    if (!message) return res.status(400).json({ error: 'Az üzenet nem lehet üres.' });

    const withdrawal = await dbGet('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!withdrawal) return res.status(404).json({ error: 'Elállás nem található.' });

    const mailSubject = subject || `HawkStone – Elállási ügy értesítő (#${withdrawal.contract_id})`;
    const mailHtml = brandedMail({
      title: 'HawkStone Városi Mászóklub',
      subtitle: 'Elállási ügy – értesítő',
      bodyHtml: `
        <p style="font-size: 15px; line-height: 1.65; color: ${MAIL_THEME.text}; margin: 0 0 16px 0;">Kedves ${withdrawal.customer_name}!</p>
        <div style="background: ${MAIL_THEME.panel}; border: 1px solid ${MAIL_THEME.border}; border-radius: 10px; padding: 14px 20px; margin: 0 0 18px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            ${mailRow('Elállás azonosítója', '#' + withdrawal.contract_id)}
            ${mailRow('Jegy ID', '#' + withdrawal.ticket_id)}
          </table>
        </div>
        <div style="border-left: 3px solid ${MAIL_THEME.accent}; background: ${MAIL_THEME.panel}; padding: 14px 18px; border-radius: 6px; font-size: 14px; line-height: 1.7; color: ${MAIL_THEME.text}; white-space: pre-wrap;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
      footerHtml: 'Üdvözlettel,<br>HawkStone Mászóklub Adminisztráció'
    });

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"HawkStone" <noreply@hawkstone.hu>`,
        to: withdrawal.customer_email,
        subject: mailSubject,
        html: mailHtml,
        attachments: [mailHeaderAttachment()]
      });
      console.log(`[EMAIL] Admin message sent to ${withdrawal.customer_email}`);
    } else {
      console.log(`[EMAIL MOCK] Admin message would be sent to: ${withdrawal.customer_email}`);
      console.log(`Subject: ${mailSubject}`);
      console.log(`Message: ${message}`);
    }

    // Save note
    await dbRun('UPDATE withdrawals SET admin_note = ? WHERE id = ?', [message, withdrawalId]);

    res.json({ success: true, message: 'Üzenet elküldve.' });
  } catch (error) {
    res.status(500).json({ error: 'Hiba az üzenet küldésekor: ' + error.message });
  }
});

// ---------------- GALLERY & REFERENCES UPLOAD API ----------------
function toInternetFriendlyFilename(raw, fallback = 'referencia-maszofal') {
  const base = String(raw || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ő/g, 'o')
    .replace(/ű/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || fallback) + '.jpg';
}

// Public endpoint: list dynamic gallery items (for index.html and referenciak.html)
app.get('/api/gallery', async (req, res) => {
  try {
    const rows = await dbAll('SELECT id, target, city, name, alt, filename, created_at FROM gallery_items ORDER BY id ASC');
    const items = (rows || []).map(r => {
      const folder = r.target === 'home_gallery' ? 'hawkstone' : 'wall';
      const relPath = `pictures/${folder}/${r.filename}`;
      const absPath = path.join(__dirname, 'public', 'pictures', folder, r.filename);
      const hasStaticFile = fs.existsSync(absPath);
      return {
        id: r.id,
        target: r.target,
        city: r.city,
        name: r.name,
        alt: r.alt || `${r.city} – ${r.name}`,
        filename: r.filename,
        src: hasStaticFile ? relPath : `/api/gallery-image/${r.id}/${encodeURIComponent(r.filename)}`,
        created_at: r.created_at
      };
    });
    res.json(items);
  } catch (error) {
    res.json([]);
  }
});

// Public endpoint: serve uploaded image bytes directly from DB with long cache headers
app.get('/api/gallery-image/:id/:filename?', async (req, res) => {
  try {
    const item = await dbGet('SELECT filename, image_data FROM gallery_items WHERE id = ?', [req.params.id]);
    if (!item || !item.image_data) {
      return res.status(404).send('Kép nem található');
    }
    const base64Part = item.image_data.includes(',') ? item.image_data.split(',')[1] : item.image_data;
    const buffer = Buffer.from(base64Part, 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  } catch (error) {
    res.status(500).send('Hiba a kép betöltésekor');
  }
});

// Admin endpoint: list all uploaded gallery/reference items
app.get('/api/admin/references', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const rows = await dbAll('SELECT id, target, city, name, alt, filename, created_at FROM gallery_items ORDER BY id DESC');
    const items = (rows || []).map(r => {
      const folder = r.target === 'home_gallery' ? 'hawkstone' : 'wall';
      const relPath = `pictures/${folder}/${r.filename}`;
      const absPath = path.join(__dirname, 'public', 'pictures', folder, r.filename);
      const hasStaticFile = fs.existsSync(absPath);
      return {
        id: r.id,
        target: r.target,
        city: r.city,
        name: r.name,
        alt: r.alt,
        filename: r.filename,
        src: hasStaticFile ? relPath : `/api/gallery-image/${r.id}/${encodeURIComponent(r.filename)}`,
        saved_to_disk: hasStaticFile,
        created_at: r.created_at
      };
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Hiba a referenciák lekérésekor: ' + error.message });
  }
});

// Admin endpoint: upload, sanitize filename, save to DB (and public/pictures/* if writable)
app.post('/api/admin/references', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { target, city, name, filename, customSlug, imageData, imageBase64 } = req.body;
    const finalImageData = imageData || imageBase64;
    if (!city || !finalImageData) {
      return res.status(400).json({ error: 'A város/főcím és a kép kiválasztása kötelező.' });
    }
    const cleanTarget = target === 'home_gallery' ? 'home_gallery' : 'references';
    const cleanCity = String(city).trim();
    const cleanName = String(name || '').trim();
    const cleanAlt = cleanName ? `${cleanCity} – ${cleanName}` : cleanCity;
    const rawSlug = filename || customSlug || (cleanName ? `${cleanCity}-${cleanName}` : cleanCity);
    let cleanFilename = toInternetFriendlyFilename(rawSlug);

    const folder = cleanTarget === 'home_gallery' ? 'hawkstone' : 'wall';
    const targetDir = path.join(__dirname, 'public', 'pictures', folder);
    let savedToDisk = false;

    // Avoid overwriting existing file with the same name by appending a short suffix if needed
    try {
      if (fs.existsSync(path.join(targetDir, cleanFilename))) {
        const stem = cleanFilename.replace(/\.jpg$/i, '');
        cleanFilename = `${stem}-${Date.now().toString().slice(-4)}.jpg`;
      }
      const base64Part = finalImageData.includes(',') ? finalImageData.split(',')[1] : finalImageData;
      const buffer = Buffer.from(base64Part, 'base64');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, cleanFilename), buffer);
      savedToDisk = true;
    } catch (fsErr) {
      // On read-only serverless filesystems (e.g. Vercel), DB storage serves the image via /api/gallery-image/:id/:filename
      console.log('[GALLERY UPLOAD] Read-only filesystem, serving from database:', fsErr.message);
    }

    const result = await dbRun(
      'INSERT INTO gallery_items (target, city, name, alt, filename, image_data) VALUES (?, ?, ?, ?, ?, ?)',
      [cleanTarget, cleanCity, cleanName, cleanAlt, cleanFilename, finalImageData]
    );

    const newId = result.lastID;
    const src = savedToDisk
      ? `pictures/${folder}/${cleanFilename}`
      : `/api/gallery-image/${newId}/${encodeURIComponent(cleanFilename)}`;

    res.json({
      success: true,
      item: {
        id: newId,
        target: cleanTarget,
        city: cleanCity,
        name: cleanName,
        alt: cleanAlt,
        filename: cleanFilename,
        src,
        saved_to_disk: savedToDisk
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a kép feltöltésekor: ' + error.message });
  }
});

// Admin endpoint: delete an uploaded gallery/reference item
app.delete('/api/admin/references/:id', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const item = await dbGet('SELECT * FROM gallery_items WHERE id = ?', [req.params.id]);
    if (!item) {
      return res.status(404).json({ error: 'A kiválasztott elem nem található.' });
    }
    const folder = item.target === 'home_gallery' ? 'hawkstone' : 'wall';
    const filePath = path.join(__dirname, 'public', 'pictures', folder, item.filename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {}

    await dbRun('DELETE FROM gallery_items WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a törlés során: ' + error.message });
  }
});

// ---------------- DEFAULT HOME WALL TYPES (MÁSZÓFAL TÍPUSAINK) ----------------
const DEFAULT_HOME_WALL_TYPES = [
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

// ---------------- HOME WALL TYPES API (MÁSZÓFAL TÍPUSAINK) ----------------
app.get('/api/site-settings/wall-types', async (req, res) => {
  try {
    const row = await dbGet('SELECT setting_value FROM site_settings WHERE setting_key = ?', ['home_wall_types']);
    if (!row || !row.setting_value) {
      return res.json(DEFAULT_HOME_WALL_TYPES);
    }
    const parsed = JSON.parse(row.setting_value);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return res.json(DEFAULT_HOME_WALL_TYPES);
    }
    res.json(parsed);
  } catch (error) {
    res.json(DEFAULT_HOME_WALL_TYPES);
  }
});

app.put('/api/admin/site-settings/wall-types', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'A kártyák listájának megadása kötelező.' });
    }

    const cleanItems = items.map((item, idx) => ({
      id: Number(item.id) || (idx + 1),
      nr: String(item.nr || `0${idx + 1}`).trim(),
      badge: String(item.badge || '').trim(),
      title: String(item.title || '').trim(),
      desc: String(item.desc || '').trim(),
      note_title: String(item.note_title || '').trim(),
      note: String(item.note || '').trim()
    }));

    const jsonVal = JSON.stringify(cleanItems);
    const existing = await dbGet('SELECT setting_key FROM site_settings WHERE setting_key = ?', ['home_wall_types']);
    if (existing) {
      await dbRun('UPDATE site_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [jsonVal, 'home_wall_types']);
    } else {
      await dbRun('INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)', ['home_wall_types', jsonVal]);
    }

    res.json({ success: true, items: cleanItems });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a mászófal típusok kártyáinak mentésekor: ' + error.message });
  }
});

// ---------------- SITE CONTACT SETTINGS API ----------------
const DEFAULT_CONTACT_SETTINGS = {
  company_name: 'HOVI-TECH Kft.',
  address: '4531 Nyírpazony, Árpád u. 139.',
  phone_display: '(+36) 30 574 6946',
  phone_tel: '+36305746946',
  email_primary: 'orangeramp.info@gmail.com',
  email_secondary: 'info@hawkstone.hu',
  web_primary: 'www.orangeramp.com',
  web_secondary: 'www.hawkstone.hu'
};

app.get('/api/site-settings/contact', async (req, res) => {
  try {
    const row = await dbGet('SELECT setting_value FROM site_settings WHERE setting_key = ?', ['contact_info']);
    if (!row || !row.setting_value) {
      return res.json(DEFAULT_CONTACT_SETTINGS);
    }
    const parsed = JSON.parse(row.setting_value);
    res.json({ ...DEFAULT_CONTACT_SETTINGS, ...parsed });
  } catch (error) {
    res.json(DEFAULT_CONTACT_SETTINGS);
  }
});

app.put('/api/admin/site-settings/contact', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const {
      company_name,
      address,
      phone_display,
      email_primary,
      email_secondary,
      web_primary,
      web_secondary
    } = req.body;

    if (!company_name || !address || !phone_display || !email_primary) {
      return res.status(400).json({ error: 'A cégnév, a cím, a telefonszám és az elsődleges e-mail cím megadása kötelező.' });
    }

    const cleanPhoneDisplay = String(phone_display).trim();
    const cleanPhoneTel = cleanPhoneDisplay.replace(/[^+\d]/g, '') || '+36305746946';

    const updated = {
      company_name: String(company_name).trim(),
      address: String(address).trim(),
      phone_display: cleanPhoneDisplay,
      phone_tel: cleanPhoneTel,
      email_primary: String(email_primary).trim(),
      email_secondary: String(email_secondary || '').trim(),
      web_primary: String(web_primary || '').trim(),
      web_secondary: String(web_secondary || '').trim()
    };

    const jsonVal = JSON.stringify(updated);
    const existing = await dbGet('SELECT setting_key FROM site_settings WHERE setting_key = ?', ['contact_info']);
    if (existing) {
      await dbRun('UPDATE site_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [jsonVal, 'contact_info']);
    } else {
      await dbRun('INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)', ['contact_info', jsonVal]);
    }

    res.json({ success: true, contact: updated });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a kapcsolati adatok mentésekor: ' + error.message });
  }
});

// ---------------- WALL PRODUCTS (maszofalaink.html) API ----------------
app.get('/api/wall-products', async (req, res) => {
  try {
    const rows = await dbAll('SELECT id, category, code, title, height, width, surface, anchor_points, filename, sort_order, created_at FROM wall_products ORDER BY sort_order ASC, id ASC');
    const items = (rows || []).map(r => {
      const relPath = `pictures/iskolai/${r.filename}`;
      const absPath = path.join(__dirname, 'public', 'pictures', 'iskolai', r.filename);
      const hasStaticFile = fs.existsSync(absPath);
      return {
        id: r.id,
        category: r.category,
        code: r.code,
        title: r.title,
        height: r.height,
        width: r.width,
        surface: r.surface,
        anchor_points: r.anchor_points || '',
        filename: r.filename,
        src: hasStaticFile ? relPath : `/api/wall-product-image/${r.id}/${encodeURIComponent(r.filename)}`,
        created_at: r.created_at
      };
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Hiba a mászófal kártyák lekérésekor: ' + error.message });
  }
});

app.get('/api/wall-product-image/:id/:filename?', async (req, res) => {
  try {
    const item = await dbGet('SELECT filename, image_data FROM wall_products WHERE id = ?', [req.params.id]);
    if (!item || !item.image_data) {
      return res.status(404).send('Kép nem található');
    }
    const base64Part = item.image_data.includes(',') ? item.image_data.split(',')[1] : item.image_data;
    const buffer = Buffer.from(base64Part, 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  } catch (error) {
    res.status(500).send('Hiba a kép betöltésekor');
  }
});

app.post('/api/admin/wall-products', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { category, code, title, height, width, surface, anchor_points, filename, imageData } = req.body;
    if (!code || !title || !height || !width || !surface || !imageData) {
      return res.status(400).json({ error: 'A típusszám, megnevezés, méretek, felület és a kép megadása kötelező.' });
    }

    const validCategories = ['iskolai', 'boulder', 'jatszoter', 'egyeb'];
    const cleanCategory = validCategories.includes(category) ? category : 'iskolai';
    const cleanCode = String(code).trim();
    const cleanTitle = String(title).trim();
    const cleanHeight = String(height).trim();
    const cleanWidth = String(width).trim();
    const cleanSurface = String(surface).trim();
    const cleanAnchors = String(anchor_points || '').trim();
    let cleanFilename = toInternetFriendlyFilename(filename || `${cleanCode}-${cleanTitle}`, 'maszofal');

    const targetDir = path.join(__dirname, 'public', 'pictures', 'iskolai');
    let savedToDisk = false;

    try {
      if (fs.existsSync(path.join(targetDir, cleanFilename))) {
        const stem = cleanFilename.replace(/\.jpg$/i, '');
        cleanFilename = `${stem}-${Date.now().toString().slice(-4)}.jpg`;
      }
      const base64Part = imageData.includes(',') ? imageData.split(',')[1] : imageData;
      const buffer = Buffer.from(base64Part, 'base64');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, cleanFilename), buffer);
      savedToDisk = true;
    } catch (fsErr) {
      console.log('[WALL PRODUCT UPLOAD] Read-only filesystem, serving from database:', fsErr.message);
    }

    const maxSortRow = await dbGet('SELECT MAX(sort_order) as maxSort FROM wall_products');
    const nextSort = (maxSortRow && maxSortRow.maxSort ? maxSortRow.maxSort : 9) + 1;

    const result = await dbRun(
      'INSERT INTO wall_products (category, code, title, height, width, surface, anchor_points, filename, image_data, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [cleanCategory, cleanCode, cleanTitle, cleanHeight, cleanWidth, cleanSurface, cleanAnchors, cleanFilename, imageData, nextSort]
    );

    const newId = result.lastID;
    const src = savedToDisk
      ? `pictures/iskolai/${cleanFilename}`
      : `/api/wall-product-image/${newId}/${encodeURIComponent(cleanFilename)}`;

    res.json({
      success: true,
      item: {
        id: newId,
        category: cleanCategory,
        code: cleanCode,
        title: cleanTitle,
        height: cleanHeight,
        width: cleanWidth,
        surface: cleanSurface,
        anchor_points: cleanAnchors,
        filename: cleanFilename,
        src
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a mászófal kártya mentésekor: ' + error.message });
  }
});

app.put('/api/admin/wall-products/:id', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const item = await dbGet('SELECT * FROM wall_products WHERE id = ?', [req.params.id]);
    if (!item) {
      return res.status(404).json({ error: 'A módosítani kívánt mászófal kártya nem található.' });
    }

    const { category, code, title, height, width, surface, anchor_points, filename, imageData } = req.body;
    if (!code || !title || !height || !width || !surface) {
      return res.status(400).json({ error: 'A típusszám, megnevezés, méretek és felület megadása kötelező.' });
    }

    const validCategories = ['iskolai', 'boulder', 'jatszoter', 'egyeb'];
    const cleanCategory = validCategories.includes(category) ? category : item.category;
    const cleanCode = String(code).trim();
    const cleanTitle = String(title).trim();
    const cleanHeight = String(height).trim();
    const cleanWidth = String(width).trim();
    const cleanSurface = String(surface).trim();
    const cleanAnchors = String(anchor_points || '').trim();

    let cleanFilename = item.filename;
    let newImageData = item.image_data;

    if (imageData) {
      cleanFilename = toInternetFriendlyFilename(filename || `${cleanCode}-${cleanTitle}`, 'maszofal');
      const targetDir = path.join(__dirname, 'public', 'pictures', 'iskolai');
      try {
        const base64Part = imageData.includes(',') ? imageData.split(',')[1] : imageData;
        const buffer = Buffer.from(base64Part, 'base64');
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, cleanFilename), buffer);
      } catch (fsErr) {
        console.log('[WALL PRODUCT UPDATE] Read-only filesystem, serving from database:', fsErr.message);
      }
      newImageData = imageData;
    }

    await dbRun(
      'UPDATE wall_products SET category = ?, code = ?, title = ?, height = ?, width = ?, surface = ?, anchor_points = ?, filename = ?, image_data = ? WHERE id = ?',
      [cleanCategory, cleanCode, cleanTitle, cleanHeight, cleanWidth, cleanSurface, cleanAnchors, cleanFilename, newImageData, req.params.id]
    );

    res.json({
      success: true,
      item: {
        id: Number(req.params.id),
        category: cleanCategory,
        code: cleanCode,
        title: cleanTitle,
        height: cleanHeight,
        width: cleanWidth,
        surface: cleanSurface,
        anchor_points: cleanAnchors,
        filename: cleanFilename,
        src: newImageData && !fs.existsSync(path.join(__dirname, 'public', 'pictures', 'iskolai', cleanFilename))
          ? `/api/wall-product-image/${req.params.id}/${encodeURIComponent(cleanFilename)}`
          : `pictures/iskolai/${cleanFilename}`
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a mászófal kártya módosításakor: ' + error.message });
  }
});

app.delete('/api/admin/wall-products/:id', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const item = await dbGet('SELECT * FROM wall_products WHERE id = ?', [req.params.id]);
    if (!item) {
      return res.status(404).json({ error: 'A kiválasztott mászófal kártya nem található.' });
    }

    // Ha saját feltöltött képfájl volt (image_data nem üres), töröljük a lemezről is
    if (item.image_data) {
      const filePath = path.join(__dirname, 'public', 'pictures', 'iskolai', item.filename);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (_) {}
    }

    await dbRun('DELETE FROM wall_products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Hiba a törlés során: ' + error.message });
  }
});

// Subdomain & Club Routing
app.get(['/klub', '/maszoklub', '/foglalas'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'klub.html'));
});

// Clean URLs for main site pages
app.get('/referenciak', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'referenciak.html'));
});

app.get('/maszofalaink', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maszofalaink.html'));
});

app.get('/webadmin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'webadmin.html'));
});

// Fallback to client routing / 404 error page
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint nem található' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Szerver fut a http://localhost:${PORT} címen`);
});
