const jwt = require('jsonwebtoken');
const Booking = require('../models/bookingModel');
const { addClient, removeClient } = require('../utils/sse');

// Subscribe to booking events via SSE
// GET /api/bookings/subscribe/:bookingId?token=JWT
exports.subscribeBookingEvents = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { token } = req.query;
    if (!token) {
      return res.status(401).json({ message: 'Token is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (!booking.user || booking.user.toString() !== decoded.id) {
      return res.status(403).json({ message: 'Not authorized to subscribe to this booking' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Initial ping to open the stream
    res.write(': connected\n\n');

    addClient(bookingId, res);

    req.on('close', () => {
      removeClient(bookingId, res);
      try { res.end(); } catch (e) {}
    });
  } catch (err) {
    console.error('SSE subscribe error:', err);
    try {
      res.status(500).json({ message: 'Server error' });
    } catch (_) {}
  }
};