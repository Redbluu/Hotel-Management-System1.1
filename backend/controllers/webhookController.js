const crypto = require('crypto');
const Xendit = require('xendit-node');
const Booking = require('../models/bookingModel');

const XENDIT_SECRET_API_KEY = process.env.XENDIT_SECRET_API_KEY;
const XENDIT_WEBHOOK_TOKEN = process.env.XENDIT_WEBHOOK_TOKEN;

const xendit = new Xendit({ secretKey: XENDIT_SECRET_API_KEY });

const handleXenditWebhook = async (req, res) => {
  console.log('Xendit Webhook received. Headers:', req.headers);
  console.log('Xendit Webhook received. Body:', req.body);

  const xIncomingCallbackToken = req.headers['x-callback-token'];

  if (!xIncomingCallbackToken) {
    console.warn('X-Callback-Token header not found.');
    return res.status(401).json({ message: 'Unauthorized: X-Callback-Token missing' });
  }

  if (xIncomingCallbackToken !== XENDIT_WEBHOOK_TOKEN) {
    console.warn('X-Callback-Token mismatch. Possible tampering or incorrect secret key.');
    return res.status(401).json({ message: 'Unauthorized: Invalid X-Callback-Token' });
  }

  try {
    const event = req.body;
    console.log('Received Xendit webhook event:', event);

    let bookingId;
    let paymentStatus;
    let xenditPaidAt = null;

    switch (event.event) {
      // Payment Intents (older flow)
      case 'payment_intent.succeeded':
        console.log('Payment Intent succeeded:', event.data);
        bookingId = event.data.metadata?.bookingId;
        paymentStatus = 'paid';
        xenditPaidAt = new Date();
        break;
      case 'payment_intent.failed':
        console.log('Payment Intent failed:', event.data);
        bookingId = event.data.metadata?.bookingId;
        paymentStatus = 'failed';
        break;
      case 'payment_intent.processing':
        console.log('Payment Intent processing:', event.data);
        bookingId = event.data.metadata?.bookingId;
        paymentStatus = 'pending';
        break;
      case 'payment_intent.requires_action':
        console.log('Payment Intent requires action:', event.data);
        bookingId = event.data.metadata?.bookingId;
        paymentStatus = 'pending';
        break;

      // E-Wallet charges (older flow)
      case 'ewallet.charge.succeeded':
        console.log('E-wallet charge succeeded:', event.data);
        bookingId = event.data.reference_id;
        paymentStatus = 'paid';
        xenditPaidAt = new Date();
        break;
      case 'ewallet.charge.failed':
        console.log('E-wallet charge failed:', event.data);
        bookingId = event.data.reference_id;
        paymentStatus = 'failed';
        break;
      case 'ewallet.charge.pending':
        console.log('E-wallet charge pending:', event.data);
        bookingId = event.data.reference_id;
        paymentStatus = 'pending';
        break;

      // Payment Requests (newer flow)
      case 'payment_request.succeeded':
      case 'payment_request.completed':
      case 'payment_request.authorized':
      case 'payment_request.captured':
      case 'payment_request.settled':
        console.log(`Payment Request success-like event: ${event.event}`, event.data);
        bookingId = event?.data?.reference_id
          || event?.data?.metadata?.bookingId
          || event?.data?.payment_request?.reference_id
          || event?.data?.payment_request?.metadata?.bookingId;
        paymentStatus = 'paid';
        xenditPaidAt = new Date();
        break;
      case 'payment_request.failed':
      case 'payment_request.canceled':
      case 'payment_request.cancelled':
      case 'payment_request.expired':
        console.log(`Payment Request failure-like event: ${event.event}`, event.data);
        bookingId = event?.data?.reference_id
          || event?.data?.metadata?.bookingId
          || event?.data?.payment_request?.reference_id
          || event?.data?.payment_request?.metadata?.bookingId;
        paymentStatus = 'failed';
        break;

      // Payment Session (dashboard events)
      case 'payment_session.completed':
        console.log('Payment Session completed:', event.data);
        bookingId = event?.data?.payment_request?.reference_id
          || event?.data?.reference_id
          || event?.data?.metadata?.bookingId;
        paymentStatus = 'paid';
        xenditPaidAt = new Date();
        break;
      case 'payment_session.expired':
      case 'payment_session.failed':
        console.log(`Payment Session not completed: ${event.event}`, event.data);
        bookingId = event?.data?.payment_request?.reference_id
          || event?.data?.reference_id
          || event?.data?.metadata?.bookingId;
        paymentStatus = 'failed';
        break;

      // QR Codes (if configured)
      case 'qr_code.payment_succeeded':
      case 'qr_code.payment_successful':
        console.log(`QR Code payment succeeded: ${event.event}`, event.data);
        bookingId = event?.data?.reference_id || event?.data?.metadata?.bookingId;
        paymentStatus = 'paid';
        xenditPaidAt = new Date();
        break;
      case 'qr_code.payment_failed':
      case 'qr_code.payment_expired':
        console.log(`QR Code payment failed/expired: ${event.event}`, event.data);
        bookingId = event?.data?.reference_id || event?.data?.metadata?.bookingId;
        paymentStatus = 'failed';
        break;

      default:
        // Fallback: infer status from event.data.status and try various reference fields
        const inferredStatus = (event?.data?.status || '').toUpperCase();
        bookingId = event?.data?.reference_id
          || event?.data?.metadata?.bookingId
          || event?.data?.payment_request?.reference_id
          || event?.data?.payment_request?.metadata?.bookingId;

        if (['PENDING', 'PROCESSING', 'REQUIRES_ACTION'].includes(inferredStatus)) {
          paymentStatus = 'pending';
        } else if (['SUCCEEDED', 'PAID', 'COMPLETED', 'AUTHORIZED', 'AUTHORISED', 'CAPTURED', 'SETTLED', 'CHARGED'].includes(inferredStatus)) {
          paymentStatus = 'paid';
          xenditPaidAt = new Date();
        } else if (['FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED', 'VOIDED'].includes(inferredStatus)) {
          paymentStatus = 'failed';
        }

        if (!bookingId || !paymentStatus) {
          console.log('Unhandled Xendit event type:', event.event, 'status:', event?.data?.status);
          return res.status(200).json({ message: 'Unhandled event type' });
        }
    }

    if (bookingId && paymentStatus) {
      const booking = await Booking.findById(bookingId);
      if (booking) {
        booking.paymentStatus = paymentStatus;
        booking.paymentDetails.xenditStatus = event.event;
        if (xenditPaidAt) {
          booking.paymentDetails.xenditPaidAt = xenditPaidAt;
        }
        await booking.save();
        console.log(`Booking ${bookingId} updated to status: ${paymentStatus}`);

        // Broadcast SSE payment update
        try {
          const { broadcast } = require('../utils/sse');
          broadcast(bookingId.toString(), 'payment_update', {
            bookingId: bookingId.toString(),
            paymentStatus,
            event: event.event,
          });
        } catch (e) {
          console.warn('SSE broadcast failed:', e);
        }
      } else {
        console.warn(`Booking ${bookingId} not found for webhook event.`);
      }
    }

    res.status(200).json({ message: 'Webhook received and processed' });
  } catch (error) {
    console.error('Error processing Xendit webhook:', error);
    res.status(500).json({ message: 'Error processing webhook' });
  }
};

module.exports = { handleXenditWebhook };