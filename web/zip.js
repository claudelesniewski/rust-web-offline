// A minimal ZIP writer (stored, uncompressed entries) for "Export all".

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 (as used by ZIP and PNG) of `bytes`. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a ZIP archive from `files` ([{ name, content: string }]). */
export function zip(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    // Fields shared by the local and central headers, from "version needed" on.
    const common = (v) => {
      v.setUint16(0, 20, true); // version needed: 2.0
      v.setUint16(2, 0x0800, true); // flags: names are UTF-8
      v.setUint16(4, 0, true); // method: stored
      v.setUint16(6, dosTime, true);
      v.setUint16(8, dosDate, true);
      v.setUint32(10, crc, true);
      v.setUint32(14, data.length, true);
      v.setUint32(18, data.length, true);
      v.setUint16(22, name.length, true);
    };
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    common(new DataView(local.buffer, 4));
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    common(new DataView(central.buffer, 6));
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const size = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end], { type: "application/zip" });
}
