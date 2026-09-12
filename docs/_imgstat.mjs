// 统计 PNG 亮度分布：判断"截图全黑"还是"深色主题本身暗"
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const file = process.argv[2];
// 用 playwright 自带的 pngjs 不方便，直接借 sharp? 没有依赖 -> 用 zlib 手动解 PNG
import zlib from 'node:zlib';

const buf = readFileSync(file);
let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
  if (type === 'IDAT') idat.push(data);
  pos += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
const stride = w * ch;
let prev = Buffer.alloc(stride);
let i = 0;
let sum = 0, bright = 0, mid = 0, dark = 0, max = 0;
const rows = [];
for (let y = 0; y < h; y++) {
  const ft = raw[i++];
  const line = Buffer.from(raw.subarray(i, i + stride)); i += stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
    if (ft === 1) line[x] = (line[x] + a) & 255;
    else if (ft === 2) line[x] = (line[x] + b) & 255;
    else if (ft === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
    else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
  }
  for (let x = 0; x < w; x++) {
    const o = x * ch;
    const lum = ch >= 3 ? 0.299 * line[o] + 0.587 * line[o + 1] + 0.114 * line[o + 2] : line[o];
    sum += lum; if (lum > max) max = lum;
    if (lum > 90) bright++; else if (lum > 30) mid++; else dark++;
  }
  prev = line;
}
const total = w * h;
const pct = (n) => (100 * n / total).toFixed(2) + '%';
console.log(JSON.stringify({ file: path.basename(file), w, h, ch, mean: +(sum / total).toFixed(1), max: +max.toFixed(0), brightPx: pct(bright), midPx: pct(mid), darkPx: pct(dark) }, null, 1));
