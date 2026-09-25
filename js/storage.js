/**
 * storage.js — every read and write of saved data goes through this file.
 *
 * Nothing else in the site touches localStorage or IndexedDB directly. So if
 * you add a feature that needs to remember something, add a small get/save
 * pair here, the same way the sections below do, and call those from your card.
 *
 * All data stays in the browser it was entered in. There are no accounts and
 * nothing syncs between devices.
 *
 * ---------------------------------------------------------------------------
 * What is saved, and where
 *
 *   localStorage "progress"
 *     Which videos have been watched, per catalog. Never reset.
 *     { "builtin:mathematik": { done: [0, 1, 4] }, ... }
 *
 *   localStorage "assignments"
 *     The videos each day was given for its own lessons (the "today" list),
 *     kept forever as history for the calendar.
 *     { "2026-09-10": [Entry, Entry, Entry], ... }
 *
 *   localStorage "prep"
 *     The videos each day was given to prepare for the next day's lessons
 *     (the "prep" list). Same layout as "assignments".
 *
 *   localStorage "daily"
 *     Which checklist items were ticked, per day.
 *     { "2026-09-10": { "Sofatutor": true, "Membean": true }, ... }
 *
 *   localStorage "dailyDetails"
 *     What was typed into a checklist item's text boxes, and the score beside
 *     each one, per day (see TASK_DETAILS in config.js). A score is null until
 *     entered.
 *     { "2026-09-10": { "Edmentum": { fields: ["", "", ""], scores: [85, null, null] } }, ... }
 *
 *   localStorage "dailyMinutes"
 *     The minutes entered for a checklist item, per day (see MINUTES_TASKS in
 *     config.js).
 *     { "2026-09-10": { "Membean": 15 }, ... }
 *
 *   localStorage "collapsed:<card id>"
 *     "1" if that card is collapsed, "0" if open.
 *
 *   IndexedDB "planner" -> store "catalogs"
 *     Uploaded catalogs, looked up by id. IndexedDB is used instead of
 *     localStorage because a catalog can be hundreds of KB, and localStorage
 *     only holds about 5 MB in total.
 *
 * ---------------------------------------------------------------------------
 * The shapes used throughout the site
 *
 *   Catalog  { id, subject, label, source, videos: [Video, ...] }
 *            id       "builtin:mathematik" or "upload:englisch klasse 8"
 *            subject  "Mathematik", matched against SCHEDULE in config.js
 *            label    "Mathematik Klasse 8", shown to the user
 *            source   "built-in" or "uploaded"
 *
 *   Video    { title, topic }
 *            topic is the bold heading the video sits under in the spreadsheet
 *
 *   Entry    { catalogId, videoIndex, done, scheduled, custom, catchUp, score }
 *            One video assigned to one day. videoIndex is its position in the
 *            catalog's videos list. scheduled is true when the subject came
 *            from the timetable, false when it was a fill-in pick. custom is
 *            true when you picked the video yourself instead of the planner.
 *            catchUp is true for an extra video added to catch up with the
 *            class. score is the percentage you entered for it, or null.
 *
 *   list     "today" or "prep": which of a day's two lists of videos.
 */

// ---------------------------------------------------------------- helpers

/** Reads a saved value, or returns `fallback` if it is missing or unreadable. */
function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Today's date as "2026-09-10", in the user's own time zone.
 *
 * (The built-in toISOString() is not used because it switches to UTC first,
 * which gives the wrong date for part of every day outside the UK.)
 */
function todayStr() {
  return dateToStr(new Date());
}

/** Tomorrow's date as "2026-09-11". */
function tomorrowStr() {
  const date = strToDate(todayStr());
  date.setDate(date.getDate() + 1); // rolls over into the next month by itself
  return dateToStr(date);
}

