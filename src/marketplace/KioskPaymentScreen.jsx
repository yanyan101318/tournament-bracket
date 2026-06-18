import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const KioskPaymentScreen = ({ totalAmount, orderId, onPaymentSuccess }) => {
  const [qrImageUrl, setQrImageUrl] = useState(null);
  const [paymentId, setPaymentId] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading', 'pending', 'paid', 'error'
  const [errorMsg, setErrorMsg] = useState(null);
  const pollingRef = useRef(null);

  useEffect(() => {
    // 1. Create payment session on mount
    const createPayment = async () => {
      try {
        const response = await fetch('/api/create-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: totalAmount, orderId: orderId })
        });
        
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create payment session');
        }

        setQrImageUrl(data.qrImageUrl);
        setPaymentId(data.paymentId);
        setStatus('pending');
      } catch (err) {
        console.error("Error creating payment:", err);
        setStatus('error');
        setErrorMsg('Unable to initialize payment. Please try again.');
      }
    };

    createPayment();
  }, [totalAmount, orderId]);

  useEffect(() => {
    // 2. Poll the status every 3 seconds if pending
    if (status === 'pending' && paymentId) {
      pollingRef.current = setInterval(async () => {
        try {
          const response = await fetch(`/api/check-status/${paymentId}`);
          if (response.ok) {
            const data = await response.json();
            
            if (data.status === 'paid') {
              setStatus('paid');
              clearInterval(pollingRef.current);
              
              // 3. Call success callback after 3 seconds delay
              setTimeout(() => {
                if (onPaymentSuccess) onPaymentSuccess();
              }, 3000);
            }
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [status, paymentId, onPaymentSuccess]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-8 select-none">
      <div className="bg-white p-12 rounded-3xl shadow-2xl max-w-lg w-full text-center border border-gray-100">
        <h2 className="text-4xl font-bold text-gray-900 mb-8">GCash Payment</h2>
        
        {status === 'loading' && (
          <div className="flex flex-col items-center py-10">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mb-6"></div>
            <p className="text-xl text-gray-600 font-medium">Generating QR Code...</p>
          </div>
        )}

        {status === 'pending' && qrImageUrl && (
          <div className="flex flex-col items-center animate-fade-in py-4">
            <div className="bg-blue-50 p-6 rounded-2xl mb-8 shadow-inner border border-blue-100">
              <img 
                src={qrImageUrl} 
                alt="QR Code" 
                className="w-[300px] h-[300px] object-contain"
              />
            </div>
            <p className="text-4xl font-bold text-gray-900 mb-3">
              ₱{(totalAmount / 100).toFixed(2)}
            </p>
            <p className="text-lg text-gray-500 font-medium animate-pulse">
              Please scan the QR code using your GCash app to pay.
            </p>
          </div>
        )}

        {status === 'paid' && (
          <div className="flex flex-col items-center animate-fade-in py-10">
            <div className="bg-green-100 p-8 rounded-full mb-8 shadow-sm">
              <svg className="w-20 h-20 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <h3 className="text-4xl font-extrabold text-green-600 mb-4 tracking-tight">Payment Successful! ✅</h3>
            <p className="text-xl text-gray-600 font-medium">Completing your order...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center text-red-500 py-10">
            <p className="text-3xl font-bold mb-4">Oops!</p>
            <p className="text-lg font-medium">{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default KioskPaymentScreen;
