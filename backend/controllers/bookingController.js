const mongoose = require('mongoose');
const Booking = require('../models/bookingModel');
const Room = require('../models/roomModel');
const BookingActivity = require('../models/bookingActivityModel');
const CancelledBooking = require('../models/cancelledBookingModel');
const Billing = require('../models/Billing');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

// @desc    Get all bookings with optional status and search filters
// @route   GET /api/bookings
// @access  Admin
const getAllBookings = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  let query = {};

  // Add status filter if provided
  if (status && status !== 'all') {
    query.status = status;
  }

  // Add search filter if provided
  if (search) {
    query.$or = [
      { customerName: { $regex: search, $options: 'i' } },
      { referenceNumber: { $regex: search, $options: 'i' } },
      { roomNumber: { $regex: search, $options: 'i' } }
    ];
  }

  const bookings = await Booking.find(query)
    .sort({ createdAt: -1 });

  res.json(bookings);
});

// @desc    Get booking by ID
// @route   GET /api/bookings/:id
// @access  Admin
const getBookingById = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }

  res.json(booking);
});

// @desc    Create new booking
// @route   POST /api/bookings
// @access  Public
const createBooking = asyncHandler(async (req, res) => {
  console.log('Received booking request body:', req.body);
  const {
    customerName,
    customerEmail,
    contactNumber,
    roomNumber,
    checkIn,
    checkOut,
    adults,
    children,
    guestName,
    specialRequests
  } = req.body;

  // Generate reference number
  const referenceNumber = 'BK' + Date.now().toString().slice(-8);

  const room = await Room.findOne({ roomNumber });
  console.log('Found room:', room); // Log the found room
  if (!room) {
    res.status(404);
    throw new Error('Room not found');
  }

  // Calculate number of hours for per-hour pricing
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  // Server-side guard: enforce valid order and minimum 3-hour duration
  if (checkOutDate <= checkInDate) {
    res.status(400);
    throw new Error('Check-out must be after check-in');
  }
  const MIN_MS = 3 * 60 * 60 * 1000;
  if ((checkOutDate - checkInDate) < MIN_MS) {
    res.status(400);
    throw new Error('Minimum booking duration is 3 hours');
  }
  const diffTimeMs = Math.abs(checkOutDate - checkInDate);
  const numberOfHoursRaw = diffTimeMs / (1000 * 60 * 60);
  // bill partial hours as full hours
  const numberOfHours = Math.ceil(numberOfHoursRaw);
  const numberOfGuests = adults + children;

  // Map per-hour rates by room type
  const hourlyRates = {
    Economy: 100,
    Deluxe: 200,
    Presidential: 400,
    Suite: 450,
  };
  const roomType = room.roomType;
  const roomHourlyRate = hourlyRates[roomType] ?? room.price; // fallback to stored price
  console.log('Room hourly rate:', roomHourlyRate, 'Type:', typeof roomHourlyRate, 'RoomType:', roomType);
  if (typeof roomHourlyRate !== 'number' || isNaN(roomHourlyRate)) {
    res.status(500);
    throw new Error('Room hourly rate is not a valid number.');
  }
  const subtotal = numberOfHours * roomHourlyRate;
  const taxRate = 0.12; // Include 12% tax in final price
  const taxesAndFees = 0; // Tax is included in the hourly rate; do not separate
  const totalAmount = Math.round(subtotal * (1 + taxRate));

  // --- Robust double-booking prevention & reassignment logic ---
  // Determine if there is any overlapping active booking tied to this room
  const overlappingActive = await Booking.findOne({
    $or: [
      { room: room._id },
      { roomNumber: room.roomNumber }
    ],
    status: { $nin: ['cancelled', 'completed'] },
    checkIn: { $lt: checkOutDate },
    checkOut: { $gt: checkInDate },
  });

  const roomCurrentlyAvailable = room.status === 'available' && !room.isBooked;

  let selectedRoom = room;

  // If requested room is not currently available or it has overlapping bookings, assign an alternative
  if (!roomCurrentlyAvailable || overlappingActive) {
    console.log(`Requested room ${room.roomNumber} not assignable (available=${roomCurrentlyAvailable}, overlap=${!!overlappingActive}). Searching alternative...`);

    // Try to find any available room of the same type across any floor
    const candidateRooms = await Room.find({
      status: 'available',
      isBooked: false,
      roomType: room.roomType,
    }).sort({ floor: 1, roomNumber: 1 });

    let assigned = null;
    for (const candidate of candidateRooms) {
      const candidateOverlap = await Booking.findOne({
        $or: [
          { room: candidate._id },
          { roomNumber: candidate.roomNumber }
        ],
        status: { $nin: ['cancelled', 'completed'] },
        checkIn: { $lt: checkOutDate },
        checkOut: { $gt: checkInDate },
      });
      if (!candidateOverlap) {
        assigned = candidate;
        break;
      }
    }

    if (!assigned) {
      res.status(400);
      throw new Error(`Room type ${room.roomType} is fully booked for your selected time.`);
    }

    selectedRoom = assigned;
    console.log(`Assigned alternative room ${selectedRoom.roomNumber} for type ${room.roomType}.`);
  }

  // Update room status to reserved
  selectedRoom.status = 'occupied';
  selectedRoom.isBooked = true;
  await selectedRoom.save();

  const bookingData = {
    room: selectedRoom._id,
    user: req.user.id, // Ensure user ID is included
    referenceNumber,
    customerName,
    customerEmail,
    checkIn,
    checkOut,
    adults,
    children,
    guestName,
    contactNumber,
    specialRequests,
    roomNumber: selectedRoom.roomNumber,
    numberOfGuests,
    totalAmount,
  };

  console.log('Booking data before creation:', bookingData);

  const booking = await Booking.create(bookingData);
  console.log('Created booking:', booking);

  if (booking) {
    // Create booking activity
    await BookingActivity.create({
      booking: booking._id,
      activity: 'Booking created',
      status: 'pending'
    });

    // Create billing record for the room booking
    const roomBilling = await Billing.create({
      booking: booking._id,
      user: req.user.id,
      roomNumber: selectedRoom.roomNumber,
      amount: totalAmount,
      description: `Room booking charge for ${selectedRoom.roomNumber} (${numberOfHours} hours)`,
      status: 'pending',
      paymentMethod: 'online payment'
    });

    console.log('Created room billing record:', roomBilling);

    res.status(201).json({
      ...booking.toObject(),
      billingRecord: roomBilling
    });
  }
});

