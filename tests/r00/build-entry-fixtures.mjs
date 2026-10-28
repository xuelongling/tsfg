// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";

export async function startArtifactServer(artifacts) {
  const server = createServer((request, response) => {
    const content = artifacts.get(request.url);
    if (content === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": content.length });
    response.end(content);
  });
  await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(undefined)),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

export function parseTarArchive(bytes) {
  const entries = [];
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const stringField = (start, length) => {
      const field = header.subarray(start, start + length);
      const end = field.indexOf(0);
      return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
    };
    const octalField = (start, length) =>
      Number.parseInt(stringField(start, length).trim() || "0", 8);
    const size = octalField(124, 12);
    const contentStart = offset + 512;
    entries.push({
      bytes: bytes.subarray(contentStart, contentStart + size),
      gid: octalField(116, 8),
      mode: octalField(100, 8),
      mtime: octalField(136, 12),
      name: stringField(0, 100),
      uid: octalField(108, 8),
    });
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export function fixtureDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function fixtureCrc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function dataDescriptorZip(entryPath, bytes) {
  const name = Buffer.from(entryPath, "utf8");
  const checksum = fixtureCrc32(bytes);
  const flags = 0x0808;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(name.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(checksum, 4);
  descriptor.writeUInt32LE(bytes.length, 8);
  descriptor.writeUInt32LE(bytes.length, 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  const centralOffset = local.length + name.length + bytes.length + descriptor.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, bytes, descriptor, central, name, end]);
}

export function fixtureTreeDigest(installPath, bytes) {
  const payload = JSON.stringify({
    entries: [{ path: installPath, sha256: fixtureDigest(bytes), type: "file" }],
    schemaVersion: "1",
  });
  return fixtureDigest(payload);
}
