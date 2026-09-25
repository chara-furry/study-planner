/**
 * curriculum.js — puts each catalog's videos in the order the school teaches
 * them, and works out how far ahead of the class you are.
 *
 * There is no page code in here, only rules. plan.js uses them to pick videos,
 * and the Catalogs card shows the result.
 *
 * ---------------------------------------------------------------------------
 * Study order
 *
 * A catalog's videos are studied topic by topic, following CURRICULUM in
 * config.js, and then the videos that belong to no topic, in spreadsheet order.
 * The sofatutor spreadsheets list some videos more than once under different
 * headings; only the first copy in study order is kept, so no video is
 * assigned twice.
 *
 * ---------------------------------------------------------------------------
 * Ahead of the class
 *
 * The curriculum lists topics but no dates, so where the class is has to be
 * estimated. The estimate assumes every subject's curriculum is spread evenly
 * over the school's business days: the weekdays of SCHOOL_YEAR, skipping
 * DAYS_OFF. By the time a quarter of those days have passed, the class is taken
 * to have covered a quarter of each subject's curriculum videos.
 *
 * You're ahead when you've watched a bigger share of a subject's curriculum
 * videos than that. The difference is given in school weeks, so subjects can
 * be compared: "2 weeks ahead" means the class needs about 2 more weeks of
 * school to cover what you already have.
 */

// The study plan of each catalog, worked out once. A WeakMap forgets a catalog
// when it's no longer in use, so an uploaded catalog that's replaced gets a
// fresh plan.
const studyPlans = new WeakMap();

/**
 * How a catalog's videos are studied:
 *
 *   { order, curriculum, topicOf }
 *   order       every video position, in study order, without duplicates
 *   curriculum  the positions that belong to a curriculum topic, in order
 *               (the start of `order`). For a subject with no CURRICULUM
 *               entry, every video counts.
 *   topicOf     Map of video position -> curriculum topic name
 */
function studyPlan(catalog) {
  if (!studyPlans.has(catalog)) studyPlans.set(catalog, makeStudyPlan(catalog));
  return studyPlans.get(catalog);
}

function makeStudyPlan(catalog) {
  const topics = CURRICULUM[catalog.subject] || [];
  const topicOf = new Map();
  const positions = catalog.videos.map((_, index) => index);

  // Titles listed under `videos` are claimed first, so they win over a
  // section listed under an earlier topic.
  for (const { topic, videos = [] } of topics) {
    for (const title of videos) {
      const matches = positions.filter((i) => catalog.videos[i].title === title && !topicOf.has(i));
      if (matches.length === 0) warnNoMatch(catalog, topic, "video", title);
      for (const i of matches) topicOf.set(i, topic);
    }
  }

  for (const { topic, sections = [] } of topics) {
    for (const section of sections) {
      const inSection = positions.filter((i) => catalog.videos[i].topic === section);
      if (inSection.length === 0) warnNoMatch(catalog, topic, "section", section);
      for (const i of inSection) if (!topicOf.has(i)) topicOf.set(i, topic);
    }
  }

  // Topic by topic, then everything else.
  const ordered = [
    ...topics.flatMap(({ topic }) => positions.filter((i) => topicOf.get(i) === topic)),
    ...positions.filter((i) => !topicOf.has(i)),
  ];

  // Keep only the first copy of each title.
  const seenTitles = new Set();
  const order = ordered.filter((i) => {
    const title = catalog.videos[i].title;
    if (seenTitles.has(title)) return false;
    seenTitles.add(title);
    return true;
  });

  const curriculum = topics.length > 0 ? order.filter((i) => topicOf.has(i)) : order;
  return { order, curriculum, topicOf };
}

function warnNoMatch(catalog, topic, kind, name) {
  console.warn(`CURRICULUM (config.js): no ${kind} "${name}" in ${catalog.label}, listed under "${topic}".`);
}

/**
 * What to show under a video's title: its curriculum topic and its heading,
 * like "Atmung · Bau und Funktion der Atmungsorgane", or just the heading for a
 * video outside the curriculum.
 */
function videoTopicLabel(catalog, videoIndex) {
  const video = catalog.videos[videoIndex];
  const heading = video.topic || catalog.label;
  const topic = studyPlan(catalog).topicOf.get(videoIndex);
  return topic ? `${topic} · ${heading}` : heading;
}

// ---------------------------------------------------------------- the class

/**
 * Where you are compared to the class in one subject, on the given day:
 *
 *   { weeksAhead, yourTopic, classTopic, hasCurriculum }
 *   weeksAhead     school weeks ahead of the class; negative when behind
 *   yourTopic      the curriculum topic of your next unwatched video, or null
 *                  once you've watched them all
 *   classTopic     the topic the class is estimated to be on, or null once
 *                  the class has covered them all
 *   hasCurriculum  false when the subject has no CURRICULUM entry
 *
 * `planned` lists video positions to count as watched as well, so plan.js can
 * ask where you'd be after today's videos.
 */
function curriculumStatus(catalog, dateStr, planned = []) {
  const { curriculum, topicOf } = studyPlan(catalog);
  const watched = getWatched(catalog.id);
  const isCovered = (i) => watched.has(i) || planned.includes(i);

  const classShare = shareOfSchoolYearPassed(dateStr);
  const yourShare = curriculum.length === 0
    ? 1 // nothing to watch, so nothing to be behind on
    : curriculum.filter(isCovered).length / curriculum.length;

  const nextUnwatched = curriculum.find((i) => !isCovered(i));
  const classPosition = Math.floor(classShare * curriculum.length);

  return {
    weeksAhead: (yourShare - classShare) * schoolWeeksInYear(),
    yourTopic: nextUnwatched === undefined ? null : topicName(catalog, topicOf, nextUnwatched),
    classTopic: classPosition >= curriculum.length ? null : topicName(catalog, topicOf, curriculum[classPosition]),
    hasCurriculum: Boolean(CURRICULUM[catalog.subject]),
  };
}

function topicName(catalog, topicOf, videoIndex) {
  return topicOf.get(videoIndex) || catalog.videos[videoIndex].topic || catalog.label;
}

/**
 * The share (0 to 1) of the school year's business days that have passed by
 * the end of the given day.
 */
function shareOfSchoolYearPassed(dateStr) {
  const days = schoolDaysInYear();
  if (days.length === 0) return 0;

  // "2026-09-10" style dates compare correctly as plain text.
  const passed = days.filter((day) => day <= dateStr).length;
  return passed / days.length;
}

let schoolDaysCache = null;

/** Every school day in SCHOOL_YEAR, as "2026-09-10" strings. */
function schoolDaysInYear() {
  if (!schoolDaysCache) {
    schoolDaysCache = [];
    const date = strToDate(SCHOOL_YEAR.from);
    while (dateToStr(date) <= SCHOOL_YEAR.to) {
      if (dayType(date).kind === "school") schoolDaysCache.push(dateToStr(date));
      date.setDate(date.getDate() + 1);
    }
  }
  return schoolDaysCache;
}

function schoolWeeksInYear() {
  return schoolDaysInYear().length / 5;
}
