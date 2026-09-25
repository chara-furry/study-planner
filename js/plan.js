/**
 * plan.js — decides which videos to watch each day, and lets you change them.
 *
 * There is no page code in here, only the rules. The Today's Videos and
 * Prepare for Tomorrow cards ask this file for their videos and draw them with
 * plan-list.js.
 *
 * Every day has two lists (the `list` argument below):
 *
 *   "today"  videos for today's own lessons
 *   "prep"   one video for each of tomorrow's lessons, to watch today so you
 *            walk into class already knowing the topic
 *
 * How many videos "today" gets (see dayType below):
 *
 *   school day, or an ordinary weekend    VIDEOS_PER_DAY      (3)
 *   a day off listed in DAYS_OFF          VIDEOS_PER_DAY_OFF  (9)
 *
 * How they are picked:
 *
 *   1. On a school day, take the subjects SCHEDULE (config.js) lists for that
 *      weekday.
 *   2. Fill the remaining slots one at a time, from the catalog picked the
 *      fewest times so far that day, breaking ties by whichever subject is
 *      least far ahead of the class (see curriculum.js). So every subject gets
 *      a turn before any gets a second: nine videos on a day off means one
 *      from each of the eight catalogs plus one extra.
 *   3. Catch up: while a subject would still be behind the class after
 *      today's videos, add one more of its videos, most-behind subject first,
 *      up to MAX_CATCH_UP_VIDEOS extra.
 *   4. From each chosen catalog, take the next video in curriculum order (see
 *      curriculum.js) that isn't watched and isn't in today's other list.
 *
 * "prep" is simply rule 4 for each of tomorrow's lessons. It's empty when
 * tomorrow is a weekend or a day off.
 *
 * Each list is worked out and saved the first time it's shown each day. That
 * keeps it steady while you work through it, and keeps a record for the
 * calendar. A video left unticked isn't lost: it's the next one in its
 * catalog, so it comes back the next time that subject is picked.
 */

/** One of today's lists of Entries (see storage.js for the shape). */
async function getTodayList(list) {
  const catalogs = await getAllCatalogs();
  const saved = getDayPlan(todayStr(), list);
  if (saved) return withoutMissingVideos(todayStr(), list, saved, catalogs);

  // "prep" must be picked after "today", so it can skip today's videos.
  if (list === "prep") await getTodayList("today");

  const entries = list === "today"
    ? pickVideosForDay(strToDate(todayStr()), catalogs)
    : pickPrepVideos(catalogs);

  saveDayPlan(todayStr(), list, entries);
  return entries;
}

/**
 * The catalog and video an Entry points at: { catalog, video }, or null when
 * they're gone. That happens when a catalog is deleted, and when an uploaded
 * one is replaced by a spreadsheet that no longer has the video.
 */
function videoOf(entry, catalogs) {
  const catalog = catalogs.find((c) => c.id === entry.catalogId);
  const video = catalog?.videos[entry.videoIndex];
  return video ? { catalog, video } : null;
}

/**
 * One of today's lists without the entries whose video is gone, saved again
 * if any were dropped. They can't be watched, so leaving them would hold the
 * day open for good. Earlier days keep theirs, as the record of that day.
 */
function withoutMissingVideos(dateStr, list, entries, catalogs) {
  const kept = entries.filter((entry) => videoOf(entry, catalogs));
  if (kept.length !== entries.length) saveDayPlan(dateStr, list, kept);
  return kept;
}

// --------------------------------------------------------------- day types

/**
 * What kind of day a date is:
 *
 *   { kind, name, videos, lessons }
 *   kind     "school", "weekend" or "off"
 *   name     "School day", "Weekend", or the holiday's name ("Autumn holidays")
 *   videos   how many videos its "today" list gets
 *   lessons  the timetable's subjects that day; empty when there's no school
 */
function dayType(date) {
  const holiday = holidayOn(date);
  if (holiday) {
    return { kind: "off", name: holiday, videos: VIDEOS_PER_DAY_OFF, lessons: [] };
  }

  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) {
    return { kind: "weekend", name: "Weekend", videos: VIDEOS_PER_DAY, lessons: [] };
  }

  return { kind: "school", name: "School day", videos: VIDEOS_PER_DAY, lessons: SCHEDULE[weekday] || [] };
}

/** The name of the DAYS_OFF entry a date falls in, or null. */
function holidayOn(date) {
  const dateStr = dateToStr(date);
  // "2026-09-10" style dates compare correctly as plain text.
  const holiday = DAYS_OFF.find((days) => dateStr >= days.from && dateStr <= (days.to || days.from));
  return holiday ? holiday.name : null;
}

