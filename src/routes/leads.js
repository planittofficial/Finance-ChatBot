'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/leadsController');

// POST /api/leads  — create a lead
router.post('/', controller.createLead);

// GET /api/leads — list leads (admin)
router.get('/', controller.listLeads);

// PATCH /api/leads/:id/status — update lead status
router.patch('/:id/status', controller.updateLeadStatus);

module.exports = router;
