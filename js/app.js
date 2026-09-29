/**
 * app.js — starts the site and keeps every card up to date.
 *
 * This file loads last, after all the cards, so everything it calls exists.
 *
 * ---------------------------------------------------------------------------
 * The one rule: after changing any saved data, call refreshAll().
 *
 * Each card redraws itself completely from saved data, so no card needs to
 * know which other cards care about what it changed. Ticking a video, for
 * example, also has to update the calendar's dots and a progress bar; calling
 * refreshAll() takes care of all of that.
 * ---------------------------------------------------------------------------
 */

/** Redraws every card. Add your new card's render function to this list. */
async function refreshAll() {
  // Redrawing replaces the page's elements, which would drop the keyboard
  // cursor. Remember which element had it (by id) and put it back afterwards.
  const focusedId = document.activeElement?.id;

  await renderTodayCard();     // on a new day these two work out and save
  await renderTomorrowCard();  // today's videos, which the cards below read
  syncAutoTickedTask();        // ticks Sofatutor once those videos are done
  renderDailyCard();
  renderOverview();
  renderResultCard();
  renderCalendarCard();
  await renderCatalogsCard();

  if (focusedId) document.getElementById(focusedId)?.focus();
}

// ------------------------------------------------------ collapsing cards
//
// Any <section class="card collapsible"> gets this automatically: clicking its
// header hides or shows its body, and the choice is remembered.

for (const card of document.querySelectorAll(".collapsible")) {
  const header = card.querySelector(".section-header");
  const body = card.querySelector(".section-body");

  header.onclick = () => setCollapsed(card, !body.hidden);
  setCollapsed(card, isCardCollapsed(card.id)); // restore the saved state
}

function setCollapsed(card, collapsed) {
  const body = card.querySelector(".section-body");
  const arrow = card.querySelector(".collapse-toggle");

  body.hidden = collapsed;
  arrow.textContent = collapsed ? "▸" : "▾";
  arrow.setAttribute("aria-label", collapsed ? "Expand section" : "Collapse section");
  setCardCollapsed(card.id, collapsed);
}

// ------------------------------------------------------ a new day begins
//
// If the page is left open overnight, redraw everything once the date changes,
// so the morning shows a new plan and an empty checklist. Checking every second
// is simpler than setting a timer for midnight, and also works if the computer
// was asleep at midnight.

let dateLastChecked = todayStr();

setInterval(() => {
  if (todayStr() !== dateLastChecked) {
    dateLastChecked = todayStr();
    refreshAll();
  }
}, 1000);

// ----------------------------------------- staying level with the class
//
// A browser that starts at the first video of the year is a whole school year
// behind the class, and would spend weeks catching up. Counting the curriculum
// videos the class has already covered as watched fixes that, and the planner
// carries on from where school is.
//
// It happens by itself once per browser (START_CAUGHT_UP in config.js), and
// again whenever the Catch up button in the bar at the top is pressed.

const catchUpButton = document.getElementById("catch-up-btn");

/**
 * Counts every curriculum video the class has covered by today as watched,
 * and says how many that added. Videos are only ever added, so anything
 * watched ahead of the class stays exactly as it was.
 */
async function catchUpWithClass() {
  let added = 0;

  for (const catalog of await getAllCatalogs()) {
    const before = getWatched(catalog.id).size;
    addWatched(catalog.id, videosCoveredByClass(catalog, todayStr()));
    added += getWatched(catalog.id).size - before;
  }

  // Today's videos may have been picked from further back. They're worked out
  // again, unless the day is under way: a list with something ticked or scored
  // on it is the record of what was actually watched.
  for (const list of ["today", "prep"]) {
    const plan = getDayPlan(todayStr(), list) || [];
    const untouched = plan.every((entry) => !entry.done && entry.score === null);
    if (untouched) deleteDayPlan(todayStr(), list);
  }

  return added;
}

// The automatic run, remembered under "caughtUp" so it only happens once,
// whether or not anything has been watched in this browser already.
async function catchUpWithClassOnce() {
  if (!START_CAUGHT_UP || isCaughtUpWithClass()) return;
  rememberCaughtUpWithClass();
  await catchUpWithClass();
}

catchUpButton.onclick = async () => {
  const question = "Count every video the class has already covered as watched?\n\n"
    + "Nothing is un-watched, and a day you've already started is kept as it is.";
  if (!confirm(question)) return;

  const added = await catchUpWithClass();
  await refreshAll();

  alert(added === 0
    ? "You were already level with the class."
    : `${added} video${added === 1 ? "" : "s"} counted as watched. You're level with the class.`);
};

// ----------------------------------------------------------------- start

catchUpWithClassOnce().then(refreshAll);
