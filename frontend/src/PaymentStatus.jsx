import React from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import './PaymentStatus.css'; // Import the CSS file

const PaymentStatus = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Existing state (from navigate), if present
  const { success, error, booking } = location.state || {};
  // New: read query params for Xendit return URLs
  const params = new URLSearchParams(location.search);
  const qSuccess = params.get('success');
  const qError = params.get('error');
  const qBookingId = params.get('bookingId');
  const isSuccessFromQuery = qSuccess === 'true';

  // Final values prefer location.state, fallback to query
  const finalSuccess = typeof success !== 'undefined' ? success : isSuccessFromQuery;
  const finalError = typeof error !== 'undefined' ? error : qError;
  const finalBookingId = booking?._id || qBookingId;

  const handleDoneClick = () => {
    navigate('/');
  };

  return (
    <div className="payment-status-container">
      {finalSuccess ? (
        <div className="payment-success">
          <div className="back-button-container">
            <button onClick={() => navigate(-1)} className="back-button">
              ← Back
            </button>
          </div>
          <div className="confirmation-header">
            <span className="check-icon">✔️</span>
            <h1>Booking Confirmed</h1>
          </div>
          <p className="check-in-message">You're all set! 
            <br></br> You can check all your bookings in My Bookings page.
          </p>
          <div className="booking-reference-section">
            <p>Booking reference</p>
            <div className="booking-reference-box">
              {finalBookingId}
            </div>
          </div>
          <div className="check-in-info">
            <h2>Check-in information</h2>
            <ul>
              <li>Bring this reference number at the front desk for confirmation.</li>
              <li>Cancellation: Until 48 hours before check-in; and you will pay 10% of room's price as reservation fee.</li>
            </ul>
          </div>
          <button onClick={handleDoneClick} className="done-button">Done</button>
        </div>
      ) : (
        <div className="payment-failure">
          <h1>Payment Failed!</h1>
          <p>{finalError || 'There was an issue processing your payment. Please try again.'}</p>
          <Link to="/">Go to Home</Link>
        </div>
      )}
    </div>
  );
};

export default PaymentStatus;