// @desc    Update booking status
// @route   PUT /api/bookings/:id
// @access  Admin
const updateBookingStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const booking = await Booking.findById(req.params.id);
  
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }
  
  const oldStatus = booking.status;
  booking.status = status;
  const updatedBooking = await booking.save();
  
  // If booking status changed to 'completed', update room status
  if (status === 'completed' && oldStatus !== 'completed') {
    const room = await Room.findById(booking.room);
    if (room) {
      // Check if there are any other active bookings for this room
      const otherActiveBooking = await Booking.findOne({
        room: room._id,
        _id: { $ne: booking._id }, // Exclude current booking
        status: { $nin: ['cancelled', 'completed'] },
        checkOut: { $gte: new Date() },
      });
      
      if (!otherActiveBooking) {
        room.status = 'available';
        room.isBooked = false;
        await room.save();
        console.log(`Room ${room.roomNumber} status updated to available after booking completion`);
      }
    }
  }
  
  // Create booking activity
  await BookingActivity.create({
    booking: booking._id,
    activity: `Booking ${status}`,
    status
  });
  
  res.json(updatedBooking);
});

// @desc    Update payment status
// @route   PUT /api/bookings/:id/payment-status
// @access  Admin
const updatePaymentStatus = asyncHandler(async (req, res) => {
  const { paymentStatus } = req.body;
  const booking = await Booking.findById(req.params.id);
  
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }
  
  booking.paymentStatus = paymentStatus;
  const updatedBooking = await booking.save();
  
  // Create booking activity
  await BookingActivity.create({
    booking: booking._id,
    activity: `Payment ${paymentStatus}`,
    status: booking.status
  });
  
  res.json(updatedBooking);
});

// @desc    Generate payment QR code
// @route   POST /api/bookings/generate-qr
// @access  Admin
const generatePaymentQrCode = asyncHandler(async (req, res) => {
  // Implementation for QR code generation
  res.json({ qrCode: 'QR code data' });
});

// @desc    Get user's bookings
// @route   GET /api/bookings/my-bookings
// @access  Private
const getMyBookings = asyncHandler(async (req, res) => {
  console.log('Backend: Fetching bookings for email:', req.user.email);
  console.log('Backend: Fetching bookings for userId:', req.user._id);
  const bookings = await Booking.find({
    $or: [
      { customerEmail: req.user.email },
      { user: req.user._id }
    ]
  }).sort({ createdAt: -1 });
  console.log('Backend: Bookings found:', bookings);
  
  res.json(bookings);
});

