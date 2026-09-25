/**
 * xlsx.js — reads a catalog spreadsheet without any external library.
 *
 * You should not need to read or change this file to add a feature: call
 * parseCatalogXlsx(file) and you get back plain data.
 *
 * An .xlsx file is a ZIP archive containing XML. The parts this file needs:
 *
 *   xl/workbook.xml       lists the sheets; the first one's name becomes the
 *                         catalog label ("Mathematik Klasse 8 Katalog")
 *   xl/sharedStrings.xml  a de-duplicated string table; most text cells hold
 *                         an index into it rather than the text itself
 *   xl/styles.xml         font and formatting definitions, used here to work
 *                         out which cells are bold
 *   xl/worksheets/sheet1.xml  the cells themselves
 *
 * Browsers can already unzip DEFLATE data through DecompressionStream, so the
 * only thing missing is walking the ZIP's own index, which is what
 * readZipEntryAsText does.
 *
 * The expected sheet layout, matching the sofatutor catalogs:
 *   column A  Datum        (ignored)
 *   column B  Video-Titel  bold = topic heading, plain = a video
 *   column C  the tick box (ignored)
 */

// -------------------------------------------------------------- ZIP reading

// Signatures that mark the ZIP's index structures, as little-endian uint32.
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP_DEFLATE = 8; // compression method; 0 means the data is stored as-is

/** Inflates raw DEFLATE bytes using the browser's built-in decompressor. */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Finds the "end of central directory" record, which is the ZIP's table of
 * contents pointer and sits at the very end of the file.
 *
 * It is 22 bytes long but may be followed by a comment of up to 65535 bytes,
 * so its exact position is unknown and we scan backwards for its signature.
 * Returns the offset, or -1 if this is not a ZIP file at all.
 */
function findEndOfCentralDirectory(view, byteLength) {
  const earliestPossible = Math.max(0, byteLength - 22 - 65535);

  for (let offset = byteLength - 22; offset >= earliestPossible; offset--) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

/**
 * Extracts one file from a ZIP archive and decodes it as UTF-8 text.
 * Returns null when the archive has no such entry.
 *
 * The byte offsets below come from the ZIP specification's record layouts.
 */
async function readZipEntryAsText(buffer, entryName) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();

  const endRecord = findEndOfCentralDirectory(view, buffer.byteLength);
  if (endRecord === -1) throw new Error("Not a valid .xlsx file");

  const entryCount = view.getUint16(endRecord + 10, true);
  let entryOffset = view.getUint32(endRecord + 16, true);

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(entryOffset, true) !== ZIP_CENTRAL_DIRECTORY_ENTRY) break;

    const compressionMethod = view.getUint16(entryOffset + 10, true);
    const compressedSize = view.getUint32(entryOffset + 20, true);
    const nameLength = view.getUint16(entryOffset + 28, true);
    const extraLength = view.getUint16(entryOffset + 30, true);
    const commentLength = view.getUint16(entryOffset + 32, true);
    const localHeaderOffset = view.getUint32(entryOffset + 42, true);
    const name = decoder.decode(
      bytes.subarray(entryOffset + 46, entryOffset + 46 + nameLength));

    if (name === entryName) {
      // The file's bytes sit after its local header, whose name and extra
      // fields can be sized differently from the ones in the index above.
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const data = bytes.subarray(dataStart, dataStart + compressedSize);

      const raw = compressionMethod === ZIP_DEFLATE ? await inflateRaw(data) : data;
      return decoder.decode(raw);
    }

    entryOffset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

// ------------------------------------------------------------- XML helpers

