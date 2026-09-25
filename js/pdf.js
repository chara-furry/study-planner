/**
 * pdf.js — writes a simple PDF without any external library.
 *
 * You should not need to change this file to change the report; that's laid
 * out in cards/result.js. It uses this file like so:
 *
 *   await preparePdfFonts();                       // once, before measuring text
 *   const pdf = createPdf({ title: "Hello" });
 *   pdf.text("Hello 你好 👋", 50, 60, { size: 20, bold: true });
 *   pdf.line(50, 70, 545, 70);
 *   await pdf.download("hello.pdf");
 *
 * Positions are in points (1/72 inch), measured from the top-left corner of an
 * A4 page, which is PAGE_WIDTH x PAGE_HEIGHT points. A text's `y` is its
 * baseline, the line the letters sit on.
 *
 * How it works: a PDF is mostly plain text. Each page is a list of drawing
 * commands ("use this font, move here, write this"), and the file ends with a
 * table saying at which byte each part starts.
 *
 * Text is written in Noto Sans TC, which font.js reads: a copy of just the
 * letters each report uses is embedded in the file, in regular and bold, with
 * a table mapping them back to Unicode. So English, German and Traditional
 * Chinese text, punctuation and symbols are real text, which can be searched
 * and copied. Emoji, and the rare character the font lacks, are drawn by the
 * browser in its own fonts and placed as small transparent pictures (emoji
 * keep their colors), each tagged with the text it shows so copying still
 * works.
 */

const PAGE_WIDTH = 595.28;  // A4
const PAGE_HEIGHT = 841.89;

// Pictures of text are drawn at this many pixels per point: 4 is about 290
// dots per inch, sharp enough to print.
const PICTURE_SCALE = 4;

// The font, once loaded: { font, regular, bold } (see font.js).
let pdfFonts = null;

/** Loads the font the PDF is written in. Call before createPdf() or measureText(). */
async function preparePdfFonts() {
  if (!pdfFonts) {
    const font = await loadPdfFont();
    pdfFonts = { font, regular: font.instance(400), bold: font.instance(700) };
  }
}

/**
 * Starts a new PDF with one empty page. `title` is shown by PDF viewers in
 * place of the file name.
 */
