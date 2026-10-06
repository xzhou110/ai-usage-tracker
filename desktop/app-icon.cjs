// Three quota bars on a navy tile. Generated locally, with no external assets.
function createAppIcon(nativeImage) {
  const size = 32;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bar = (x >= 6 && x < 11 && y >= 17 && y < 25) ||
        (x >= 14 && x < 19 && y >= 11 && y < 25) ||
        (x >= 22 && x < 27 && y >= 6 && y < 25);
      const color = bar ? [226, 194, 106] : [55, 35, 23]; // BGRA
      const offset = (y * size + x) * 4;
      pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor: 1 });
}
module.exports = { createAppIcon };
