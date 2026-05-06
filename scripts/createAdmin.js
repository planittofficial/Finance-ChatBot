'use strict';

/**
 * Create an admin user in MongoDB.
 * Usage:
 *   node scripts/createAdmin.js <username> <password>
 * Requires:
 *   MONGODB_URI in .env
 */

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const AdminUser = require('../src/models/AdminUser');

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI in .env');
    process.exit(1);
  }
  if (!username || !password) {
    console.error('Usage: node scripts/createAdmin.js <username> <password>');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const existing = await AdminUser.findOne({ username: String(username).trim() }).exec();
  if (existing) {
    console.log(`Admin user already exists: ${existing.username}`);
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(String(password), 12);
  await AdminUser.create({ username: String(username).trim(), passwordHash, role: 'admin' });
  console.log(`Created admin user: ${username}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('Failed to create admin:', e.message);
  process.exit(1);
});
