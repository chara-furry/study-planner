# Study Planner

A personal study site. Every day it picks sofatutor videos to watch based on the
Klasse 8 timetable: three on a school day, nine on a holiday to get ahead, plus
one for each of tomorrow's lessons so you can practice them the day before. You
enter the score you got on each video, and once the whole day is done (every
video ticked and scored, the daily checklist ticked) you can export the day's
results as a PDF or a Word document. A calendar keeps a record of what got done.

Videos follow the school's Klasse 8 curriculum ("Themenübersicht"), topic by
topic, and the planner keeps you ahead of the class: it estimates where the
class is in each subject and adds catch-up videos while you're behind. The
Catalogs card shows how many weeks ahead you are.

It runs entirely in the browser: no server, no build step, no libraries, no
accounts. Progress is saved in the browser it was entered in and doesn't follow
you to another browser or computer.

---

## Running it

**To use it:** open `index.html` in a browser.

**While editing the code:** run the included server, which stops the browser
from caching old copies of your files:

```
python tools/serve.py
```

then open http://localhost:8765. After saving a change, just refresh the page.

---

## How the code is organized

```
index.html              the page: the bar at the top, then two columns of
                        cards
style.css               all styling; colors are at the top
catalogs.js             the 2,557 built-in videos (generated, don't edit)

js/
  config.js             SETTINGS: timetable, holidays, curriculum, videos per
                        day, checklist
  storage.js            everything saved in the browser goes through here
  dom.js                el(), a helper for building page elements
  pdf.js                writes PDF files (you can ignore this one too)
  font.js               reads the font PDFs are written in (and this one)
  docx.js               writes Word files (and this one)
  plan.js               the rules for picking and changing each day's videos
  plan-list.js          a list of videos with checkboxes, score boxes and the ✎
                        form (Today's Videos and Prepare for Tomorrow share it)
  xlsx.js               reads uploaded spreadsheets (you can ignore this one)
  curriculum.js         curriculum order, and how far ahead of the class you are
  cards/                one file per card on the page
    clock.js            the clock in the bar at the top
    daily.js            Daily Checklist
    today.js            Today's Videos
    tomorrow.js         Prepare for Tomorrow
    result.js           Today's Result: the PDF and Word exports, and what
                        unlocks them
    calendar.js         Calendar
    catalogs.js         Catalogs
    overview.js         the "done today" bar at the top, and the cards' counts
  app.js                starts everything; holds refreshAll()

fonts/
  noto-sans-tc.js       the font PDFs are written in (generated, don't edit;
                        see fonts/README.md for its license)

tools/
  serve.py              local server for development
  build_font.py         regenerates fonts/noto-sans-tc.js from the .ttf
  build_catalogs.py     regenerates catalogs.js from the .xlsx files
```

Every card file follows the same pattern:

1. Look up the page elements it draws into, with `document.getElementById`.
2. A `render…Card()` function that redraws the whole card from saved data.
3. When the user changes something: save it, then call `refreshAll()`.

`cards/today.js` is the shortest of them, and a good one to read first;
`cards/daily.js` shows what a card with its own boxes to fill in looks like.

### The one rule

**After changing any saved data, call `refreshAll()`.**

It redraws every card from saved data. That's why ticking a video also updates
the calendar's dots and the progress bar without either card knowing about the
other. A new card joins in by adding one line to `refreshAll()` in `app.js`.

---

## Common changes

### Change the timetable, holidays, curriculum, videos per day, or checklist items

Edit `js/config.js`. That's all it takes.

`AUTO_TICKED_TASK` is the checklist item that ticks itself once all of today's
videos are ticked and have their score (%) entered (Sofatutor, since that's
where the videos are). Set it to `null` to make it a normal checkbox again.

`TASK_DETAILS` lists the checklist items that get three required text boxes,
each with its own score box (Edmentum, Wisdomhall, Achieve3000). The names
given there are the boxes' placeholders. An item can't be ticked until every
box and score is filled in.

`MINUTES_TASKS` lists the checklist items that get a required box for the
minutes spent on them (Membean).

`DAYS_OFF` holds the 2026/27 school calendar's holidays. Add next year's there
when the new calendar comes out; until then, every weekday after 5 Sep 2027 is
treated as a school day.

Subject names in `SCHEDULE` and `CURRICULUM` must match a catalog's subject,
which is the first word of its spreadsheet's sheet name: "**Mathematik** Klasse
8 Katalog".

`CURRICULUM` lists each subject's topics in teaching order, and which sofatutor
videos cover each one: whole headings (the light blue rows in the spreadsheet)
under `sections`, or exact video titles under `videos`. If a name doesn't match
anything, the browser console (F12) says so. For Klasse 9, replace the topics
and update `SCHOOL_YEAR` along with `DAYS_OFF`.

`MAX_CATCH_UP_VIDEOS` caps how many extra videos a day gets while a subject is
behind the class. Where the class is, is an estimate: it assumes each subject's
curriculum is spread evenly over the school year's business days (weekdays in
`SCHOOL_YEAR`, skipping `DAYS_OFF`).

### Change the PDF or Word report

The PDF's layout is `buildReportPdf()` in `js/cards/result.js`, written as a
sequence of `pdf.text(...)`, `pdf.line(...)` and `pdf.box(...)` calls. The
Word version is `buildReportDocx()` in the same file, built from paragraphs
and tables; change both to keep them matching.

