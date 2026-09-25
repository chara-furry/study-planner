/**
 * font.js — reads the font the PDF report is written in, so pdf.js can embed
 * it and write any English, German or Traditional Chinese text as real text.
 *
 * You should not need to change this file. pdf.js uses it like so:
 *
 *   const font = await loadPdfFont();
 *   const regular = font.instance(400);      // or 700 for bold
 *   const glyph = font.glyphFor("學".codePointAt(0));
 *   regular.advance(glyph);                  // its width, in font units
 *   regular.inkBounds(glyph);                // where its shape starts and ends
 *   font.proportional.get(glyph);            // its narrower Western version, if any
 *   regular.subset([glyph, ...]);            // a small font file with just those
 *
 * ---------------------------------------------------------------------------
 * About the font
 *
 * It's Noto Sans TC (see fonts/README.md), a TrueType font whose letters are
 * outlines ("glyphs") numbered from 0. Its "cmap" table says which glyph draws
 * which character, "hmtx" how wide each glyph is, and "glyf" the outlines.
 *
 * It's also a *variable* font: it holds one weight (Thin) plus, in "gvar",
 * how far each outline point moves to reach the other weights, and in "HVAR"
 * how each width changes. instance() applies those movements to make Regular
 * or Bold, for just the glyphs a report uses.
 *
 * A PDF can then embed a cut-down copy of the font with only those glyphs,
 * keeping their numbers (the unused ones are left empty), which is what
 * subset() builds.
 */

const FONT_SCRIPT = "fonts/noto-sans-tc.js";

let fontPromise = null;

/** Loads and reads the font, once. Returns a Promise of the font. */
function loadPdfFont() {
  if (!fontPromise) {
    fontPromise = (async () => {
      if (!window.PDF_FONT_DATA) await loadScript(FONT_SCRIPT);
      const packed = Uint8Array.from(atob(window.PDF_FONT_DATA), (char) => char.charCodeAt(0));
      delete window.PDF_FONT_DATA; // the unpacked copy below is all that's needed
      const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip"));
      return readFont(await new Response(stream).arrayBuffer());
    })();
    fontPromise.catch(() => { fontPromise = null; }); // let a later export try again
  }
  return fontPromise;
}

/** Adds a <script> to the page and waits for it to run. */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = el("script", { src });
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(script);
  });
}

// ------------------------------------------------------ reading the font

