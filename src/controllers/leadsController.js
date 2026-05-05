"use strict";

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(process.cwd(), 'leads.json');

function readAll() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) || [];
  } catch (e) {
    return [];
  }
}

function writeAll(leads) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2));
}

function makeLead(obj) {
  const profile = obj.financial_profile || {};
  const expenses = profile.expenses || {};

  return {
    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: obj.name || '',
    phone: obj.phone || '',
    email: obj.email || '',
    address: obj.address || '',
    monthly_salary: profile.monthly_salary || 0,
    goal: profile.goal || '',
    risk_profile: profile.risk_profile || 'moderate',
    expense_breakdown: {
      basic_needs: expenses.basic_needs || 0,
      bills_payments: expenses.bills_payments || 0,
      personal_spending: expenses.personal_spending || 0,
      extra_unexpected: expenses.extra_unexpected || 0,
    },
    captured_at: new Date().toISOString(),
    status: 'new',
    financial_profile: profile,
    conversation_summary: obj.conversation_summary || '',
    peak_insight: obj.peak_insight || '',
    chat_transcript: obj.chat_transcript || [],
  };
}

/**
 * Save a lead object programmatically and return the saved lead.
 */
function saveLeadObject(obj) {
  const leads = readAll();
  const lead = makeLead(obj || {});
  leads.unshift(lead);
  writeAll(leads);
  return lead;
}

async function createLead(req, res) {
  try {
    const body = req.body || {};
    if (!body.name || !body.phone) {
      return res.status(400).json({ error: 'name and phone are required' });
    }

    const leads = readAll();
    const lead = makeLead(body);
    leads.unshift(lead);
    writeAll(leads);

    return res.json({ success: true, lead });
  } catch (err) {
    console.error('[createLead]', err);
    return res.status(500).json({ error: 'Failed to save lead' });
  }
}

async function listLeads(req, res) {
  try {
    const leads = readAll();
    return res.json({ leads, total: leads.length });
  } catch (err) {
    console.error('[listLeads]', err);
    return res.status(500).json({ error: 'Failed to read leads' });
  }
}

async function updateLeadStatus(req, res) {
  try {
    const id = req.params.id;
    const { status } = req.body || {};
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });

    const leads = readAll();
    const idx = leads.findIndex(l => l.id === id);
    if (idx === -1) return res.status(404).json({ error: 'lead not found' });
    leads[idx].status = status;
    leads[idx].updated_at = new Date().toISOString();
    writeAll(leads);
    return res.json({ success: true, lead: leads[idx] });
  } catch (err) {
    console.error('[updateLeadStatus]', err);
    return res.status(500).json({ error: 'Failed to update lead' });
  }
}

module.exports = {
  createLead,
  listLeads,
  updateLeadStatus,
  saveLeadObject,
};
