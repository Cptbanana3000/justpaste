// server.js
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const crypto = require('crypto'); // For generating editCode
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Render/Proxy for correct client IPs
app.set('trust proxy', 1);

// Content size limits
const MAX_CONTENT_SIZE = 20 * 1024; // 20KB in bytes
const MAX_CONTENT_SIZE_MB = '20KB'; // For error messages

// --- Server-side encryption (AES-256-GCM) ---
const NOTE_ENC_KEY_B64 = process.env.NOTE_ENC_KEY_B64 || '';
let NOTE_ENC_KEY = null;
if (!NOTE_ENC_KEY_B64) {
  if (process.env.NODE_ENV === 'production') {
    console.error('NOTE_ENC_KEY_B64 missing in production.');
    process.exit(1);
  } else {
    console.warn('WARNING: NOTE_ENC_KEY_B64 is not set. Notes will be stored in plaintext.');
  }
} else {
  try {
    const keyBuf = Buffer.from(NOTE_ENC_KEY_B64, 'base64');
    if (keyBuf.length !== 32) throw new Error('Key must be 32 bytes (base64 of 256-bit)');
    NOTE_ENC_KEY = keyBuf;
  } catch (e) {
    console.error('Invalid NOTE_ENC_KEY_B64:', e.message);
    process.exit(1);
  }
}

function encryptContent(plaintext) {
  if (!NOTE_ENC_KEY) return plaintext; // plaintext fallback
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', NOTE_ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ivB64 = iv.toString('base64');
  const ctB64 = ct.toString('base64');
  const tagB64 = tag.toString('base64');
  return `${ivB64}:${ctB64}:${tagB64}`;
}

function decryptContent(stored) {
  if (!NOTE_ENC_KEY) return stored; // plaintext fallback
  if (typeof stored !== 'string') return stored;
  const parts = stored.split(':');
  if (parts.length !== 3) return stored; // not encrypted
  const [ivB64, ctB64, tagB64] = parts;
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', NOTE_ENC_KEY, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (e) {
    return stored; // if decrypt fails (legacy), return as-is
  }
}

// Abuse/reporting helpers
const REPORT_HASH_SALT = process.env.REPORT_HASH_SALT || crypto.randomBytes(16).toString('hex');
function hashReporter(ip, ua) {
  const h = crypto.createHash('sha256');
  h.update((ip || '') + '|' + (ua || '') + '|' + REPORT_HASH_SALT);
  return h.digest('hex');
}
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ADMIN_IP_ALLOWLIST = (process.env.ADMIN_IP_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean);
function ipAllowed(req) {
  if (!ADMIN_IP_ALLOWLIST.length) return true;
  const ip = (req.ip || '').trim();
  const v4 = ip.replace(/^::ffff:/, '');
  return ADMIN_IP_ALLOWLIST.includes(ip) || ADMIN_IP_ALLOWLIST.includes(v4);
}
function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.substring(7) : '';
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!ipAllowed(req)) {
    return res.status(401).json({ message: 'IP not allowed' });
  }
  next();
}

// Content size validation middleware
const validateContentSize = (req, res, next) => {
    const content = req.body.content;
    // Type check: must be a string
    if (typeof content !== 'string') {
        return res.status(400).json({ message: 'Content must be a string.' });
    }
    // Reject empty string (already checked, but keep for robustness)
    if (!content.trim()) {
        return res.status(400).json({ message: 'Content cannot be empty.' });
    }
    const contentSize = Buffer.byteLength(content, 'utf8');
    if (contentSize > MAX_CONTENT_SIZE) {
        const currentSizeKB = Math.round(contentSize / 1024);
        return res.status(413).json({ 
            message: `Content size (${currentSizeKB}KB) exceeds the maximum limit of ${MAX_CONTENT_SIZE_MB}.`,
            maxSize: MAX_CONTENT_SIZE_MB,
            currentSize: `${currentSizeKB}KB`
        });
    }
    next();
};

// --- Rate Limiting Configuration ---
// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { message: 'Too many requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for note creation
const createNoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: { message: 'Too many notes created from this IP, please try again after an hour' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for note updates
const updateNoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: { message: 'Too many note updates from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for reporting
const reportNoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many reports from this IP, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Firebase Admin SDK Initialization ---
try {
  admin.initializeApp({
    credential: admin.credential.cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS))
  });
  // Firebase Admin SDK initialized
} catch (error) {
  console.error('Firebase Admin SDK initialization error:', error);
  process.exit(1);
}

