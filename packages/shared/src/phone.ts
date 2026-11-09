// Liberian phone numbers: +231 followed by 8–9 national digits.
// Mobile: 077/078 (Orange), 088/055 (Lonestar Cell MTN). Users type them with a leading 0.

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Normalise user input to E.164. Defaults to Liberia (+231) for national-format numbers.
 * Returns null when the input cannot be a valid number.
 */
export function normalizePhone(input: string, defaultCountryCode = "231"): string | null {
  const trimmed = input.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  let e164: string;
  if (plus) {
    e164 = `+${digits}`;
  } else if (digits.startsWith("00")) {
    e164 = `+${digits.slice(2)}`;
  } else if (digits.startsWith(defaultCountryCode) && digits.length > defaultCountryCode.length + 6) {
    e164 = `+${digits}`;
  } else if (digits.startsWith("0")) {
    e164 = `+${defaultCountryCode}${digits.slice(1)}`;
  } else {
    e164 = `+${defaultCountryCode}${digits}`;
  }

  if (!E164.test(e164)) return null;
  if (e164.startsWith("+231")) {
    const national = e164.slice(4);
    if (national.length < 7 || national.length > 9) return null;
  }
  return e164;
}

export type LiberianMobileNetwork = "orange" | "lonestar_mtn" | "unknown";

export function liberianNetwork(e164: string): LiberianMobileNetwork {
  if (!e164.startsWith("+231")) return "unknown";
  const national = e164.slice(4);
  if (/^7[78]/.test(national)) return "orange";
  if (/^(88|55)/.test(national)) return "lonestar_mtn";
  return "unknown";
}

/** "+231 77 012 3456" style display; falls back to raw E.164. */
export function formatPhone(e164: string): string {
  if (e164.startsWith("+231") && e164.length === 13) {
    const n = e164.slice(4);
    return `+231 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
  }
  return e164;
}

/** Mask all but the last 3 digits — for showing contact numbers in logs and admin lists. */
export function maskPhone(e164: string): string {
  return e164.replace(/\d(?=\d{3})/g, "•");
}
