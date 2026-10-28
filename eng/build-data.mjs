// SPDX-License-Identifier: MIT
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { TextDecoder } from "node:util";
import { PackageFailureError } from "./build-errors.mjs";

export function canonicalize(value) {
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) {
      throw new TypeError("canonical JSON must use I-JSON strings without lone surrogate code units");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        if (hasLoneSurrogate(key)) {
          throw new TypeError("canonical JSON must use I-JSON keys without lone surrogate code units");
        }
        return `${JSON.stringify(key)}:${canonicalize(value[key])}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function digestFile(filePath) {
  const hasher = createHash("sha256");
  const handle = await open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) hasher.update(chunk);
  } finally {
    await handle.close().catch(() => undefined);
  }
  return `sha256:${hasher.digest("hex")}`;
}

export async function readRegularFile(filePath, description) {
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const file = await handle.stat();
    if (!file.isFile()) throw new Error("not a regular file");
    return await handle.readFile();
  } catch (error) {
    throw new Error(`${description} is not a stable regular file: ${error.message}`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeAtomicText(destinationPath, contents) {
  const absolutePath = path.resolve(destinationPath);
  const parent = path.dirname(absolutePath);
  const temporaryPath = path.join(
    parent,
    `.${path.basename(absolutePath)}.${randomUUID()}.tmp`,
  );
  await mkdir(parent, { recursive: true });
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
    });
    injectPublishFailure("report-before-rename");
    await renameWithRetry(temporaryPath, absolutePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function renameWithRetry(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !["EPERM", "EBUSY"].includes(error.code) ||
        attempt >= 7
      ) {
        throw error;
      }
      await delay(50 * 2 ** Math.min(attempt, 4));
    }
  }
}

export async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function readCanonicalJson(filePath, name) {
  const bytes = await readRegularFile(filePath, name);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new PackageFailureError(`${name} must be I-JSON encoded as UTF-8`);
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw new PackageFailureError(`${name} must not contain a BOM`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PackageFailureError(`${name} is not valid JSON: ${error.message}`);
  }
  let canonical;
  try {
    canonical = canonicalize(value);
  } catch (error) {
    throw new PackageFailureError(`${name} is not I-JSON: ${error.message}`);
  }
  if (text !== canonical && text !== `${canonical}\n`) {
    throw new PackageFailureError(`${name} must use canonical JSON`);
  }
  return value;
}

export function hasLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function injectPublishFailure(point) {
  if (process.env.TSFG_TEST_FAIL_PUBLISH_AT === point) {
    throw new Error(`injected publish failure at ${point}`);
  }
}
