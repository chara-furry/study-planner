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

// ------------------------------------------------- starting level with the class
//
// A browser that has never run the planner would otherwise start at the first
// video of the year, a whole school year behind the class, and spend weeks
// catching up. START_CAUGHT_UP (config.js) counts the curriculum videos the
// class has already covered as watched, once, so the planner carries on from
// where school is.

async function catchUpWithClassOnFirstRun() {
  if (!START_CAUGHT_UP || hasSavedProgress()) return;

  for (const catalog of await getAllCatalogs()) {
    addWatched(catalog.id, videosCoveredByClass(catalog, todayStr()));
  }

  // Today may already have been given videos picked from no progress at all.
  // Nothing can have been ticked off them (ticking is progress, and there is
  // none), so they're worked out again from where the class is instead.
  deleteDayPlan(todayStr(), "today");
  deleteDayPlan(todayStr(), "prep");
}

// ----------------------------------------------------------------- start

catchUpWithClassOnFirstRun().then(refreshAll);