function parseXML(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

/** The first sheet's name, which the catalog is labelled after. */
function readSheetName(workbookXml) {
  const sheet = parseXML(workbookXml).getElementsByTagName("sheet")[0];
  return (sheet && sheet.getAttribute("name")) || "";
}

/**
 * The shared string table, as an array indexed by the number cells refer to.
 *
 * A single string can be split across several <t> runs when parts of it are
 * styled differently, so the runs are concatenated back together.
 */
function readSharedStrings(sharedStringsXml) {
  if (!sharedStringsXml) return [];

  return [...parseXML(sharedStringsXml).getElementsByTagName("si")].map((item) => {
    let text = "";
    for (const run of item.getElementsByTagName("t")) text += run.textContent;
    return text;
  });
}

/**
 * The set of style indexes that render bold, which is how topic headings are
 * distinguished from video titles.
 *
 * A cell's `s` attribute is an index into <cellXfs>, and each entry there
 * points at a <fonts> entry by `fontId`. So this resolves bold fonts first,
 * then collects every style built on one of them.
 */
function readBoldStyleIndexes(stylesXml) {
  const boldStyles = new Set();
  if (!stylesXml) return boldStyles;

  const doc = parseXML(stylesXml);

  const boldFontIds = new Set();
  const fonts = doc.getElementsByTagName("fonts")[0];
  if (fonts) {
    [...fonts.getElementsByTagName("font")].forEach((font, fontId) => {
      const bold = font.getElementsByTagName("b")[0];
      // <b/> with no value means bold; <b val="0"/> explicitly means not bold.
      const isBold = bold &&
        bold.getAttribute("val") !== "0" &&
        bold.getAttribute("val") !== "false";
      if (isBold) boldFontIds.add(fontId);
    });
  }

  const cellFormats = doc.getElementsByTagName("cellXfs")[0];
  if (cellFormats) {
    [...cellFormats.getElementsByTagName("xf")].forEach((format, styleIndex) => {
      if (boldFontIds.has(Number(format.getAttribute("fontId") || 0))) {
        boldStyles.add(styleIndex);
      }
    });
  }

  return boldStyles;
}

/** Reads one cell's text, following the shared string table when needed. */
function readCellText(cell, sharedStrings) {
  const type = cell.getAttribute("t");

  // Inline strings keep their text inside the cell instead of the table.
  if (type === "inlineStr") {
    let text = "";
    for (const run of cell.getElementsByTagName("t")) text += run.textContent;
    return text;
  }

  const value = cell.getElementsByTagName("v")[0];
  if (!value) return "";

  // t="s" means the value is an index into the shared string table.
  return type === "s"
    ? (sharedStrings[Number(value.textContent)] ?? "")
    : value.textContent;
}

// ------------------------------------------------------------ catalog parse

/**
 * Parses a catalog spreadsheet.
 *
 * Returns {label, subject, videos: [{title, topic}]}, where `topic` is the
 * most recent bold heading above each video. Throws with a message
 * suitable for showing to the user when the file is not a catalog.
 */
async function parseCatalogXlsx(file) {
  const buffer = await file.arrayBuffer();

  const sheetXml = await readZipEntryAsText(buffer, "xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("no worksheet found inside the file");

  const workbookXml = await readZipEntryAsText(buffer, "xl/workbook.xml");
  const sharedStrings = readSharedStrings(
    await readZipEntryAsText(buffer, "xl/sharedStrings.xml"));
  const boldStyles = readBoldStyleIndexes(
    await readZipEntryAsText(buffer, "xl/styles.xml"));

  // "Mathematik Klasse 8 Katalog" -> label "Mathematik Klasse 8",
  // subject "Mathematik", which is what SCHEDULE matches against.
  const sheetName = workbookXml ? readSheetName(workbookXml) : "";
  const label = (sheetName || "Uploaded catalog").replace(/\s*Katalog\s*$/i, "").trim();
  const subject = label.split(/\s+/)[0];

  const videos = [];
  let currentTopic = "";
  let headerLooksRight = false;

  for (const row of parseXML(sheetXml).getElementsByTagName("row")) {
    const rowNumber = Number(row.getAttribute("r"));

    for (const cell of row.getElementsByTagName("c")) {
      // Only column B carries titles; A holds dates and C the tick box.
      // A cell reference looks like "B14": the column, then the row number.
      if (!/^B\d+$/.test(cell.getAttribute("r") || "")) continue;

      const text = String(readCellText(cell, sharedStrings)).trim();
      if (text === "") continue;

      if (rowNumber === 1) {
        headerLooksRight = text.toLowerCase() === "video-titel";
        continue;
      }

      // Bold rows are topic headings; everything under one belongs to it.
      if (boldStyles.has(Number(cell.getAttribute("s") || 0))) {
        currentTopic = text;
      } else {
        videos.push({ title: text, topic: currentTopic });
      }
    }
  }

  if (!headerLooksRight) throw new Error('cell B1 must read "Video-Titel"');
  if (videos.length === 0) throw new Error("no video titles found");

  return { label, subject, videos };
}
