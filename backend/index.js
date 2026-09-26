'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'codemedics-api' });
});

// ── Routes (wired incrementally as services are built) ────────────────────────
// app.use('/api/scan',      require('./routes/scan'));
// app.use('/api/diagnose',  require('./routes/diagnose'));
// app.use('/api/prescribe', require('./routes/prescribe'));
// app.use('/api/treat',     require('./routes/treat'));
// app.use('/api/verify',    require('./routes/verify'));

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