const db = admin.firestore();
const notesCollection = db.collection('notes'); // Define your Firestore collection name
const reportsCollection = db.collection('reports');
const moderationLogs = db.collection('moderationLogs');

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'", "'unsafe-inline'", "'unsafe-eval'",
          "https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
        ],
        styleSrc: [
          "'self'", "'unsafe-inline'", "https://fonts.googleapis.com",
          "https://cdnjs.cloudflare.com"
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: [
          "'self'", "data:", "https:",
          "https://www.google-analytics.com", "https://*.google-analytics.com",
          "https://*.analytics.google.com", "https://*.google.com",
          "https://www.googletagmanager.com",
          "https://tinylaun.ch",
          "https://www.tinylaun.ch",
          "https://tinylaun.ch/tinylaunch_badge_launching_soon.svg"
        ],
        frameSrc: ["'self'", "https:", "data:"],
        connectSrc: [
          "'self'",
          "https://*.google-analytics.com", "https://*.analytics.google.com",
          "https://firestore.googleapis.com", "https://*.firebaseio.com",
          "https:"
        ],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'sameorigin' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// CORS: restrict to allowed origins
const allowedOrigins = [
  'http://localhost:3000',
  'https://flingnote.click'
];
app.use((req, res, next) => {
  // Disallow CORS on admin endpoints
  if (req.path.startsWith('/api/admin/')) return next();
  return cors({ origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow same-origin
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  }})(req, res, next);
});

app.use(express.json({ limit: '200kb' })); // Set higher than our own limit so our middleware can handle it
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory

// Add X-Robots-Tag for admin.html
app.get('/admin.html', (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Apply rate limiting to all API routes
app.use('/api/', apiLimiter);

// Additional admin rate limiter
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/api/admin/', adminLimiter);

// Global error handler for payload too large
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      message: 'Payload too large. The maximum allowed is 100KB.',
      maxSize: '100KB'
    });
  }
  next(err);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

// Helper function to generate a random 6-character alphanumeric shortId
function generateShortId(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// --- API Routes ---

// POST /api/notes - Create a new note
app.post('/api/notes', createNoteLimiter, validateContentSize, async (req, res) => {
  try {
    const { content } = req.body;
    const editCode = crypto.randomBytes(16).toString('hex');

    // Generate a unique 6-character shortId
    let shortId;
    let exists = true;
    while (exists) {
      shortId = generateShortId();
      const snapshot = await notesCollection.where('shortId', '==', shortId).get();
      exists = !snapshot.empty;
    }

    // Generate a unique 7-character Firestore doc ID
    let noteId;
    let idExists = true;
    while (idExists) {
      noteId = generateShortId(7);
      const doc = await notesCollection.doc(noteId).get();
      idExists = doc.exists;
    }

    // Encrypt content for storage
    const storedContent = encryptContent(content);

    // Save the note with both IDs
    await notesCollection.doc(noteId).set({
      content: storedContent,
      editCode,
      shortId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      size: Buffer.byteLength(content, 'utf8'),
      views: 0,
      reportCount: 0,
      isDeleted: false
    });

    res.status(201).json({
      id: noteId, // Firestore doc ID
      shortId: shortId,
      editCode: editCode,
      message: 'Note created successfully.'
    });
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ message: 'Server error while creating note.' });
  }
});

// GET /api/notes/:id - Get a note by its ID
app.get('/api/notes/:id', async (req, res) => {
  try {
    const noteId = req.params.id;
    const noteRef = notesCollection.doc(noteId);
    const noteDoc = await noteRef.get();

    if (!noteDoc.exists) {
      return res.status(404).json({ message: 'Note not found.' });
    }

    const baseData = noteDoc.data();
    if (baseData.isDeleted) return res.status(404).json({ message: 'Note has been removed.' });

    // Increment the views field atomically
    await noteRef.update({ views: admin.firestore.FieldValue.increment(1) });
    // Get the updated document
    const updatedDoc = await noteRef.get();
    const noteData = updatedDoc.data();
    const plaintext = decryptContent(noteData.content);
    res.status(200).json({
      content: plaintext,
      id: updatedDoc.id,
      createdAt: noteData.createdAt ? noteData.createdAt.toDate() : null,
      views: noteData.views || 1
    });
  } catch (error) {
    console.error('Error fetching note:', error);
    res.status(500).json({ message: 'Server error while fetching note.' });
  }
});