function createPdf({ title = "" } = {}) {
  if (!pdfFonts) throw new Error("Call preparePdfFonts() first.");

  const pages = [[]]; // each page is a list of drawing commands
  const commands = () => pages[pages.length - 1];

  // For each weight: which glyphs this document uses, and the text each draws.
  const used = { regular: new Map(), bold: new Map() };

  // Pictures of text, each drawn once and reused: { name, width, height, rgb, alpha }
  const pictures = [];
  const pictureByKey = new Map();

  // PDF measures y upwards from the bottom of the page, so flip it.
  const x = (value) => round(value);
  const y = (value) => round(PAGE_HEIGHT - value);

  /**
   * Writes one line of text. Options: size (in points), bold, color
   * ("#1877f2").
   */
  function text(str, left, baseline, { size = 11, bold = false, color = "#000000" } = {}) {
    let at = left;
    const weight = bold ? "bold" : "regular";

    for (const part of splitForPdf(str)) {
      if (part.glyphs) {
        for (let i = 0; i < part.glyphs.length; i++) {
          if (!used[weight].has(part.glyphs[i])) used[weight].set(part.glyphs[i], part.chars[i]);
        }
        // Glyphs as hex numbers; a number between them moves the next one
        // left by that many 1/1000 of the size (closing up wide symbols).
        const instance = bold ? pdfFonts.bold : pdfFonts.regular;
        const toPdfUnits = 1000 / pdfFonts.font.unitsPerEm;
        let shown = "";
        part.glyphs.forEach((glyph, i) => {
          const [before, after] = part.tight[i] ? tightening(instance, glyph) : [0, 0];
          if (before) shown += ` ${Math.round(before * toPdfUnits)} `;
          shown += `<${glyph.toString(16).padStart(4, "0")}>`;
          if (after) shown += ` ${Math.round(after * toPdfUnits)} `;
        });
        commands().push(
          `BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb(color)} rg ${x(at)} ${y(baseline)} Td [${shown}] TJ ET`);
      } else {
        const picture = pictureOf(part.str, size, bold, color, part.emoji);
        // The picture reaches from above the tallest letter to below the
        // lowest (TEXT_PICTURE_TOP and _BOTTOM). ActualText is what copying
        // it gives.
        const top = baseline - size * TEXT_PICTURE_TOP;
        commands().push(
          `/Span << /ActualText ${unicodeString(part.str)} >> BDC ` +
          `q ${round(picture.width)} 0 0 ${round(picture.height)} ${x(at)} ${y(top + picture.height)} cm ` +
          `/${picture.name} Do Q EMC`);
      }
      at += measurePart(part, size, bold);
    }
  }

  function pictureOf(str, size, bold, color, emoji) {
    const key = JSON.stringify([str, size, bold, color, emoji]);
    if (!pictureByKey.has(key)) {
      const picture = { name: `Im${pictures.length + 1}`, ...textPicture(str, size, bold, color, emoji) };
      pictures.push(picture);
      pictureByKey.set(key, picture);
    }
    return pictureByKey.get(key);
  }

  /** Draws a straight line from (x1, y1) to (x2, y2). */
  function line(x1, y1, x2, y2, { color = "#cccccc", width = 0.5 } = {}) {
    commands().push(
      `${rgb(color)} RG ${width} w 1 J ${x(x1)} ${y(y1)} m ${x(x2)} ${y(y2)} l S`);
  }

  /** Fills a rectangle whose top-left corner is at (left, top). */
  function box(left, top, width, height, color) {
    commands().push(
      `${rgb(color)} rg ${x(left)} ${y(top + height)} ${round(width)} ${round(height)} re f`);
  }

  /** Everything drawn after this goes on a new page. */
  function newPage() {
    pages.push([]);
  }

  /**
   * The finished file as bytes. Every character in `file` below stands for
   * exactly one byte, which is what makes the byte positions in the table at
   * the end (the "xref") easy to work out: they're just string lengths.
   *
   * It waits for the fonts and pictures to be compressed, so it returns a
   * Promise.
   */
  async function toBytes() {
    const objects = []; // numbered from 1, so object n is objects[n - 1]
    const add = (body) => objects.push(body); // returns the new object's number
    const stream = (dictionary, data) => add(`<< ${dictionary} /Length ${data.length} >>\nstream\n${data}\nendstream`);

    add("<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>");
    add(""); // the page list; filled in below, once the pages have numbers
    const infoNumber = add(`<< /Title ${unicodeString(title)} /Producer (Study Planner) >>`);

    const fontRefs = [];
    for (const [key, weight, name] of [["F1", "regular", "Regular"], ["F2", "bold", "Bold"]]) {
      if (used[weight].size === 0) continue;
      fontRefs.push(`/${key} ${await addFont(add, stream, pdfFonts[weight], used[weight], name)} 0 R`);
    }

    // Each picture is two images: its colors, and how see-through each pixel
    // is (the "soft mask"). Both are compressed the same way PNGs are.
    const pictureRefs = [];
    for (const picture of pictures) {
      const size = `/Width ${picture.pixelWidth} /Height ${picture.pixelHeight} /BitsPerComponent 8`;
      const maskNumber = stream(`/Type /XObject /Subtype /Image ${size} /ColorSpace /DeviceGray ` +
        "/Filter /FlateDecode", await compress(picture.alpha));
      const imageNumber = stream(`/Type /XObject /Subtype /Image ${size} /ColorSpace /DeviceRGB ` +
        `/SMask ${maskNumber} 0 R /Filter /FlateDecode`, await compress(picture.rgb));
      pictureRefs.push(`/${picture.name} ${imageNumber} 0 R`);
    }
    const resources = `<< /Font << ${fontRefs.join(" ")} >> /XObject << ${pictureRefs.join(" ")} >> >>`;

    const pageNumbers = [];
    for (const pageCommands of pages) {
      const contentNumber = stream("/Filter /FlateDecode", await compress(pageCommands.join("\n")));
      pageNumbers.push(add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources ${resources} /Contents ${contentNumber} 0 R >>`));
    }
    objects[1] = `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(" ")}] ` +
      `/Count ${pageNumbers.length} >>`;

    // The second line tells programs the file holds non-text bytes.
    let file = "%PDF-1.7\n%âãÏÓ\n";
    const startsAt = [];
    objects.forEach((body, i) => {
      startsAt.push(file.length);
      file += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefStart = file.length;
    file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    file += startsAt.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("");
    file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoNumber} 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`;

    return Uint8Array.from(file, (char) => char.charCodeAt(0));
  }

  /** Saves the PDF the same way a file downloaded from a website is saved. */
  async function download(filename) {
    const blob = new Blob([await toBytes()], { type: "application/pdf" });
    const link = el("a", { href: URL.createObjectURL(blob), download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  }

  return { text, line, box, newPage, download };
}

/**
 * Embeds one weight of the font: the font file cut down to `used` glyphs, the
 * width of each, and a table from glyph back to text (for copying and search).
 * Returns the font's object number.
 */
async function addFont(add, stream, instance, used, styleName) {
  const { font } = pdfFonts;
  const scale = 1000 / font.unitsPerEm; // PDF measures glyphs in 1/1000 of the size
  const glyphs = [...used.keys()].sort((a, b) => a - b);
  const baseName = `${styleName === "Bold" ? "SPLNRB" : "SPLNRA"}+NotoSansTC-${styleName}`;

  const fontFile = instance.subset(glyphs);
  const fileNumber = stream(`/Filter /FlateDecode /Length1 ${fontFile.length}`,
    await compress(bytesToString(fontFile)));

  const bbox = font.bbox.map((v) => Math.round(v * scale)).join(" ");
  const descriptorNumber = add(
    `<< /Type /FontDescriptor /FontName /${baseName} /Flags 4 /FontBBox [${bbox}] /ItalicAngle 0 ` +
    `/Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)} ` +
    `/CapHeight ${Math.round(font.capHeight * scale)} /StemV ${styleName === "Bold" ? 140 : 80} ` +
    `/FontFile2 ${fileNumber} 0 R >>`);

  const widths = glyphs.map((g) => `${g} [${Math.round(instance.advance(g) * scale)}]`).join(" ");
  const cidFontNumber = add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseName} ` +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> " +
    `/FontDescriptor ${descriptorNumber} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`);

  const toUnicodeNumber = stream("/Filter /FlateDecode", await compress(toUnicodeCMap(glyphs, used)));

  return add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /Identity-H ` +
    `/DescendantFonts [${cidFontNumber} 0 R] /ToUnicode ${toUnicodeNumber} 0 R >>`);
}

/** The table a PDF reader uses to turn glyph numbers back into text. */
function toUnicodeCMap(glyphs, used) {
  const utf16Hex = (str) => [...str].map((c) => {
    const code = c.codePointAt(0);
    if (code < 0x10000) return code.toString(16).padStart(4, "0");
    const v = code - 0x10000;
    return (0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16);
  }).join("");

  const blocks = [];
  for (let i = 0; i < glyphs.length; i += 100) { // at most 100 per block
    const chunk = glyphs.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar\n` +
      chunk.map((g) => `<${g.toString(16).padStart(4, "0")}> <${utf16Hex(used.get(g))}>`).join("\n") +
      "\nendbfchar");
  }
  return "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n" +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
    "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n" +
    "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" +
    blocks.join("\n") +
    "\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
}

// ------------------------------------------------------ splitting text

// Emoji: drawn as pictures, in color. (Characters that are emoji only when
// followed by U+FE0F, like "©" or "♥", stay text unless they are.)
const EMOJI = /\p{Emoji_Presentation}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u{FE0F}|\u{20E3}|\u{200D}/u;

// Chinese (and Japanese) characters, and the full-width punctuation that goes
// with them. Next to these, shared marks like “ ” … × keep their full,
// Chinese-style width; elsewhere they get their narrower Western form.
const CJK_CONTEXT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\u3000-\u303f\uff00-\uffef]/u;

/**
 * Splits text into runs the font can draw ({ glyphs, chars, tight }) and runs
 * to draw as pictures ({ str, emoji }):
 * "Vocab 😀 學" -> [text "Vocab ", picture "😀", text " 學"].
 *
 * In English or German text, marks the font draws as wide as a Chinese
 * character get narrower: its Western version if it has one (“ ” ‘ ’ …),
 * or else the empty space around it is closed up (× ± → ★): `tight`.
 */
function splitForPdf(str) {
  const { font, regular } = pdfFonts;
  const chars = graphemes(cleanText(str));
  const isSpace = (char) => /^\s$/u.test(char);
  const neighbor = (i, step) => {
    for (let j = i + step; j >= 0 && j < chars.length; j += step) if (!isSpace(chars[j])) return chars[j];
    return "";
  };

  const parts = [];
  chars.forEach((char, i) => {
    const codePoints = [...char];
    const emoji = EMOJI.test(char);
    let glyphs = emoji ? null : codePoints.map((c) => font.glyphFor(c.codePointAt(0)));
    const drawable = glyphs && glyphs.every((g) => g !== 0);
    const last = parts[parts.length - 1];

    if (!drawable) {
      if (last && !last.glyphs && last.emoji === emoji) last.str += char;
      else parts.push({ str: char, emoji });
      return;
    }

    const western = !CJK_CONTEXT.test(char) && !CJK_CONTEXT.test(neighbor(i, -1)) && !CJK_CONTEXT.test(neighbor(i, 1));
    if (western) glyphs = glyphs.map((g) => font.proportional.get(g) ?? g);
    const tight = glyphs.map((g) => western && regular.advance(g) >= 0.9 * font.unitsPerEm);

    if (last?.glyphs) {
      last.glyphs.push(...glyphs);
      last.chars.push(...(glyphs.length === codePoints.length ? codePoints : [char]));
      last.tight.push(...tight);
    } else {
      parts.push({ glyphs, chars: glyphs.length === codePoints.length ? codePoints : [char], tight });
    }
  });
  return parts;
}

/**
 * How much empty space to take away before and after a wide symbol, in font
 * units, so it sits in Western text like a normal-width character: its ink
 * keeps a small margin on each side.
 */
function tightening(instance, glyph) {
  const ink = instance.inkBounds(glyph);
  if (!ink) return [0, 0];
  const margin = 0.06 * pdfFonts.font.unitsPerEm;
  return [
    Math.max(0, Math.round(ink[0] - margin)),
    Math.max(0, Math.round(instance.advance(glyph) - ink[1] - margin)),
  ];
}

// ------------------------------------------------------ measuring text

const measuringCanvas = document.createElement("canvas").getContext("2d");
// PDF text isn't kerned (letter pairs like "AV" nudged closer), so measure
// pictures without it too.
measuringCanvas.fontKerning = "none";

/**
 * The CSS font used for pictures of text: the computer's own color emoji
 * fonts for emoji, and its symbol fonts for anything else the PDF's font
 * doesn't have (like ✔ or ẞ), which is drawn in the text's color.
 */
function cssFont(size, bold, emoji) {
  const families = emoji
    ? '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
    : '"Segoe UI Symbol", "Segoe UI", "Apple Symbols", "Noto Sans Symbols 2", "Arial Unicode MS", sans-serif';
  return `${bold ? "bold " : ""}${size}px ${families}`;
}

function measurePart(part, size, bold) {
  if (part.glyphs) {
    const instance = bold ? pdfFonts.bold : pdfFonts.regular;
    const units = part.glyphs.reduce((sum, g, i) => {
      const [before, after] = part.tight[i] ? tightening(instance, g) : [0, 0];
      return sum + instance.advance(g) - before - after;
    }, 0);
    return units * size / pdfFonts.font.unitsPerEm;
  }
  measuringCanvas.font = cssFont(size, bold, part.emoji);
  return measuringCanvas.measureText(part.str).width;
}

/** How wide `str` is, in points, when written at `size` points. */
function measureText(str, size, bold = false) {
  return splitForPdf(str).reduce((sum, part) => sum + measurePart(part, size, bold), 0);
}

/**
 * Splits text into lines no wider than `maxWidth` points. English and German
 * break between words; Chinese, which has no spaces, between any two
 * characters (but not just before a closing mark like "，" or "」", or just
 * after an opening one like "「"). Anything still too long for a line is
 * broken wherever it has to be.
 */
function wrapText(str, maxWidth, size, bold = false) {
  const lines = [];
  let current = "";

  const place = (piece, joiner) => {
    const longer = current ? current + joiner + piece : piece;
    if (current && measureText(longer, size, bold) > maxWidth) {
      lines.push(current);
      current = piece;
    } else {
      current = longer;
    }
  };

  for (const word of cleanText(str).split(/\s+/).filter(Boolean)) {
    breakOpportunities(word).forEach((token, t) => {
      breakLongWord(token, maxWidth, size, bold).forEach((piece, p) => place(piece, t === 0 && p === 0 ? " " : ""));
    });
  }

  if (current) lines.push(current);
  return lines;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u;
const NO_LINE_START = /^[，。、；：？！」』）》〉】〕〗～…‥·,.;:?!)\]}%’”]$/u;
const NO_LINE_END = /^[「『（《〈【〔〖(\[{‘“]$/u;

/** Splits a space-free word into the pieces a line may break between. */
function breakOpportunities(word) {
  const tokens = [];
  let current = "";
  let previousWasCjk = false;
  let glued = false; // the previous character was an opening mark

  for (const char of graphemes(word)) {
    const isCjk = CJK.test(char);
    if (current && !glued && !NO_LINE_START.test(char) && (isCjk || previousWasCjk)) {
      tokens.push(current);
      current = "";
    }
    current += char;
    glued = NO_LINE_END.test(char);
    previousWasCjk = isCjk;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Splits a word wider than `maxWidth` into pieces that each fit. */
function breakLongWord(word, maxWidth, size, bold) {
  if (measureText(word, size, bold) <= maxWidth) return [word];

  const pieces = [];
  let current = "";
  for (const char of graphemes(word)) {
    if (current && measureText(current + char, size, bold) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Shortens text with "…" at the end until it fits in `maxWidth` points. */
function fitText(str, maxWidth, size, bold = false) {
  str = cleanText(str);
  if (measureText(str, size, bold) <= maxWidth) return str;

  const chars = graphemes(str);
  while (chars.length > 0 && measureText(chars.join("") + "…", size, bold) > maxWidth) chars.pop();
  return chars.join("").trimEnd() + "…";
}

// ------------------------------------------------------ pictures of text

// How far a picture of text reaches above and below the baseline, as a share
// of the font size. Enough for emoji and symbols.
const TEXT_PICTURE_TOP = 1.0;
const TEXT_PICTURE_BOTTOM = 0.3;

/**
 * Draws text the font can't, like "😀" or "✔", with the browser's fonts. Returns its
 * size in points and its pixels, split into colors (RGB) and see-through-ness
 * (alpha), each as a string of bytes.
 */
function textPicture(str, size, bold, color, emoji) {
  const width = measurePart({ str, emoji }, size, bold);
  const height = size * (TEXT_PICTURE_TOP + TEXT_PICTURE_BOTTOM);
  const pixelWidth = Math.max(1, Math.ceil(width * PICTURE_SCALE));
  const pixelHeight = Math.ceil(height * PICTURE_SCALE);

  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext("2d");
  context.fontKerning = "none";
  context.font = cssFont(size * PICTURE_SCALE, bold, emoji);
  context.fillStyle = color;
  context.textBaseline = "alphabetic";
  context.fillText(str, 0, size * TEXT_PICTURE_TOP * PICTURE_SCALE);

  const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight).data; // R, G, B, A, R, ...
  let rgbBytes = "";
  let alphaBytes = "";
  for (let i = 0; i < pixels.length; i += 4) {
    rgbBytes += String.fromCharCode(pixels[i], pixels[i + 1], pixels[i + 2]);
    alphaBytes += String.fromCharCode(pixels[i + 3]);
  }

  return {
    width: pixelWidth / PICTURE_SCALE,
    height: pixelHeight / PICTURE_SCALE,
    pixelWidth,
    pixelHeight,
    rgb: rgbBytes,
    alpha: alphaBytes,
  };
}

// ------------------------------------------------------ helpers

/** Compresses a string of bytes the way a PDF's /FlateDecode expects. */
async function compress(bytes) {
  const input = new Blob([Uint8Array.from(bytes, (char) => char.charCodeAt(0))]);
  const output = input.stream().pipeThrough(new CompressionStream("deflate"));
  return bytesToString(new Uint8Array(await new Response(output).arrayBuffer()));
}

/** Bytes as a string with one character per byte, the way `file` holds them. */
function bytesToString(bytes) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return result;
}

function round(value) {
  return Number(value.toFixed(2));
}

/** "#1877f2" as the "0.094 0.467 0.949" a PDF expects. */
function rgb(hex) {
  return [1, 3, 5]
    .map((i) => round(parseInt(hex.slice(i, i + 2), 16) / 255))
    .join(" ");
}

/**
 * Text for the file's details, like its title, as a PDF string that can hold
 * any character: UTF-16 in hex, starting with the marker FEFF.
 */
function unicodeString(str) {
  let hex = "FEFF";
  for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${hex}>`;
}

/**
 * Tidies text before it's drawn: tabs, line breaks and other invisible control
 * characters become spaces, and letters written as a base plus an accent
 * ("e" + "´") are joined into one ("é"), which the font can draw.
 */
function cleanText(str) {
  return String(str).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").normalize("NFC");
}

/** Splits text into the characters a reader sees, so "👍🏽" or "🇩🇪" stays whole. */
function graphemes(str) {
  if (typeof Intl.Segmenter !== "function") return Array.from(str);
  return Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(str), (s) => s.segment);
}
