// Keep in sync with src/lib/normalizePhilippinePhone.js
function normalizePhilippineMsisdn(phone) {
  if (phone == null || phone === "") return null;

  const raw = String(phone).trim();
  if (!raw || raw === "—" || /^n\/a$/i.test(raw) || /@/.test(raw)) return null;

  let n = raw.replace(/\D/g, "");
  if (!n) return null;

  while (n.startsWith("00")) n = n.slice(2);

  if (n.startsWith("6309")) {
    n = "639" + n.slice(4);
  }

  if (n.startsWith("6390")) {
    const rest = n.slice(4);
    if (rest.length === 10 && rest.startsWith("9")) {
      n = "63" + rest;
    } else if (rest.length === 9 && rest.startsWith("9")) {
      n = "639" + rest;
    }
  }

  if (n.startsWith("09")) {
    n = "63" + n.slice(1);
  } else if (n.startsWith("9") && n.length === 10) {
    n = "63" + n;
  }

  if (n.length === 12 && /^639\d{9}$/.test(n)) {
    return n;
  }

  return null;
}

function normalizePhilippineMsisdnNumber(phone) {
  const s = normalizePhilippineMsisdn(phone);
  if (!s) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

module.exports = { normalizePhilippineMsisdn, normalizePhilippineMsisdnNumber };
