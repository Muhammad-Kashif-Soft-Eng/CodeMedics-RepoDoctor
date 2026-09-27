'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');

// ── Database connection ───────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/codemedics';

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected:', MONGODB_URI))
  .catch((err) => console.error('MongoDB connection error:', err.message));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Codemedics API listening on http://localhost:${PORT}`);
});
