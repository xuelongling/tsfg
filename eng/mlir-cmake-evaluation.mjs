// SPDX-License-Identifier: MIT

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