// @desc    Update room status based on active bookings
// @route   PUT /api/bookings/update-room-status/:roomId
// @access  Admin
const updateRoomStatus = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  
  // Find active bookings for this room
  const activeBooking = await Booking.findOne({
    room: roomId,
    status: { $nin: ['cancelled', 'completed'] },
    checkOut: { $gte: new Date() },
  });
  
  const room = await Room.findById(roomId);
  if (!room) {
    res.status(404);
    throw new Error('Room not found');
  }
  
  // Update room status based on active bookings
  if (activeBooking) {
    room.status = 'occupied';
    room.isBooked = true;
  } else {
    room.status = 'available';
    room.isBooked = false;
  }
  
  await room.save();
  
  res.json({
    message: 'Room status updated successfully',
    room: {
      roomNumber: room.roomNumber,
      status: room.status,
      isBooked: room.isBooked,
      hasActiveBooking: !!activeBooking
    }
  });
});

// @desc    Cancel booking and update room status
// @route   DELETE /api/bookings/:id
// @access  Admin
const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  
  if (!booking) {
    res.status(404);
    throw new Error('Booking not found');
  }
  
  const { reason } = req.body || {};

  // Get the room ID before deleting the booking
  const roomId = booking.room;
  
  // Create booking activity before deletion
  await BookingActivity.create({
    booking: booking._id,
    activity: 'Booking cancelled and deleted',
    status: 'cancelled',
    details: reason || ''
  });

  // Remove all billing records associated with this booking
  await Billing.deleteMany({ booking: booking._id });
  // Safety: Also remove any potential stray billing docs tied to the same user/room
  // This covers legacy or non-standard billing entries that may not reference the booking id
  await Billing.deleteMany({ user: booking.user, roomNumber: booking.roomNumber });
  
  // Store a snapshot of the cancelled booking in the 'cancelledbookings' collection
  await CancelledBooking.create({
    booking: booking._id,
    user: booking.user,
    room: booking.room,
    referenceNumber: booking.referenceNumber,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    contactNumber: booking.contactNumber,
    guestName: booking.guestName,
    roomNumber: booking.roomNumber,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    adults: booking.adults,
    children: booking.children,
    numberOfGuests: booking.numberOfGuests,
    specialRequests: booking.specialRequests,
    totalAmount: booking.totalAmount,
    paymentStatus: booking.paymentStatus,
    status: 'cancelled',
    reason: reason || '',
    cancelledAt: new Date()
  });
  
  // Permanently delete the booking
  await Booking.findByIdAndDelete(req.params.id);
  
  // Update room status after cancellation
  const activeBooking = await Booking.findOne({
    room: roomId,
    status: { $nin: ['cancelled', 'completed'] },
    checkOut: { $gte: new Date() },
  });
  
  const room = await Room.findById(roomId);
  if (room) {
    if (activeBooking) {
      room.status = 'occupied';
      room.isBooked = true;
    } else {
      room.status = 'available';
      room.isBooked = false;
    }
    await room.save();
  }
  
  res.json({ 
    message: 'Booking cancelled and permanently deleted',
    roomStatus: room ? room.status : 'unknown',
    isBooked: room ? room.isBooked : undefined
  });
});
  
// @desc    Delete cancelled bookings
// @route   DELETE /api/bookings/cancelled
// @access  Admin
const deleteCancelledBookings = asyncHandler(async (req, res, next) => {
  console.log("deleteCancelledBookings function called.");
  console.log("Request user:", req.user);
  
  if (req.originalUrl === '/api/bookings/user-cancelled') {
    // User-specific deletion
    const userId = new mongoose.Types.ObjectId(req.user.id);
    console.log("Attempting to delete user-specific cancelled bookings for user ID:", userId);
    console.log("Type of userId:", typeof userId);
    const query = { user: userId, status: 'cancelled' };
    console.log("Query for deleteMany:", query);

    const bookingsToFind = await Booking.find(query);
    console.log("Bookings found with query:", bookingsToFind);

    const result = await Booking.deleteMany(query);
    console.log("User-specific deletion result:", result);
    if (result.deletedCount === 0) {
      res.status(404).json({ success: false, message: 'No cancelled bookings found for this user.' });
      return;
    }
    res.status(200).json({ success: true, message: 'All cancelled bookings for the user deleted successfully.' });
  } else {
    // Admin deletion (original functionality)
    console.log("Attempting to delete all cancelled bookings (admin request).");
    const result = await Booking.deleteMany({ status: 'cancelled' });
    console.log("Admin deletion result:", result);
    if (result.deletedCount === 0) {
      res.status(404).json({ success: false, message: 'No cancelled bookings found.' });
      return;
    }
    res.status(200).json({ success: true, message: 'All cancelled bookings deleted successfully.' });
  }
});

module.exports = {
  createBooking,
  getAllBookings,
  getBookingById,
  updateBookingStatus,
  updatePaymentStatus,
  generatePaymentQrCode,
  getMyBookings,
  cancelBooking,
  deleteCancelledBookings,
  updateRoomStatus,
  
};
