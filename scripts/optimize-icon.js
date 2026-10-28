#!/usr/bin/env node
/**
 * Resize the extension icon to a Marketplace-friendly PNG.
 *
 * VS Code recommends a square PNG of at least 128x128 (256x256 is ideal) and
 * anything above ~1 MB needlessly inflates the VSIX. This script decodes the
 * source artwork, box-downsamples it and re-encodes it with maximum
 * compression - using only Node's built-in zlib, so no image dependency.
 *
 * Usage: npm run optimize:icon
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'images/icon-source.png');
const target = path.join(root, 'icon.png');
const TARGET_SIZE = 256;

function readChunks(buffer) {
    const chunks = [];
    let offset = 8; // skip the PNG signature
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        chunks.push({ type, data });
        offset += length + 12;
        if (type === 'IEND') {
            break;
        }
    }
    return chunks;
}

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let crc = -1;
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
}

function unfilter(raw, width, height, bytesPerPixel) {
    const stride = width * bytesPerPixel;
    const output = Buffer.alloc(stride * height);
    let rawOffset = 0;

    for (let y = 0; y < height; y++) {
        const filterType = raw[rawOffset++];
        const rowStart = y * stride;
        const previousRowStart = (y - 1) * stride;

        for (let x = 0; x < stride; x++) {
            const value = raw[rawOffset + x];
            const left = x >= bytesPerPixel ? output[rowStart + x - bytesPerPixel] : 0;
            const up = y > 0 ? output[previousRowStart + x] : 0;
            const upLeft = y > 0 && x >= bytesPerPixel ? output[previousRowStart + x - bytesPerPixel] : 0;

            let result;
            switch (filterType) {
                case 0:
                    result = value;
                    break;
                case 1:
                    result = value + left;
                    break;
                case 2:
                    result = value + up;
                    break;
                case 3:
                    result = value + ((left + up) >> 1);
                    break;
                case 4: {
                    const p = left + up - upLeft;
                    const pa = Math.abs(p - left);
                    const pb = Math.abs(p - up);
                    const pc = Math.abs(p - upLeft);
                    const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
                    result = value + predictor;
                    break;
                }
                default:
                    throw new Error(`Unsupported PNG filter type: ${filterType}`);
            }
            output[rowStart + x] = result & 0xff;
        }
        rawOffset += stride;
    }

    return output;
}

function averageResize(pixels, width, height, bytesPerPixel, newWidth, newHeight) {
    const output = Buffer.alloc(newWidth * newHeight * bytesPerPixel);
    const scaleX = width / newWidth;
    const scaleY = height / newHeight;

    for (let y = 0; y < newHeight; y++) {
        const startY = Math.floor(y * scaleY);
        const endY = Math.min(Math.ceil((y + 1) * scaleY), height);
        for (let x = 0; x < newWidth; x++) {
            const startX = Math.floor(x * scaleX);
            const endX = Math.min(Math.ceil((x + 1) * scaleX), width);
            const totals = new Array(bytesPerPixel).fill(0);
            let count = 0;

            for (let sy = startY; sy < endY; sy++) {
                for (let sx = startX; sx < endX; sx++) {
                    const index = (sy * width + sx) * bytesPerPixel;
                    for (let c = 0; c < bytesPerPixel; c++) {
                        totals[c] += pixels[index + c];
                    }
                    count++;
                }
            }

            const outIndex = (y * newWidth + x) * bytesPerPixel;
            for (let c = 0; c < bytesPerPixel; c++) {
                output[outIndex + c] = count > 0 ? Math.round(totals[c] / count) : 0;
            }
        }
    }

    return output;
}

function encodePng(pixels, width, height, bytesPerPixel) {
    const stride = width * bytesPerPixel;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter type: none
        pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; // bit depth
    header[9] = bytesPerPixel === 4 ? 6 : 2; // colour type: RGBA / RGB
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function main() {
    if (!fs.existsSync(source)) {
        console.error(`Source icon not found: ${source}`);
        process.exitCode = 1;
        return;
    }

    const buffer = fs.readFileSync(source);
    const chunks = readChunks(buffer);
    const ihdr = chunks.find((entry) => entry.type === 'IHDR');
    if (!ihdr) {
        console.error('Source is not a PNG file (no IHDR chunk).');
        process.exitCode = 1;
        return;
    }

    const width = ihdr.data.readUInt32BE(0);
    const height = ihdr.data.readUInt32BE(4);
    const bitDepth = ihdr.data[8];
    const colorType = ihdr.data[9];
    const interlace = ihdr.data[12];

    if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
        console.error(
            `Unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}). ` +
                'Re-save the artwork as a non-interlaced 8-bit RGB/RGBA PNG.',
        );
        process.exitCode = 1;
        return;
    }

    const bytesPerPixel = colorType === 6 ? 4 : 3;
    const idat = Buffer.concat(chunks.filter((entry) => entry.type === 'IDAT').map((entry) => entry.data));
    const raw = zlib.inflateSync(idat);
    const pixels = unfilter(raw, width, height, bytesPerPixel);
    const resized = averageResize(pixels, width, height, bytesPerPixel, TARGET_SIZE, TARGET_SIZE);
    const encoded = encodePng(resized, TARGET_SIZE, TARGET_SIZE, bytesPerPixel);

    fs.writeFileSync(target, encoded);
    console.log(
        `icon.png written: ${width}x${height} -> ${TARGET_SIZE}x${TARGET_SIZE}, ` +
            `${Math.round(buffer.length / 1024)} KB -> ${Math.round(encoded.length / 1024)} KB`,
    );
}

main();
