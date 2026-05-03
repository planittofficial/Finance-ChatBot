const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: false,
    index: true,
  },
  name: {
    type: String,
    required: false,
  },
  sessionId: {
    type: String,
    required: true,
    unique: true,
  },
  profile: {
    age: Number,
    income: Number,
    expenses: Number,
    savings: Number,
    risk: String,
    goal: String,
  },
  analysis: {
    type: mongoose.Schema.Types.Mixed, // Stores the complex analysis projections/JSON
  },
  status: {
    type: String,
    enum: ['incomplete', 'completed', 'advisor_requested'],
    default: 'incomplete'
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model('Lead', LeadSchema);
