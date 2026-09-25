/**
 * cards/result.js — the Today's Result card.
 *
 * Shows how much of today is done, and exports a report of the day as a PDF
 * or a Word document. The Export buttons only unlock once everything is done:
 *
 *   - every video in Today's Videos and Prepare for Tomorrow is ticked,
 *   - each of them has a score entered, and
 *   - every item in the Daily Checklist is ticked, which for the items in
 *     TASK_DETAILS and MINUTES_TASKS means their boxes are filled in too.
 *
 * The PDF is drawn with pdf.js and the Word document with docx.js;
 * buildReportPdf() and buildReportDocx() below decide what goes where. Both
 * show the same things.
 */

const resultSummary = document.getElementById("result-summary");
const resultStatus = document.getElementById("result-status");
const exportButton = document.getElementById("export-btn");
const exportDocxButton = document.getElementById("export-docx-btn");

exportButton.onclick = exportTodayPdf;
exportDocxButton.onclick = exportTodayDocx;

/** Redraws the card from saved data. Called by refreshAll() in app.js. */
function renderResultCard() {
  const work = todaysWork();
  const videos = [...work.today, ...work.prep];
  const watched = videos.filter((entry) => entry.done).length;
  const scored = videos.filter((entry) => entry.done && entry.score !== null).length;
  const ticked = DAILY_TASKS.filter((task) => work.ticks[task]).length;

  resultSummary.textContent =
    `Videos watched ${watched}/${videos.length} · ` +
    `Scores entered ${scored}/${videos.length} · ` +
    `Checklist ${ticked}/${DAILY_TASKS.length}`;

  const left = whatsLeft(work);
  const unlocked = left.length === 0;

  exportButton.disabled = !unlocked;
  exportButton.textContent = unlocked ? "Export as PDF" : "🔒 Export as PDF";
  exportDocxButton.disabled = !unlocked;
  exportDocxButton.textContent = unlocked ? "Export as Word (DOCX)" : "🔒 Export as Word (DOCX)";

  resultStatus.className = unlocked ? "done-message" : "muted";
  resultStatus.textContent = unlocked
    ? `🎉 Everything's done! Average score: ${formatAverage(videos)}.`
    : `Unlocks once everything is done. Still to do: ${left.join(" · ")}.`;
}

/** Today's two lists of videos, and today's checklist ticks. */
function todaysWork() {
  return {
    today: getDayPlan(todayStr(), "today") || [],
    prep: getDayPlan(todayStr(), "prep") || [],
    ticks: getDailyChecks(todayStr()),
  };
}

/**
 * What's still to do before the export unlocks, as short phrases such as
 * "watch 2 videos". Empty once everything is done.
 */
function whatsLeft({ today, prep, ticks }) {
  const videos = [...today, ...prep];
  const unwatched = videos.filter((entry) => !entry.done).length;
  const unscored = videos.filter((entry) => entry.done && entry.score === null).length;
  // The item that ticks itself isn't listed: "watch 2 videos" and "enter 2
  // scores" already cover it.
  const unticked = DAILY_TASKS.filter((task) => !ticks[task] && task !== AUTO_TICKED_TASK);
  const unfilled = unticked.filter((task) => !taskDetailsComplete(todayStr(), task));
  const untickedButFilled = unticked.filter((task) => !unfilled.includes(task));

  const left = [];
  if (unwatched > 0) left.push(`watch ${countOf(unwatched, "video")}`);
  if (unscored > 0) left.push(`enter ${countOf(unscored, "score")}`);
  if (unfilled.length > 0) left.push(`fill in ${unfilled.join(", ")}`);
  if (untickedButFilled.length > 0) left.push(`tick ${untickedButFilled.join(", ")}`);
  return left;
}

/** "1 video", "3 videos". */
function countOf(number, noun) {
  return `${number} ${noun}${number === 1 ? "" : "s"}`;
}

/** The average of the scores entered, as "88%", or "none" if there are none. */
function formatAverage(videos) {
  const scores = videos.map((entry) => entry.score).filter((score) => score !== null);
  if (scores.length === 0) return "none";
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) + "%";
}

// ------------------------------------------------------------- the report

// Layout, in points. An A4 page is 595 wide and 842 tall.
const MARGIN = 50;
const RIGHT_EDGE = PAGE_WIDTH - MARGIN;
const SUBJECT_COLUMN = MARGIN;       // the left edge of each of the three columns
const VIDEO_COLUMN = MARGIN + 100;
const VIDEO_COLUMN_WIDTH = RIGHT_EDGE - VIDEO_COLUMN - 60; // leaves room for the score
const LOWEST_Y = PAGE_HEIGHT - 70;   // below this, start a new page

