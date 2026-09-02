/**
 * Minimal QR code encoder.
 *
 * Written in-repo rather than pulled from npm because the need is narrow — one
 * fixed payload shape, rendered server-adjacent — and it keeps the kiosk page
 * free of external script dependencies.
 *
 * Supports byte mode with error-correction level M, automatically selecting the
 * smallest version (1..10) that fits. Our tokens are ~80 characters, well
 * inside that range.
 */

// --- Galois field arithmetic over GF(256) ---------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // AES/QR primitive polynomial
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data: number[], ecCount: number): number[] {
  const gen = generatorPoly(ecCount);
  const result = new Array(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < gen.length - 1; i++) {
      result[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return result;
}

// --- Version tables (level M only) ----------------------------------------

type VersionSpec = {
  version: number;
  /** Total data codewords available at level M. */
  dataCodewords: number;
  /** EC codewords per block. */
  ecPerBlock: number;
  /** Block structure: [count, dataCodewordsPerBlock][] */
  blocks: Array<[number, number]>;
};

const VERSIONS: VersionSpec[] = [
  { version: 1, dataCodewords: 16, ecPerBlock: 10, blocks: [[1, 16]] },
  { version: 2, dataCodewords: 28, ecPerBlock: 16, blocks: [[1, 28]] },
  { version: 3, dataCodewords: 44, ecPerBlock: 26, blocks: [[1, 44]] },
  { version: 4, dataCodewords: 64, ecPerBlock: 18, blocks: [[2, 32]] },
  { version: 5, dataCodewords: 86, ecPerBlock: 24, blocks: [[2, 43]] },
  { version: 6, dataCodewords: 108, ecPerBlock: 16, blocks: [[4, 27]] },
  { version: 7, dataCodewords: 124, ecPerBlock: 18, blocks: [[4, 31]] },
  { version: 8, dataCodewords: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]] },
  { version: 9, dataCodewords: 182, ecPerBlock: 22, blocks: [[3, 36], [2, 37]] },
  { version: 10, dataCodewords: 216, ecPerBlock: 26, blocks: [[4, 43], [1, 44]] },
];

/** Alignment-pattern centre coordinates per version. */
const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

/** Pre-computed BCH format bits for level M, masks 0..7. */
const FORMAT_BITS_M = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

/** Pre-computed version information for versions 7..10. */
const VERSION_BITS: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

// --- Encoding --------------------------------------------------------------

function toUtf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function selectVersion(byteLength: number): VersionSpec {
  for (const spec of VERSIONS) {
    // 4 bits mode + 8 or 16 bits length + payload
    const lengthBits = spec.version < 10 ? 8 : 16;
    const needed = Math.ceil((4 + lengthBits + byteLength * 8) / 8);
    if (needed <= spec.dataCodewords) return spec;
  }
  throw new Error(
    `Payload of ${byteLength} bytes exceeds the supported QR capacity.`,
  );
}

function buildDataCodewords(text: string, spec: VersionSpec): number[] {
  const bytes = toUtf8Bytes(text);
  const bits: number[] = [];

  const pushBits = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  pushBits(0b0100, 4); // byte mode
  pushBits(bytes.length, spec.version < 10 ? 8 : 16);
  for (const byte of bytes) pushBits(byte, 8);

  // Terminator, up to four zero bits.
  const capacityBits = spec.dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  }

  // Alternating pad bytes, per spec.
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < spec.dataCodewords) {
    codewords.push(PAD[padIndex++ % 2]);
  }

  return codewords;
}

/** Interleave data and EC blocks in the order the matrix expects. */
function interleave(data: number[], spec: VersionSpec): number[] {
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];

  let offset = 0;
  for (const [count, size] of spec.blocks) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(offset, offset + size);
      offset += size;
      blocks.push(block);
      ecBlocks.push(reedSolomon(block, spec.ecPerBlock));
    }
  }

  const result: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

// --- Matrix construction ---------------------------------------------------

type Matrix = { size: number; modules: Uint8Array; reserved: Uint8Array };

function createMatrix(version: number): Matrix {
  const size = version * 4 + 17;
  return {
    size,
    modules: new Uint8Array(size * size),
    reserved: new Uint8Array(size * size),
  };
}

