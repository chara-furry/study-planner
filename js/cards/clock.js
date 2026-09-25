/**
 * cards/clock.js — the clock in the bar at the top of the page: the time of
 * day ("Afternoon"), the time, and the date.
 *
 * It shows no saved data, so it isn't part of refreshAll(). It just redraws
 * itself every second, which keeps it on the right minute.
 */

const clockPeriod = document.getElementById("clock-period");
const clockTime = document.getElementById("clock-time");
const clockDate = document.getElementById("clock-date");

/** Turns a 24-hour hour into the label shown above the time. */
function timeOfDay(hour) {
  if (hour < 5) return "Night";
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  if (hour < 21) return "Evening";
  return "Night";
}

function updateClock() {
  const now = new Date();

  clockPeriod.textContent = timeOfDay(now.getHours());
  clockTime.textContent = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  clockDate.textContent = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

updateClock(); // draw immediately, rather than showing blanks for a second
setInterval(updateClock, 1000);
