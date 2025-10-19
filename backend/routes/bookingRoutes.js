const express = require('express');
const { createBooking, getAllBookings, getBookingById, updateBookingStatus, updatePaymentStatus, getMyBookings, cancelBooking, deleteCancelledBookings } = require('../controllers/bookingController');
const { generatePaymentQrCode } = require('../controllers/paymentController');
const { subscribeBookingEvents } = require('../controllers/sseController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// SSE subscription route (uses token in query string)
router.get('/subscribe/:bookingId', subscribeBookingEvents);

// Protect all routes after this point
router.use(protect);

// User routes
router.post('/', createBooking);
router.get('/my-bookings', getMyBookings);
router.delete('/user-cancelled', authorize(['user']), deleteCancelledBookings);
router.delete('/user-cancel/:id', cancelBooking);
router.post('/generate-payment-qr', generatePaymentQrCode);

// Admin routes
router.delete('/cancelled', authorize(['admin']), deleteCancelledBookings);
router.get('/', authorize(['admin']), getAllBookings);
router.get('/:id', authorize(['admin']), getBookingById);
router.put('/:id', authorize(['admin']), updateBookingStatus);
router.put('/:id/payment-status', authorize(['admin']), updatePaymentStatus);
router.post('/generate-qr', authorize(['admin']), generatePaymentQrCode);
router.delete('/:id', authorize(['admin']), cancelBooking);

module.exports = router;