/** Turns a Date into "2026-09-10". */
function dateToStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Turns "2026-09-10" back into a Date (at midnight, local time). */
function strToDate(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// ------------------------------------------------------ watched videos

/** Returns the Set of video indexes watched in one catalog. */
function getWatched(catalogId) {
  const progress = loadJSON("progress", {});
  return new Set(progress[catalogId]?.done || []);
}

/** Marks one video as watched (true) or not watched (false). */
function setWatched(catalogId, videoIndex, watched) {
  const progress = loadJSON("progress", {});
  const indexes = new Set(progress[catalogId]?.done || []);

  if (watched) indexes.add(videoIndex);
  else indexes.delete(videoIndex);

  progress[catalogId] = { done: [...indexes] };
  saveJSON("progress", progress);
}

// ------------------------------------------------- videos assigned per day

// Where each of a day's two lists is saved. "assignments" predates the prep
// list, which is why the names don't match.
const LIST_KEYS = { today: "assignments", prep: "prep" };

/**
 * Returns one of a day's lists of Entries, or null if it hasn't been worked
 * out yet. `list` is "today" or "prep".
 */
function getDayPlan(dateStr, list) {
  return loadJSON(LIST_KEYS[list], {})[dateStr] || null;
}

function saveDayPlan(dateStr, list, entries) {
  const all = loadJSON(LIST_KEYS[list], {});
  all[dateStr] = entries;
  saveJSON(LIST_KEYS[list], all);
}

function deleteDayPlan(dateStr, list) {
  const all = loadJSON(LIST_KEYS[list], {});
  delete all[dateStr];
  saveJSON(LIST_KEYS[list], all);
}

/**
 * Moves everything saved about one catalog's videos to new positions, for
 * when an uploaded catalog is replaced by a corrected spreadsheet (see
 * uploadCatalog in cards/catalogs.js). Videos are saved by their position in
 * the catalog, which the new spreadsheet can change.
 *
 * `moved` maps an old position to its new one. A position left out of it is a
 * video the new spreadsheet doesn't have, so it is forgotten: it stops
 * counting as watched, and drops out of the days it was assigned to.
 */
function moveSavedVideos(catalogId, moved) {
  const progress = loadJSON("progress", {});
  if (progress[catalogId]) {
    const done = (progress[catalogId].done || []).filter((i) => moved.has(i));
    progress[catalogId] = { done: done.map((i) => moved.get(i)) };
    saveJSON("progress", progress);
  }

  for (const key of Object.values(LIST_KEYS)) {
    const days = loadJSON(key, {});
    for (const [dateStr, entries] of Object.entries(days)) {
      days[dateStr] = entries
        .filter((entry) => entry.catalogId !== catalogId || moved.has(entry.videoIndex))
        .map((entry) => entry.catalogId === catalogId
          ? { ...entry, videoIndex: moved.get(entry.videoIndex) }
          : entry);
    }
    saveJSON(key, days);
  }
}

// ------------------------------------------------------- daily checklist

/** Returns { "Sofatutor": true, ... } for one day. Missing items are unticked. */
function getDailyChecks(dateStr) {
  return loadJSON("daily", {})[dateStr] || {};
}

function setDailyCheck(dateStr, item, ticked) {
  const all = loadJSON("daily", {});
  all[dateStr] = { ...all[dateStr], [item]: ticked };
  saveJSON("daily", all);
}

/** A checklist item's text boxes and their scores for one day, blank if never filled. */
function getTaskDetails(dateStr, task) {
  const saved = (loadJSON("dailyDetails", {})[dateStr] || {})[task];
  const count = (TASK_DETAILS[task] || []).length;
  return {
    fields: Array.from({ length: count }, (_, i) => saved?.fields?.[i] ?? ""),
    scores: Array.from({ length: count }, (_, i) => saved?.scores?.[i] ?? null),
  };
}

function setTaskDetails(dateStr, task, details) {
  const all = loadJSON("dailyDetails", {});
  all[dateStr] = { ...all[dateStr], [task]: details };
  saveJSON("dailyDetails", all);
}

/** The minutes entered for a checklist item on one day, or null. */
function getTaskMinutes(dateStr, task) {
  return (loadJSON("dailyMinutes", {})[dateStr] || {})[task] ?? null;
}

function setTaskMinutes(dateStr, task, minutes) {
  const all = loadJSON("dailyMinutes", {});
  all[dateStr] = { ...all[dateStr], [task]: minutes };
  saveJSON("dailyMinutes", all);
}

/**
 * True when everything a checklist item needs before it can be ticked is
 * filled in: its text boxes and scores (TASK_DETAILS), or its minutes
 * (MINUTES_TASKS). Always true for a plain item.
 */
function taskDetailsComplete(dateStr, task) {
  if (MINUTES_TASKS.includes(task) && getTaskMinutes(dateStr, task) === null) return false;
  if (!TASK_DETAILS[task]) return true;
  const { fields, scores } = getTaskDetails(dateStr, task);
  return fields.every((text) => text.trim() !== "") && scores.every((score) => score !== null);
}

// ------------------------------------------------------- collapsed cards

function isCardCollapsed(cardId) {
  return localStorage.getItem("collapsed:" + cardId) === "1";
}

function setCardCollapsed(cardId, collapsed) {
  localStorage.setItem("collapsed:" + cardId, collapsed ? "1" : "0");
}

// ------------------------------------------------------------- catalogs

/** Every catalog: the built-in ones from catalogs.js, then uploaded ones. */
async function getAllCatalogs() {
  return [...window.BUILTIN_CATALOGS, ...(await getUploadedCatalogs())];
}

async function getUploadedCatalogs() {
  const store = await openCatalogStore("readonly");
  return waitFor(store.getAll());
}

async function saveUploadedCatalog(catalog) {
  const store = await openCatalogStore("readwrite");
  await waitFor(store.put(catalog));
}

async function deleteUploadedCatalog(catalogId) {
  const store = await openCatalogStore("readwrite");
  await waitFor(store.delete(catalogId));
}

/**
 * Opens the uploaded-catalogs store in IndexedDB, creating it on first use.
 * `mode` is "readonly" or "readwrite".
 */
function openCatalogStore(mode) {
  return new Promise((resolve, reject) => {
    // Bump the version number if the store's layout ever changes; the
    // onupgradeneeded code below then runs once to build the new one.
    const request = indexedDB.open("planner", 2);

    request.onupgradeneeded = () => {
      request.result.createObjectStore("catalogs", { keyPath: "id" });
    };

    request.onsuccess = () => {
      resolve(request.result.transaction("catalogs", mode).objectStore("catalogs"));
    };
    request.onerror = () => reject(request.error);
  });
}

/** Lets you `await` an IndexedDB request instead of setting up callbacks. */
function waitFor(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
