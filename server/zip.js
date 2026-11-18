// Streaming ZIP (metoda "store", bez kompresije) s ZIP64 podrškom.
// Datoteke se šalju u hodu - bez privremenih datoteka i bez vanjskih paketa.
import zlib from 'node:zlib';
import { Writable } from 'node:stream';

const MAX32 = 0xffffffff;
let LIMIT = MAX32; // za testove se može smanjiti kako bi se isprobao ZIP64
export function _setZip64Limit(n) { LIMIT = n; }

// CRC32 - zlib.crc32 (Node 20.15+/22.2+) ili tablica
let crcTable = null;
function crc32(buf, prev = 0) {
  if (zlib.crc32) return zlib.crc32(buf, prev);
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = (prev ^ MAX32) >>> 0;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ MAX32) >>> 0;
}

function dosTime(ms) {
  const d = new Date(ms || Date.now());
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };

export class ZipStream {
  constructor(out) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
    this.aborted = false;
    out.on('close', () => { if (!out.writableFinished) this.aborted = true; });
  }

  write(buf) {
    if (this.aborted) return Promise.reject(new Error('Preuzimanje je prekinuto.'));
    this.offset += buf.length;
    if (this.out.write(buf)) return Promise.resolve();
    return new Promise((res, rej) => {
      const onDrain = () => { this.out.off('close', onClose); res(); };
      const onClose = () => { this.out.off('drain', onDrain); rej(new Error('Preuzimanje je prekinuto.')); };
      this.out.once('drain', onDrain);
      this.out.once('close', onClose);
    });
  }

  async addDir(name, mtime) {
    const n = Buffer.from(name.replace(/\/*$/, '/'), 'utf8');
    const { time, date } = dosTime(mtime);
    const offset = this.offset;
    const zip64 = offset >= LIMIT;
    const extra = zip64 ? Buffer.concat([u16(1), u16(16), u64(0), u64(0)]) : Buffer.alloc(0);
    await this.write(Buffer.concat([
      u32(0x04034b50), u16(zip64 ? 45 : 20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(0), u32(0), u32(0), u16(n.length), u16(extra.length), n, extra,
    ]));
    this.entries.push({ n, time, date, crc: 0, size: 0, offset, dir: true });
  }

  // writeFn(sink) mora upisati sadržaj datoteke u sink (Writable)
  async addFile(name, mtime, expectedSize, writeFn) {
    const n = Buffer.from(name, 'utf8');
    const { time, date } = dosTime(mtime);
    const offset = this.offset;
    const zip64 = (expectedSize || 0) >= LIMIT || offset >= LIMIT;
    const extra = zip64 ? Buffer.concat([u16(1), u16(16), u64(0), u64(0)]) : Buffer.alloc(0);
    await this.write(Buffer.concat([
      u32(0x04034b50), u16(zip64 ? 45 : 20), u16(0x0808), u16(0), u16(time), u16(date),
      u32(0), u32(zip64 ? MAX32 : 0), u32(zip64 ? MAX32 : 0), u16(n.length), u16(extra.length), n, extra,
    ]));

    let crc = 0, size = 0;
    const zip = this;
    const sink = new Writable({
      write(chunk, _enc, cb) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        zip.write(chunk).then(() => cb(), cb);
      },
    });
    let error = null;
    try {
      await writeFn(sink);
    } catch (e) {
      error = e;
    }
    if (this.aborted) throw new Error('Preuzimanje je prekinuto.');
    // neki adapteri (FTP) ne zatvaraju odredišni stream
    if (!sink.writableFinished) {
      await new Promise((res) => {
        if (sink.writableEnded) sink.once('finish', res).once('error', res);
        else sink.end(res);
      });
    }
    if (!zip64 && size >= LIMIT) throw new Error(`Datoteka ${name} je narasla tijekom preuzimanja.`);

    await this.write(zip64
      ? Buffer.concat([u32(0x08074b50), u32(crc), u64(size), u64(size)])
      : Buffer.concat([u32(0x08074b50), u32(crc), u32(size), u32(size)]));
    this.entries.push({ n, time, date, crc, size, offset, dir: false, flags: 0x0808 });
    return { size, error };
  }

  async addBuffer(name, buf) {
    await this.addFile(name, Date.now(), buf.length, (sink) => new Promise((res, rej) => sink.end(buf, (e) => (e ? rej(e) : res()))));
  }

  async finish() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const big = e.size >= LIMIT || e.offset >= LIMIT;
      const extra = big ? Buffer.concat([u16(1), u16(24), u64(e.size), u64(e.size), u64(e.offset)]) : Buffer.alloc(0);
      await this.write(Buffer.concat([
        u32(0x02014b50), u16((3 << 8) | 45), u16(big ? 45 : 20), u16(e.flags || 0x0800), u16(0),
        u16(e.time), u16(e.date), u32(e.crc),
        u32(big ? MAX32 : e.size), u32(big ? MAX32 : e.size),
        u16(e.n.length), u16(extra.length), u16(0), u16(0), u16(0),
        u32(e.dir ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0),
        u32(big ? MAX32 : e.offset), e.n, extra,
      ]));
    }
    const cdSize = this.offset - cdStart;
    const count = this.entries.length;
    const need64 = count >= 0xffff || cdStart >= LIMIT || cdSize >= LIMIT;
    if (need64) {
      const z64Start = this.offset;
      await this.write(Buffer.concat([
        u32(0x06064b50), u64(44), u16((3 << 8) | 45), u16(45), u32(0), u32(0),
        u64(count), u64(count), u64(cdSize), u64(cdStart),
      ]));
      await this.write(Buffer.concat([u32(0x07064b50), u32(0), u64(z64Start), u32(1)]));
    }
    await this.write(Buffer.concat([
      u32(0x06054b50), u16(0), u16(0),
      u16(need64 ? 0xffff : count), u16(need64 ? 0xffff : count),
      u32(need64 ? MAX32 : cdSize), u32(need64 ? MAX32 : cdStart), u16(0),
    ]));
    await new Promise((res) => this.out.end(res));
  }
}
