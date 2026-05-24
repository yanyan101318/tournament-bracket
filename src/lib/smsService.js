import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { normalizePhilippineMsisdnNumber } from "./normalizePhilippinePhone.js";

/**
 * Clean SMS service for frontend
 */
export async function sendBookingSMS(bookingId, phoneNumber, message) {
  const formatted = normalizePhilippineMsisdnNumber(phoneNumber);
  if (formatted == null) {
    return {
      success: false,
      error: "Invalid or unsupported phone number format",
      code: phoneNumber ? "invalid_format" : "no_number",
    };
  }

  try {
    const response = await fetch("/api/send-sms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phoneNumber: formatted, message }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      // Log failure to Firestore
      try {
        await addDoc(collection(db, "sms_logs"), {
          bookingId,
          phoneNumber: formatted,
          phoneRaw: phoneNumber,
          message,
          status: "failed",
          apiResponse: data,
          timestamp: serverTimestamp(),
        });
      } catch (err) {
        console.error("Failed to log SMS error to Firestore", err);
      }
      
      const errText = String(data.error || "").toLowerCase();
      const isFormat =
        response.status === 400 &&
        (errText.includes("format") || errText.includes("phone number"));
      const isConfig =
        response.status === 500 &&
        (errText.includes("not configured") ||
          errText.includes("sender id") ||
          errText.includes("not provisioned"));
      return {
        success: false,
        error: data.hint ? `${data.error} ${data.hint}` : data.error || "SMS API failure",
        code: isFormat ? "invalid_format" : isConfig ? "config_error" : "api_error",
      };
    }

    // Log success to Firestore
    try {
      await addDoc(collection(db, "sms_logs"), {
        bookingId,
        phoneNumber: formatted,
        message,
        status: "success",
        apiResponse: data,
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to log SMS success to Firestore", err);
    }

    return { success: true };
  } catch (error) {
    console.error("sendBookingSMS error:", error);
    return { success: false, error: "Network error while sending SMS", code: "network_error" };
  }
}
