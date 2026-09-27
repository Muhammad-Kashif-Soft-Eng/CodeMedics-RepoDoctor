'use strict';

const express = require('express');
const cors = require('cors');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'codemedics-api' });
});

// ── Routes (uncommented as each service is built) ────────────────────────────
app.use('/api/scan',      require('./routes/scan'));
app.use('/api/diagnose',  require('./routes/diagnose'));
app.use('/api/prescribe', require('./routes/prescribe'));
app.use('/api/treat',     require('./routes/treat'));
app.use('/api/verify',    require('./routes/verify'));
app.use('/api/before-after', require('./routes/beforeAfter'));

module.exports = app;