function readFont(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const u8 = (at) => view.getUint8(at);
  const u16 = (at) => view.getUint16(at);
  const i16 = (at) => view.getInt16(at);
  const u32 = (at) => view.getUint32(at);
  const f2dot14 = (at) => view.getInt16(at) / 16384;

  // Where each table starts: { head: { offset, length }, ... }
  const tables = {};
  for (let i = 0; i < u16(4); i++) {
    const at = 12 + 16 * i;
    tables[String.fromCharCode(...bytes.subarray(at, at + 4))] = { offset: u32(at + 8), length: u32(at + 12) };
  }
  const table = (tag) => tables[tag]?.offset;
  const tableBytes = (tag) => bytes.subarray(table(tag), table(tag) + tables[tag].length);

  const head = table("head");
  const unitsPerEm = u16(head + 18);
  const longLoca = i16(head + 50) === 1;
  const numGlyphs = u16(table("maxp") + 4);
  const numberOfHMetrics = u16(table("hhea") + 34);
  const os2 = table("OS/2");

  const glyphStart = (glyph) => table("glyf") +
    (longLoca ? u32(table("loca") + 4 * glyph) : 2 * u16(table("loca") + 2 * glyph));
  const glyphLength = (glyph) => glyphStart(glyph + 1) - glyphStart(glyph);
  const thinAdvance = (glyph) => u16(table("hmtx") + 4 * Math.min(glyph, numberOfHMetrics - 1));

  // ---- which glyph draws which character (cmap format 12)

  const groups = []; // [firstChar, lastChar, firstGlyph], sorted
  const cmap = table("cmap");
  for (let i = 0; i < u16(cmap + 2); i++) {
    const sub = cmap + u32(cmap + 8 + 8 * i);
    if (u16(sub) !== 12) continue;
    for (let g = 0; g < u32(sub + 12); g++) {
      const at = sub + 16 + 12 * g;
      groups.push([u32(at), u32(at + 4), u32(at + 8)]);
    }
    break;
  }

  /** The glyph that draws a character (a code point), or 0 if the font has none. */
  function glyphFor(codePoint) {
    let low = 0;
    let high = groups.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const [first, last, glyph] = groups[mid];
      if (codePoint < first) high = mid - 1;
      else if (codePoint > last) low = mid + 1;
      else return glyph + codePoint - first;
    }
    return 0;
  }

  // ---- weights: from a weight like 700 to the font's -1..1 scale

  const axes = []; // [{ tag, min, default, max }]
  if (table("fvar")) {
    const fvar = table("fvar");
    for (let i = 0; i < u16(fvar + 8); i++) {
      const at = fvar + u16(fvar + 4) + i * u16(fvar + 10);
      axes.push({
        tag: String.fromCharCode(...bytes.subarray(at, at + 4)),
        min: view.getInt32(at + 4) / 65536,
        default: view.getInt32(at + 8) / 65536,
        max: view.getInt32(at + 12) / 65536,
      });
    }
  }

  // avar bends that scale per axis: pairs of [from, to].
  const avarMaps = [];
  if (table("avar")) {
    let at = table("avar") + 8;
    for (let a = 0; a < u16(table("avar") + 6); a++) {
      const pairs = [];
      for (let p = 0; p < u16(at); p++) pairs.push([f2dot14(at + 2 + 4 * p), f2dot14(at + 4 + 4 * p)]);
      avarMaps.push(pairs);
      at += 2 + 4 * pairs.length;
    }
  }

  function coordinatesFor(weight) {
    return axes.map((axis, a) => {
      const value = axis.tag === "wght" ? Math.min(axis.max, Math.max(axis.min, weight)) : axis.default;
      let n = value < axis.default ? (value - axis.default) / (axis.default - axis.min)
        : value > axis.default ? (value - axis.default) / (axis.max - axis.default) : 0;
      const pairs = avarMaps[a];
      if (pairs && pairs.length) {
        for (let p = 1; p < pairs.length; p++) {
          const [from0, to0] = pairs[p - 1];
          const [from1, to1] = pairs[p];
          if (n <= from1) {
            n = from1 === from0 ? to0 : to0 + (n - from0) * (to1 - to0) / (from1 - from0);
            break;
          }
        }
      }
      return n;
    });
  }

  /**
   * How much of a variation applies at `coords`: 1 at its peak, fading to 0
   * at its edges. Same rule for gvar and HVAR.
   */
  function regionScalar(coords, peaks, starts, ends) {
    let scalar = 1;
    coords.forEach((coord, a) => {
      const peak = peaks[a];
      if (peak === 0) return;
      const start = starts ? starts[a] : Math.min(peak, 0);
      const end = ends ? ends[a] : Math.max(peak, 0);
      if (start > peak || peak > end || (start < 0 && end > 0)) return;
      if (coord === peak) return;
      if (coord <= start || coord >= end) { scalar = 0; return; }
      scalar *= coord < peak ? (coord - start) / (peak - start) : (end - coord) / (end - peak);
    });
    return scalar;
  }

  // ---- outlines

  /**
   * A glyph's outline: { contours: [lastPointIndex, ...], points: [{ x, y, on }] }
   * for a simple glyph, or { components: [{ glyph, flags, dx, dy, transform }] }
   * for one built from other glyphs (like "Ä" from "A" and "¨"). Null if empty.
   */
  function readGlyph(glyph) {
    if (glyphLength(glyph) === 0) return null;
    const start = glyphStart(glyph);
    const contourCount = i16(start);

    if (contourCount < 0) {
      const components = [];
      let at = start + 10;
      let flags;
      do {
        flags = u16(at);
        const component = { glyph: u16(at + 2), flags };
        at += 4;
        if (flags & 0x0001) { // arguments are 16-bit
          component.dx = flags & 0x0002 ? i16(at) : u16(at);
          component.dy = flags & 0x0002 ? i16(at + 2) : u16(at + 2);
          at += 4;
        } else {
          component.dx = flags & 0x0002 ? view.getInt8(at) : u8(at);
          component.dy = flags & 0x0002 ? view.getInt8(at + 1) : u8(at + 1);
          at += 2;
        }
        const scaleLength = flags & 0x0008 ? 2 : flags & 0x0040 ? 4 : flags & 0x0080 ? 8 : 0;
        component.transform = bytes.slice(at, at + scaleLength); // copied as is
        at += scaleLength;
        components.push(component);
      } while (flags & 0x0020); // more components follow
      return { components };
    }

    const contours = [];
    for (let c = 0; c < contourCount; c++) contours.push(u16(start + 10 + 2 * c));
    const pointCount = contourCount ? contours[contourCount - 1] + 1 : 0;
    let at = start + 10 + 2 * contourCount;
    at += 2 + u16(at); // skip the hinting instructions

    const flags = [];
    while (flags.length < pointCount) {
      const flag = u8(at++);
      flags.push(flag);
      if (flag & 0x08) for (let r = u8(at++); r > 0; r--) flags.push(flag); // repeated
    }
    const points = flags.map((flag) => ({ x: 0, y: 0, on: Boolean(flag & 0x01) }));
    for (const [axis, shortBit, sameBit] of [["x", 0x02, 0x10], ["y", 0x04, 0x20]]) {
      let value = 0;
      flags.forEach((flag, p) => {
        if (flag & shortBit) value += (flag & sameBit ? 1 : -1) * u8(at++);
        else if (!(flag & sameBit)) { value += i16(at); at += 2; }
        points[p][axis] = value;
      });
    }
    return { contours, points };
  }

  // ---- gvar: how outline points move between weights

  const gvar = table("gvar");

  /**
   * How far each of a glyph's `pointCount` points moves at `coords`, as
   * { dx: [...], dy: [...] }. For a glyph built from others, its "points" are
   * its components' positions. `outline` is needed to fill in points a
   * variation leaves out (see inferDeltas).
   */
  function pointDeltas(glyph, pointCount, coords, outline) {
    const dx = new Float64Array(pointCount);
    const dy = new Float64Array(pointCount);
    if (!gvar) return { dx, dy };

    const axisCount = u16(gvar + 4);
    const sharedTuples = gvar + u32(gvar + 8);
    const longOffsets = u16(gvar + 14) & 1;
    const dataArray = gvar + u32(gvar + 16);
    const offset = (g) => longOffsets ? u32(gvar + 20 + 4 * g) : 2 * u16(gvar + 20 + 2 * g);
    const start = dataArray + offset(glyph);
    if (offset(glyph + 1) === offset(glyph)) return { dx, dy };

    const tupleCount = u16(start) & 0x0fff;
    let data = start + u16(start + 2);
    let sharedPoints = null;
    if (u16(start) & 0x8000) [sharedPoints, data] = readPointNumbers(data);

    let header = start + 4;
    for (let t = 0; t < tupleCount; t++) {
      const size = u16(header);
      const index = u16(header + 2);
      header += 4;
      const readTuple = (at) => Array.from({ length: axisCount }, (_, a) => f2dot14(at + 2 * a));
      let peaks;
      if (index & 0x8000) { peaks = readTuple(header); header += 2 * axisCount; }
      else peaks = readTuple(sharedTuples + (index & 0x0fff) * 2 * axisCount);
      let starts = null;
      let ends = null;
      if (index & 0x4000) {
        starts = readTuple(header);
        ends = readTuple(header + 2 * axisCount);
        header += 4 * axisCount;
      }

      const tupleData = data;
      data += size;
      const scalar = regionScalar(coords, peaks, starts, ends);
      if (scalar === 0) continue;

      let at = tupleData;
      let points = sharedPoints;
      if (index & 0x2000) [points, at] = readPointNumbers(at);
      const count = points ? points.length : pointCount;
      let xs;
      let ys;
      [xs, at] = readDeltas(at, count);
      [ys, at] = readDeltas(at, count);

      if (!points) {
        for (let p = 0; p < pointCount; p++) { dx[p] += scalar * xs[p]; dy[p] += scalar * ys[p]; }
      } else {
        const tx = new Float64Array(pointCount);
        const ty = new Float64Array(pointCount);
        const touched = new Array(pointCount).fill(false);
        points.forEach((p, i) => {
          if (p >= pointCount) return;
          tx[p] = xs[i];
          ty[p] = ys[i];
          touched[p] = true;
        });
        if (outline?.contours) inferDeltas(outline, tx, ty, touched);
        for (let p = 0; p < pointCount; p++) { dx[p] += scalar * tx[p]; dy[p] += scalar * ty[p]; }
      }
    }
    return { dx, dy };
  }

  // A list of point numbers, packed; null means "every point".
  function readPointNumbers(at) {
    let count = u8(at++);
    if (count === 0) return [null, at];
    if (count & 0x80) count = ((count & 0x7f) << 8) | u8(at++);
    const points = [];
    let last = 0;
    while (points.length < count) {
      const control = u8(at++);
      const words = control & 0x80;
      for (let r = (control & 0x7f) + 1; r > 0 && points.length < count; r--) {
        last += words ? u16(at) : u8(at);
        at += words ? 2 : 1;
        points.push(last);
      }
    }
    return [points, at];
  }

  // A list of movements, packed in runs of zeros, bytes or 16-bit numbers.
  function readDeltas(at, count) {
    const deltas = [];
    while (deltas.length < count) {
      const control = u8(at++);
      for (let r = (control & 0x3f) + 1; r > 0 && deltas.length < count; r--) {
        if (control & 0x80) deltas.push(0);
        else if (control & 0x40) { deltas.push(i16(at)); at += 2; }
        else deltas.push(view.getInt8(at++));
      }
    }
    return [deltas, at];
  }

  /**
   * A variation may give movements for only some points of an outline; the
   * rest are worked out from their neighbors on the same contour, the way the
   * OpenType spec describes ("interpolate untouched points").
   */
  function inferDeltas({ contours, points }, dx, dy, touched) {
    let first = 0;
    for (const last of contours) {
      const moved = [];
      for (let p = first; p <= last; p++) if (touched[p]) moved.push(p);
      if (moved.length === 1) {
        for (let p = first; p <= last; p++) if (!touched[p]) { dx[p] = dx[moved[0]]; dy[p] = dy[moved[0]]; }
      } else if (moved.length > 1) {
        moved.forEach((from, i) => {
          const to = moved[(i + 1) % moved.length];
          for (let p = from + 1; p !== to; p++) {
            if (p > last) { p = first - 1; continue; } // wrap round the contour
            dx[p] = interpolate(points[p].x, points[from].x, points[to].x, dx[from], dx[to]);
            dy[p] = interpolate(points[p].y, points[from].y, points[to].y, dy[from], dy[to]);
          }
        });
      }
      first = last + 1;
    }
  }

  function interpolate(value, a, b, deltaA, deltaB) {
    if (a === b) return deltaA === deltaB ? deltaA : 0;
    const [low, high, deltaLow, deltaHigh] = a < b ? [a, b, deltaA, deltaB] : [b, a, deltaB, deltaA];
    if (value <= low) return deltaLow;
    if (value >= high) return deltaHigh;
    return deltaLow + (value - low) * (deltaHigh - deltaLow) / (high - low);
  }

  // ---- HVAR: how widths change between weights

  const hvar = table("HVAR");

  function advanceDelta(glyph, coords) {
    if (!hvar) return 0;
    const store = hvar + u32(hvar + 4);
    const mapping = u32(hvar + 8);

    let outer = 0;
    let inner = glyph;
    if (mapping) {
      const map = hvar + mapping;
      const format = u8(map);
      const entryFormat = u8(map + 1);
      const mapCount = format === 0 ? u16(map + 2) : u32(map + 2);
      const entrySize = ((entryFormat & 0x30) >> 4) + 1;
      const innerBits = (entryFormat & 0x0f) + 1;
      const at = map + (format === 0 ? 4 : 6) + entrySize * Math.min(glyph, mapCount - 1);
      let entry = 0;
      for (let b = 0; b < entrySize; b++) entry = (entry << 8) | u8(at + b);
      outer = entry >>> innerBits;
      inner = entry & ((1 << innerBits) - 1);
    }

    const regions = store + u32(store + 2);
    const axisCount = u16(regions);
    const data = store + u32(store + 8 + 4 * outer);
    const itemCount = u16(data);
    if (inner >= itemCount) return 0;
    const longWords = u16(data + 2) & 0x8000;
    const wordCount = u16(data + 2) & 0x7fff;
    const regionCount = u16(data + 4);
    const rowSize = longWords ? 4 * wordCount + 2 * (regionCount - wordCount) : 2 * wordCount + (regionCount - wordCount);
    let at = data + 6 + 2 * regionCount + inner * rowSize;

    let delta = 0;
    for (let r = 0; r < regionCount; r++) {
      let value;
      if (r < wordCount) { value = longWords ? view.getInt32(at) : i16(at); at += longWords ? 4 : 2; }
      else { value = longWords ? i16(at) : view.getInt8(at); at += longWords ? 2 : 1; }
      const region = regions + 4 + u16(data + 6 + 2 * r) * axisCount * 6;
      const tuple = (k) => Array.from({ length: axisCount }, (_, a) => f2dot14(region + a * 6 + k * 2));
      delta += value * regionScalar(coords, tuple(1), tuple(0), tuple(2));
    }
    return delta;
  }

  // ---- one weight of the font

  /**
   * The font at one weight (400 regular, 700 bold): each glyph's width, and
   * a cut-down font file holding just the glyphs given.
   */
  function instance(weight) {
    const coords = coordinatesFor(weight);
    const advances = new Map();
    const outlines = new Map(); // glyph -> { contours, points } or { components }, moved to this weight

    function advance(glyph) {
      if (!advances.has(glyph)) advances.set(glyph, Math.round(thinAdvance(glyph) + advanceDelta(glyph, coords)));
      return advances.get(glyph);
    }

    function outline(glyph) {
      if (!outlines.has(glyph)) {
        const original = readGlyph(glyph);
        let moved = original;
        if (original?.points) {
          const { dx, dy } = pointDeltas(glyph, original.points.length + 4, coords, original);
          moved = {
            contours: original.contours,
            points: original.points.map((p, i) => ({ x: Math.round(p.x + dx[i]), y: Math.round(p.y + dy[i]), on: p.on })),
          };
        } else if (original?.components) {
          const { dx, dy } = pointDeltas(glyph, original.components.length + 4, coords, null);
          moved = {
            components: original.components.map((c, i) => (c.flags & 0x0002)
              ? { ...c, dx: Math.round(c.dx + dx[i]), dy: Math.round(c.dy + dy[i]) }
              : c),
          };
        }
        outlines.set(glyph, moved);
      }
      return outlines.get(glyph);
    }

    /** Every point of a glyph, components included, for its bounding box. */
    function allPoints(glyph, depth = 0) {
      const shape = outline(glyph);
      if (!shape || depth > 8) return [];
      if (shape.points) return shape.points;
      return shape.components.flatMap((c) => {
        const t = new DataView(c.transform.buffer, c.transform.byteOffset, c.transform.byteLength);
        const s = (i) => t.getInt16(i) / 16384;
        const [a, b, cc, d] = c.transform.length === 2 ? [s(0), 0, 0, s(0)]
          : c.transform.length === 4 ? [s(0), 0, 0, s(2)]
          : c.transform.length === 8 ? [s(0), s(2), s(4), s(6)] : [1, 0, 0, 1];
        const offsetX = c.flags & 0x0002 ? c.dx : 0;
        const offsetY = c.flags & 0x0002 ? c.dy : 0;
        return allPoints(c.glyph, depth + 1).map((p) => ({ x: a * p.x + cc * p.y + offsetX, y: b * p.x + d * p.y + offsetY }));
      });
    }

    /**
     * A TrueType font file with only `glyphs` (and the glyphs they're built
     * from) drawn; every other glyph is left empty but keeps its number.
     */
    function subset(glyphs) {
      const keep = new Set([0, ...glyphs]);
      for (const glyph of keep) { // the set grows while it's walked, so components get added too
        outline(glyph)?.components?.forEach((c) => keep.add(c.glyph));
      }

      const glyphBytes = new Map();
      for (const glyph of keep) glyphBytes.set(glyph, encodeGlyph(outline(glyph), allPoints(glyph)));

      // glyf and loca: the outlines, and where each starts.
      const loca = new DataView(new ArrayBuffer(4 * (numGlyphs + 1)));
      const pieces = [];
      let offset = 0;
      for (let glyph = 0; glyph < numGlyphs; glyph++) {
        loca.setUint32(4 * glyph, offset);
        const piece = glyphBytes.get(glyph);
        if (piece) { pieces.push(piece); offset += piece.length; }
      }
      loca.setUint32(4 * numGlyphs, offset);
      const glyf = concatBytes(pieces);

      // hmtx: width and left side of every glyph (unused ones 0).
      const hmtx = new DataView(new ArrayBuffer(4 * numGlyphs));
      for (const glyph of keep) {
        hmtx.setUint16(4 * glyph, advance(glyph));
        const points = allPoints(glyph);
        hmtx.setInt16(4 * glyph + 2, points.length ? Math.min(...points.map((p) => p.x)) : 0);
      }

      const headCopy = tableBytes("head").slice();
      new DataView(headCopy.buffer).setUint32(8, 0);   // checkSumAdjustment, not needed
      new DataView(headCopy.buffer).setInt16(50, 1);   // loca uses 32-bit offsets
      const hheaCopy = tableBytes("hhea").slice();
      new DataView(hheaCopy.buffer).setUint16(34, numGlyphs); // a width for every glyph
      const maxpCopy = tableBytes("maxp").slice();

      return buildFontFile({
        glyf, head: headCopy, hhea: hheaCopy, hmtx: new Uint8Array(hmtx.buffer),
        loca: new Uint8Array(loca.buffer), maxp: maxpCopy,
      });
    }

    /** Where a glyph's ink starts and ends across, as [left, right], or null if it has none. */
    function inkBounds(glyph) {
      const points = allPoints(glyph);
      if (!points.length) return null;
      const xs = points.map((p) => p.x);
      return [Math.min(...xs), Math.max(...xs)];
    }

    return { advance, inkBounds, subset };
  }

  // ---- GSUB: other versions of glyphs, like narrower quote marks

  /**
   * The glyph swaps an OpenType feature makes, as a Map from glyph to glyph.
   * Only one-for-one swaps ("single substitutions") are read, which is all
   * "pwid" (proportional widths) uses.
   */
  function substitutions(featureTag) {
    const map = new Map();
    const gsub = table("GSUB");
    if (!gsub) return map;
    const features = gsub + u16(gsub + 6);
    const lookups = gsub + u16(gsub + 8);

    const lookupIndexes = new Set();
    for (let i = 0; i < u16(features); i++) {
      const record = features + 2 + 6 * i;
      if (String.fromCharCode(...bytes.subarray(record, record + 4)) !== featureTag) continue;
      const feature = features + u16(record + 4);
      for (let k = 0; k < u16(feature + 2); k++) lookupIndexes.add(u16(feature + 4 + 2 * k));
    }

    for (const index of lookupIndexes) {
      const lookup = lookups + u16(lookups + 2 + 2 * index);
      for (let s = 0; s < u16(lookup + 4); s++) {
        let type = u16(lookup);
        let sub = lookup + u16(lookup + 6 + 2 * s);
        if (type === 7) { type = u16(sub + 2); sub += u32(sub + 4); } // "extension": the real one is further on
        if (type !== 1) continue;
        coverage(sub + u16(sub + 2)).forEach((glyph, i) => {
          map.set(glyph, u16(sub) === 1 ? (glyph + i16(sub + 4)) & 0xffff : u16(sub + 6 + 2 * i));
        });
      }
    }
    return map;
  }

  // The glyphs a GSUB rule applies to, in order.
  function coverage(at) {
    const glyphs = [];
    if (u16(at) === 1) {
      for (let i = 0; i < u16(at + 2); i++) glyphs.push(u16(at + 4 + 2 * i));
    } else {
      for (let r = 0; r < u16(at + 2); r++) {
        for (let g = u16(at + 4 + 6 * r); g <= u16(at + 6 + 6 * r); g++) glyphs.push(g);
      }
    }
    return glyphs;
  }

  return {
    unitsPerEm,
    glyphFor,
    instance,
    // Narrower, Western versions of glyphs that are as wide as a Chinese
    // character by default, like “ ” ‘ ’ and …: Map of glyph -> glyph.
    proportional: substitutions("pwid"),
    // For the PDF's description of the font, in font units.
    ascent: i16(os2 + 68),
    descent: i16(os2 + 70),
    capHeight: u16(os2) >= 2 ? i16(os2 + 88) : Math.round(0.7 * i16(os2 + 68)),
    bbox: [i16(head + 36), i16(head + 38), i16(head + 40), i16(head + 42)],
  };
}