What unlocks the exports is `whatsLeft()` in the same file: to stop requiring
scores, for example, delete the line that counts `unscored`.

### Change the colors

Edit the variables at the top of `style.css`, for example `--accent` for the
blue used on buttons, progress bars and today's date.

### Add a new card

Here's a complete example: a **Streak** card showing how many days in a row the
whole daily checklist was finished.

**1. Add the card to `index.html`.** Copy an existing `<section>` (there's a
template in a comment at the top of `<main>`), give it a new id, and put your
content inside `section-body`:

```html
<section id="streak-section" class="card collapsible">
  <div class="section-header">
    <h2><span class="card-icon" aria-hidden="true">🔥</span>Streak</h2>
    <button class="collapse-toggle" aria-label="Collapse section">▾</button>
  </div>
  <div class="section-body">
    <p id="streak-count"></p>
  </div>
</section>
```

Put it in either of the two `<div class="column">`s, whichever side you want
it on. `card` gives it the white box and `collapsible` makes it fold up when
its header is clicked. Both work without any extra code.

**2. Create `js/cards/streak.js`:**

```js
/**
 * cards/streak.js — how many days in a row the daily checklist was finished.
 */

const streakCount = document.getElementById("streak-count");

/** Redraws the card from saved data. Called by refreshAll() in app.js. */
function renderStreakCard() {
  const day = new Date();

  // Today doesn't break the streak until it's over, so if it isn't finished
  // yet, start counting from yesterday.
  if (!checklistFinished(day)) day.setDate(day.getDate() - 1);

  let streak = 0;
  while (checklistFinished(day)) {
    streak++;
    day.setDate(day.getDate() - 1);
  }

  streakCount.textContent = `🔥 ${streak} day${streak === 1 ? "" : "s"} in a row`;
}

/** True if every item in DAILY_TASKS was ticked on the given date. */
function checklistFinished(date) {
  const ticks = getDailyChecks(dateToStr(date));
  return DAILY_TASKS.every((task) => ticks[task]);
}
```

**3. Load it in `index.html`**, in the group of card scripts (before `app.js`):

```html
<script src="js/cards/streak.js"></script>
```

**4. Add it to `refreshAll()` in `js/app.js`:**

```js
async function refreshAll() {
  renderDailyCard();
  renderStreakCard();   // ← new
  ...
}
```

Done. The streak now updates whenever a checklist item is ticked, because
ticking calls `refreshAll()`.

### Save a new kind of data

Add a small pair of functions to `js/storage.js`, next to the similar ones
there, and call them from your card. For example, to save notes per day:

```js
function getNote(dateStr) {
  return loadJSON("notes", {})[dateStr] || "";
}

function setNote(dateStr, text) {
  const all = loadJSON("notes", {});
  all[dateStr] = text;
  saveJSON("notes", all);
}
```

Then from a card: `setNote(todayStr(), text); refreshAll();`

Also add a line describing the new key to the list at the top of
`storage.js`, so the next person knows it exists.

### Build a list of rows

Use `el()` from `js/dom.js` and the `.rows` style from `style.css`, the same
way the checklist does:

```js
const rows = items.map((item) =>
  el("li", {}, [
    el("input", { type: "checkbox", onchange: () => { /* save, then refreshAll() */ } }),
    el("span", { className: "row-title", textContent: item }),
  ])
);
myList.replaceChildren(...rows);   // myList is a <ul class="rows">
```

### Useful functions you can call from any card

| Function | Gives you |
|---|---|
| `todayStr()` / `tomorrowStr()` | today or tomorrow as `"2026-09-10"` |
| `dateToStr(date)` / `strToDate(str)` | convert between Date and `"2026-09-10"` |
| `getDailyChecks(dateStr)` | `{ "Sofatutor": true, ... }` for that day |
| `getDayPlan(dateStr, list)` | one of that day's saved lists of videos, or `null`; `list` is `"today"` or `"prep"` |
| `await getTodayList(list)` | one of today's lists, worked out if not saved yet |
| `dayType(date)` | school day, weekend or holiday, and how many videos it gets |
| `getWatched(catalogId)` | the Set of watched video positions |
| `await getAllCatalogs()` | every catalog, with its videos |
| `videoOf(entry, catalogs)` | the catalog and video an assigned video points at, or `null` once they're gone |
| `el(tag, properties, children)` | a new page element |

The shapes of catalogs, videos and assigned videos are described at the top of
`js/storage.js`.

### Update the built-in catalogs

`catalogs.js` is generated from the `.xlsx` files in the folder above `website/`.
After changing or adding spreadsheets, rebuild it:

```
pip install openpyxl
python tools/build_catalogs.py
```

For a one-off catalog, the upload button on the site works too.

---

## When something goes wrong

**My change doesn't show up.** The browser is probably running a cached copy.
Use `python tools/serve.py`, or press Ctrl+F5 to force a full reload.

**A card is blank, or nothing happens.** Press F12 and look at the Console tab.
The error message names the file and line.

**"… is not defined".** Either a name is misspelled, or a script is loading
before the one it depends on. Check the order of the `<script>` tags at the
bottom of `index.html`: data, then helpers, then cards, then `app.js` last.

**I want to start over.** Clear the site's data in the browser (F12 →
Application → Clear site data). This deletes all progress.
