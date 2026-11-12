 // One-off: regenerate console/public PWA icons + favicon from the official logo.
const path = require('node:path');
const fs = require('node:fs');
const sharp = require(path.join(__dirname, '..', 'gateway', 'node_modules', 'sharp'));

const publicDir = path.join(__dirname, '..', 'console', 'public');
const source = path.join(publicDir, 'krynara-official-source.png');
const official = path.join(publicDir, 'krynara-official.png');

(async () => {
  // Normalize the master source to a real PNG (the original may arrive as JPEG bytes).
  await sharp(source).png().toFile(official);
  console.log('wrote krynara-official.png (normalized PNG)');

  // The logo is a wide banner. Crop a square around the eclipse mark so icons are the
  // symbol itself, not the wordmark.
  const meta = await sharp(source).metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.round((meta.width - side) / 2);
  const top = Math.round((meta.height - side) / 2);
  const mark = sharp(source).extract({ left, top, width: side, height: side });

  for (const size of [192, 512]) {
    await mark.clone().resize(size, size, { fit: 'cover' }).png().toFile(path.join(publicDir, `logo-${size}x${size}.png`));
    console.log(`wrote logo-${size}x${size}.png`);
  }
  await mark.clone().resize(64, 64, { fit: 'cover' }).png().toFile(path.join(publicDir, 'favicon.png'));
  console.log('wrote favicon.png');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
