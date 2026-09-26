'use strict';

const mongoose = require('mongoose');

const STATUSES = ['pending', 'success', 'failed'];

const treatmentResultSchema = new mongoose.Schema(
  {
    prescriptionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription', required: true },
    filesChanged:      { type: [String], default: [] },
    beforeScore:       { type: Number, min: 0, max: 100 },
    afterScore:        { type: Number, min: 0, max: 100 },
    status:            { type: String, enum: STATUSES, default: 'pending' },
    verificationOutput:{ type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TreatmentResult', treatmentResultSchema);
