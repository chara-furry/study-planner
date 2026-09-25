/**
 * docx.js — writes a simple Word document (.docx) without any external library.
 *
 * You should not need to change this file to change the report; that's laid
 * out in cards/result.js, which builds the document's body from the helpers
 * below and hands it to createDocx():
 *
 *   const body = docxParagraph([docxRun("Hello 👋", { size: 20, bold: true })]);
 *   createDocx({ title: "Hello", body }).download("hello.docx");
 *
 * How it works: a .docx file is a zip archive of a few XML files. The page's
 * contents go in word/document.xml, written in Word's XML vocabulary ("w:p" is
 * a paragraph, "w:r" a run of text with one look, "w:tbl" a table). Sizes are
 * in the units Word uses: font sizes in points here (converted to Word's
 * half-points), widths in twentieths of a point ("twips"; 567 make 1 cm).
 * Colors are "#1877f2" strings.
 *
 * Text is stored as Unicode, and Word draws any character itself, emoji
 * included. Chinese is set in Microsoft JhengHei (a Traditional Chinese font
 * Windows has; Word picks a similar one elsewhere) and marked as Traditional
 * Chinese (zh-TW), so Word uses the Taiwanese forms of the characters;
 * English and German use Arial.
 */

// A4 with 2 cm margins, in twips.
const DOCX_PAGE_WIDTH = 11906;
const DOCX_PAGE_HEIGHT = 16838;
const DOCX_MARGIN = 1134;
const DOCX_CONTENT_WIDTH = DOCX_PAGE_WIDTH - 2 * DOCX_MARGIN;

const W_NAMESPACE = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// ------------------------------------------------------ building the body

/** A run of text with one look. Options: size (points), bold, color. */
function docxRun(text, { size = 10, bold = false, color = null } = {}) {
  const props = [
    bold ? "<w:b/>" : "",
    color ? `<w:color w:val="${color.replace("#", "")}"/>` : "",
    `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`,
  ].join("");
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;
}

/**
 * A paragraph of runs. Options: align ("right"), before / after (space above
 * and below, in points), keepNext (keep on the same page as what follows),
 * indent (left indent, in twips).
 */
function docxParagraph(runs, { align = null, before = 0, after = 0, keepNext = false, indent = 0 } = {}) {
  const content = [].concat(runs).join("");
  // Lines are a fixed 1.35 times the paragraph's largest text. Left to
  // itself, Word spaces lines of Chinese nearly twice as far apart as
  // English ones, because of how tall Chinese fonts say their lines are.
  const largest = Math.max(20, ...[...content.matchAll(/<w:sz w:val="(\d+)"\/>/g)].map((m) => Number(m[1])));
  const lineHeight = Math.round((largest / 2) * 1.35 * 20); // twips
  const props = [
    keepNext ? "<w:keepNext/>" : "",
    `<w:spacing w:before="${Math.round(before * 20)}" w:after="${Math.round(after * 20)}" ` +
      `w:line="${lineHeight}" w:lineRule="exact"/>`,
    indent ? `<w:ind w:left="${indent}"/>` : "",
    align ? `<w:jc w:val="${align}"/>` : "",
  ].join("");
  return `<w:p><w:pPr>${props}</w:pPr>${content}</w:p>`;
}

/**
 * A table cell holding paragraphs. Options: width (twips), fill (background
 * color), borderBelow (color of a line under the cell), padTop / padBottom
 * (space inside the cell, in points).
 */
function docxCell(paragraphs, { width, fill = null, borderBelow = null, padTop = 3, padBottom = 3 } = {}) {
  const border = borderBelow
    ? `<w:tcBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${borderBelow.replace("#", "")}"/></w:tcBorders>`
    : "";
  const props = [
    `<w:tcW w:w="${width}" w:type="dxa"/>`,
    border,
    fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill.replace("#", "")}"/>` : "",
    `<w:tcMar><w:top w:w="${Math.round(padTop * 20)}" w:type="dxa"/>` +
      `<w:bottom w:w="${Math.round(padBottom * 20)}" w:type="dxa"/></w:tcMar>`,
  ].join("");
  // Word requires every cell to end with a paragraph.
  const content = [].concat(paragraphs).join("") || docxParagraph([]);
  return `<w:tc><w:tcPr>${props}</w:tcPr>${content}</w:tc>`;
}

/**
 * A table row, never split across two pages. Options: header (repeat this row
 * at the top of each page the table runs onto).
 */
function docxRow(cells, { header = false } = {}) {
  const props = (header ? "<w:tblHeader/>" : "") + "<w:cantSplit/>";
  return `<w:tr><w:trPr>${props}</w:trPr>${cells.join("")}</w:tr>`;
}

