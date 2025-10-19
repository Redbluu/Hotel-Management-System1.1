const clientsByBooking = new Map();

function addClient(bookingId, res) {
  let set = clientsByBooking.get(bookingId);
  if (!set) {
    set = new Set();
    clientsByBooking.set(bookingId, set);
  }
  set.add(res);
}

function removeClient(bookingId, res) {
  const set = clientsByBooking.get(bookingId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    clientsByBooking.delete(bookingId);
  }
}

function broadcast(bookingId, event, data) {
  const set = clientsByBooking.get(bookingId);
  if (!set) return;
  const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch (e) {
      // Ignore write errors; connection may be closed
    }
  }
}

module.exports = { addClient, removeClient, broadcast };