// server.js
require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const crypto = require('crypto'); // For generating editCode

const app = express();
const PORT = process.env.PORT || 3000;

// --- Firebase Admin SDK Initialization ---
// GOOGLE_APPLICATION_CREDENTIALS environment variable should point to your service account key JSON file
try {
  admin.initializeApp({
    // credential: admin.credential.cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)) // If not using env var directly
  });
  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error('Firebase Admin SDK initialization error:', error);
  process.exit(1);
}

const db = admin.firestore();
const notesCollection = db.collection('notes'); // Define your Firestore collection name

// Middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse JSON request bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory

// --- API Routes ---

// POST /api/notes - Create a new note
console.log('Defining POST /api/notes route');
app.post('/api/notes', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ message: 'Content cannot be empty.' });
    }

    const editCode = crypto.randomBytes(16).toString('hex');
    
    // Firestore will auto-generate an ID for the new document
    const newNoteRef = await notesCollection.add({
      content,
      editCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), // Use Firestore server timestamp
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
console.log('Defining GET /api/notes/:id route');
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

// PUT /api/notes/:id - Update an existing note
app.put('/api/notes/:id', async (req, res) => {
  try {
    const noteId = req.params.id;
    const { content, editCode } = req.body;

    if (!content) {
      return res.status(400).json({ message: 'Content cannot be empty.' });
    }
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
      updatedAt: admin.firestore.FieldValue.serverTimestamp() // Optionally add an updatedAt field
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
  console.log(`Server running on http://localhost:${PORT}`);
});

console.log('Server started on port', PORT);
