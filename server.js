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

// Barion configuration
const BARION_POS_KEY = process.env.BARION_POS_KEY;
const BARION_PAYEE_EMAIL = process.env.BARION_PAYEE_EMAIL;
const BARION_BASE_URL = 'https://api.test.barion.com'; // Sandbox environment

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
app.use(express.json());
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
  const dbPath = path.join(__dirname, 'database.db');
  localDb = new sqlite3.Database(dbPath);
  console.log('[DATABASE] Connecting to local database.db (SQLite3)...');
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
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS entry_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      scan_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      location_id INTEGER,
      status TEXT NOT NULL,
      message TEXT,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS barion_payments (
      payment_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      ticket_type TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

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
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

  // Seed Locations
  const locationsCount = await dbGet('SELECT COUNT(*) as count FROM locations');
  if (locationsCount.count === 0) {
    await dbRun("INSERT INTO locations (name, address, capacity) VALUES ('Eötvös mászófal', 'Nyíregyháza, Eötvös u. 12.', 15)");
    await dbRun("INSERT INTO locations (name, address, capacity) VALUES ('Kossuth mászófal', 'Nyíregyháza, Kossuth u. 56.', 15)");
    await dbRun("INSERT INTO locations (name, address, capacity) VALUES ('Zrínyi mászófal', 'Nyíregyháza, Zrínyi u. 34.', 15)");

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
    const adminHash = await bcrypt.hash('adminhawk', 10);
    const staffHash = await bcrypt.hash('staffhawk', 10);
    const zoldHash = await bcrypt.hash('zoldhawk', 10);
    const pirosHash = await bcrypt.hash('piroshawk', 10);

    await dbRun("INSERT INTO users (name, email, phone, password_hash, license_number, card_type, role, is_verified) VALUES ('Admin Főnök', 'admin@hawkstone.hu', '06201112222', ?, 'SMV-00001', 'ZÖLD', 'ADMIN', 1)", [adminHash]);
    await dbRun("INSERT INTO users (name, email, phone, password_hash, license_number, card_type, role, is_verified) VALUES ('Mászómester Staff', 'staff@hawkstone.hu', '06301112222', ?, 'SMV-00002', 'ZÖLD', 'STAFF', 1)", [staffHash]);
    await dbRun("INSERT INTO users (name, email, phone, password_hash, license_number, card_type, role, is_verified) VALUES ('Kovács Péter (Zöld)', 'zold@hawkstone.hu', '06703334444', ?, 'SMV-99887', 'ZÖLD', 'USER', 1)", [zoldHash]);
    await dbRun("INSERT INTO users (name, email, phone, password_hash, license_number, card_type, role, is_verified) VALUES ('Szabó Anna (Piros)', 'piros@hawkstone.hu', '06704445555', ?, '', 'PIROS', 'USER', 1)", [pirosHash]);
  }
}

initDB().catch(console.error);

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
migratePhoneNumbers();

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
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Nincs jogosultságod ehhez a művelethez!' });
    }
    next();
  };
}