// ------------------------------------------------------ writing glyphs

/** An outline as TrueType glyph bytes, without hinting. `points` gives its bounds. */
function encodeGlyph(shape, points) {
  if (!shape) return new Uint8Array(0);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const bounds = points.length
    ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round) : [0, 0, 0, 0];

  if (shape.components) {
    const size = 10 + shape.components.reduce((sum, c) => sum + 8 + c.transform.length, 0);
    const out = new DataView(new ArrayBuffer(size + (size % 2)));
    out.setInt16(0, -1);
    bounds.forEach((value, i) => out.setInt16(2 + 2 * i, value));
    let at = 10;
    shape.components.forEach((c, i) => {
      // 16-bit arguments always; no hinting; "more components" on all but the last.
      let flags = (c.flags | 0x0001) & ~0x0100 & ~0x0020;
      if (i < shape.components.length - 1) flags |= 0x0020;
      out.setUint16(at, flags);
      out.setUint16(at + 2, c.glyph);
      if (c.flags & 0x0002) { out.setInt16(at + 4, c.dx); out.setInt16(at + 6, c.dy); }
      else { out.setUint16(at + 4, c.dx); out.setUint16(at + 6, c.dy); }
      at += 8;
      c.transform.forEach((byte, b) => out.setUint8(at + b, byte));
      at += c.transform.length;
    });
    return new Uint8Array(out.buffer);
  }

  const { contours, points: outlinePoints } = shape;
  const count = outlinePoints.length;
  const size = 10 + 2 * contours.length + 2 + count + 4 * count;
  const out = new DataView(new ArrayBuffer(size + (size % 2)));
  out.setInt16(0, contours.length);
  bounds.forEach((value, i) => out.setInt16(2 + 2 * i, value));
  let at = 10;
  for (const last of contours) { out.setUint16(at, last); at += 2; }
  out.setUint16(at, 0); // no hinting instructions
  at += 2;
  // One flag per point (on or off the curve), then every x and y as a 16-bit
  // step from the point before. Not the smallest encoding, but simple.
  for (const p of outlinePoints) out.setUint8(at++, p.on ? 1 : 0);
  let previous = 0;
  for (const p of outlinePoints) { out.setInt16(at, p.x - previous); previous = p.x; at += 2; }
  previous = 0;
  for (const p of outlinePoints) { out.setInt16(at, p.y - previous); previous = p.y; at += 2; }
  return new Uint8Array(out.buffer);
}

