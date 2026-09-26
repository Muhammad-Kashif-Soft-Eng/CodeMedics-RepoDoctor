'use strict';

const mongoose = require('mongoose');

// ── Category scores sub-schema ────────────────────────────────────────────────
const categoryScoresSchema = new mongoose.Schema(
  {
    testing:       { type: Number, min: 0, max: 100, required: true },
    documentation: { type: Number, min: 0, max: 100, required: true },
    structure:     { type: Number, min: 0, max: 100, required: true },
    codeQuality:   { type: Number, min: 0, max: 100, required: true },
    dependencies:  { type: Number, min: 0, max: 100, required: true },
    overall:       { type: Number, min: 0, max: 100, required: true },
  },
  { _id: false }
);

// ── ScanResult ────────────────────────────────────────────────────────────────
// createdAt (from { timestamps: true }) is the authoritative scan time.
// It is set once at insert and never changes — use it wherever scan time is needed.
const scanResultSchema = new mongoose.Schema(
  {
    repoUrl:           { type: String, required: true, trim: true },
    structure:         { type: mongoose.Schema.Types.Mixed, default: {} },
    testingSignals:    { type: mongoose.Schema.Types.Mixed, default: {} },
    docSignals:        { type: mongoose.Schema.Types.Mixed, default: {} },
    qualitySignals:    { type: mongoose.Schema.Types.Mixed, default: {} },
    dependencySignals: { type: mongoose.Schema.Types.Mixed, default: {} },
    healthScore:       { type: categoryScoresSchema, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScanResult', scanResultSchema);