// ------------------------------------------------------------ picking videos

/**
 * Works out the "today" list for the given date, following the rules at the
 * top of this file. It only reads saved progress, never changes anything, so
 * it's safe to call for any date to see what it would pick.
 */
function pickVideosForDay(date, catalogs) {
  const dateStr = dateToStr(date);
  const day = dayType(date);
  const unavailable = unavailableVideos(dateStr, "today", catalogs);
  const picks = [];
  const otherList = getDayPlan(dateStr, "prep") || [];

  const timesPicked = (catalog) => picks.filter((pick) => pick.catalogId === catalog.id).length;

  // Weeks ahead of the class once today's videos so far are watched.
  const weeksAheadAfterToday = (catalog) => {
    const planned = [...picks, ...otherList]
      .filter((entry) => entry.catalogId === catalog.id)
      .map((entry) => entry.videoIndex);
    return curriculumStatus(catalog, dateStr, planned).weeksAhead;
  };

  // Rule 1: the timetable's subjects for this day.
  for (const subject of day.lessons) {
    if (picks.length >= day.videos) break;

    const catalog = catalogs.find((c) =>
      c.subject === subject && timesPicked(c) === 0 && nextVideo(c, unavailable) !== -1);
    if (catalog) picks.push(takeNextVideo(catalog, unavailable, true));
  }

  // Rule 2: top up, least-picked first, then the least far ahead.
  while (picks.length < day.videos) {
    const candidates = catalogs.filter((c) => nextVideo(c, unavailable) !== -1);
    if (candidates.length === 0) break; // every catalog is finished

    const ahead = new Map(candidates.map((c) => [c, weeksAheadAfterToday(c)]));
    candidates.sort((a, b) => timesPicked(a) - timesPicked(b) || ahead.get(a) - ahead.get(b));
    picks.push(takeNextVideo(candidates[0], unavailable, false));
  }

  // Rule 3: catch up with the class. Only a curriculum video helps, so a
  // subject whose next video is outside the curriculum is skipped.
  for (let extra = 0; extra < MAX_CATCH_UP_VIDEOS; extra++) {
    const behind = catalogs
      .filter((c) => studyPlan(c).curriculum.includes(nextVideo(c, unavailable)))
      .map((c) => ({ catalog: c, weeksAhead: weeksAheadAfterToday(c) }))
      .filter((subject) => subject.weeksAhead < 0)
      .sort((a, b) => a.weeksAhead - b.weeksAhead);
    if (behind.length === 0) break;

    picks.push({ ...takeNextVideo(behind[0].catalog, unavailable, false), catchUp: true });
  }

  return picks;
}

/** Works out the "prep" list: one video for each of tomorrow's lessons. */
function pickPrepVideos(catalogs) {
  const tomorrow = dayType(strToDate(tomorrowStr()));
  const unavailable = unavailableVideos(todayStr(), "prep", catalogs);
  const picks = [];

  for (const subject of tomorrow.lessons) {
    const catalog = catalogs.find((c) =>
      c.subject === subject && !picks.some((pick) => pick.catalogId === c.id) &&
      nextVideo(c, unavailable) !== -1);
    if (catalog) picks.push(takeNextVideo(catalog, unavailable, true));
  }

  return picks;
}

/**
 * Makes an Entry for the next available video in a catalog, and marks that
 * video unavailable so the next pick doesn't take it too.
 */
function takeNextVideo(catalog, unavailable, scheduled) {
  const videoIndex = nextVideo(catalog, unavailable);
  unavailable.add(videoKey(catalog.id, videoIndex));
  return { catalogId: catalog.id, videoIndex, done: false, scheduled, custom: false, catchUp: false, score: null };
}

/** Position of the next video in study order that isn't unavailable, or -1. */
function nextVideo(catalog, unavailable) {
  const next = studyPlan(catalog).order.find((index) => !unavailable.has(videoKey(catalog.id, index)));
  return next ?? -1;
}

/**
 * Every video that can't go in one of a day's lists: the watched ones, and
 * the ones in that day's other list. `list` is the one being filled. Returned
 * as a Set of videoKey()s.
 *
 * Other days' lists don't count, which is what lets a video left unticked
 * come back.
 */
function unavailableVideos(dateStr, list, catalogs) {
  const keys = new Set();

  for (const catalog of catalogs) {
    for (const index of getWatched(catalog.id)) keys.add(videoKey(catalog.id, index));
  }

  const otherList = list === "today" ? "prep" : "today";
  for (const entry of getDayPlan(dateStr, otherList) || []) {
    keys.add(videoKey(entry.catalogId, entry.videoIndex));
  }

  return keys;
}