const REPORT_COLORS = {
  text: "#1c1e21",
  muted: "#65676b",
  line: "#e4e6eb",
  panel: "#f0f2f5",
  accent: "#1877f2",
  good: "#31a24c",   // score of 80% or more
  okay: "#c77700",   // 50% to 79%
  poor: "#d93025",   // below 50%
};

/** Saves the report of today as "study-report-2026-09-10.pdf". */
async function exportTodayPdf() {
  // The button is disabled until then, but check anyway.
  if (whatsLeft(todaysWork()).length > 0) return;

  // The first PDF takes a moment: its font has to be loaded (see font.js).
  exportButton.disabled = true;
  exportButton.textContent = "Preparing PDF…";
  try {
    const pdf = await buildReportPdf();
    await pdf.download(`study-report-${todayStr()}.pdf`);
  } catch (error) {
    console.error(error);
    alert(`Sorry, the PDF couldn't be made: ${error.message}`);
  } finally {
    renderResultCard();
  }
}

/** Lays out today's report. Returns the PDF from createPdf() in pdf.js. */
async function buildReportPdf() {
  await preparePdfFonts(); // before anything is measured
  const catalogs = await getAllCatalogs();
  const { today, prep, ticks } = todaysWork();
  const videos = [...today, ...prep];

  const longDate = strToDate(todayStr()).toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const pdf = createPdf({ title: `Study report – ${longDate}` });
  let y = MARGIN + 10; // how far down the page the next thing goes
  let pageNumber = 1;
  let section = null;  // the section being drawn, repeated at the top of a new page
  const exportedAt = new Date().toLocaleString("en-US",
    { dateStyle: "long", timeStyle: "short" });

  // ---- small drawing helpers, which move `y` down as they go

  const writeRight = (str, right, baseline, options) =>
    pdf.text(str, right - measureText(str, options.size, options.bold), baseline, options);

  const drawFooter = () => {
    pdf.line(MARGIN, PAGE_HEIGHT - 45, RIGHT_EDGE, PAGE_HEIGHT - 45, { color: REPORT_COLORS.line });
    const options = { size: 8, color: REPORT_COLORS.muted };
    pdf.text(`Exported ${exportedAt} from Study Planner`, MARGIN, PAGE_HEIGHT - 32, options);
    writeRight(`Page ${pageNumber}`, RIGHT_EDGE, PAGE_HEIGHT - 32, options);
  };

  // Starts a new page if something `height` points tall won't fit on this one,
  // headed by the name of the section that carries on there. Returns true if
  // it did.
  const makeRoom = (height) => {
    if (y + height <= LOWEST_Y) return false;
    drawFooter();
    pdf.newPage();
    pageNumber++;
    y = MARGIN + 10;
    if (section) {
      y += 12;
      pdf.text(`${section} (continued)`, MARGIN, y, { size: 9, bold: true, color: REPORT_COLORS.muted });
      y += 4;
    }
    return true;
  };

  const drawSectionTitle = (title, subtitle) => {
    section = null;
    makeRoom(90); // keep a title together with at least its first row
    section = title;
    y += 30;
    pdf.text(title, MARGIN, y, { size: 13, bold: true, color: REPORT_COLORS.text });
    if (subtitle) {
      y += 15;
      pdf.text(subtitle, MARGIN, y, { size: 9, color: REPORT_COLORS.muted });
    }
    y += 10;
  };

  const drawTableHeader = () => {
    y += 12;
    const options = { size: 7.5, bold: true, color: REPORT_COLORS.muted };
    pdf.text("SUBJECT", SUBJECT_COLUMN, y, options);
    pdf.text("VIDEO", VIDEO_COLUMN, y, options);
    writeRight("SCORE", RIGHT_EDGE, y, options);
    y += 6;
    pdf.line(MARGIN, y, RIGHT_EDGE, y, { color: REPORT_COLORS.line, width: 1 });
  };

  const drawVideoRow = (entry) => {
    const found = videoOf(entry, catalogs);
    if (!found) return; // its catalog or video was removed since
    const { catalog, video } = found;

    const titleLines = wrapText(video.title, VIDEO_COLUMN_WIDTH, 10.5, true);
    const topicLines = wrapText(videoTopicLabel(catalog, entry.videoIndex), VIDEO_COLUMN_WIDTH, 8.5);
    const height = 12 + titleLines.length * 13 + topicLines.length * 11;

    if (makeRoom(height)) drawTableHeader();

    const firstBaseline = y + 16;
    // A long subject name, say from an uploaded catalog, is cut short with "…".
    pdf.text(fitText(catalog.subject, VIDEO_COLUMN - SUBJECT_COLUMN - 8, 10, true), SUBJECT_COLUMN,
      firstBaseline, { size: 10, bold: true, color: REPORT_COLORS.accent });

    titleLines.forEach((line, i) => pdf.text(line, VIDEO_COLUMN, firstBaseline + i * 13,
      { size: 10.5, bold: true, color: REPORT_COLORS.text }));

    const topicTop = firstBaseline + titleLines.length * 13 - 1;
    topicLines.forEach((line, i) => pdf.text(line, VIDEO_COLUMN, topicTop + i * 11,
      { size: 8.5, color: REPORT_COLORS.muted }));

    const score = entry.score === null ? "–" : `${entry.score}%`;
    writeRight(score, RIGHT_EDGE, firstBaseline, { size: 11, bold: true, color: scoreColor(entry.score) });

    y += height;
    pdf.line(MARGIN, y, RIGHT_EDGE, y, { color: REPORT_COLORS.line });
  };

  // What was typed into a checklist item's boxes, each wrapped to fit beside
  // its score: [{ lines, score }, ...]. Empty for a plain item.
  const taskEntries = (task) => {
    if (!TASK_DETAILS[task]) return [];
    const { fields, scores } = getTaskDetails(todayStr(), task);
    const textWidth = RIGHT_EDGE - 60 - (MARGIN + 18);
    return fields.map((text, i) => ({ lines: wrapText(text, textWidth, 9.5), score: scores[i] }));
  };

  // How tall a checklist item is, with its entries, so it can be kept on one
  // page.
  const taskHeight = (entries) => 18 + entries.reduce(
    (sum, { lines }) => sum + 14 + (lines.length - 1) * 12, 0) + (entries.length ? 4 : 0);

  // A checklist item's entries, one per line under its name, each with its
  // score on the right.
  const drawTaskEntries = (entries) => {
    for (const { lines, score } of entries) {
      y += 14;
      writeRight(score === null ? "–" : `${score}%`, RIGHT_EDGE, y,
        { size: 10, bold: true, color: scoreColor(score) });
      lines.forEach((line, n) => {
        if (n > 0) y += 12;
        pdf.text(line, MARGIN + 18, y, { size: 9.5, color: REPORT_COLORS.muted });
      });
    }
    if (entries.length) y += 4;
  };

  const drawCheckMark = (left, baseline) => {
    const options = { color: REPORT_COLORS.good, width: 1.6 };
    pdf.line(left, baseline - 4, left + 3, baseline - 1, options);
    pdf.line(left + 3, baseline - 1, left + 9, baseline - 8, options);
  };

  // ---- the report itself

  pdf.text("STUDY PLANNER · DAILY REPORT", MARGIN, y, { size: 8.5, bold: true, color: REPORT_COLORS.accent });
  y += 28;
  pdf.text(longDate, MARGIN, y, { size: 22, bold: true, color: REPORT_COLORS.text });
  y += 18;
  // describeDay() starts with the weekday, which the date above already shows.
  const aboutToday = describeDay(todayStr()).split(" · ").slice(1).join(" · ");
  pdf.text(aboutToday, MARGIN, y, { size: 10, color: REPORT_COLORS.muted });
  y += 18;

  // Three numbers in a grey panel: videos, average score, checklist.
  const panelHeight = 50;
  pdf.box(MARGIN, y, RIGHT_EDGE - MARGIN, panelHeight, REPORT_COLORS.panel);
  const ticked = DAILY_TASKS.filter((task) => ticks[task]).length;
  const stats = [
    [String(videos.length), videos.length === 1 ? "video watched" : "videos watched"],
    [formatAverage(videos), "average score"],
    [`${ticked}/${DAILY_TASKS.length}`, "daily checklist"],
  ];
  const statWidth = (RIGHT_EDGE - MARGIN) / stats.length;
  stats.forEach(([number, label], i) => {
    const left = MARGIN + 16 + i * statWidth;
    pdf.text(number, left, y + 24, { size: 17, bold: true, color: REPORT_COLORS.text });
    pdf.text(label, left, y + 38, { size: 8.5, color: REPORT_COLORS.muted });
  });
  y += panelHeight;

  drawSectionTitle("Today's videos");
  drawTableHeader();
  if (today.length === 0) {
    y += 16;
    pdf.text("No videos today.", VIDEO_COLUMN, y, { size: 10, color: REPORT_COLORS.muted });
    y += 8;
  }
  today.forEach(drawVideoRow);

  if (prep.length > 0) {
    drawSectionTitle("Prepared for tomorrow", describeDay(tomorrowStr()));
    drawTableHeader();
    prep.forEach(drawVideoRow);
  }

  drawSectionTitle("Daily checklist");
  for (const task of DAILY_TASKS) {
    const entries = taskEntries(task);
    makeRoom(taskHeight(entries) + 4); // an item and its entries stay together
    y += 18;
    if (ticks[task]) drawCheckMark(MARGIN + 2, y);
    pdf.text(task, MARGIN + 18, y, { size: 10.5, color: REPORT_COLORS.text });
    if (MINUTES_TASKS.includes(task)) {
      const minutes = getTaskMinutes(todayStr(), task);
      writeRight(minutes === null ? "–" : `${minutes} min`, RIGHT_EDGE, y,
        { size: 10, bold: true, color: REPORT_COLORS.text });
    }
    drawTaskEntries(entries);
  }

  drawFooter();
  return pdf;
}