// GET /api/notes/:id/raw - Get raw note content as text/plain
app.get('/api/notes/:id/raw', async (req, res) => {
  try {
    const noteId = req.params.id;
    const noteDoc = await notesCollection.doc(noteId).get();

    if (!noteDoc.exists) {
      return res.status(404).send('Note not found.');
    }

    const baseData = noteDoc.data();
    if (baseData.isDeleted) return res.status(404).send('Note has been removed.');

    const noteData = noteDoc.data();
    const plaintext = decryptContent(noteData.content);
    res.setHeader('Content-Type', 'text/plain');
    res.send(plaintext);
  } catch (error) {
    console.error('Error fetching raw note:', error);
    res.status(500).send('Server error while fetching raw note.');
  }
});

// PUT /api/notes/:id - Update an existing note
app.put('/api/notes/:id', updateNoteLimiter, validateContentSize, async (req, res) => {
  try {
    const noteId = req.params.id;
    const { content, editCode } = req.body;

    if (!editCode) {
      return res.status(400).json({ message: 'Edit code is required.' });
    }

    const noteRef = notesCollection.doc(noteId);
    const noteDoc = await noteRef.get();

    if (!noteDoc.exists) {
      return res.status(404).json({ message: 'Note not found.' });
    }

    const baseData = noteDoc.data();
    if (baseData.isDeleted) return res.status(403).json({ message: 'Note is removed.' });

    const noteData = noteDoc.data();
    if (noteData.editCode !== editCode) {
      return res.status(403).json({ message: 'Invalid edit code. You are not authorized to edit this note.' });
    }

    const storedContent = encryptContent(content);

    await noteRef.update({
      content: storedContent,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      size: Buffer.byteLength(content, 'utf8') // Update the size (plaintext size)
    });

    res.status(200).json({ message: 'Note updated successfully.', id: noteDoc.id });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ message: 'Server error while updating note.' });
  }
});

// GET /api/notes/s/:shortId - Get a note by its shortId
app.get('/api/notes/s/:shortId', async (req, res) => {
  try {
    const { shortId } = req.params;
    const snapshot = await notesCollection.where('shortId', '==', shortId).limit(1).get();
    if (snapshot.empty) {
      return res.status(404).json({ message: 'Note not found.' });
    }
    const doc = snapshot.docs[0];
    const noteRef = notesCollection.doc(doc.id);
    const baseData = doc.data();
    if (baseData.isDeleted) return res.status(404).json({ message: 'Note has been removed.' });
    // Increment the views field atomically
    await noteRef.update({ views: admin.firestore.FieldValue.increment(1) });
    // Get the updated document
    const updatedDoc = await noteRef.get();
    const noteData = updatedDoc.data();
    const plaintext = decryptContent(noteData.content);
    res.status(200).json({
      content: plaintext,
      id: updatedDoc.id,
      shortId: noteData.shortId,
      createdAt: noteData.createdAt ? noteData.createdAt.toDate() : null,
      views: noteData.views || 1
    });
  } catch (error) {
    console.error('Error fetching note by shortId:', error);
    res.status(500).json({ message: 'Server error while fetching note.' });
  }
});

