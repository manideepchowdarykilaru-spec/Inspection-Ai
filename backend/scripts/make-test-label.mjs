/**
 * Builds a realistic raster package label so the OCR pipeline can be tested
 * against actual pixels rather than the vector demo corpus.
 */
import { Jimp, loadFont } from 'jimp';
import { SANS_16_BLACK, SANS_32_BLACK, SANS_64_BLACK } from 'jimp/fonts';
import { writeFileSync } from 'node:fs';

const W = 900;
const H = 1250;

const img = new Jimp({ width: W, height: H, color: 0xffffffff });

const f64 = await loadFont(SANS_64_BLACK);
const f32 = await loadFont(SANS_32_BLACK);
const f16 = await loadFont(SANS_16_BLACK);

const lines = [
  [f64, 40, 60, 'SHAKTI GOLD'],
  [f32, 40, 150, 'Toor Dal (Arhar)'],
  [f16, 40, 205, 'Unpolished  Premium Grade'],

  [f16, 40, 300, 'NET QUANTITY'],
  [f32, 40, 330, '1 kg'],

  [f16, 480, 300, 'MAXIMUM RETAIL PRICE'],
  [f32, 480, 330, 'MRP Rs. 182.00'],
  [f16, 480, 380, '(inclusive of all taxes)'],

  [f16, 40, 450, 'MANUFACTURED AND PACKED BY'],
  [f32, 40, 480, 'Shakti Agro Mills Pvt. Ltd.'],
  [f16, 40, 530, 'Plot 27, Food Park, Sanand Road'],
  [f16, 40, 560, 'Ahmedabad, Gujarat - 382110, India'],

  [f16, 40, 640, 'MONTH AND YEAR OF PACKING'],
  [f32, 40, 670, '07/2026'],

  [f16, 480, 640, 'BEST BEFORE'],
  [f32, 480, 670, '09/2027'],

  [f16, 40, 760, 'CONSUMER CARE'],
  [f16, 40, 795, 'Consumer Cell, Shakti Agro Mills Pvt. Ltd.'],
  [f16, 40, 825, 'Toll Free 1800-233-7788'],
  [f16, 40, 855, 'care@shaktiagro.example'],

  [f16, 40, 930, 'COUNTRY OF ORIGIN'],
  [f32, 40, 960, 'India'],

  [f16, 480, 930, 'FSSAI LIC. NO.'],
  [f32, 480, 960, '10019043002277'],

  [f16, 40, 1060, 'BATCH NO.'],
  [f32, 40, 1090, 'SG-2607-D12'],

  [f16, 480, 1060, 'BARCODE'],
  [f32, 480, 1090, '8901234512345'],
];

for (const [font, x, y, text] of lines) {
  img.print({ font, x, y, text });
}

const buffer = await img.getBuffer('image/png');
writeFileSync(new URL('../../scratch/test-label.png', import.meta.url), buffer);
console.log(`wrote test-label.png  ${W}x${H}  ${buffer.length} bytes`);
