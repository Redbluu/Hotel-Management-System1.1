const Booking = require('../models/bookingModel');
const Room = require('../models/roomModel');
const ArchivedBooking = require('../models/archivedBookingModel');

/**
 * Archive all bookings with checkOut in the past (now) and not cancelled.
 * Moves documents to ArchivedBooking collection and removes from active Booking.
 * Also updates room status if there are no remaining active bookings.
 */
const archivePastBookings = async () => {
  const now = new Date();
  let archivedCount = 0;

  try {
    console.log('[Archive] Scanning for past bookings to archive...');

    const pastBookings = await Booking.find({
      checkOut: { $lt: now },
      status: { $ne: 'cancelled' }
    });

    console.log(`[Archive] Found ${pastBookings.length} past bookings.`);

    for (const booking of pastBookings) {
      // Prepare archive payload (exclude _id to avoid collision)
      const obj = booking.toObject();
      delete obj._id;

      const archiveDoc = {
        originalBookingId: booking._id,
        ...obj,
        archivedAt: new Date()
      };

      // Create archive record
      await ArchivedBooking.create(archiveDoc);

      // Delete booking from active collection
      await Booking.findByIdAndDelete(booking._id);
      archivedCount++;
      console.log(`[Archive] Archived and removed booking ${booking.referenceNumber} (room ${booking.roomNumber}).`);

      // Update room status if no other active booking remains for the room
      const activeBooking = await Booking.findOne({
        $or: [
          { room: booking.room },
          { roomNumber: booking.roomNumber }
        ],
        status: { $nin: ['cancelled', 'completed'] },
        checkOut: { $gte: now },
      });

      const room = await Room.findById(booking.room);
      if (room) {
        if (activeBooking) {
          room.status = 'occupied';
          room.isBooked = true;
        } else {
          room.status = 'available';
          room.isBooked = false;
        }
        await room.save();
        console.log(`[Archive] Room ${room.roomNumber} status set to ${room.status}.`);
      }
    }

    console.log(`[Archive] Completed. Archived ${archivedCount} bookings.`);
    return archivedCount;
  } catch (err) {
    console.error('[Archive] Error archiving past bookings:', err);
    throw err;
  }
};

module.exports = { archivePastBookings };