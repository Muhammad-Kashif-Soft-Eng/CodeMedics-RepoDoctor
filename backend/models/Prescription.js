'use strict';

const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema(
  {
    findingId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Finding', required: true },
    treatmentTitle:      { type: String, required: true, trim: true },
    reason:              { type: String, required: true },
    expectedResult:      { type: String, required: true },
    filesToChange:       { type: [String], default: [] },
    verificationStrategy:{ type: String, default: '' },
    riskNotes:           { type: String, default: '' },
    approved:            { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Prescription', prescriptionSchema);
