'use strict';

/**
 * routes/chat.js
 * ──────────────
 * All /api/chat routes wired to the chat controller.
 */

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/chatController');

/**
 * POST /api/chat/start
 * Creates a new session and returns the first bot message + step metadata.
 *
 * Response:
 *   { sessionId, message, phase, step, progress }
 */
router.post('/start', controller.startSession);

/**
 * POST /api/chat/message
 * Sends a user message and returns the bot's response.
 *
 * Body: { sessionId: string, message: string }
 *
 * Response:
 *   { sessionId, message, phase, step?, progress?, analysis?, profile?, invalid? }
 */
router.post('/message', controller.handleMessage);

/**
 * POST /api/chat/analyze
 * Force-triggers analysis on a session where all 6 fields are already set.
 * Useful for testing or when the frontend pre-fills the profile.
 *
 * Body: { sessionId: string }
 */
router.post('/analyze', controller.forceAnalyze);

/**
 * GET /api/chat/session/:id
 * Returns full session state — profile, phase, history, analysis.
 * Useful for reconnecting after a page refresh.
 */
router.get('/session/:id', controller.getSessionState);

/**
 * DELETE /api/chat/session/:id
 * Ends and removes a session.
 */
router.delete('/session/:id', controller.deleteSessionHandler);

module.exports = router;
