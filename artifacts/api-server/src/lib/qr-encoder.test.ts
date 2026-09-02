/**
 * Verification for the in-repo QR encoder.
 *
 * A subtly wrong encoder is the worst kind of bug here: the kiosk renders
 * something that *looks* exactly like a QR code, and the failure only shows up
 * as a phone that refuses to scan, on site, with no diagnostic. So this file
 * does not merely round-trip through the encoder's own helpers — it re-derives
 * the parts that can be re-derived, using different algorithms:
 *
 *  - the format/version information tables are recomputed from their BCH
 *    generator polynomials and compared against the hard-coded constants;
 *  - the error-correction codewords are checked by *syndrome evaluation*
 *    (C(a^j) == 0), which shares no code path with the LFSR division the
 *    encoder uses to produce them;
 *  - the function-pattern map is written out independently from the spec's
 *    geometry rather than reusing the encoder's `reserved` array.
 *
 * What it cannot prove is that a physical scanner is happy. Scan the kiosk
 * page once with any phone camera and that question is settled for good.
 */

import { describe, expect, it } from "vitest";
import { encodeQr, qrToSvg } from "./qr-encoder";

// --- Independent GF(256) arithmetic ---------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function mul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

// --- Independent version table (level M) ----------------------------------

type Spec = { version: number; ecPerBlock: number; blocks: Array<[number, number]> };

