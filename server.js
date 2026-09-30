require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const authRoutes = require('./routes/authRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const inspectionRoutes = require('./routes/inspectionRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const reportRoutes = require('./routes/reportRoutes');
const slotRoutes = require('./routes/slotRoutes');
const mailerRoutes = require('./routes/mailerRoutes');
const schoolRoutes = require('./routes/schoolRoutes');
const { startReminderJob } = require('./utils/reminders');

const app = express();
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/properties', propertyRoutes);
app.use('/inspections', inspectionRoutes);
app.use('/transactions', transactionRoutes);
app.use('/admin', adminRoutes);
app.use('/reviews', reviewRoutes);
app.use('/reports', reportRoutes);
app.use('/slots', slotRoutes);
app.use('/notifications', mailerRoutes);
app.use('/schools', schoolRoutes);

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGOATLAS_URI)
  .then(() => {
    console.log('MongoDB connected');
    startReminderJob();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });