'use strict';

const jwt = require('jsonwebtoken');

function getJwtSecret() {
  return process.env.ADMIN_JWT_SECRET || 'dev-admin-jwt-secret-change-me';
}

function adminAuth(req, res, next) {
  const bearer = req.headers.authorization;
  const tokenFromHeader = bearer && bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7) : null;
  const token = req.cookies?.admin_token || tokenFromHeader;

  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.admin = payload;
    return next();
  } catch (_e) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { adminAuth, getJwtSecret };
