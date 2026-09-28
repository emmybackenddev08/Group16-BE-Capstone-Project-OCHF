// ============================================================
// OFF-CAMPUS HOSTEL FINDER — MONGODB SCHEMA (Mongoose)
// Collections: User, StudentProfile, ProviderProfile, School,
// Property, Inspection, Transaction, Review, Report
//
// Design notes:
// - Charges and photos are embedded in Property (always fetched
//   together, never queried independently) — avoids extra lookups.
// - Location fields use GeoJSON Point + a 2dsphere index, so
//   "distance from school" and "properties near me" can use
//   native $near / $geoWithin queries instead of app-side math.
// - Profiles are separate collections (not embedded in User) so
//   student/provider-specific fields don't bloat every user doc
//   and each can be queried/indexed independently.
// ============================================================

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { Schema } = mongoose;

// ------------------------------------------------------------
// Shared GeoJSON Point sub-schema
// ------------------------------------------------------------
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
    },
  },
  { _id: false }
);

// ------------------------------------------------------------
// 1. USER
// ------------------------------------------------------------
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['student', 'provider', 'admin'], required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// NOTE: hashing now happens explicitly in authController.register()
// for both student and provider signups — not automatically here.
// This method still expects passwordHash to already be a bcrypt hash.
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// ------------------------------------------------------------
// 2. SCHOOL
// ------------------------------------------------------------
const schoolSchema = new Schema(
  {
    name: { type: String, required: true },
    location: { type: pointSchema, required: true }, // GeoJSON Point
  },
  { timestamps: true }
);
schoolSchema.index({ location: '2dsphere' });

// ------------------------------------------------------------
// 3. STUDENT PROFILE
// ------------------------------------------------------------
const studentProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School' }, // optional "home" school
    fullName: { type: String, required: true },
    phone: String,
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },
    verificationDocUrl: String,
  },
  { timestamps: true }
);
studentProfileSchema.index({ verificationStatus: 1 });

// ------------------------------------------------------------
// 4. PROVIDER PROFILE
// ------------------------------------------------------------
const providerProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    businessName: String,
    phone: { type: String, required: true },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },
    verificationDocUrl: String,
  },
  { timestamps: true }
);
providerProfileSchema.index({ verificationStatus: 1 });

// ------------------------------------------------------------
// 5. PROPERTY (with embedded charges + photos)
// ------------------------------------------------------------
const chargeSchema = new Schema(
  {
    name: { type: String, required: true }, // e.g. "Electricity", "Caution fee"
    amount: { type: Number, required: true },
  },
  { _id: false }
);

const photoSchema = new Schema(
  {
    url: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const propertySchema = new Schema(
  {
    providerId: { type: Schema.Types.ObjectId, ref: 'ProviderProfile', required: true },
    title: { type: String, required: true },
    description: String,
    price: { type: Number, required: true, min:0 },
    additionalCharges: [chargeSchema],
    photos: [photoSchema],
    address: { type: String, required: true },
    location: { type: pointSchema, required: true }, // GeoJSON Point,
    amenities: { type:String, default:[]},
    propertyType: { type: [String], enum: ['room', 'self_contain', 'shared', 'apartment', 'hostel'] },
    availabilityStatus: {
      type: String,
      enum: ['available', 'unavailable', 'booked'],
      default: 'available',
    },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true }
);
propertySchema.index({ location: '2dsphere' });
propertySchema.index({ verificationStatus: 1, availabilityStatus: 1 });
propertySchema.index({ price: 1 });
propertySchema.index({ providerId: 1 });
propertySchema.index({ title: 'text', description: 'text' }); // keyword search

// ------------------------------------------------------------
// 6. INSPECTION
// ------------------------------------------------------------
const inspectionSchema = new Schema(
  {
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    status: {
      type: String,
      enum: ['requested', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'missed'],
      default: 'requested',
    },
    decision: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
    requestedAt: { type: Date, default: Date.now },
    scheduledAt: Date,
    completedAt: Date,
    declineReason: String,   // set if a provider declines the request outright
    rejectionReason: String, // set if the student rejects the property after inspection
  },
  { timestamps: true }
);
inspectionSchema.index({ propertyId: 1 });
inspectionSchema.index({ studentId: 1 });
inspectionSchema.index({ status: 1 });

// ------------------------------------------------------------
// 7. TRANSACTION
// ------------------------------------------------------------
const transactionSchema = new Schema(
  {
    inspectionId: {
      type: Schema.Types.ObjectId,
      ref: 'Inspection',
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'cancelled'],
      default: 'pending',
    },
    amount: { type: Number, required: true },
  },
  { timestamps: true }
);
transactionSchema.index({ status: 1 });

// ------------------------------------------------------------
// 8. REVIEW
// ------------------------------------------------------------
const reviewSchema = new Schema(
  {
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: String,
  },
  { timestamps: true }
);
reviewSchema.index({ propertyId: 1, studentId: 1 }, { unique: true }); // one review per student per property

// ------------------------------------------------------------
// 9. REPORT
// ------------------------------------------------------------
const reportSchema = new Schema(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    reason: { type: String, required: true },
    status: { type: String, enum: ['open', 'reviewed', 'resolved'], default: 'open' },
  },
  { timestamps: true }
);
reportSchema.index({ status: 1 });
// Enforce at least one of propertyId / transactionId
reportSchema.pre('validate', function (next) {
  if (!this.propertyId && !this.transactionId) {
    return next(new Error('Report must reference a propertyId or transactionId'));
  }
  next();
});

// ------------------------------------------------------------
// EXPORT MODELS
// ------------------------------------------------------------
module.exports = {
  User: mongoose.model('User', userSchema),
  School: mongoose.model('School', schoolSchema),
  StudentProfile: mongoose.model('StudentProfile', studentProfileSchema),
  ProviderProfile: mongoose.model('ProviderProfile', providerProfileSchema),
  Property: mongoose.model('Property', propertySchema),
  Inspection: mongoose.model('Inspection', inspectionSchema),
  Transaction: mongoose.model('Transaction', transactionSchema),
  Review: mongoose.model('Review', reviewSchema),
  Report: mongoose.model('Report', reportSchema),
};