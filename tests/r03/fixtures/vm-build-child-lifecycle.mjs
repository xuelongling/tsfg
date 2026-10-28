// SPDX-License-Identifier: MIT
const code = Number(process.argv[2]);
if (code !== 0 && code !== 7) throw new TypeError("expected lifecycle test exit code");
process.stdout.write(JSON.stringify({ pid: process.pid, code }) + "\n");
process.stderr.write("child-stderr-marker\n");
process.exitCode = code;
