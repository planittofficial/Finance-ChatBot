const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: false,
    index: true,
  },
  conversationStartedAt: {
    type: Date,
    required: false,
    index: true,
  },
  conversationCompletedAt: {
    type: Date,
    required: false,
    index: true,
  },
  name: {
    type: String,
    required: false,
  },
  phone: {
    type: String,
    required: false,
  },
  address: {
    type: String,
    required: false,
  },
  sessionId: {
    type: String,
    required: true,
    unique: true,
  },
  profile: {
    type: mongoose.Schema.Types.Mixed,
  },
  analysis: {
    type: mongoose.Schema.Types.Mixed,
  },
  keyFinancialInsights: {
    type: [String],
    default: [],
  },
  peakInsight: {
    type: String,
    default: '',
  },
  expenseBreakdown: {
    basic_needs: { type: Number, default: 0 },
    bills_payments: { type: Number, default: 0 },
    personal_spending: { type: Number, default: 0 },
    extra_unexpected: { type: Number, default: 0 },
  },
  monthlySalary: {
    type: Number,
    default: 0,
  },
  goal: {
    type: String,
    default: '',
  },
  riskProfile: {
    type: String,
    enum: ['conservative', 'moderate', 'aggressive'],
    default: 'moderate',
  },
  status: {
    type: String,
    enum: ['incomplete', 'completed', 'advisor_requested', 'captured', 'contacted'],
    default: 'incomplete',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Auto-update the updatedAt field
LeadSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Lead', LeadSchema);
