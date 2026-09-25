/**
 * cards/tomorrow.js — the Prepare for Tomorrow card.
 *
 * One video for each of tomorrow's lessons, to watch today so you walk into
 * class already knowing the topic. These are part of today's work: they're
 * ticked and scored just like Today's Videos, and the export on the Today's
 * Result card only unlocks once they're done too.
 *
 * When tomorrow has no lessons (a weekend or a day off) there's nothing to
 * prepare, so the list starts empty. You can still add videos to it.
 */

const tomorrowSubtitle = document.getElementById("tomorrow-subtitle");
const tomorrowList = document.getElementById("tomorrow-list");
const tomorrowActions = document.getElementById("tomorrow-actions");

/** Redraws the card from saved data. Called by refreshAll() in app.js. */
async function renderTomorrowCard() {
  const plan = await getTodayList("prep");
  const catalogs = await getAllCatalogs();

  const date = strToDate(tomorrowStr());
  const tomorrow = dayType(date);
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });

  if (tomorrow.kind === "school") {
    tomorrowSubtitle.textContent = `${weekday}'s lessons: ${tomorrow.lessons.join(", ")}. Practice them today.`;
  } else {
    const why = tomorrow.kind === "off" ? tomorrow.name : "the weekend";
    tomorrowSubtitle.textContent = `No lessons tomorrow (${why}), so there's nothing to prepare.`;
  }

  tomorrowList.replaceChildren(...buildPlanRows("prep", plan, catalogs));
  tomorrowActions.replaceChildren(...buildPlanActions("prep", plan));
}