// ---------------- AUTH ROUTES ----------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password, licenseNumber } = req.body;
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

    await dbRun(
      'INSERT INTO users (name, email, phone, password_hash, license_number, card_type, is_verified, verification_token) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
      [name, email, normalizedPhone, passwordHash, licenseNumber || '', cardType, verificationToken]
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

    // Development Backdoor: admin/admin credentials check
    if (email === 'admin' && password === 'admin') {
      const adminUser = await dbGet("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
      if (adminUser) {
        const userPayload = { id: adminUser.id, email: adminUser.email, name: adminUser.name, role: adminUser.role, card_type: adminUser.card_type };
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ token, user: userPayload, mustChangePassword: false });
      }
    }

    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
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
    const user = await dbGet('SELECT id, name, email, phone, license_number, card_type, role, must_change_password FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(444).json({ error: 'Felhasználó nem található!' });

    // Fetch user's active/unused tickets
    const tickets = await dbAll("SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC", [user.id]);

    // Fetch user's bookings (upcoming or past) with attendance log check
    const bookings = await dbAll(`
      SELECT b.id as booking_id, b.booking_date, s.start_time, s.end_time, l.name as location_name,
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

    // day_of_week from date: 0 = Sun, 1 = Mon ... 6 = Sat
    const parsedDate = new Date(date);
    if (isNaN(parsedDate)) {
      return res.status(400).json({ error: 'Érvénytelen dátum formátum!' });
    }
    const dayOfWeek = parsedDate.getDay();

    const slots = await dbAll(`
      SELECT s.*, l.name as location_name,
        (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.booking_date = ?) as booked_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.booking_date = ? AND b.user_id = ?) as user_booked
      FROM slots s
      JOIN locations l ON s.location_id = l.id
      WHERE s.location_id = ? 
        AND s.day_of_week = ?
        AND s.id NOT IN (SELECT slot_id FROM slot_cancellations WHERE cancelled_date = ?)
      ORDER BY s.start_time ASC
    `, [date, date, req.user.id, locationId, dayOfWeek, date]);

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

// Create booking
app.post('/api/bookings', authenticateToken, async (req, res) => {
  try {
    const { slotId, date } = req.body;
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

    const bookedCountRow = await dbGet('SELECT COUNT(*) as count FROM bookings WHERE slot_id = ? AND booking_date = ?', [slotId, date]);
    if (bookedCountRow.count >= slot.max_capacity) {
      return res.status(400).json({ error: 'Ez az időpont már betelt (telt ház)!' });
    }

    // Insert booking (handles unique constraint per user-slot-date automatically)
    try {
      await dbRun('INSERT INTO bookings (user_id, slot_id, booking_date) VALUES (?, ?, ?)', [req.user.id, slotId, date]);
      res.status(201).json({ message: 'Sikeres foglalás!' });
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

    // Users can delete their own booking; Admin/Staff can delete any
    if (booking.user_id !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'STAFF') {
      return res.status(403).json({ error: 'Nincs jogosultságod törölni ezt a foglalást!' });
    }

    // Regular users cannot delete expired or attended bookings
    if (req.user.role !== 'ADMIN' && req.user.role !== 'STAFF') {
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

// ---------------- BARION ONLINE PAYMENT ----------------
// Helper to query and process Barion payment state
async function processBarionPayment(paymentId, domain) {
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
  const response = await fetch(`${BARION_BASE_URL}/v2/Payment/GetPaymentState?PosKey=${BARION_POS_KEY}&PaymentId=${paymentId}`);
  const stateData = await response.json();

  if (!response.ok || (stateData.Errors && stateData.Errors.length > 0)) {
    const errorMsg = stateData.Errors && stateData.Errors[0] ? stateData.Errors[0].Title : 'Lekérdezési hiba';
    throw new Error(`Barion hiba a lekéréskor: ${errorMsg}`);
  }

  console.log(`[BARION] Checked state for payment ${paymentId}. Status: ${stateData.Status}`);

  if (stateData.Status === 'Succeeded') {
    // Double check processed status again inside a sequential block (fake lock/concurrency safety)
    const doubleCheck = await dbGet('SELECT processed FROM barion_payments WHERE payment_id = ?', [paymentId]);
    if (doubleCheck && doubleCheck.processed === 1) {
      return { success: true, alreadyProcessed: true };
    }

    // Set processed = 1 and status = Succeeded
    await dbRun(
      'UPDATE barion_payments SET status = ?, processed = 1 WHERE payment_id = ?',
      ['Succeeded', paymentId]
    );

    const userId = localPayment.user_id;
    const ticketType = localPayment.ticket_type;

    const today = new Date();
    const purchaseDate = today.toISOString().split('T')[0];
    
    const expires = new Date();
    expires.setDate(today.getDate() + 30);
    const expiresDate = expires.toISOString().split('T')[0];

    let sessions = 0;
    if (ticketType === 'NAPI') sessions = 1;
    else if (ticketType === 'TIZ_ALKALMAS') sessions = 10;
    else if (ticketType === 'HAVI') sessions = 9999;

    const qrUuid = generateUUID();

    const result = await dbRun(
      'INSERT INTO tickets (user_id, ticket_type, purchase_date, expires_date, sessions_remaining, qr_code_uuid) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, ticketType, purchaseDate, expiresDate, sessions, qrUuid]
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

    // Generate invoice and send confirmation email synchronously to prevent serverless function termination
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
          }
        }
        
        await sendTicketConfirmationEmail(ticketObj, climber, domain, invoiceBuffer, invoiceNumber);
      }
    } catch (err) {
      console.error('[EMAIL/BILLING ERROR] Error processing post-payment email/invoice:', err);
    }


    return { success: true, ticket: ticketObj };
  } else {
    // Update local status with the non-success status
    await dbRun(
      'UPDATE barion_payments SET status = ? WHERE payment_id = ?',
      [stateData.Status, paymentId]
    );
    return { success: false, status: stateData.Status };
  }
}

// Start Barion Payment (returns GatewayUrl)
app.post('/api/barion/start-payment', authenticateToken, async (req, res) => {
  try {
    const { ticketType, billingName, billingZip, billingCity, billingAddress, billingTaxNumber } = req.body;
    if (!['NAPI', 'TIZ_ALKALMAS', 'HAVI'].includes(ticketType)) {
      return res.status(400).json({ error: 'Érvénytelen jegytípus!' });
    }

    if (!BARION_POS_KEY || !BARION_PAYEE_EMAIL) {
      return res.status(500).json({ error: 'A Barion fizetés nincs konfigurálva a szerveren.' });
    }

    let price = 0;
    let ticketName = '';
    let ticketDesc = '';
    if (ticketType === 'NAPI') {
      price = 2800;
      ticketName = 'Egyszeri Napijegy';
      ticketDesc = 'Egyszeri belépésre jogosító jegy a HawkStone Városi Mászóklubban.';
    } else if (ticketType === 'TIZ_ALKALMAS') {
      price = 22000;
      ticketName = '10 Alkalmas Bérlet';
      ticketDesc = '10 alkalmas bérlet a HawkStone Városi Mászóklubban.';
    } else if (ticketType === 'HAVI') {
      price = 28000;
      ticketName = '30 Napos Korlátlan Bérlet';
      ticketDesc = '30 napig korlátlan belépésre jogosító bérlet a HawkStone Városi Mászóklubban.';
    }

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const domain = `${protocol}://${host}`;

    const paymentRequest = {
      POSKey: BARION_POS_KEY,
      PaymentType: 'Immediate',
      GuestCheckout: true,
      FundingSources: ['All'],
      PaymentRequestId: `hawk_${Date.now()}_${req.user.id}`,
      RedirectUrl: `${domain}/dashboard.html`,
      CallbackUrl: `${domain}/api/barion/callback`,
      Currency: 'HUF',
      Locale: 'hu-HU',
      SendPaymentMail: true,
      Transactions: [
        {
          POSTransactionId: `tx_${Date.now()}_${req.user.id}`,
          Payee: BARION_PAYEE_EMAIL,
          Total: price,
          Items: [
            {
              Name: ticketName,
              Description: ticketDesc,
              Quantity: 1,
              Unit: 'db',
              UnitPrice: price,
              ItemTotal: price
            }
          ]
        }
      ]
    };

    console.log('[BARION] Initiating payment for user:', req.user.id, ticketType);

    const response = await fetch(`${BARION_BASE_URL}/v2/Payment/Start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paymentRequest)
    });

    const responseData = await response.json();
    if (!response.ok || (responseData.Errors && responseData.Errors.length > 0)) {
      const errorMsg = responseData.Errors && responseData.Errors[0] ? responseData.Errors[0].Title : 'Barion hiba';
      console.error('[BARION ERROR] Failed to start payment:', responseData.Errors);
      return res.status(400).json({ error: `Barion hiba: ${errorMsg}` });
    }

    // Save payment details in database with Prepared status and billing details
    await dbRun(
      'INSERT INTO barion_payments (payment_id, user_id, ticket_type, status, amount, processed, billing_name, billing_zip, billing_city, billing_address, billing_tax_number) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
      [
        responseData.PaymentId,
        req.user.id,
        ticketType,
        'Prepared',
        price,
        billingName || '',
        billingZip || '',
        billingCity || '',
        billingAddress || '',
        billingTaxNumber || ''
      ]
    );

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
      res.json({ message: 'Fizetés sikeresen igazolva!', ticket: result.ticket });
    } else {
      res.status(400).json({ error: `Sikertelen fizetés! Státusz: ${result.status}` });
    }
  } catch (error) {
    console.error('[BARION VERIFY ERROR]:', error);
    res.status(500).json({ error: 'Hiba az ellenőrzés során: ' + error.message });
  }
});

// Barion Webhook IPN Callback
// IMPORTANT: Respond with 200 OK immediately, BEFORE any async processing.
// Barion has a short timeout for callbacks — if we wait for DB + API + email,
// it will mark the callback as failed (CallbackFailed), even if it succeeded.
app.post('/api/barion/callback', (req, res) => {
  const paymentId = req.body.PaymentId || req.query.paymentId || req.body.paymentId;
  if (!paymentId) {
    console.warn('[BARION CALLBACK] Received callback without paymentId');
    return res.status(400).send('Missing paymentId');
  }

  console.log('[BARION CALLBACK] Received IPN for payment:', paymentId, '— responding 200 OK immediately.');

  // Respond to Barion immediately so it does not retry / mark as CallbackFailed
  res.status(200).send('OK');

  // Process the payment asynchronously in the background (fire-and-forget)
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host;
  const domain = `${protocol}://${host}`;

  processBarionPayment(paymentId, domain).then(result => {
    if (result.alreadyProcessed) {
      console.log(`[BARION CALLBACK] Payment ${paymentId} was already processed — no action needed.`);
    } else if (result.success) {
      console.log(`[BARION CALLBACK] Payment ${paymentId} successfully processed in background.`);
    } else {
      console.log(`[BARION CALLBACK] Payment ${paymentId} not succeeded — status: ${result.status}`);
    }
  }).catch(err => {
    console.error(`[BARION CALLBACK ERROR] Background processing failed for payment ${paymentId}:`, err.message);
  });
});