/** Puts tables together into a TrueType font file. */
function buildFontFile(tablesByTag) {
  const tags = Object.keys(tablesByTag).sort();
  const headerSize = 12 + 16 * tags.length;
  const padded = (length) => (length + 3) & ~3;
  const total = headerSize + tags.reduce((sum, tag) => sum + padded(tablesByTag[tag].length), 0);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const entrySelector = Math.floor(Math.log2(tags.length));
  view.setUint32(0, 0x00010000); // TrueType outlines
  view.setUint16(4, tags.length);
  view.setUint16(6, 16 * 2 ** entrySelector);
  view.setUint16(8, entrySelector);
  view.setUint16(10, 16 * tags.length - 16 * 2 ** entrySelector);

  let offset = headerSize;
  tags.forEach((tag, i) => {
    const data = tablesByTag[tag];
    out.set(data, offset);
    const entry = 12 + 16 * i;
    for (let c = 0; c < 4; c++) view.setUint8(entry + c, tag.charCodeAt(c));
    view.setUint32(entry + 4, tableChecksum(out, offset, data.length));
    view.setUint32(entry + 8, offset);
    view.setUint32(entry + 12, data.length);
    offset += padded(data.length);
  });
  return out;
}

function tableChecksum(bytes, offset, length) {
  let sum = 0;
  for (let i = 0; i < length; i += 4) {
    const word = ((bytes[offset + i] << 24) | ((bytes[offset + i + 1] ?? 0) << 16) |
      ((bytes[offset + i + 2] ?? 0) << 8) | (bytes[offset + i + 3] ?? 0)) >>> 0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}

function concatBytes(pieces) {
  const out = new Uint8Array(pieces.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const piece of pieces) { out.set(piece, at); at += piece.length; }
  return out;
}
