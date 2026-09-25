/**
 * cards/overview.js — how much of today is done, at a glance.
 *
 * Fills in the progress bar in the bar at the top of the page, and the small
 * counts in the headers of the Today's Videos, Prepare for Tomorrow and Daily
 * Checklist cards (like "2/3"), which stay visible when a card is folded up.
 *
 * A video counts as done once it's ticked and its score is entered. The
 * checklist counts every item except the one that ticks itself (Sofatutor),
 * since that's the videos again.
 */

const overviewLabel = document.getElementById("overview-label");
const overviewCount = document.getElementById("overview-count");
const overviewFill = document.getElementById("overview-fill");

/** Redraws the counts from saved data. Called by refreshAll() in app.js. */
function renderOverview() {
  const finished = (entry) => entry.done && entry.score !== null;
  const today = getDayPlan(todayStr(), "today") || [];
  const prep = getDayPlan(todayStr(), "prep") || [];
  const ticks = getDailyChecks(todayStr());
  const tasks = DAILY_TASKS.filter((task) => task !== AUTO_TICKED_TASK);

  const counts = {
    "today-count": [today.filter(finished).length, today.length],
    "tomorrow-count": [prep.filter(finished).length, prep.length],
    "daily-count": [DAILY_TASKS.filter((task) => ticks[task]).length, DAILY_TASKS.length],
  };
  for (const [id, [done, total]] of Object.entries(counts)) {
    const badge = document.getElementById(id);
    badge.textContent = total ? `${done}/${total}` : "";
    badge.classList.toggle("complete", total > 0 && done === total);
  }

  const done = today.filter(finished).length + prep.filter(finished).length +
    tasks.filter((task) => ticks[task]).length;
  const total = today.length + prep.length + tasks.length;
  const allDone = total > 0 && done === total;

  overviewLabel.textContent = allDone ? "All done for today 🎉" : "Done today";
  overviewCount.textContent = allDone ? "" : `${done} of ${total}`;
  overviewFill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  overviewFill.classList.toggle("complete", allDone);
}
