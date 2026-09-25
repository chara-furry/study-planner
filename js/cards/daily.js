/**
 * cards/daily.js — the Daily Checklist card.
 *
 * Shows the items in DAILY_TASKS (config.js) as checkboxes. Ticks are saved
 * per day, so the list starts empty again each morning while earlier days
 * keep their record for the calendar.
 *
 * AUTO_TICKED_TASK (Sofatutor) is the exception: its box can't be clicked,
 * because it ticks itself once all of today's videos are ticked and scored (see
 * syncAutoTickedTask in plan.js). Its row says how far along they are.
 *
 * Items in TASK_DETAILS get three text boxes, each with its own score box.
 * Items in MINUTES_TASKS (Membean) get a box for the minutes spent instead.
 * Either way, the checkbox stays locked until everything is filled in, and
 * unticks itself if a box is emptied again.
 */

const dailyList = document.getElementById("daily-list");
const dailyDoneMessage = document.getElementById("daily-done-msg");

/** Redraws the card from saved data. Called by refreshAll() in app.js. */
function renderDailyCard() {
  const rows = DAILY_TASKS.map((item, index) => {
    const isAuto = item === AUTO_TICKED_TASK;

    const className = TASK_DETAILS[item] ? "task-with-details"
      : MINUTES_TASKS.includes(item) ? "task-with-minutes" : "";

    return el("li", { className }, [
      el("input", {
        type: "checkbox",
        id: `daily-${index}`, // lets refreshAll() keep the keyboard cursor here
        ariaLabel: isAuto ? `${item}, ticks itself when today's videos are watched and scored` : item,
        onchange: (event) => {
          setDailyCheck(todayStr(), item, event.target.checked);
          refreshAll();
        },
      }),
      el("div", { className: "row-text" }, [
        el("div", { className: "row-title", textContent: item }),
        isAuto ? el("div", { className: "row-subtitle" }) : "",
      ]),
      MINUTES_TASKS.includes(item) ? buildMinutesBox(item, index) : "",
      TASK_DETAILS[item] ? buildTaskDetails(item, index) : "",
    ]);
  });

  dailyList.replaceChildren(...rows);
  updateDailyTicks();
}

/**
 * Brings the checkboxes, strike-throughs and the "complete" message up to date
 * without redrawing the rows, so typing in a text box isn't interrupted.
 */
function updateDailyTicks() {
  const ticks = getDailyChecks(todayStr());

  DAILY_TASKS.forEach((item, index) => {
    const checkbox = document.getElementById(`daily-${index}`);
    const row = checkbox.closest("li");
    const ticked = Boolean(ticks[item]);
    const complete = taskDetailsComplete(todayStr(), item);

    checkbox.checked = ticked;
    checkbox.disabled = item === AUTO_TICKED_TASK || !complete;
    checkbox.title = complete ? "" : "Fill in every box first";
    row.classList.toggle("done", ticked);

    if (item === AUTO_TICKED_TASK) row.querySelector(".row-subtitle").textContent = describeAutoTask(ticked);
  });

  dailyDoneMessage.hidden = !DAILY_TASKS.every((item) => ticks[item]);
}

/**
 * After a box beside a checklist item changes: unticks the item if it's no
 * longer fully filled in, then updates only the parts of the page that depend
 * on it, so typing isn't interrupted.
 */
function afterTaskBoxChange(item) {
  if (!taskDetailsComplete(todayStr(), item) && getDailyChecks(todayStr())[item]) {
    setDailyCheck(todayStr(), item, false);
  }
  updateDailyTicks();
  renderOverview();
  renderResultCard();
  renderCalendarCard();
}

/** The box beside a checklist item for the minutes spent on it. */
function buildMinutesBox(item, index) {
  let minutes = getTaskMinutes(todayStr(), item);

  return el("label", { className: "score minutes" }, [
    el("input", {
      type: "number",
      id: `daily-${index}-minutes`,
      min: 0,
      max: 1440,
      inputMode: "numeric",
      placeholder: "–",
      value: minutes ?? "",
      ariaLabel: `${item}: minutes trained (required)`,
      required: true,
      oninput: (event) => {
        minutes = readMinutes(event.target.value);
        setTaskMinutes(todayStr(), item, minutes);
        afterTaskBoxChange(item);
      },
      // Once the cursor leaves, show the number as it was saved.
      onchange: (event) => { event.target.value = minutes ?? ""; },
    }),
    "min",
  ]);
}

/** Turns what was typed into a whole number of minutes (0 to 1440), or null if blank. */
function readMinutes(text) {
  if (text.trim() === "") return null;
  const minutes = Math.round(Number(text));
  return Number.isNaN(minutes) ? null : Math.min(1440, Math.max(0, minutes));
}

/** The text boxes beside a checklist item, each paired with a score box. */
function buildTaskDetails(item, index) {
  const details = getTaskDetails(todayStr(), item);

  // Saves on every keystroke.
  const save = () => {
    setTaskDetails(todayStr(), item, details);
    afterTaskBoxChange(item);
  };

  const pairs = TASK_DETAILS[item].map((name, i) => el("div", { className: "task-pair" }, [
    el("input", {
      type: "text",
      id: `daily-${index}-field-${i}`,
      className: "task-field",
      placeholder: name,
      value: details.fields[i],
      title: details.fields[i], // shows the whole text when it's cut off with "…"
      ariaLabel: `${item}: ${name} (required)`,
      required: true,
      oninput: (event) => {
        details.fields[i] = event.target.value;
        event.target.title = event.target.value;
        save();
      },
    }),
    el("label", { className: "score" }, [
      el("input", {
        type: "number",
        id: `daily-${index}-score-${i}`,
        min: 0,
        max: 100,
        inputMode: "numeric",
        placeholder: "–",
        value: details.scores[i] ?? "",
        ariaLabel: `${item}: score for ${name}, in percent (required)`,
        required: true,
        oninput: (event) => {
          details.scores[i] = readScore(event.target.value);
          save();
        },
        // Once the cursor leaves, show the number as it was saved (0 to 100).
        onchange: (event) => { event.target.value = details.scores[i] ?? ""; },
      }),
      "%",
    ]),
  ]));

  return el("div", { className: "task-details" }, pairs);
}

/** The small line under the item that ticks itself. */
function describeAutoTask(ticked) {
  if (ticked) return "Ticked by itself: all of today's videos are watched and scored";

  const { done, total } = todaysVideoProgress();
  return `Ticks itself when all of today's videos are watched and have a % entered (${done} of ${total} so far)`;
}