function setModule(m: Matrix, x: number, y: number, dark: boolean, reserve = true) {
  if (x < 0 || y < 0 || x >= m.size || y >= m.size) return;
  m.modules[y * m.size + x] = dark ? 1 : 0;
  if (reserve) m.reserved[y * m.size + x] = 1;
}

function placeFinder(m: Matrix, cx: number, cy: number) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= m.size || y >= m.size) continue;
      const inRing =
        (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) ||
        (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
      const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      setModule(m, x, y, inRing || inCore);
    }
  }
}

function placeAlignment(m: Matrix, version: number) {
  const positions = ALIGNMENT_POSITIONS[version] ?? [];
  for (const cy of positions) {
    for (const cx of positions) {
      // Skip the three corners already occupied by finder patterns.
      const nearFinder =
        (cx <= 8 && cy <= 8) ||
        (cx <= 8 && cy >= m.size - 9) ||
        (cx >= m.size - 9 && cy <= 8);
      if (nearFinder) continue;

      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const isDark =
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
          setModule(m, cx + dx, cy + dy, isDark);
        }
      }
    }
  }
}

function placeTimingAndStatic(m: Matrix, version: number) {
  for (let i = 8; i < m.size - 8; i++) {
    const dark = i % 2 === 0;
    setModule(m, i, 6, dark);
    setModule(m, 6, i, dark);
  }
  // Reserve the format-information areas.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setModule(m, i, 8, false);
      setModule(m, 8, i, false);
    }
  }
  // Row 8 to the right: 8 modules. Column 8 at the bottom: only 7 — the eighth
  // position, (8, size - 8), is the dark module and must not be cleared here.
  for (let i = 0; i < 8; i++) {
    setModule(m, m.size - 1 - i, 8, false);
    if (i < 7) setModule(m, 8, m.size - 1 - i, false);
  }

  // Dark module. Always set, and reserved so data placement skips it.
  setModule(m, 8, m.size - 8, true);

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const x = i % 3;
      const y = Math.floor(i / 3);
      setModule(m, m.size - 11 + x, y, false);
      setModule(m, y, m.size - 11 + x, false);
    }
  }
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function placeData(m: Matrix, codewords: number[], mask: number) {
  let bitIndex = 0;
  let upward = true;

  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column

    for (let step = 0; step < m.size; step++) {
      const y = upward ? m.size - 1 - step : step;
      for (let c = 0; c < 2; c++) {
        const x = right - c;
        if (m.reserved[y * m.size + x]) continue;

        let dark = false;
        if (bitIndex < codewords.length * 8) {
          const byte = codewords[bitIndex >> 3];
          dark = ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex++;
        }
        if (MASKS[mask](x, y)) dark = !dark;
        m.modules[y * m.size + x] = dark ? 1 : 0;
      }
    }
    upward = !upward;
  }
}

function placeFormatInfo(m: Matrix, mask: number) {
  const bits = FORMAT_BITS_M[mask];
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;
    // Top-left, split around the timing row/column.
    if (i < 6) setModule(m, 8, i, dark);
    else if (i === 6) setModule(m, 8, 7, dark);
    else if (i === 7) setModule(m, 8, 8, dark);
    else if (i === 8) setModule(m, 7, 8, dark);
    else setModule(m, 14 - i, 8, dark);

    // Mirrored copy.
    if (i < 8) setModule(m, m.size - 1 - i, 8, dark);
    else setModule(m, 8, m.size - 15 + i, dark);
  }
}

function placeVersionInfo(m: Matrix, version: number) {
  if (version < 7) return;
  const bits = VERSION_BITS[version];
  if (bits === undefined) return;

  for (let i = 0; i < 18; i++) {
    const dark = ((bits >> i) & 1) === 1;
    const x = i % 3;
    const y = Math.floor(i / 3);
    setModule(m, m.size - 11 + x, y, dark);
    setModule(m, y, m.size - 11 + x, dark);
  }
}

// --- Mask selection --------------------------------------------------------

