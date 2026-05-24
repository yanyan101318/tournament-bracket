const {
  normalizePhilippineMsisdnNumber,
} = require("./phoneFormat.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({ error: "Phone number and message are required." });
    }

    const appKey = process.env.M360_APP_KEY;
    const appSecret = process.env.M360_APP_SECRET;
    const shortcodeMask =
      process.env.M360_SHORTCODE_MASK || process.env.M360_SENDER_ID || "";

    if (!appKey || !appSecret) {
      return res.status(500).json({ error: "SMS credentials not configured on the server." });
    }

    if (!String(shortcodeMask).trim()) {
      return res.status(500).json({
        error: "SMS sender ID not configured.",
        hint: "Add M360_SHORTCODE_MASK to your .env file (your m360 sender ID / shortcode).",
      });
    }

    const msisdn = normalizePhilippineMsisdnNumber(phoneNumber);
    if (msisdn == null) {
      return res.status(400).json({
        error: "Invalid phone number format.",
        hint: "Use a Philippine mobile number (e.g. 09XX XXX XXXX or +63 9XX XXX XXXX).",
      });
    }

    const url = "https://api.m360.com.ph/v3/api/broadcast";

    const payload = {
      app_key: appKey,
      app_secret: appSecret,
      shortcode_mask: String(shortcodeMask).trim(),
      msisdn,
      content: message,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("M360 API Error Response:", data);
      const m360Msg = Array.isArray(data?.message)
        ? data.message.join(" ")
        : String(data?.message || "");
      const notProvisioned = /not provisioned/i.test(m360Msg);
      return res.status(notProvisioned ? 500 : response.status).json({
        error: notProvisioned
          ? "SMS sender ID is not provisioned on your m360 account."
          : "M360 SMS API failed.",
        hint: notProvisioned
          ? "Set M360_SHORTCODE_MASK in .env to the exact sender ID shown in your m360 dashboard."
          : undefined,
        details: data,
      });
    }

    if (data && data.code && data.code !== 200 && data.code !== "200" && data.code !== 0) {
      console.error("M360 Custom Error:", data);
      return res.status(400).json({
        error: "M360 SMS failed to send.",
        details: data,
      });
    }

    return res.status(200).json({
      success: true,
      message: "SMS dispatched successfully",
      response: data,
    });
  } catch (error) {
    console.error("SMS Server Error:", error);
    return res.status(500).json({ error: "Internal server error while sending SMS." });
  }
};
