// SPDX-License-Identifier: MIT
// Product literal verification: exact decimal/radix rational, one RNE rounding.
// The conformance oracle is separately frozen and does not import this module.
export const floatNames = ["f32", "f64"];
export function floatBits(token, type) {
  if (!floatNames.includes(type) || typeof token !== "string") throw new TypeError("invalid float literal");
  const precision = type === "f32" ? 24 : 53, emin = type === "f32" ? -126 : -1022,
    emax = type === "f32" ? 127 : 1023, width = type === "f32" ? 32 : 64;
  const negative = token.startsWith("-"), text = token.replace(/^[+-]/, "");
  const digits = "[0-9](?:_?[0-9])*";
  const decimal = new RegExp(`^(?:(${digits})(?:\\.(${digits})?)?|\\.(${digits}))(?:[eE]([+-]?${digits}))?$`).exec(text);
  let numerator, denominator = 1n;
  if (/^0(?:[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|[bB][01](?:_?[01])*|[oO][0-7](?:_?[0-7])*)$/.test(text)) {
    numerator = BigInt(text.replaceAll("_", ""));
  } else {
    if (!decimal) throw new TypeError("invalid exact float token");
    const fraction = (decimal[2] ?? decimal[3] ?? "").replaceAll("_", "");
    numerator = BigInt((decimal[1] ?? "").replaceAll("_", "") + fraction);
    if (numerator !== 0n) {
      const exponent = BigInt((decimal[4] ?? "0").replaceAll("_", "")) - BigInt(fraction.length);
      const order = exponent + BigInt(numerator.toString().length - 1);
      if (order > 400n) throw new RangeError("finite float literal overflows");
      if (order < -400n) numerator = 0n;
      else if (exponent >= 0n) numerator *= 10n ** exponent;
      else denominator = 10n ** -exponent;
    }
  }
  let bits = negative ? 1n << BigInt(width - 1) : 0n;
  if (numerator !== 0n) {
    let exponent = numerator.toString(2).length - denominator.toString(2).length;
    if (exponent >= 0 ? numerator < (denominator << BigInt(exponent)) : (numerator << BigInt(-exponent)) < denominator) exponent--;
    if (exponent > emax) throw new RangeError("finite float literal overflows");
    const unit = Math.max(exponent, emin) - (precision - 1);
    const n = unit < 0 ? numerator << BigInt(-unit) : numerator;
    const d = unit > 0 ? denominator << BigInt(unit) : denominator;
    let q = n / d;
    const twice = (n % d) * 2n;
    if (twice > d || twice === d && (q & 1n)) q++;
    if (q >= 1n << BigInt(precision)) { q >>= 1n; exponent++; }
    if (exponent > emax) throw new RangeError("finite float literal overflows");
    if (q >= 1n << BigInt(precision - 1)) {
      bits |= BigInt(Math.max(exponent, emin) - emin + 1) << BigInt(precision - 1);
      q -= 1n << BigInt(precision - 1);
    }
    bits |= q;
  }
  return bits.toString(16).padStart(width / 4, "0");
}