// --- Reporting ---
app.post('/api/notes/:id/report', reportNoteLimiter, async (req, res) => {
  try {
    const noteId = req.params.id;
    const { reason, details } = req.body || {};
    const noteDoc = await notesCollection.doc(noteId).get();
    if (!noteDoc.exists) return res.status(404).json({ message: 'Note not found.' });
    const noteData = noteDoc.data();
    const shortId = noteData.shortId;
    const ua = req.headers['user-agent'] || '';
    const ip = req.ip || '';
    const reporterHash = hashReporter(ip, ua);
    const cleanReason = typeof reason === 'string' ? reason.slice(0, 64) : '';
    const cleanDetails = typeof details === 'string' ? details.slice(0, 500) : '';

    // Prevent spamming: same reporter+note within last 24h using a guard doc
    const guards = db.collection('reportGuards');
    const guardId = `${noteId}_${reporterHash}`;
    const guardRef = guards.doc(guardId);
    const guardDoc = await guardRef.get();
    const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
    if (guardDoc.exists) {
      const g = guardDoc.data();
      const ts = g && g.createdAt && g.createdAt.toDate ? g.createdAt.toDate().getTime() : 0;
      if (ts && ts > sinceMs) {
        return res.status(429).json({ message: 'You already reported this note recently.' });
      }
    }
    await guardRef.set({ createdAt: admin.firestore.FieldValue.serverTimestamp() });

    await reportsCollection.add({
      noteId,
      shortId,
      reason: cleanReason || 'other',
      details: cleanDetails,
      reporterHash,
      userAgent: ua.slice(0, 200),
      referer: (req.headers['referer'] || '').toString().slice(0, 300),
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await notesCollection.doc(noteId).update({
      reportCount: admin.firestore.FieldValue.increment(1),
      lastReportedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).json({ message: 'Report submitted. Thank you.' });
  } catch (e) {
    console.error('Error reporting note:', e);
    res.status(500).json({ message: 'Server error while reporting note.' });
  }
});

// --- Admin APIs ---
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  try {
    const status = (req.query.status || 'open').toString();
    const limit = Math.min(parseInt((req.query.limit || '50').toString(), 10) || 50, 200);
    const shortId = (req.query.shortId || '').toString().trim();
    let items = [];

    if (shortId) {
      // Search reports by shortId, optional status filter; sort in-memory by createdAt desc
      const snap = await reportsCollection.where('shortId', '==', shortId).limit(500).get();
      items = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt ? d.data().createdAt.toDate() : null }));
      if (status) items = items.filter(it => (it.status || 'open') === status);
      items.sort((a, b) => (b.createdAt ? b.createdAt.getTime() : 0) - (a.createdAt ? a.createdAt.getTime() : 0));
      items = items.slice(0, limit);
    } else if (status) {
      // Avoid composite index: filter by status, then sort by date
      const snap = await reportsCollection.where('status', '==', status).limit(limit).get();
      items = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt ? d.data().createdAt.toDate() : null }));
      items.sort((a, b) => (b.createdAt ? b.createdAt.getTime() : 0) - (a.createdAt ? a.createdAt.getTime() : 0));
    } else {
      const snap = await reportsCollection.orderBy('createdAt', 'desc').limit(limit).get();
      items = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt ? d.data().createdAt.toDate() : null }));
    }

    res.json({ items });
  } catch (e) {
    console.error('Error listing reports:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/admin/reports/:id/close', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    await reportsCollection.doc(id).update({ status: 'closed' });
    res.json({ message: 'Report closed' });
  } catch (e) {
    console.error('Error closing report:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/admin/notes/:id', requireAdmin, async (req, res) => {
  try {
    const noteId = req.params.id;
    const doc = await notesCollection.doc(noteId).get();
    if (!doc.exists) return res.status(404).json({ message: 'Note not found' });
    const data = doc.data();
    const plaintext = decryptContent(data.content);
    const reportsSnap = await reportsCollection.where('noteId', '==', noteId).orderBy('createdAt', 'desc').limit(50).get();
    const reports = reportsSnap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt ? d.data().createdAt.toDate() : null }));
    res.json({ note: { id: doc.id, shortId: data.shortId, content: plaintext, isDeleted: !!data.isDeleted, reportCount: data.reportCount || 0 }, reports });
  } catch (e) {
    console.error('Error fetching note (admin):', e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/admin/notes/:id/delete', requireAdmin, async (req, res) => {
  try {
    const noteId = req.params.id;
    await notesCollection.doc(noteId).update({ isDeleted: true });
    // Close open reports for this note (best-effort)
    const snap = await reportsCollection.where('noteId', '==', noteId).limit(500).get();
    const batch = db.batch();
    snap.docs.forEach(d => {
      const data = d.data();
      if (data && data.status !== 'closed') {
        batch.update(d.ref, { status: 'closed' });
      }
    });
    await batch.commit();
    await moderationLogs.add({ noteId, action: 'delete', actor: 'admin', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ message: 'Note deleted' });
  } catch (e) {
    console.error('Error deleting note:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/admin/notes/:id/restore', requireAdmin, async (req, res) => {
  try {
    const noteId = req.params.id;
    await notesCollection.doc(noteId).update({ isDeleted: false });
    await moderationLogs.add({ noteId, action: 'restore', actor: 'admin', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ message: 'Note restored' });
  } catch (e) {
    console.error('Error restoring note:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// --- Fallback for SPA: Serve index.html for any route not handled by API or static files ---
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });
// This is more explicit and less likely to cause parsing issues

// Alternative approach - catch anything that doesn't start with /api
app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
