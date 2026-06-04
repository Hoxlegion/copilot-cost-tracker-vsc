const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const width = 256;
const height = 256;
const bg = { r: 15, g: 23, b: 42, a: 255 };
const accent = { r: 34, g: 211, b: 238, a: 255 };
const accent2 = { r: 56, g: 189, b: 248, a: 255 };

const rowBytes = width * 4 + 1;
const raw = Buffer.alloc(rowBytes * height);

function setPixel(x, y, c) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const off = y * rowBytes + 1 + x * 4;
  raw[off] = c.r;
  raw[off + 1] = c.g;
  raw[off + 2] = c.b;
  raw[off + 3] = c.a;
}

for (let y = 0; y < height; y++) {
  raw[y * rowBytes] = 0;
  for (let x = 0; x < width; x++) {
    const t = y / (height - 1);
    const c = {
      r: Math.round(bg.r * (1 - t) + 2 * t),
      g: Math.round(bg.g * (1 - t) + 10 * t),
      b: Math.round(bg.b * (1 - t) + 30 * t),
      a: 255
    };
    setPixel(x, y, c);
  }
}

const cx = width / 2;
const cy = height / 2;
const outerR = 96;
const innerR = 70;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= innerR && d <= outerR) {
      const angle = Math.atan2(dy, dx);
      if (angle > -2.6 && angle < 2.6) {
        const blend = (Math.sin((angle + 2.6) / 5.2 * Math.PI) + 1) / 2;
        const c = {
          r: Math.round(accent.r * (1 - blend) + accent2.r * blend),
          g: Math.round(accent.g * (1 - blend) + accent2.g * blend),
          b: Math.round(accent.b * (1 - blend) + accent2.b * blend),
          a: 255
        };
        setPixel(x, y, c);
      }
    }
  }
}

for (let y = 104; y <= 152; y++) {
  for (let x = 168; x <= 188; x++) {
    setPixel(x, y, bg);
  }
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([len, name, data, crc]);
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const outPath = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(outPath, png);
console.log(`Created ${outPath}`);