/**
 * The videos you could put in one slot of a list, for the ✎ form. Leaves out
 * everything unavailableVideos() does, plus the list's other slots. `slot` is
 * -1 when adding a new video.
 *
 * Returns a Map of catalog id -> video positions, holding only catalogs that
 * have at least one video to choose.
 */
function videosToChooseFrom(list, plan, slot, catalogs) {
  const unavailable = unavailableVideos(todayStr(), list, catalogs);
  plan.forEach((entry, i) => {
    if (i !== slot) unavailable.add(videoKey(entry.catalogId, entry.videoIndex));
  });

  const choices = new Map();
  for (const catalog of catalogs) {
    // In study order, so the videos coming up next are at the top.
    const free = studyPlan(catalog).order.filter((index) => !unavailable.has(videoKey(catalog.id, index)));
    if (free.length > 0) choices.set(catalog.id, free);
  }
  return choices;
}

/** One video as a single string, e.g. "builtin:mathematik#12", for use in a Set. */
function videoKey(catalogId, videoIndex) {
  return `${catalogId}#${videoIndex}`;
}

// ----------------------------------------------------------- changing a list
//
// Each of these changes one of today's two lists. `slot` is a video's
// position in that list.

/** Ticks one video on or off. */
function markVideoDone(list, slot, done) {
  const plan = getDayPlan(todayStr(), list) || [];
  const entry = plan[slot];
  if (!entry) return;

  entry.done = done;
  saveDayPlan(todayStr(), list, plan);
  setWatched(entry.catalogId, entry.videoIndex, done);
}

/** Saves the score for one video: a whole number from 0 to 100, or null. */
function setScore(list, slot, score) {
  const plan = getDayPlan(todayStr(), list) || [];
  if (!plan[slot]) return;

  plan[slot].score = score;
  saveDayPlan(todayStr(), list, plan);
}

/** Puts a different video in one slot. */
async function changeVideo(list, slot, catalogId, videoIndex) {
  const plan = await getTodayList(list);
  plan[slot] = { catalogId, videoIndex, done: false, scheduled: false, custom: true, catchUp: false, score: null };
  saveDayPlan(todayStr(), list, plan);
}

/** Adds one more video to the end of a list. */
async function addVideo(list, catalogId, videoIndex) {
  const plan = await getTodayList(list);
  plan.push({ catalogId, videoIndex, done: false, scheduled: false, custom: true, catchUp: false, score: null });
  saveDayPlan(todayStr(), list, plan);
}

async function removeVideo(list, slot) {
  const plan = await getTodayList(list);
  plan.splice(slot, 1);
  saveDayPlan(todayStr(), list, plan);
}

/**
 * How many of today's videos are finished, across both lists: ticked and with
 * a score entered. { done: 4, total: 6 }.
 */
function todaysVideoProgress() {
  const videos = [...(getDayPlan(todayStr(), "today") || []), ...(getDayPlan(todayStr(), "prep") || [])];
  const finished = videos.filter((entry) => entry.done && entry.score !== null);
  return { done: finished.length, total: videos.length };
}

/**
 * Ticks AUTO_TICKED_TASK (config.js) in today's checklist once every video in
 * both of today's lists is ticked and scored, and unticks it otherwise.
 * refreshAll() calls this, so it keeps up with every change to the videos
 * without each change having to remember to.
 *
 * A day with no videos at all (every catalog finished) counts as done, so the
 * item can't get stuck unticked.
 */
function syncAutoTickedTask() {
  if (!AUTO_TICKED_TASK) return;

  const { done, total } = todaysVideoProgress();
  const shouldBeTicked = done === total;
  if (Boolean(getDailyChecks(todayStr())[AUTO_TICKED_TASK]) !== shouldBeTicked) {
    setDailyCheck(todayStr(), AUTO_TICKED_TASK, shouldBeTicked);
  }
}

/** Throws away your changes to a list. It's worked out afresh when next shown. */
function resetList(list) {
  deleteDayPlan(todayStr(), list);
}

/**
 * True if a list was changed by hand and nothing in it is ticked yet, which
 * is when the "Reset" button is offered. (Once something is ticked, resetting
 * would rewrite what you actually did.)
 */
function canResetList(list, plan) {
  const usualLength = list === "today"
    ? dayType(strToDate(todayStr())).videos
    : dayType(strToDate(tomorrowStr())).lessons.length;

  // Catch-up videos come and go with progress, so they aren't counted.
  const automatic = plan.filter((entry) => !entry.custom && !entry.catchUp).length;
  const changed = plan.some((entry) => entry.custom) || automatic !== usualLength;
  return changed && !plan.some((entry) => entry.done);
}
