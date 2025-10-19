const express = require('express');
const connectDB = require('./config/db');
const cors = require('cors');
require('dotenv').config();
const { updateRoomStatuses } = require('./utils/roomStatusUpdater');
const { archivePastBookings } = require('./utils/archiveBookings');

const app = express();

// Connect Database
connectDB();

// Init Middleware
app.use(express.json({
  extended: false,
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
      process.env.FRONTEND_URL // allow current tunnel domain
    ].filter(Boolean);
    if (!origin || allowed.includes(origin)) {
      return callback(null, true);
    }
    // Permit localtunnel subdomains of the same base if FRONTEND_URL is set
    try {
      const tunnelHost = new URL(process.env.FRONTEND_URL || '').host || '';
      if (origin && origin.includes(tunnelHost)) {
        return callback(null, true);
      }
    } catch (_) {}
    callback(null, true); // fallback to allow for dev convenience
  },
  credentials: true
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  next();
});

// Define Routes
console.log('Loading routes...');
app.use('/api/rooms', require('./routes/roomRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
console.log('Loading payment routes...');
app.use('/api/payment', require('./routes/paymentRoutes'));
console.log('Payment routes loaded');
app.use('/api/billings', require('./routes/billingRoutes'));
app.use('/api/test', require('./routes/testRoutes'));

app.use('/api/reviews', require('./routes/reviewRoutes'));

app.use('/api/booking-activities', require('./routes/bookingActivityRoutes'));

app.use('/api/dashboard', require('./routes/dashboardRoutes'));

app.use('/webhooks', require('./routes/webhookRoutes'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Kick off an initial room status sync and schedule periodic updates
(async () => {
  try {
    await updateRoomStatuses();
    await archivePastBookings();
  } catch (e) {
    console.error('Initial sync failed:', e);
  }
})();

const ROOM_STATUS_SYNC_INTERVAL_MS = parseInt(process.env.ROOM_STATUS_SYNC_INTERVAL_MS || '60000', 10);
setInterval(() => {
  updateRoomStatuses().catch(err => console.error('Scheduled room status sync failed:', err));
}, ROOM_STATUS_SYNC_INTERVAL_MS);

const ARCHIVE_BOOKINGS_INTERVAL_MS = parseInt(process.env.ARCHIVE_BOOKINGS_INTERVAL_MS || '60000', 10);
setInterval(() => {
  archivePastBookings().catch(err => console.error('Scheduled archive failed:', err));
}, ARCHIVE_BOOKINGS_INTERVAL_MS);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));