const SPECS: Record<number, Spec> = {
  1: { version: 1, ecPerBlock: 10, blocks: [[1, 16]] },
  2: { version: 2, ecPerBlock: 16, blocks: [[1, 28]] },
  3: { version: 3, ecPerBlock: 26, blocks: [[1, 44]] },
  4: { version: 4, ecPerBlock: 18, blocks: [[2, 32]] },
  5: { version: 5, ecPerBlock: 24, blocks: [[2, 43]] },
  6: { version: 6, ecPerBlock: 16, blocks: [[4, 27]] },
  7: { version: 7, ecPerBlock: 18, blocks: [[4, 31]] },
  8: { version: 8, ecPerBlock: 22, blocks: [[2, 38], [2, 39]] },
  9: { version: 9, ecPerBlock: 22, blocks: [[3, 36], [2, 37]] },
  10: { version: 10, ecPerBlock: 26, blocks: [[4, 43], [1, 44]] },
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// --- Independent function-pattern map -------------------------------------

function isFunctionModule(x: number, y: number, version: number, n: number): boolean {
  if (x < 9 && y < 9) return true; // finder + separator + format, top-left
  if (x >= n - 8 && y < 9) return true; // top-right
  if (x < 9 && y >= n - 8) return true; // bottom-left (incl. the dark module)
  if (x === 6 || y === 6) return true; // timing
  if (version >= 7) {
    if (x >= n - 11 && x <= n - 9 && y <= 5) return true;
    if (y >= n - 11 && y <= n - 9 && x <= 5) return true;
  }
  const centres = ALIGNMENT[version] ?? [];
  for (const cy of centres) {
    for (const cx of centres) {
      const nearFinder =
        (cx <= 8 && cy <= 8) || (cx <= 8 && cy >= n - 9) || (cx >= n - 9 && cy <= 8);
      if (nearFinder) continue;
      if (Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2) return true;
    }
  }
  return false;
}

const MASK_FNS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// --- BCH recomputation of the published tables ----------------------------

function bch(data: number, generator: number, dataBits: number, totalBits: number): number {
  const ecBits = totalBits - dataBits;
  let value = data << ecBits;
  const genBitLength = 32 - Math.clz32(generator);
  for (let i = totalBits; i >= genBitLength; i--) {
    if ((value >> (i - 1)) & 1) value ^= generator << (i - genBitLength);
  }
  return (data << ecBits) | value;
}

/** Format info: 2 EC-level bits + 3 mask bits, BCH(15,5), XOR 0x5412. */
function formatBits(ecLevelBits: number, mask: number): number {
  return bch((ecLevelBits << 3) | mask, 0b101_0011_0111, 5, 15) ^ 0b101_0100_0001_0010;
}

/** Version info: 6 version bits, BCH(18,6), no masking. */
function versionBits(version: number): number {
  return bch(version, 0b1_1111_0010_0101, 6, 18);
}

// --- Decoder ---------------------------------------------------------------

type Decoded = { version: number; mask: number; text: string };

function decode(matrix: boolean[][]): Decoded {
  const n = matrix.length;
  expect((n - 17) % 4).toBe(0);
  const version = (n - 17) / 4;
  const spec = SPECS[version];
  expect(spec, `no spec for version ${version}`).toBeDefined();

  // --- format information, read from the top-left copy ---
  const formatModules: boolean[] = [];
  for (let i = 0; i < 15; i++) {
    if (i < 6) formatModules.push(matrix[i][8]);
    else if (i === 6) formatModules.push(matrix[7][8]);
    else if (i === 7) formatModules.push(matrix[8][8]);
    else if (i === 8) formatModules.push(matrix[8][7]);
    else formatModules.push(matrix[8][14 - i]);
  }
  let readFormat = 0;
  for (let i = 0; i < 15; i++) if (formatModules[i]) readFormat |= 1 << i;

  // Level M is 0b00; find the mask whose published word matches.
  let mask = -1;
  for (let candidate = 0; candidate < 8; candidate++) {
    if (formatBits(0b00, candidate) === readFormat) mask = candidate;
  }
  expect(mask, `format word 0x${readFormat.toString(16)} is not a valid level-M word`)
    .toBeGreaterThanOrEqual(0);

  // The mirrored copy must carry the same word.
  let mirrored = 0;
  for (let i = 0; i < 15; i++) {
    const bit = i < 8 ? matrix[8][n - 1 - i] : matrix[n - 15 + i][8];
    if (bit) mirrored |= 1 << i;
  }
  expect(mirrored).toBe(readFormat);

  // --- version information ---
  if (version >= 7) {
    let read = 0;
    for (let i = 0; i < 18; i++) {
      if (matrix[Math.floor(i / 3)][n - 11 + (i % 3)]) read |= 1 << i;
    }
    expect(read).toBe(versionBits(version));
  }

  // --- data modules, in zigzag order, unmasked ---
  const bits: number[] = [];
  let up = true;
  for (let col = n - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5;
    for (let step = 0; step < n; step++) {
      const y = up ? n - 1 - step : step;
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        if (isFunctionModule(x, y, version, n)) continue;
        const value = MASK_FNS[mask](x, y) ? !matrix[y][x] : matrix[y][x];
        bits.push(value ? 1 : 0);
      }
    }
    up = !up;
  }

  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
    stream.push(byte);
  }

  // --- de-interleave into blocks ---
  const blockSizes: number[] = [];
  for (const [count, size] of spec.blocks) {
    for (let i = 0; i < count; i++) blockSizes.push(size);
  }
  const totalData = blockSizes.reduce((a, b) => a + b, 0);
  const dataBlocks: number[][] = blockSizes.map(() => []);
  let cursor = 0;
  const maxSize = Math.max(...blockSizes);
  for (let i = 0; i < maxSize; i++) {
    for (let b = 0; b < blockSizes.length; b++) {
      if (i < blockSizes[b]) dataBlocks[b].push(stream[cursor++]);
    }
  }
  const ecBlocks: number[][] = blockSizes.map(() => []);
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let b = 0; b < blockSizes.length; b++) ecBlocks[b].push(stream[cursor++]);
  }
  expect(cursor).toBe(totalData + blockSizes.length * spec.ecPerBlock);

  // --- syndrome check: every block must be a valid RS codeword ---
  for (let b = 0; b < blockSizes.length; b++) {
    const codeword = [...dataBlocks[b], ...ecBlocks[b]];
    for (let j = 0; j < spec.ecPerBlock; j++) {
      let s = 0;
      for (const byte of codeword) s = mul(s, EXP[j]) ^ byte;
      expect(s, `block ${b} syndrome ${j} is non-zero — corrupt EC codewords`).toBe(0);
    }
  }

  // --- payload ---
  const data = dataBlocks.flat();
  const dataBits: number[] = [];
  for (const byte of data) {
    for (let b = 7; b >= 0; b--) dataBits.push((byte >> b) & 1);
  }
  const take = (count: number) => {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | dataBits.shift()!;
    return value;
  };

  expect(take(4), "expected byte mode").toBe(0b0100);
  const length = take(version < 10 ? 8 : 16);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = take(8);

  return { version, mask, text: new TextDecoder().decode(bytes) };
}

