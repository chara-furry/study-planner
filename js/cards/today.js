/**
 * cards/today.js — the Today's Videos card.
 *
 * Lists the videos plan.js picked for today's own lessons. The subject badge
 * is blue for subjects from the timetable and grey for fill-in picks. The rows,
 * score boxes and ✎ form come from plan-list.js, shared with the Prepare for
 * Tomorrow card.
 */

const todaySubtitle = document.getElementById("today-subtitle");
const todayList = document.getElementById("today-list");
const todayActions = document.getElementById("today-actions");
const todayDoneMessage = document.getElementById("today-done-msg");

/** Redraws the card from saved data. Called by refreshAll() in app.js. */
async function renderTodayCard() {
  const plan = await getTodayList("today");
  const catalogs = await getAllCatalogs();

  const catchUps = plan.filter((entry) => entry.catchUp).length;
  todaySubtitle.textContent = plan.length === 0
    ? "All catalogs are finished. Add a new one below!"
    : describeDay(todayStr()) +
      (catchUps > 0 ? ` · +${catchUps} to catch up with the class` : "");

  todayList.replaceChildren(...buildPlanRows("today", plan, catalogs));
  todayActions.replaceChildren(...buildPlanActions("today", plan));

  const allDone = plan.length > 0 && plan.every((entry) => entry.done);
  todayDoneMessage.hidden = !allDone;
}
