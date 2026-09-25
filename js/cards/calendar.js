/**
 * cards/calendar.js — the Calendar card.
 *
 * A month grid of past study. Each day can show two dots:
 *   blue   every video that day was watched (its own and the prep for the next)
 *   green  the whole daily checklist was ticked
 * Days off from DAYS_OFF (config.js) are shaded green, like on the school
 * calendar. Clicking a day opens a panel below the grid listing what it held.
 *
 * The calendar saves nothing of its own. It only reads the day plans and
 * checklist ticks the other cards have saved, so it fills in by itself.
 */

const calendarMonthLabel = document.getElementById("cal-month");
const calendarWeekdays = document.getElementById("cal-weekdays");
const calendarGrid = document.getElementById("cal-grid");
const calendarDetail = document.getElementById("cal-detail");

const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// What the calendar is showing. These reset when the page reloads.
let shownMonth = new Date();  // any day inside the month on screen
let openDay = null;           // the clicked day as "2026-09-10", or null

document.getElementById("cal-prev").onclick = () => changeMonth(-1);
document.getElementById("cal-next").onclick = () => changeMonth(+1);

function changeMonth(step) {
  shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + step, 1);
  renderCalendarCard();
}

/** Redraws the card from saved data. Called by refreshAll() in app.js. */
function renderCalendarCard() {
  const year = shownMonth.getFullYear();
  const month = shownMonth.getMonth();

  calendarMonthLabel.textContent = shownMonth.toLocaleDateString("en-US",
    { month: "long", year: "numeric" });

  calendarWeekdays.replaceChildren(
    ...WEEKDAY_NAMES.map((name) => el("span", { textContent: name })));

  // Day 0 of next month is the last day of this month, which gives the
  // month's length without having to handle leap years.
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdayOfThe1st = new Date(year, month, 1).getDay();

  const cells = [];
  // Empty cells first, so the 1st lines up under the right weekday.
  for (let i = 0; i < weekdayOfThe1st; i++) {
    cells.push(el("div", { className: "cal-day blank" }));
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(buildDayCell(dateToStr(new Date(year, month, day))));
  }
  calendarGrid.replaceChildren(...cells);

  renderOpenDay();
}

/** One clickable day in the grid: its number and up to two dots. */
function buildDayCell(dateStr) {
  const summary = summarizeDay(dateStr);

  const day = dayType(strToDate(dateStr));

  const classes = ["cal-day"];
  if (day.kind === "off") classes.push("off");
  if (dateStr === todayStr()) classes.push("today");
  if (dateStr === openDay) classes.push("selected");
  // "2026-09-10" style dates sort correctly as plain text.
  if (dateStr > todayStr()) classes.push("future");

  const dots = [];
  if (summary.allVideosDone) dots.push(el("i", { className: "dot dot-videos" }));
  if (summary.allTasksDone) dots.push(el("i", { className: "dot dot-daily" }));

  return el("button", {
    className: classes.join(" "),
    title: day.kind === "off" ? day.name : "", // shown when hovering the day
    onclick: () => {
      openDay = (openDay === dateStr) ? null : dateStr; // a second click closes it
      renderCalendarCard();
    },
  }, [
    el("span", { textContent: strToDate(dateStr).getDate() }),
    el("span", { className: "cal-dots" }, dots),
  ]);
}

/** Everything the calendar needs to know about one day. */
function summarizeDay(dateStr) {
  const today = getDayPlan(dateStr, "today") || [];
  const prep = getDayPlan(dateStr, "prep") || [];
  const videos = [...today, ...prep];
  const ticks = getDailyChecks(dateStr);
  const tickedTasks = DAILY_TASKS.filter((task) => ticks[task]);

  return {
    today,
    prep,
    tickedTasks,
    // A day with no videos assigned doesn't count as "all done".
    allVideosDone: videos.length > 0 && videos.every((entry) => entry.done),
    allTasksDone: tickedTasks.length === DAILY_TASKS.length,
  };
}

/** Draws the panel under the grid for the clicked day, or hides it. */
async function renderOpenDay() {
  calendarDetail.hidden = !openDay;
  if (!openDay) return;

  const summary = summarizeDay(openDay);
  const catalogs = await getAllCatalogs();
  const day = dayType(strToDate(openDay));

  const rows = [
    ...summary.today.map((entry) => buildDetailRow(entry, catalogs, false)),
    ...summary.prep.map((entry) => buildDetailRow(entry, catalogs, true)),
  ];

  if (rows.length === 0) {
    rows.push(el("li", {
      textContent: openDay > todayStr() ? "Not planned yet." : "No videos were assigned this day.",
    }));
  }

  const taskNames = summary.tickedTasks.length ? ` (${summary.tickedTasks.join(", ")})` : "";
  rows.push(el("li", {
    textContent: `Daily checklist: ${summary.tickedTasks.length}/${DAILY_TASKS.length}${taskNames}`,
  }));
  for (const task of MINUTES_TASKS) {
    const minutes = getTaskMinutes(openDay, task);
    if (minutes === null) continue;
    rows.push(el("li", {}, [
      el("span", { className: "cal-detail-title", textContent: task }),
      ` — ${minutes} min`,
    ]));
  }
  for (const task of Object.keys(TASK_DETAILS)) {
    const { fields, scores } = getTaskDetails(openDay, task);
    // "Algebra quiz 90%", for each box with something in it.
    const entries = fields
      .map((text, i) => [text.trim(), scores[i] === null ? "" : `${scores[i]}%`].filter(Boolean).join(" "))
      .filter(Boolean);
    if (entries.length === 0) continue;
    rows.push(el("li", {}, [
      el("span", { className: "cal-detail-title", textContent: task }),
      " — " + entries.join(" · "),
    ]));
  }

  calendarDetail.replaceChildren(
    el("h3", {
      textContent: strToDate(openDay).toLocaleDateString("en-US",
        { weekday: "long", month: "long", day: "numeric" }),
    }),
    el("p", { className: "cal-day-type", textContent: `${day.name} · ${day.videos} videos` }),
    el("ul", {}, rows),
  );
}

/** One video in the open day's panel: "✓ Title — Mathematik · 90%". */
function buildDetailRow(entry, catalogs, isPrep) {
  const found = videoOf(entry, catalogs);
  const title = found ? found.video.title : "(video removed)";

  const details = [found ? found.catalog.subject : ""];
  if (isPrep) details.push("prep for the next day");
  if (entry.score !== null) details.push(`${entry.score}%`);
  const about = details.filter(Boolean).join(" · ");

  return el("li", { className: entry.done ? "done" : "" }, [
    el("span", {
      className: "cal-detail-title",
      textContent: (entry.done ? "✓ " : "○ ") + title,
    }),
    about ? " — " + about : "",
  ]);
}
