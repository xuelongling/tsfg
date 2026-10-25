// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';

// Bound each record at 128 MiB, matching the existing Ninja capture budget.
// This per-record guard is new: oversize input is rejected, never truncated.
const traceRecordBudget = 128 * 1024 * 1024;
/** @param {import("node:stream").Readable} stream @param {(record: any) => void} consume */
export async function readCmakeTraceEvents(stream, consume) {
  if (!stream || typeof stream.destroy !== "function") throw new TypeError("CMake trace requires a byte stream");
  const hash = createHash('sha256');
  let parts = [], pendingBytes = 0, bytes = 0, codeUnits = 0, records = 0, maxRecordBytes = 0;
  const append = part => {
    pendingBytes += part.length;
    if (pendingBytes > traceRecordBudget)
      throw new RangeError(`CMake trace record ${records + 1} exceeds ${traceRecordBudget}-byte parsing budget`);
    if (part.length) parts.push(part);
  };
  const parse = terminated => {
    const text = Buffer.concat(parts, pendingBytes).toString("utf8");
    codeUnits += text.length + Number(terminated);
    maxRecordBytes = Math.max(maxRecordBytes, pendingBytes);
    const line = terminated && text.endsWith('\r') ? text.slice(0, -1) : text;
    parts = []; pendingBytes = 0;
    if (!line) return;
    consume(JSON.parse(line)); records++;
  };
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw new TypeError('CMake trace requires raw byte chunks');
      hash.update(chunk); bytes += chunk.length;
      let start = 0, end;
      while ((end = chunk.indexOf(10, start)) !== -1) {
        append(chunk.subarray(start, end)); parse(true); start = end + 1;
      }
      append(chunk.subarray(start));
    }
    if (pendingBytes) parse(false);
    return { sha256: `sha256:${hash.digest('hex')}`, bytes, codeUnits, records, maxRecordBytes, recordBudget: traceRecordBudget };
  } finally { stream.destroy(); }
}


export function isPhysicalCmakeEvaluationCall(original, recordedLine) {
  const lines = original.split("\n");
  if (recordedLine > lines.length) return false;
  const lineStart = lines.slice(0, recordedLine - 1).reduce((offset, line) => offset + line.length + 1, 0);
  const lineEnd = lineStart + lines[recordedLine - 1].length;
  let depth = 0;
  for (let index = 0; index < original.length;) {
    const character = original[index];
    if (character === "\\") { index += 2; continue; }
    if (character === '"') {
      for (index++; index < original.length; index++) {
        if (original[index] === "\\") index++;
        else if (original[index] === '"') { index++; break; }
      }
      continue;
    }
    const bracket = /^(?:#)?\[(=*)\[/.exec(original.slice(index));
    if (bracket) {
      const close = original.indexOf(`]${bracket[1]}]`, index + bracket[0].length);
      if (close === -1) return false;
      index = close + bracket[1].length + 2;
      continue;
    }
    if (character === "#") {
      const newline = original.indexOf("\n", index);
      index = newline === -1 ? original.length : newline + 1;
      continue;
    }
    if (depth === 0) {
      const command = /^([a-z_][a-z0-9_]*)\s*\(/i.exec(original.slice(index));
      if (command) {
        // Trace line identifies the command name, not text inside an argument.
        if (index >= lineStart && index <= lineEnd && command[1].toLowerCase() === "cmake_language")
          return /^\s*EVAL\s+CODE\b/.test(original.slice(index + command[0].length));
        depth = 1;
        index += command[0].length;
        continue;
      }
    }
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (depth < 0) return false;
    index++;
  }
  return false;
}
