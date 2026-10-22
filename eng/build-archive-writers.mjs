// SPDX-License-Identifier: MIT
import { PackageFailureError } from "./build-errors.mjs";

function formatTarNumber(value, length) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length >= length) throw new PackageFailureError("tar number exceeds field width");
  return `${encoded}\0`;
}

function tarHeader(entry, sourceDateEpoch) {
  const header = Buffer.alloc(512);
  const name = Buffer.from(entry.path, "utf8");
  if (name.length === 0 || name.length > 100) {
    throw new PackageFailureError(`package member path is not representable in ustar: ${entry.path}`);
  }
  name.copy(header, 0);
  header.write(formatTarNumber(entry.mode, 8), 100, "ascii");
  header.write(formatTarNumber(0, 8), 108, "ascii");
  header.write(formatTarNumber(0, 8), 116, "ascii");
  header.write(formatTarNumber(entry.bytes.length, 12), 124, "ascii");
  header.write(formatTarNumber(sourceDateEpoch, 12), 136, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  header.write(formatTarNumber(0, 8), 329, "ascii");
  header.write(formatTarNumber(0, 8), 337, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return header;
}

export function createTar(entries, sourceDateEpoch) {
  const sorted = [...entries].sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)));
  const chunks = [];
  for (const entry of sorted) {
    chunks.push(tarHeader(entry, sourceDateEpoch), entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

export function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

export function createZip(entries, sourceDateEpoch) {
  const date = new Date(Math.max(sourceDateEpoch * 1000, Date.UTC(1980, 0, 1)));
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5)
    | Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5)
    | date.getUTCDate();
  const sorted = [...entries].sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)));
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of sorted) {
    const name = Buffer.from(entry.path, "utf8");
    const checksum = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((entry.mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, entry.bytes);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
