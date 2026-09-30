require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { User } = require('../model/collectionsModel');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@ochf.com').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AdminPassword123!';

async function seedAdmin() {
  try {
    if (!process.env.MONGOATLAS_URI) {
      console.error('Error: MONGOATLAS_URI is not defined in your .env file.');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGOATLAS_URI);
    console.log('Connected to MongoDB successfully.');

    const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });

    if (existingAdmin) {
      console.log(`\nAdmin user "${ADMIN_EMAIL}" already exists.`);
      console.log(`Role: ${existingAdmin.role}`);
      console.log(`Active: ${existingAdmin.isActive}`);
      await mongoose.disconnect();
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, salt);

    const admin = await User.create({
      email: ADMIN_EMAIL,
      passwordHash,
      role: 'admin',
      isActive: true,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });

    console.log('\n=============================================');
    console.log('✅ Admin account seeded successfully!');
    console.log('=============================================');
    console.log(`Email:    ${admin.email}`);
    console.log(`Password: ${ADMIN_PASSWORD}`);
    console.log(`Role:     ${admin.role}`);
    console.log('=============================================\n');

    await mongoose.disconnect();
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exit(1);
  }
}

seedAdmin();