/** A table with the given column widths (twips) and no borders of its own. */
function docxTable(columnWidths, rows) {
  const width = columnWidths.reduce((sum, w) => sum + w, 0);
  const none = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((side) => `<w:${side} w:val="nil"/>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${none}</w:tblBorders>` +
    `<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${columnWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
    `${rows.join("")}</w:tbl>`;
}

// ------------------------------------------------------ the file

/**
 * Wraps a body into a finished document. `footer` is a line of small grey
 * text at the bottom left of every page; the page number goes on the right.
 * `title` is shown in the file's properties.
 */
function createDocx({ title = "", body, footer = "" }) {
  const document_ = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NAMESPACE}><w:body>${body}<w:sectPr>
<w:footerReference w:type="default" r:id="rIdFooter"/>
<w:pgSz w:w="${DOCX_PAGE_WIDTH}" w:h="${DOCX_PAGE_HEIGHT}"/>
<w:pgMar w:top="${DOCX_MARGIN}" w:right="${DOCX_MARGIN}" w:bottom="${DOCX_MARGIN}" w:left="${DOCX_MARGIN}" w:header="567" w:footer="567" w:gutter="0"/>
</w:sectPr></w:body></w:document>`;

  // The footer: text on the left, "Page N" at a tab stop on the right edge.
  const small = '<w:rPr><w:color w:val="65676B"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>';
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W_NAMESPACE}><w:p><w:pPr>
<w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="E4E6EB"/></w:pBdr>
<w:tabs><w:tab w:val="right" w:pos="${DOCX_CONTENT_WIDTH}"/></w:tabs></w:pPr>
<w:r>${small}<w:t xml:space="preserve">${xmlText(footer)}</w:t></w:r>
<w:r>${small}<w:tab/><w:t xml:space="preserve">Page </w:t></w:r>
<w:r>${small}<w:fldChar w:fldCharType="begin"/></w:r>
<w:r>${small}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
<w:r>${small}<w:fldChar w:fldCharType="separate"/></w:r>
<w:r>${small}<w:t>1</w:t></w:r>
<w:r>${small}<w:fldChar w:fldCharType="end"/></w:r>
</w:p></w:ftr>`;

  // Default look: Arial 10 pt, no space between paragraphs, and lines don't
  // "snap to grid" (a Word setting for Chinese text that also spaces lines
  // apart). docxParagraph() sets each paragraph's line height.
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NAMESPACE}><w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Microsoft JhengHei"/>
<w:color w:val="1C1E21"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:snapToGrid w:val="0"/><w:spacing w:before="0" w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${xmlText(title)}</dc:title><dc:creator>Study Planner</dc:creator></cp:coreProperties>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

  const files = [
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["docProps/core.xml", core],
    ["word/document.xml", document_],
    ["word/_rels/document.xml.rels", documentRels],
    ["word/styles.xml", styles],
    ["word/footer1.xml", footerXml],
  ];

  /** Saves the document the same way a file downloaded from a website is saved. */
  function download(filename) {
    const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const blob = new Blob([zipFiles(files)], { type });
    const link = el("a", { href: URL.createObjectURL(blob), download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  }

  return { download };
}

/**
 * Text made safe to put inside XML: & < > " escaped, and tabs, line breaks and
 * characters XML doesn't allow at all (most invisible control characters)
 * turned into spaces, as in the PDF.
 */
function xmlText(str) {
  return String(str).normalize("NFC")
    .replace(/[\u0000-\u001f\ufffe\uffff]/g, " ")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ------------------------------------------------------ the zip archive

/**
 * Packs [name, text] pairs into a zip archive, stored without compression
 * (the files are small, and it keeps this simple). Returns the bytes.
 *
 * A zip is each file with a short header in front, then a list of all the
 * files ("central directory") saying where each starts, then a closing record
 * saying where that list starts.
 */
function zipFiles(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const directory = [];
  let offset = 0;

  // Zip dates count from 1980; the time is the moment of export.
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const [name, text] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);  // "local file header"
    header.setUint16(4, 20, true);          // zip version needed
    header.setUint16(6, 0x0800, true);      // names are UTF-8
    header.setUint16(8, 0, true);           // stored, not compressed
    header.setUint16(10, time, true);
    header.setUint16(12, date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true); // compressed size
    header.setUint32(22, data.length, true); // size
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);          // no extra field
    chunks.push(new Uint8Array(header.buffer), nameBytes, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);   // "central directory entry"
    entry.setUint16(4, 20, true);           // made by zip version
    entry.setUint16(6, 20, true);           // zip version needed
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    // 30–41: extra field, comment, disk, attributes, all zero
    entry.setUint32(42, offset, true);      // where this file's header starts
    directory.push(new Uint8Array(entry.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const directorySize = directory.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // "end of central directory"
  end.setUint16(8, files.length, true);     // files on this disk
  end.setUint16(10, files.length, true);    // files in total
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);          // where the directory starts

  const all = [...chunks, ...directory, new Uint8Array(end.buffer)];
  const bytes = new Uint8Array(all.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of all) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

// The CRC-32 checksum a zip stores for each file, to detect damage.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
