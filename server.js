// server.js
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const crypto = require('crypto'); // For generating editCode
const rateLimit = require('express-rate-limit');

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

// --- API Routes ---

// POST /api/notes - Create a new note
app.post('/api/notes', createNoteLimiter, validateContentSize, async (req, res) => {
  try {
    const { content } = req.body;
    const editCode = crypto.randomBytes(16).toString('hex');
    
    // Firestore will auto-generate an ID for the new document
    const newNoteRef = await notesCollection.add({
      content,
      editCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), // Use Firestore server timestamp
      size: Buffer.byteLength(content, 'utf8') // Store the size for reference
    });

    res.status(201).json({
      id: newNoteRef.id, // Shareable ID (Firestore document ID)
      editCode: editCode, // Secret code for editing
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
    const noteDoc = await notesCollection.doc(noteId).get();

    if (!noteDoc.exists) {
      return res.status(404).json({ message: 'Note not found.' });
    }

    const noteData = noteDoc.data();
    res.status(200).json({
      content: noteData.content,
      id: noteDoc.id,
      // Firestore timestamp needs to be converted if you want a specific format on client
      // For simplicity, sending as is, or convert to ISO string: noteData.createdAt.toDate().toISOString()
      createdAt: noteData.createdAt ? noteData.createdAt.toDate() : null 
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
