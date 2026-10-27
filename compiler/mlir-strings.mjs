// SPDX-License-Identifier: MIT
// Shared MLIR string escaping is independent of frontend and bytecode contracts.
// The budgeted Common Program printer uses this boundary for source names,
// complete owned facts and proof metadata; it never imports the scalar emitter.
export const coreQuote = text => JSON.stringify(text).replace(/\\(?:u[0-9a-f]{4}|["\\bfnrt])/g, escape => {
    if (escape[1] === "r") return "\\0D";
    if (escape[1] === "b") return "\\08";
    if (escape[1] === "f") return "\\0C";
    if (escape[1] !== "u") return escape;
    const hex = escape.slice(2), code = Number.parseInt(hex, 16);
    return code < 128 ? "\\" + hex.slice(2) : String.fromCharCode(code);
  });
