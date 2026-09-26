'use strict';

const mongoose = require('mongoose');

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const CATEGORIES = ['Testing', 'Documentation', 'Structure', 'Code Quality', 'Dependencies'];

const findingSchema = new mongoose.Schema(
  {
    scanId:            { type: mongoose.Schema.Types.ObjectId, ref: 'ScanResult', required: true },
    title:             { type: String, required: true, trim: true },
    category:          { type: String, enum: CATEGORIES, required: true },
    severity:          { type: String, enum: SEVERITIES, required: true },
    evidence:          { type: String, required: true },
    affectedPath:      { type: String, default: '' },
    explanation:       { type: String, required: true },
    suggestedDirection:{ type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Finding', findingSchema);
