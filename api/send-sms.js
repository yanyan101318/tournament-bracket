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
      msisdn: String(msisdn),
      content: message,
    };

    console.log("Sending SMS to M360 with payload:", JSON.stringify(payload));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    let data;
    try {
      data = await response.json();
    } catch (e) {
      console.error("Failed to parse M360 response as JSON:", await response.text());
      return res.status(500).json({ error: "M360 returned invalid JSON response" });
    }

    console.log("M360 API Response Status:", response.status, "Data:", JSON.stringify(data));

    if (!response.ok) {
      console.error("M360 API Error:", { status: response.status, data });
      const m360Msg = Array.isArray(data?.message)
        ? data.message.join(" ")
        : String(data?.message || data?.error || "");
      const notProvisioned = /not provisioned/i.test(m360Msg);
      return res.status(notProvisioned ? 500 : response.status).json({
        error: notProvisioned
          ? "SMS sender ID is not provisioned on your m360 account."
          : "M360 SMS API failed.",
        m360_error: data?.message || data?.error || "Unknown error",
        hint: notProvisioned
          ? "Set M360_SHORTCODE_MASK in .env to the exact sender ID shown in your m360 dashboard."
          : undefined,
        details: data,
      });
    }

    const m360Code = data?.code;
    const m360Status = String(data?.status || "").toLowerCase();
    const isM360Success =
      data?.success === true ||
      m360Status === "success" ||
      m360Status === "ok" ||
      m360Code === 0 ||
      m360Code === "0" ||
      m360Code === 200 ||
      m360Code === "200" ||
      (typeof m360Code === "number" && m360Code >= 200 && m360Code < 300);

    if (data?.success === false || (typeof m360Code !== "undefined" && m360Code !== null && !isM360Success)) {
      console.error("M360 Custom Error Code:", data.code, "Message:", data.message);
      return res.status(400).json({
        error: "M360 SMS failed to send.",
        m360_error: data.message || data.error || "Unknown error",
        m360_code: data.code,
        details: data,
      });
    }

    console.log("SMS sent successfully:", data);
    return res.status(200).json({
      success: true,
      message: "SMS dispatched successfully",
      response: data,
    });
  } catch (error) {
    console.error("SMS Server Error:", error.message, error);
    return res.status(500).json({ error: "Internal server error while sending SMS.", details: error.message });
  }
};
