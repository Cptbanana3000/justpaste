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

// Content size limits
const MAX_CONTENT_SIZE = 20 * 1024; // 20KB in bytes
const MAX_CONTENT_SIZE_MB = '20KB'; // For error messages

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
    // Optionally, reject strings with only whitespace or control chars
    // if (!/\S/.test(content)) {
    //     return res.status(400).json({ message: 'Content must contain visible characters.' });
    // }
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
    max: 50, // Reduced from 100 to 50 requests per windowMs
    message: 'Too many requests from this IP, please try again after 15 minutes',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Stricter limiter for note creation
const createNoteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Reduced from 10 to 5 note creations per hour
    message: 'Too many notes created from this IP, please try again after an hour',
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter limiter for note updates
const updateNoteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Reduced from 20 to 10 updates per 15 minutes
    message: 'Too many note updates from this IP, please try again after 15 minutes',
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

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'", "'unsafe-inline'",
          "https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com",
          "https://pagead2.googlesyndication.com", "https://*.googlesyndication.com",
          "https://*.doubleclick.net", "https://partner.googleadservices.com",
          "https://tpc.googlesyndication.com", "https://googleads.g.doubleclick.net",
          "https://ep1.adtrafficquality.google", // The domain from the previous error
          "https://ep2.adtrafficquality.google",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net"
        ],
        styleSrc: [
          "'self'", "'unsafe-inline'", "https://fonts.googleapis.com",
          "https://pagead2.googlesyndication.com",
          "https://cdnjs.cloudflare.com"
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: [
          "'self'", "data:", "https://www.google-analytics.com", "https://*.google-analytics.com",
          "https://*.analytics.google.com", "https://pagead2.googlesyndication.com",
          "https://*.googlesyndication.com", "https://*.g.doubleclick.net", "https://*.google.com",
          "https://ep1.adtrafficquality.google", "https://ep2.adtrafficquality.google",
          "https://www.googletagmanager.com",
          "https://tinylaun.ch",
          "https://www.tinylaun.ch",
          "https://tinylaun.ch/tinylaunch_badge_launching_soon.svg"
        ],
        frameSrc: [
          "'self'", "https://*.doubleclick.net", "https://*.google.com",
          "https://googleads.g.doubleclick.net", "https://tpc.googlesyndication.com",
          "https://pagead2.googlesyndication.com", "https://*.googlesyndication.com",
          "https://ep1.adtrafficquality.google", "https://ep2.adtrafficquality.google"
        ],
        connectSrc: [
          "'self'",
          "https://*.google-analytics.com", "https://*.analytics.google.com",
          "https://firestore.googleapis.com", "https://*.firebaseio.com",
          "https://pagead2.googlesyndication.com", "https://*.googlesyndication.com",
          "https://*.g.doubleclick.net", "https://googleads.g.doubleclick.net",
          "https://ep1.adtrafficquality.google" // ** FIX: Added new domain for ad traffic quality **
        ],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json({ limit: '200kb' })); // Set higher than our own limit so our middleware can handle it
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory

// Apply rate limiting to all API routes
app.use('/api/', apiLimiter);

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

// --- Explicit routes for SEO/AdSense assets ---
app.get('/ads.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'ads.txt'));
});
app.get('/.well-known/ads.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'ads.txt'));
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

    // Save the note with both IDs
    await notesCollection.doc(noteId).set({
      content,
      editCode,
      shortId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      size: Buffer.byteLength(content, 'utf8'),
      views: 0
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

    // Increment the views field atomically
    await noteRef.update({ views: admin.firestore.FieldValue.increment(1) });
    // Get the updated document
    const updatedDoc = await noteRef.get();
    const noteData = updatedDoc.data();
    res.status(200).json({
      content: noteData.content,
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

    const noteData = noteDoc.data();
    res.setHeader('Content-Type', 'text/plain');
    res.send(noteData.content);
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

    const noteData = noteDoc.data();
    if (noteData.editCode !== editCode) {
      return res.status(403).json({ message: 'Invalid edit code. You are not authorized to edit this note.' });
    }

    await noteRef.update({
      content,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      size: Buffer.byteLength(content, 'utf8') // Update the size
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
    // Increment the views field atomically
    await noteRef.update({ views: admin.firestore.FieldValue.increment(1) });
    // Get the updated document
    const updatedDoc = await noteRef.get();
    const noteData = updatedDoc.data();
    res.status(200).json({
      content: noteData.content,
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
