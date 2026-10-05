// SPDX-License-Identifier: MIT
// Internal CMake compiler launcher. Intake and tool qualification remain owned
// by the HBE; this only stabilizes main-file spelling in the two staged roots.
import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const ordinary = async (name, directory) => {
  const state = await lstat(name);
  if (state.isSymbolicLink() || (directory ? !state.isDirectory() : !state.isFile()) ||
      path.relative(name, await realpath(name)) !== "") throw new Error(`Nonordinary compiler input: ${name}`);
};

try {
  const [expected, source, product, build, compiler, ...args] = process.argv.slice(2);
  if (![expected, source, product, build, compiler].every(name => typeof name === "string" && /^E:[\\/]/i.test(name)))
    throw new Error("The internal compiler launcher requires explicit verified E paths");
  const roots = [source, product, build].map(name => path.resolve(name));
  if (path.relative(path.resolve(expected), path.resolve(compiler)) !== "" || !within(roots[2], process.cwd()))
    throw new Error("Compiler or working directory differs from the fixed build context");
  await ordinary(path.resolve(expected), false);
  for (const root of roots) await ordinary(root, true);
  const inputs = args.flatMap((argument, index) => argument === "-c" || argument === "/c" ? [index + 1] : []);
  if (inputs.length !== 1) throw new Error("Expected one CMake compile input");
  // The locked CMake Ninja rule uses -c -- <input> for upstream targets;
  // owned targets can use -c <input>. Preserve the separator itself.
  const inputIndex = inputs[0] + (args[inputs[0]] === "--" ? 1 : 0);
  if (inputIndex >= args.length) throw new Error("Expected one CMake compile input");
  const input = path.resolve(process.cwd(), args[inputIndex]);
  if (roots.slice(0, 2).some(root => within(root, input))) {
    await ordinary(input, false);
    args[inputIndex] = path.relative(process.cwd(), input).replaceAll("\\", "/");
  }
  // CMake's locked-tool ABI/feature probes are passed through unchanged.
  // No flags, include paths, bytes, tool choice or compiler status are rewritten.
  await new Promise((resolve, reject) => {
    const child = spawn(compiler, args, { env: process.env, cwd: process.cwd(), stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 1;
      resolve(undefined);
    });
  });
} catch (error) {
  console.error(`[mlir-compiler-context] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 11;
}