// --- Tests -----------------------------------------------------------------

describe("BCH tables", () => {
  it("recomputes the level-M format words", () => {
    // Independently derived; these are the values the encoder hard-codes.
    const expected = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
    for (let mask = 0; mask < 8; mask++) {
      expect(formatBits(0b00, mask)).toBe(expected[mask]);
    }
  });

  it("recomputes the version information words", () => {
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(8)).toBe(0x085bc);
    expect(versionBits(9)).toBe(0x09a99);
    expect(versionBits(10)).toBe(0x0a4d3);
  });
});

describe("encodeQr", () => {
  it("places the three finder patterns and their separators", () => {
    const m = encodeQr("hello");
    const n = m.length;
    for (const [ox, oy] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ]) {
      // 7x7: dark ring, light gap, 3x3 dark core.
      for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
          const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6;
          const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          expect(m[oy + dy][ox + dx]).toBe(ring || core);
        }
      }
    }
    // Separators are light.
    for (let i = 0; i < 8; i++) {
      expect(m[7][i]).toBe(false);
      expect(m[i][7]).toBe(false);
    }
  });

  it("lays down alternating timing patterns", () => {
    const m = encodeQr("hello");
    for (let i = 8; i < m.length - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
  });

  it("sets the mandatory dark module", () => {
    const m = encodeQr("hello");
    expect(m[m.length - 8][8]).toBe(true);
  });

  it("round-trips a short payload", () => {
    const text = "v1.abc.123.deadbeef";
    const decoded = decode(encodeQr(text));
    expect(decoded.text).toBe(text);
  });

  it("round-trips a realistic rotating QR token", () => {
    const text = "v1.3f2b9c1e-4d5a-4c8b-9a1e-7c2d8e5f0a3b.58412093.9f3c1d7e8a2b4c6d";
    const decoded = decode(encodeQr(text));
    expect(decoded.text).toBe(text);
  });

  it("round-trips across every supported version boundary", () => {
    // Lengths chosen to walk versions 1..10, exercising single-block,
    // multi-block, and mixed-block-size interleaving, plus the switch from an
    // 8-bit to a 16-bit character-count indicator at version 10.
    for (const length of [1, 10, 14, 20, 26, 40, 62, 84, 106, 122, 150, 178, 200]) {
      const text = "A".repeat(length);
      const decoded = decode(encodeQr(text));
      expect(decoded.text, `payload of ${length} chars`).toBe(text);
    }
  });

  it("round-trips multi-byte UTF-8", () => {
    const text = "ሰላም አዲስ አበባ — ✓";
    expect(decode(encodeQr(text)).text).toBe(text);
  });

  it("picks the smallest version that fits", () => {
    expect(encodeQr("A".repeat(14)).length).toBe(21); // version 1
    expect(encodeQr("A".repeat(15)).length).toBe(25); // version 2
  });

  it("refuses payloads beyond the supported capacity", () => {
    expect(() => encodeQr("A".repeat(400))).toThrow(/capacity/);
  });

  it("renders SVG with a quiet zone", () => {
    const svg = qrToSvg("hello", { size: 200, margin: 4 });
    const modules = encodeQr("hello").length;
    expect(svg).toContain(`viewBox="0 0 ${modules + 8} ${modules + 8}"`);
    expect(svg).toContain('width="200"');
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});