// ---------------- TICKETS ----------------
// Purchase ticket simulation
app.post('/api/tickets/purchase', authenticateToken, async (req, res) => {
  try {
    const { ticketType } = req.body;
    if (!['NAPI', 'TIZ_ALKALMAS', 'HAVI'].includes(ticketType)) {
      return res.status(400).json({ error: 'Érvénytelen jegytípus!' });
    }

    const today = new Date();
    const purchaseDate = today.toISOString().split('T')[0];
    
    // Calculate expiration date (30 days validity for all)
    const expires = new Date();
    expires.setDate(today.getDate() + 30);
    const expiresDate = expires.toISOString().split('T')[0];

    let sessions = 0;
    if (ticketType === 'NAPI') sessions = 1;
    else if (ticketType === 'TIZ_ALKALMAS') sessions = 10;
    else if (ticketType === 'HAVI') sessions = 9999; // Represents unlimited

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
      let HungarianType = '';
      if (ticket.ticket_type === 'NAPI') HungarianType = 'Napijegy';
      else if (ticket.ticket_type === 'TIZ_ALKALMAS') HungarianType = '10 Alkalmas Bérlet';
      else if (ticket.ticket_type === 'HAVI') HungarianType = '30 Napos Korlátlan Bérlet';

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
 
 // Send ticket purchase confirmation email with dynamic domain and inline QR code
 async function sendTicketConfirmationEmail(ticket, climber, domain, invoiceBuffer = null, invoiceNumber = null) {
   try {
     const { pdfData, qrBuffer } = await generatePDFBuffer(ticket, climber, domain);
 
     let HungarianType = '';
     let sessionsText = '';
     let priceText = '';
     if (ticket.ticket_type === 'NAPI') {
       HungarianType = 'Egyszeri Napijegy';
       sessionsText = '1 alkalom (felhasználható)';
       priceText = '2 800 Ft';
     } else if (ticket.ticket_type === 'TIZ_ALKALMAS') {
       HungarianType = '10 Alkalmas Bérlet';
       sessionsText = '10 alkalom';
       priceText = '22 000 Ft';
     } else if (ticket.ticket_type === 'HAVI') {
       HungarianType = '30 Napos Korlátlan Bérlet';
       sessionsText = 'Korlátlan (30 napig)';
       priceText = '28 000 Ft';
     }
 
     if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
       await transporter.sendMail({
         from: process.env.SMTP_FROM || `"HawkStone" <noreply@hawkstone.hu>`,
         to: climber.email,
         subject: `HawkStone Jegyvásárlás - ${HungarianType}`,
         text: `Kedves ${climber.name}!\n\nKöszönjük jegyvásárlásodat a HawkStone Városi Mászóklubban.\n\nA vásárolt jegy adatai:\nJegy azonosítója (ID): #${ticket.id}\nTípus: ${HungarianType}\nÖsszeg: ${priceText}\nVásárlás dátuma: ${ticket.purchase_date}\nLejárat dátuma: ${ticket.expires_date}\nEgyenleg: ${sessionsText}\n\nELÁLLÁSI JOG: A vásárlástól számított 14 napon belül elállhatsz a szerződéstől. Az elálláshoz szükséges a Jegy azonosítója: #${ticket.id}\n\nA belépő QR kódot és a szabályzatot tartalmazó PDF igazolást csatoltuk ehhez a levélhez.\n\nÜdvözlettel,\nHawkStone Csapata`,
         html: `
           <div style="font-family: 'Inter', sans-serif; background-color: #0c0e17; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.08);">
             <img src="cid:mail_header_image" alt="HawkStone" style="width: 100%; max-width: 600px; display: block; border-radius: 8px; margin-bottom: 25px;">
             <h2 style="color: #ff6b00; font-family: 'Outfit', sans-serif; margin-bottom: 15px; text-align: center; font-size: 24px;">Sikeres vásárlás!</h2>
             <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; text-align: center;">Kedves ${climber.name}, köszönjük a vásárlást a <strong>HawkStone Városi Mászóklubban</strong>.</p>
             
             <!-- Ticket Info Card -->
             <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); padding: 20px; border-radius: 10px; margin: 25px 0;">
               <h3 style="margin: 0 0 15px 0; color: #ff6b00; font-family: 'Outfit', sans-serif; font-size: 18px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">Jegy Részletei</h3>
               <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                 <tr>
                   <td style="padding: 6px 0; color: #94a3b8;">Jegytípus:</td>
                   <td style="padding: 6px 0; color: #ffffff; text-align: right; font-weight: 600;">${HungarianType}</td>
                 </tr>
                 <tr style="background: rgba(255, 107, 0, 0.08); border-radius: 6px;">
                   <td style="padding: 8px 6px; color: #ff6b00; font-weight: 700;">🎫 Jegy azonosítója (ID):</td>
                   <td style="padding: 8px 6px; color: #ff6b00; text-align: right; font-weight: 700; font-size: 16px; letter-spacing: 1px;">#${ticket.id}</td>
                 </tr>
                 <tr>
                   <td style="padding: 6px 0; color: #94a3b8;">Fizetett összeg:</td>
                   <td style="padding: 6px 0; color: #ffffff; text-align: right; font-weight: 600;">${priceText}</td>
                 </tr>
                 <tr>
                   <td style="padding: 6px 0; color: #94a3b8;">Vásárlás időpontja:</td>
                   <td style="padding: 6px 0; color: #ffffff; text-align: right;">${ticket.purchase_date}</td>
                 </tr>
                 <tr>
                   <td style="padding: 6px 0; color: #94a3b8;">Lejárat dátuma:</td>
                   <td style="padding: 6px 0; color: #ffffff; text-align: right;">${ticket.expires_date}</td>
                 </tr>
                 <tr>
                   <td style="padding: 6px 0; color: #94a3b8;">Alkalmak száma:</td>
                   <td style="padding: 6px 0; color: #ffffff; text-align: right;">${sessionsText}</td>
                 </tr>
               </table>
             </div>

             <!-- Withdrawal Info Box -->
             <div style="background: rgba(255, 107, 0, 0.05); border: 1px solid rgba(255, 107, 0, 0.2); padding: 15px 18px; border-radius: 8px; margin: 0 0 20px 0;">
               <p style="margin: 0 0 6px 0; font-size: 13px; color: #ff6b00; font-weight: 700;">⚠️ Elállási jog (EU 2023/2673)</p>
               <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">A vásárlástól számított <strong style="color:#fff;">14 napon belül</strong> online elállhatsz a szerződéstől. Az elálláshoz szükséges a fenti <strong style="color:#ff6b00;">Jegy azonosítója: #${ticket.id}</strong>, amelyet add meg az <a href="${domain}/withdrawal.html" style="color:#ff6b00;">elállási oldalon</a>.</p>
             </div>
 
             ${invoiceNumber ? `
             <!-- Invoice Box -->
             <div style="background: rgba(46, 204, 113, 0.05); border: 1px solid rgba(46, 204, 113, 0.2); padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
               <p style="margin: 0; font-size: 14px; color: #2ecc71;"><strong>A kiállított e-számla (${invoiceNumber}) elkészült és csatolva van ehhez a levélhez.</strong></p>
             </div>` : ''}

             <!-- QR Code Section -->
             <div style="text-align: center; margin: 30px 0;">
               <p style="font-size: 15px; color: #94a3b8; margin-bottom: 15px;"><strong>Belépő QR kódod:</strong></p>
               <div style="display: inline-block; background: #ffffff; padding: 15px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
                 <img src="cid:qr_code_image" alt="QR kód a belépéshez" style="width: 160px; height: 160px; display: block;">
               </div>
               <p style="font-size: 12px; color: #64748b; margin-top: 10px;">Mutasd be ezt a QR kódot a leolvasónál a belépéshez.</p>
             </div>
 
             <!-- Action Button -->
             <div style="text-align: center; margin: 30px 0;">
               <a href="${domain}/dashboard.html" style="background: linear-gradient(135deg, #ff6b00 0%, #ff8c00 100%); color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; box-shadow: 0 4px 15px rgba(255, 107, 0, 0.4);">Mászói Fiók megnyitása</a>
             </div>
 
             <p style="font-size: 14px; line-height: 1.6; color: #94a3b8; text-align: center;">A belépéshez szükséges szabályzatot és az aláírandó felelősségnyilatkozatot tartalmazó PDF igazolást csatoltuk ehhez a levélhez.</p>
             <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 25px 0;">
             <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">Üdvözlettel,<br><strong>HawkStone Csapata</strong></p>
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
  
  let itemName = '';
  let price = payment.amount;
  if (payment.ticket_type === 'NAPI') {
    itemName = 'Egyszeri Napijegy';
  } else if (payment.ticket_type === 'TIZ_ALKALMAS') {
    itemName = '10 Alkalmas Bérlet';
  } else if (payment.ticket_type === 'HAVI') {
    itemName = '30 Napos Korlátlan Bérlet';
  } else {
    itemName = 'HawkStone Szolgáltatás';
  }

  // Math calculation for Hungarian 27% VAT
  const netto = (price / 1.27).toFixed(2);
  const afa = (price - parseFloat(netto)).toFixed(2);

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
    <tetel>
      <megnevezes><![CDATA[${itemName}]]></megnevezes>
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
 
 // Get rules and ticket validation PDF
app.get('/api/tickets/:id/rules-pdf', authenticateToken, async (req, res) => {
  try {
    const ticketId = req.params.id;
    const ticket = await dbGet('SELECT * FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return res.status(404).json({ error: 'A jegy nem található!' });

    // Validate ownership
    if (ticket.user_id !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'STAFF') {
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

    const climber = await dbGet('SELECT id, name, email, phone, license_number, card_type FROM users WHERE id = ?', [ticket.user_id]);
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
      SELECT b.id as booking_id, b.booking_date, s.start_time, s.end_time, s.location_id, l.name as location_name,
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
    const { qrCodeUuid, locationId } = req.body;
    if (!qrCodeUuid) {
      return res.status(400).json({ error: 'Hiányzó QR kód azonosító!' });
    }

    const ticket = await dbGet('SELECT * FROM tickets WHERE qr_code_uuid = ?', [qrCodeUuid]);
    if (!ticket) {
      return res.status(404).json({ error: 'Érvénytelen QR kód (nem található az adatbázisban)!' });
    }

    const climber = await dbGet('SELECT id, name, phone, license_number, card_type FROM users WHERE id = ?', [ticket.user_id]);
    const today = new Date().toISOString().split('T')[0];

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
      await dbRun("INSERT INTO entry_logs (ticket_id, status, message, location_id) VALUES (?, 'FAILED', ?, ?)", [ticket.id, 'Jegy/bérlet lejárt', locationId || null]);
      return res.status(400).json({
        valid: false,
        reason: 'A bérlet/jegy érvényessége lejárt!',
        user: climber,
        ticket: { ...ticket, status: 'EXPIRED' }
      });
    }

    // Check if status is ACTIVE
    if (ticket.status !== 'ACTIVE') {
      await dbRun("INSERT INTO entry_logs (ticket_id, status, message, location_id) VALUES (?, 'FAILED', ?, ?)", [ticket.id, 'Már felhasznált vagy érvénytelen jegy', locationId || null]);
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

    if (ticket.ticket_type === 'NAPI') {
      updatedSessions = 0;
      updatedStatus = 'USED';
      message = 'Sikeres belépés! Egyszeri napijegy lekezelve és lezárva.';
    } else if (ticket.ticket_type === 'TIZ_ALKALMAS') {
      if (ticket.sessions_remaining <= 0) {
        updatedStatus = 'USED';
        await dbRun("UPDATE tickets SET status = 'USED' WHERE id = ?", [ticket.id]);
        await dbRun("INSERT INTO entry_logs (ticket_id, status, message, location_id) VALUES (?, 'FAILED', ?, ?)", [ticket.id, 'Bérlet alkalmak elfogytak', locationId || null]);
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
        message = 'Sikeres belépés! Ez volt az utolsó (10.) alkalom. A bérlet lejárt.';
      } else {
        message = `Sikeres belépés! Fennmaradó alkalmak: ${updatedSessions}/10.`;
      }
    } else if (ticket.ticket_type === 'HAVI') {
      message = `Sikeres belépés! Korlátlan havi bérlet érvényes eddig: ${ticket.expires_date}`;
    }

    // Update database
    await dbRun(
      'UPDATE tickets SET sessions_remaining = ?, status = ? WHERE id = ?',
      [updatedSessions, updatedStatus, ticket.id]
    );

    // Log successful scan
    await dbRun("INSERT INTO entry_logs (ticket_id, status, message, location_id) VALUES (?, 'SUCCESS', ?, ?)", [ticket.id, message, locationId || null]);

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
app.get('/api/admin/users', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const users = await dbAll('SELECT id, name, email, phone, license_number, card_type, role FROM users ORDER BY name ASC');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// View single user details with tickets, bookings, and entry logs
app.get('/api/admin/users/:id', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await dbGet('SELECT id, name, email, phone, license_number, card_type, role FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'A keresett felhasználó nem található!' });

    const tickets = await dbAll("SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC", [userId]);
    const bookings = await dbAll(`
      SELECT b.id as booking_id, b.booking_date, s.start_time, s.end_time, l.name as location_name
      FROM bookings b
      JOIN slots s ON b.slot_id = s.id
      JOIN locations l ON s.location_id = l.id
      WHERE b.user_id = ?
      ORDER BY b.booking_date ASC, s.start_time ASC
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
app.get('/api/admin/cancellations', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
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
app.put('/api/admin/users/:id/card-type', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
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
    const { name, email, phone, license_number, card_type, role, password } = req.body;
    if (!name || !email || !phone || !card_type || !role) {
      return res.status(400).json({ error: 'Minden kötelező mező kitöltése kötelező!' });
    }

    if (!['ZÖLD', 'PIROS'].includes(card_type)) {
      return res.status(400).json({ error: 'Érvénytelen kártyatípus!' });
    }

    if (!['USER', 'STAFF', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Érvénytelen szerepkör!' });
    }

    // Check target user before updating
    const targetUser = await dbGet('SELECT email, role FROM users WHERE id = ?', [req.params.id]);
    if (!targetUser) {
      return res.status(404).json({ error: 'A felhasználó nem található!' });
    }

    // Protection for Admin Főnök (admin@hawkstone.hu) email and role
    if (targetUser.email === 'admin@hawkstone.hu') {
      if (role !== 'ADMIN') {
        return res.status(400).json({ error: 'Az Admin Főnök szerepköre nem módosítható!' });
      }
      if (email !== 'admin@hawkstone.hu') {
        return res.status(400).json({ error: 'Az Admin Főnök email címe nem módosítható!' });
      }
    }

    // Validation for ZÖLD card type: check if they have a valid sport climber license number
    if (card_type === 'ZÖLD') {
      if (!license_number || !license_number.trim()) {
        return res.status(400).json({ error: 'Zöld kártya minősítéshez kötelező sportmászó engedélyszám megadása!' });
      }
      const licenseRegex = /^(SMV-\d+|[A-Za-zÖüóőúéáíÖÜÓŐÚÉÁÍ]{2,8}-?\d+(?:\s*\/\s*\d{4})?)$/;
      if (!licenseRegex.test(license_number.trim())) {
        return res.status(400).json({ error: 'A megadott sportmászó engedélyszám formátuma érvénytelen! (Elvárt pl. SMV-00001 vagy GSE9999/2025)' });
      }
    }

    const existingUser = await dbGet('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.params.id]);
    if (existingUser) {
      return res.status(400).json({ error: 'Ez az email cím már használatban van!' });
    }

    await dbRun(
      'UPDATE users SET name = ?, email = ?, phone = ?, license_number = ?, card_type = ?, role = ? WHERE id = ?',
      [name, email, phone, license_number || '', card_type, role, req.params.id]
    );

    if (password && password.trim().length > 0) {
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
      if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: 'A megadott új jelszó nem felel meg a biztonsági követelményeknek! Legalább 8 karakter, kisbetű, nagybetű, szám és speciális karakter szükséges.' });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await dbRun('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [passwordHash, req.params.id]);
    }

    res.json({ message: 'Felhasználó adatai sikeresen frissítve!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete user (prevents deleting oneself)
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

    if (targetUser.role === 'ADMIN') {
      return res.status(400).json({ error: 'Biztonsági okokból adminisztrátori fiókot nem lehet törölni!' });
    }

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
             u.name as user_name, u.email as user_email, u.phone as user_phone, u.id as user_id,
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

// --- ANNOUNCEMENTS / ÜZENŐFAL ---

// Get active announcement (Public)
app.get('/api/announcements/active', async (req, res) => {
  try {
    const announcement = await dbGet('SELECT * FROM announcements WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1');
    res.json(announcement || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all announcements (Admin/Staff only)
app.get('/api/announcements', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const list = await dbAll('SELECT * FROM announcements ORDER BY created_at DESC');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new announcement (Admin/Staff only)
app.post('/api/announcements', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { title, content, imageUrl, isActive } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'A cím és a tartalom megadása kötelező!' });
    }

    const activeVal = isActive ? 1 : 0;

    if (activeVal === 1) {
      await dbRun('UPDATE announcements SET is_active = 0');
    }

    const result = await dbRun(
      'INSERT INTO announcements (title, content, image_url, is_active) VALUES (?, ?, ?, ?)',
      [title, content, imageUrl || null, activeVal]
    );

    res.status(201).json({ message: 'Hír sikeresen létrehozva!', id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update announcement (Admin/Staff only)
app.put('/api/announcements/:id', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const { title, content, imageUrl, isActive } = req.body;
    const { id } = req.params;

    if (!title || !content) {
      return res.status(400).json({ error: 'A cím és a tartalom megadása kötelező!' });
    }

    const activeVal = isActive ? 1 : 0;

    if (activeVal === 1) {
      await dbRun('UPDATE announcements SET is_active = 0');
    }

    await dbRun(
      'UPDATE announcements SET title = ?, content = ?, image_url = ?, is_active = ? WHERE id = ?',
      [title, content, imageUrl || null, activeVal, id]
    );

    res.json({ message: 'Hír sikeresen frissítve!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete announcement (Admin/Staff only)
app.delete('/api/announcements/:id', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
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
          OR t.purchase_date = (
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
        const purchaseDate = new Date(ticket.purchase_date);
        const currentDate = new Date(todayStr);
        const timeDiff = currentDate.getTime() - purchaseDate.getTime();
        const diffDays = timeDiff / (1000 * 3600 * 24);

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
    const { email, name, identifier, ticketIds } = req.body;
    if (!email || !name || !identifier || !ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({ error: 'Hiányzó vagy helytelen elállási adatok!' });
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

      const purchaseDate = new Date(ticket.purchase_date);
      const currentDate = new Date(todayStr);
      const timeDiff = currentDate.getTime() - purchaseDate.getTime();
      const diffDays = timeDiff / (1000 * 3600 * 24);

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

      let typeLabel = '';
      if (ticket.ticket_type === 'NAPI') typeLabel = 'Egyszeri Napijegy';
      else if (ticket.ticket_type === 'TIZ_ALKALMAS') typeLabel = '10 Alkalmas Bérlet';
      else if (ticket.ticket_type === 'HAVI') typeLabel = 'Korlátlan Havi Bérlet';

      processedDetails.push(`
        <li style="margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
          <strong>${typeLabel}</strong> (Azonosító: #${ticket.id})<br>
          <span style="color:#64748b; font-size:12px;">Vásárolva: ${ticket.purchase_date} | Fennmaradó alkalmak: ${ticket.sessions_remaining}</span>
        </li>
      `);
    }

    // Send transaction email
    const mailSubject = 'Visszaigazolás szerződéstől való elállásról - HawkStone';
    const mailText = `Kedves ${user.name}!\n\nEzúton igazoljuk, hogy ${hungarianTimeStr} időpontban elállási nyilatkozatot nyújtottál be az alábbi vásárlásra (szerződésazonosító: ${identifier}).\n\nÉrintett jegyek/bérletek:\n${validTickets.map(t => `- Jegy ID: #${t.id}, Típus: ${t.ticket_type}, Fennmaradó alkalmak: ${t.sessions_remaining}`).join('\n')}\n\nA jegyek/bérletek érvénytelenítése megtörtént. A vételár visszatérítéséről 14 napon belül intézkedünk.\n\nÜdvözlettel,\nHawkStone Csapata`;

    const mailHtml = `
      <div style="font-family: 'Montserrat', sans-serif; background-color: #0c0e17; color: #ffffff; padding: 30px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid rgba(255,255,255,0.08);">
        <h2 style="color: #f27620; font-weight: 700; margin-bottom: 20px; text-align: center;">Elállási Nyilatkozat Visszaigazolás</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #94a3b8;">Kedves <strong>${user.name}</strong>!</p>
        <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; margin-bottom: 20px;">
          Köszönjük, hogy benyújtottad elállási nyilatkozatodat. Ezúton igazoljuk, hogy a nyilatkozat beérkezett és feldolgozásra került:
        </p>
        
        <div style="background-color: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 18px; border-radius: 8px; margin-bottom: 20px; font-size: 14px;">
          <p style="margin: 0 0 8px 0; color: #94a3b8;">Beérkezés ideje: <strong style="color: #ffffff;">${hungarianTimeStr}</strong></p>
          <p style="margin: 0 0 15px 0; color: #94a3b8;">Szerződés/Rendelés azonosító: <strong style="color: #ffffff;">${identifier}</strong></p>
          <p style="margin: 0 0 10px 0; color: #f27620; font-weight: 600; text-transform: uppercase; font-size: 12px; letter-spacing:0.05em;">Visszavont szolgáltatások:</p>
          <ul style="margin: 0; padding-left: 0; list-style:none; color: #ffffff;">
            ${processedDetails.join('')}
          </ul>
        </div>

        <p style="font-size: 14px; line-height: 1.6; color: #94a3b8; margin-bottom: 15px;">
          A fenti jegyek és bérletek, valamint a hozzájuk kapcsolódó QR-kódok azonnali hatállyal <strong>érvénytelenné váltak</strong>, azok beléptetésre többé nem alkalmasak.
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #94a3b8; margin-bottom: 25px;">
          A jogszabályoknak megfelelően a vételár visszatérítéséről (vagy részleges visszatérítésről) az elállás bejelentésétől számított 14 napon belül intézkedünk.
        </p>

        <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 25px 0;">
        <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0; line-height: 1.4;">
          Ez egy automatikus, tartós adathordozón küldött visszaigazolás az EU 2023/2673 irányelvnek megfelelően.<br><br>
          Üdvözlettel,<br><strong>HawkStone Csapata</strong>
        </p>
      </div>
    `;

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || `"HawkStone" <noreply@hawkstone.hu>`,
          to: email.trim(),
          subject: mailSubject,
          text: mailText,
          html: mailHtml
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
      tickets: validTickets.map(t => ({ id: t.id, type: t.ticket_type }))
    });
  } catch (error) {
    console.error('[WITHDRAWAL CONFIRM ERROR]:', error);
    res.status(500).json({ error: 'Hiba az elállási nyilatkozat beküldése során: ' + error.message });
  }
});

// 3. Admin Withdrawals List Endpoint (Admin/Staff only)
app.get('/api/admin/withdrawals', authenticateToken, requireRole(['STAFF', 'ADMIN']), async (req, res) => {
  try {
    const list = await dbAll(`
      SELECT w.*, u.name as user_name, u.email as user_email
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      ORDER BY w.withdrawal_time DESC
    `);
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Hiba a naplózott elállások lekérésekor: ' + error.message });
  }
});

// Fallback to client routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Szerver fut a http://localhost:${PORT} címen`);
});