// ------------------------------------------------------ the Word version

/** Saves the report of today as "study-report-2026-09-10.docx". */
async function exportTodayDocx() {
  // The button is disabled until then, but check anyway.
  if (whatsLeft(todaysWork()).length > 0) return;

  try {
    const docx = await buildReportDocx();
    docx.download(`study-report-${todayStr()}.docx`);
  } catch (error) {
    console.error(error);
    alert(`Sorry, the Word document couldn't be made: ${error.message}`);
  }
}

/**
 * Lays out today's report as a Word document, with the same contents as the
 * PDF. Returns the document from createDocx() in docx.js.
 */
async function buildReportDocx() {
  const catalogs = await getAllCatalogs();
  const { today, prep, ticks } = todaysWork();
  const videos = [...today, ...prep];
  const C = REPORT_COLORS;

  const longDate = strToDate(todayStr()).toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const exportedAt = new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });

  // Column widths, in twips, adding up to the page's width inside its margins.
  const SCORE_WIDTH = 1200;
  const SUBJECT_WIDTH = 2000;
  const VIDEO_WIDTH = DOCX_CONTENT_WIDTH - SUBJECT_WIDTH - SCORE_WIDTH;
  const CHECK_WIDTH = 360;
  const TASK_WIDTH = DOCX_CONTENT_WIDTH - CHECK_WIDTH - SCORE_WIDTH;

  const sectionTitle = (title, subtitle) => [
    docxParagraph(docxRun(title, { size: 13, bold: true }), { before: 20, after: subtitle ? 2 : 6, keepNext: true }),
    subtitle ? docxParagraph(docxRun(subtitle, { size: 9, color: C.muted }), { after: 6, keepNext: true }) : "",
  ].join("");

  const scoreText = (score) => docxRun(score === null ? "–" : `${score}%`,
    { size: 10.5, bold: true, color: scoreColor(score) });

  const videoTable = (entries) => {
    const label = (text) => docxRun(text, { size: 7.5, bold: true, color: C.muted });
    const header = docxRow([
      docxCell(docxParagraph(label("SUBJECT")), { width: SUBJECT_WIDTH, borderBelow: C.line }),
      docxCell(docxParagraph(label("VIDEO")), { width: VIDEO_WIDTH, borderBelow: C.line }),
      docxCell(docxParagraph(label("SCORE"), { align: "right" }), { width: SCORE_WIDTH, borderBelow: C.line }),
    ], { header: true });

    const rows = entries.map((entry) => {
      const found = videoOf(entry, catalogs);
      if (!found) return ""; // its catalog or video was removed since
      const { catalog, video } = found;
      const cell = (content, width) => docxCell(content, { width, borderBelow: C.line, padTop: 6, padBottom: 6 });
      return docxRow([
        cell(docxParagraph(docxRun(catalog.subject, { size: 10, bold: true, color: C.accent })), SUBJECT_WIDTH),
        cell([
          docxParagraph(docxRun(video.title, { size: 10.5, bold: true })),
          docxParagraph(docxRun(videoTopicLabel(catalog, entry.videoIndex), { size: 8.5, color: C.muted })),
        ], VIDEO_WIDTH),
        cell(docxParagraph(scoreText(entry.score), { align: "right" }), SCORE_WIDTH),
      ]);
    });

    if (entries.length === 0) {
      rows.push(docxRow([
        docxCell(docxParagraph([]), { width: SUBJECT_WIDTH }),
        docxCell(docxParagraph(docxRun("No videos today.", { color: C.muted })), { width: VIDEO_WIDTH, padTop: 6 }),
        docxCell(docxParagraph([]), { width: SCORE_WIDTH }),
      ]));
    }
    return docxTable([SUBJECT_WIDTH, VIDEO_WIDTH, SCORE_WIDTH], [header, ...rows]);
  };

  // ---- the report itself

  const ticked = DAILY_TASKS.filter((task) => ticks[task]).length;
  const stats = [
    [String(videos.length), videos.length === 1 ? "video watched" : "videos watched"],
    [formatAverage(videos), "average score"],
    [`${ticked}/${DAILY_TASKS.length}`, "daily checklist"],
  ];
  const statWidth = Math.floor(DOCX_CONTENT_WIDTH / stats.length);
  const statsPanel = docxTable(stats.map(() => statWidth), [docxRow(stats.map(([number, label]) =>
    docxCell([
      docxParagraph(docxRun(number, { size: 17, bold: true }), { indent: 320 }),
      docxParagraph(docxRun(label, { size: 8.5, color: C.muted }), { indent: 320 }),
    ], { width: statWidth, fill: C.panel, padTop: 9, padBottom: 9 })))]);

  // describeDay() starts with the weekday, which the date already shows.
  const aboutToday = describeDay(todayStr()).split(" · ").slice(1).join(" · ");

  const body = [
    docxParagraph(docxRun("STUDY PLANNER · DAILY REPORT", { size: 8.5, bold: true, color: C.accent }), { after: 8 }),
    docxParagraph(docxRun(longDate, { size: 22, bold: true }), { after: 2 }),
    docxParagraph(docxRun(aboutToday, { color: C.muted }), { after: 10 }),
    statsPanel,
    sectionTitle("Today's videos"),
    videoTable(today),
    prep.length > 0 ? sectionTitle("Prepared for tomorrow", describeDay(tomorrowStr())) + videoTable(prep) : "",
    sectionTitle("Daily checklist"),
  ];

  // The checklist as a table without lines: tick, name (with its entries
  // under it), and the score or minutes on the right.
  const checklistRows = [];
  const isLast = (i, list) => i === list.length - 1;
  for (const task of DAILY_TASKS) {
    const minutes = MINUTES_TASKS.includes(task) ? getTaskMinutes(todayStr(), task) : undefined;
    const details = TASK_DETAILS[task] ? getTaskDetails(todayStr(), task) : null;
    const entryCount = details ? details.fields.length : 0;
    // keepNext keeps an item's rows on the same page as each other.
    const keep = (i) => ({ keepNext: i < entryCount });

    checklistRows.push(docxRow([
      docxCell(docxParagraph(ticks[task] ? docxRun("✓", { size: 11, bold: true, color: C.good }) : [], keep(0)),
        { width: CHECK_WIDTH, padTop: 6, padBottom: 0 }),
      docxCell(docxParagraph(docxRun(task, { size: 10.5 }), keep(0)), { width: TASK_WIDTH, padTop: 6, padBottom: 0 }),
      docxCell(docxParagraph(minutes === undefined ? []
        : docxRun(minutes === null ? "–" : `${minutes} min`, { size: 10, bold: true }), { align: "right", ...keep(0) }),
        { width: SCORE_WIDTH, padTop: 6, padBottom: 0 }),
    ]));

    details?.fields.forEach((text, i, list) => {
      checklistRows.push(docxRow([
        docxCell(docxParagraph([], keep(i + 1)), { width: CHECK_WIDTH, padTop: 1, padBottom: 0 }),
        docxCell(docxParagraph(docxRun(text, { size: 9.5, color: C.muted }), keep(i + 1)),
          { width: TASK_WIDTH, padTop: 1, padBottom: isLast(i, list) ? 3 : 0 }),
        docxCell(docxParagraph(scoreText(details.scores[i]), { align: "right", ...keep(i + 1) }),
          { width: SCORE_WIDTH, padTop: 1, padBottom: 0 }),
      ]));
    });
  }
  body.push(docxTable([CHECK_WIDTH, TASK_WIDTH, SCORE_WIDTH], checklistRows));

  return createDocx({
    title: `Study report – ${longDate}`,
    body: body.join(""),
    footer: `Exported ${exportedAt} from Study Planner`,
  });
}

function scoreColor(score) {
  if (score === null) return REPORT_COLORS.muted;
  if (score >= 80) return REPORT_COLORS.good;
  if (score >= 50) return REPORT_COLORS.okay;
  return REPORT_COLORS.poor;
}
