import crypto from 'crypto';
import fs from 'fs';
import zlib from 'zlib';

/**
 * Phase 15: a minimal ZIP writer for the closure pack. Entries are written one by one to a file
 * (deflated, or stored when deflating does not help), so memory holds one entry at a time; the
 * central directory is written at the end. No ZIP64: the archive is capped below 4 GB by the
 * caller. The SHA-256 of the whole archive is computed while writing.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const UTF8_FLAG = 0x0800;

interface CentralEntry {
  name: Buffer;
  crc: number;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export class ZipFileWriter {
  private fd: number;
  private offset = 0;
  private entries: CentralEntry[] = [];
  private hash = crypto.createHash('sha256');
  private names = new Set<string>();

  constructor(
    public readonly path: string,
    private readonly maxBytes = 2 * 1024 * 1024 * 1024
  ) {
    this.fd = fs.openSync(path, 'w');
  }

  private write(buf: Buffer) {
    if (this.offset + buf.length > this.maxBytes) throw new Error(`The closure pack would exceed ${Math.round(this.maxBytes / 1024 / 1024)} MB.`);
    fs.writeSync(this.fd, buf);
    this.hash.update(buf);
    this.offset += buf.length;
  }

  get bytesWritten() {
    return this.offset;
  }

  get entryCount() {
    return this.entries.length;
  }

  /** Adds one file. Names are made unique by suffixing " (2)", " (3)" … */
  addFile(rawName: string, data: Buffer, modified = new Date()): string {
    let name = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
    if (this.names.has(name)) {
      const dot = name.lastIndexOf('.');
      const [base, ext] = dot > name.lastIndexOf('/') ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let i = 2;
      while (this.names.has(`${base} (${i})${ext}`)) i += 1;
      name = `${base} (${i})${ext}`;
    }
    this.names.add(name);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const deflated = zlib.deflateRawSync(data, { level: 6 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosDateTime(modified);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(UTF8_FLAG, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    const offset = this.offset;
    this.write(header);
    this.write(nameBuf);
    this.write(body);
    this.entries.push({ name: nameBuf, crc, method, compressedSize: body.length, size: data.length, offset, dosTime: time, dosDate: date });
    return name;
  }

  /** Writes the central directory and closes the file. Returns size and SHA-256 of the archive. */
  finish(): { byteSize: number; sha256: string; entryCount: number } {
    const start = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(CENTRAL_HEADER, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(UTF8_FLAG, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.dosTime, 12);
      h.writeUInt16LE(e.dosDate, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressedSize, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      this.write(h);
      this.write(e.name);
    }
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_OF_CENTRAL, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
    fs.closeSync(this.fd);
    return { byteSize: this.offset, sha256: this.hash.digest('hex'), entryCount: this.entries.length };
  }

  /** Closes without finishing (on failure). */
  abort() {
    try {
      fs.closeSync(this.fd);
    } catch {
      /* already closed */
    }
  }
}

/** Reads a ZIP produced by ZipFileWriter (tests and verification): name → bytes. */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('Not a ZIP file');
  const count = buf.readUInt16LE(endAt + 10);
  let p = buf.readUInt32LE(endAt + 16);
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== CENTRAL_HEADER) throw new Error('Bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const localNameLen = buf.readUInt16LE(offset + 26);
    const localExtraLen = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressed);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if ((zlib.crc32(data) >>> 0) !== crc) throw new Error(`CRC mismatch for ${name}`);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