/**
 * ISO 18004 penalty score. Lower is better.
 *
 * Worth doing rather than pinning a mask: the payload changes every rotation
 * period, so a mask that happens to produce large uniform blocks or a decoy
 * finder pattern would show up as an intermittent, unreproducible "this one
 * won't scan" — the worst possible failure to debug from the phone end.
 */
function maskPenalty(m: Matrix): number {
  const n = m.size;
  const at = (x: number, y: number) => m.modules[y * n + x] === 1;
  let score = 0;

  // Rule 1: runs of five or more identical modules in a row or column.
  for (let i = 0; i < n; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      let prev = horizontal ? at(0, i) : at(i, 0);
      for (let j = 1; j < n; j++) {
        const cur = horizontal ? at(j, i) : at(i, j);
        if (cur === prev) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
          prev = cur;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2: 2x2 blocks of a single colour.
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) {
        score += 3;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules on a side.
  const PATTERN = [true, false, true, true, true, false, true];
  const LIGHT4 = [false, false, false, false];
  const matches = (line: boolean[], start: number, want: boolean[]) => {
    for (let k = 0; k < want.length; k++) {
      if (line[start + k] !== want[k]) return false;
    }
    return true;
  };
  for (let i = 0; i < n; i++) {
    const row: boolean[] = [];
    const col: boolean[] = [];
    for (let j = 0; j < n; j++) {
      row.push(at(j, i));
      col.push(at(i, j));
    }
    for (const line of [row, col]) {
      for (let j = 0; j + 7 <= n; j++) {
        if (!matches(line, j, PATTERN)) continue;
        const before = j >= 4 && matches(line, j - 4, LIGHT4);
        const after = j + 11 <= n && matches(line, j + 7, LIGHT4);
        if (before || after) score += 40;
      }
    }
  }

  // Rule 4: deviation of the dark-module proportion from 50%.
  let dark = 0;
  for (let i = 0; i < n * n; i++) if (m.modules[i] === 1) dark++;
  const percent = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

function buildMatrix(spec: VersionSpec, codewords: number[], mask: number): Matrix {
  const matrix = createMatrix(spec.version);
  placeFinder(matrix, 0, 0);
  placeFinder(matrix, matrix.size - 7, 0);
  placeFinder(matrix, 0, matrix.size - 7);
  placeAlignment(matrix, spec.version);
  placeTimingAndStatic(matrix, spec.version);

  placeData(matrix, codewords, mask);
  placeFormatInfo(matrix, mask);
  placeVersionInfo(matrix, spec.version);
  return matrix;
}

/**
 * Encode `text` into a boolean matrix of dark modules.
 *
 * All eight masks are built and scored; the lowest-penalty one wins, as the
 * standard requires.
 */
export function encodeQr(text: string): boolean[][] {
  const bytes = toUtf8Bytes(text);
  const spec = selectVersion(bytes.length);
  const data = buildDataCodewords(text, spec);
  const codewords = interleave(data, spec);

  let matrix = buildMatrix(spec, codewords, 0);
  let bestScore = maskPenalty(matrix);
  for (let mask = 1; mask < 8; mask++) {
    const candidate = buildMatrix(spec, codewords, mask);
    const score = maskPenalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      matrix = candidate;
    }
  }

  const result: boolean[][] = [];
  for (let y = 0; y < matrix.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < matrix.size; x++) {
      row.push(matrix.modules[y * matrix.size + x] === 1);
    }
    result.push(row);
  }
  return result;
}

/** Render an encoded matrix as a standalone SVG string. */
export function qrToSvg(text: string, options: { size?: number; margin?: number } = {}): string {
  const matrix = encodeQr(text);
  const margin = options.margin ?? 4;
  const count = matrix.length + margin * 2;
  const size = options.size ?? 320;

  let path = "";
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix.length; x++) {
      if (matrix[y][x]) path += `M${x + margin} ${y + margin}h1v1h-1z`;
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`,
    ` viewBox="0 0 ${count} ${count}" shape-rendering="crispEdges">`,
    `<rect width="${count}" height="${count}" fill="#ffffff"/>`,
    `<path d="${path}" fill="#000000"/>`,
    `</svg>`,
  ].join("");
}
