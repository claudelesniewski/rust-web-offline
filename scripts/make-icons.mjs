// Draws the app icon (a white cog on rust orange) as PNGs, so no binary
// image needs to be committed. Usage: node make-icons.mjs <out-dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { crc32 } from "../web/zip.js";

const BG = [183, 65, 14];
const FG = [255, 255, 255];
const TEETH = 8;

/** Is the point (x, y), in units of the icon's size centred on 0, inside the cog? */
function inCog(x, y) {
  const r = Math.hypot(x, y);
  const turns = (Math.atan2(y, x) / (2 * Math.PI)) * TEETH;
  const tooth = turns - Math.floor(turns) < 0.5;
  return r > 0.1 && r < (tooth ? 0.33 : 0.26);
}

function png(size) {
  const SS = 4; // supersampling per axis
  const rows = Buffer.alloc(size * (1 + size * 3));
  for (let py = 0; py < size; py++) {
    rows[py * (1 + size * 3)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inCog((px + (sx + 0.5) / SS) / size - 0.5, (py + (sy + 0.5) / SS) / size - 0.5)) hits++;
        }
      }
      const a = hits / (SS * SS);
      for (let c = 0; c < 3; c++) {
        rows[py * (1 + size * 3) + 1 + px * 3 + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
      }
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = process.argv[2];
mkdirSync(out, { recursive: true });
for (const size of [192, 512]) writeFileSync(`${out}/icon-${size}.png`, png(size));
