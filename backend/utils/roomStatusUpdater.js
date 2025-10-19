const Room = require('../models/roomModel');
const Booking = require('../models/bookingModel');

/**
 * Synchronize room.status and room.isBooked based on active bookings.
 * Rules:
 * - If any non-cancelled/non-completed booking exists with checkOut in the future
 *   for the room (by id or roomNumber), mark room as 'occupied' and isBooked=true.
 * - Otherwise, mark room as 'available' and isBooked=false.
 * - Leaves 'maintenance' rooms unchanged.
 */
const updateRoomStatuses = async () => {
  try {
    console.log('Starting room status sync...');

    const now = new Date();
    // Process only rooms that can flip between available/occupied
    const rooms = await Room.find({ status: { $in: ['available', 'occupied'] } });
    console.log(`Found ${rooms.length} rooms to evaluate for status sync`);

    let updatedCount = 0;

    for (const room of rooms) {
      const hasActiveBooking = await Booking.findOne({
        $or: [
          { room: room._id },
          { roomNumber: room.roomNumber }
        ],
        status: { $nin: ['cancelled', 'completed'] },
        checkOut: { $gte: now },
      });

      const shouldBeOccupied = !!hasActiveBooking;
      const targetStatus = shouldBeOccupied ? 'occupied' : 'available';
      const targetIsBooked = shouldBeOccupied;

      if (room.status !== targetStatus || room.isBooked !== targetIsBooked) {
        const prevStatus = room.status;
        const prevIsBooked = room.isBooked;
        room.status = targetStatus;
        room.isBooked = targetIsBooked;
        await room.save();
        updatedCount++;
        console.log(
          `Room ${room.roomNumber}: status ${prevStatus} -> ${room.status}, isBooked ${prevIsBooked} -> ${room.isBooked}`
        );
      }
    }

    console.log(`Room status sync completed. Updated ${updatedCount} rooms.`);
    return updatedCount;
  } catch (error) {
    console.error('Error syncing room statuses:', error);
    throw error;
  }
};

module.exports = { updateRoomStatuses };