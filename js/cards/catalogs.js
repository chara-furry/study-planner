/**
 * cards/catalogs.js — the Catalogs card.
 *
 * Shows a progress bar for every catalog, and how far ahead of the class you
 * are in that subject (see curriculum.js). Also lets you add your own catalogs
 * by uploading an .xlsx file in the same layout as the sofatutor ones.
 * Uploaded catalogs can be deleted; the built-in ones are part of the site.
 */

const catalogList = document.getElementById("catalog-list");
const catalogFileInput = document.getElementById("catalog-file");
const catalogStatus = document.getElementById("catalog-status");

document.getElementById("catalog-upload-btn").onclick = uploadCatalog;

/** Redraws the card from saved data. Called by refreshAll() in app.js. */
async function renderCatalogsCard() {
  const catalogs = await getAllCatalogs();
  catalogList.replaceChildren(...catalogs.map(buildCatalogRow));
}

/**
 * One row: name, progress bar, where you are compared to the class,
 * "watched/total", and a Delete button for uploads.
 */
function buildCatalogRow(catalog) {
  // Counted in study order, which leaves out the videos listed twice.
  const { order } = studyPlan(catalog);
  const watchedSet = getWatched(catalog.id);
  const watched = order.filter((index) => watchedSet.has(index)).length;
  const total = order.length;
  const percent = total ? (watched / total) * 100 : 0;
  const isUpload = catalog.source === "uploaded";

  return el("li", {}, [
    el("div", { className: "row-text" }, [
      el("div", { className: "row-title" }, [
        catalog.label,
        isUpload ? el("span", { className: "source-tag", textContent: "uploaded" }) : "",
      ]),
      el("div", { className: "progress-track" }, [
        el("div", { className: "progress-fill", style: `width: ${percent}%` }),
      ]),
      buildClassComparison(catalog),
    ]),
    el("span", { className: "catalog-count", textContent: `${watched}/${total}` }),
    isUpload
      ? el("button", {
          className: "button danger",
          textContent: "Delete",
          onclick: async () => {
            await deleteUploadedCatalog(catalog.id);
            showCatalogStatus(`Deleted "${catalog.label}".`);
            refreshAll();
          },
        })
      : "",
  ]);
}

/**
 * The line under a progress bar, e.g. "2 weeks ahead · You: Herz · Class: Atmung".
 * Green when ahead, red when behind.
 */
function buildClassComparison(catalog) {
  const status = curriculumStatus(catalog, todayStr());
  const weeks = Math.round(status.weeksAhead * 10) / 10; // one decimal place

  let lead;
  if (weeks > 0) lead = `${formatWeeks(weeks)} ahead of the class`;
  else if (weeks < 0) lead = `${formatWeeks(-weeks)} behind the class`;
  else lead = "Level with the class";

  const parts = [lead];
  parts.push(status.yourTopic ? `You: ${status.yourTopic}` : "You: curriculum done");
  if (status.hasCurriculum) {
    parts.push(status.classTopic ? `Class: ${status.classTopic}` : "Class: curriculum done");
  }

  return el("div", {
    className: `class-comparison ${weeks < 0 ? "behind" : "ahead"}`,
    textContent: parts.join(" · "),
  });
}

/** "1 week", "0.5 weeks", "2 weeks". */
function formatWeeks(weeks) {
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

/** Runs when "Add catalog" is clicked. */
async function uploadCatalog() {
  const file = catalogFileInput.files[0];
  if (!file) {
    showCatalogStatus("Choose an .xlsx file first.");
    return;
  }

  let parsed;
  try {
    parsed = await parseCatalogXlsx(file);
  } catch (error) {
    showCatalogStatus("Could not read that file: " + error.message);
    return;
  }

  // Basing the id on the name means uploading a fixed version of the same
  // spreadsheet replaces the old one, rather than adding a second copy.
  const id = "upload:" + parsed.label.toLowerCase();

  // Everything saved about a video (that it's watched, the days it was
  // assigned to) points at its position in the catalog, so when a catalog is
  // replaced, that has to follow its videos to wherever they are now.
  const replaced = (await getUploadedCatalogs()).find((catalog) => catalog.id === id);
  if (replaced) moveSavedVideos(id, newPositionsOf(replaced.videos, parsed.videos));

  await saveUploadedCatalog({
    id,
    subject: parsed.subject,
    label: parsed.label,
    source: "uploaded",
    videos: parsed.videos,
  });

  catalogFileInput.value = "";
  showCatalogStatus(`Added "${parsed.label}" (${parsed.videos.length} videos).`);

  // If today came up short because every other catalog was finished, start
  // today over so the new catalog can fill the gap. A day you've already
  // started ticking off is left alone.
  const today = getDayPlan(todayStr(), "today") || [];
  const wanted = dayType(strToDate(todayStr())).videos;
  if (today.length < wanted && !today.some((entry) => entry.done)) {
    deleteDayPlan(todayStr(), "today");
  }

  refreshAll();
}

/**
 * Where each of `before`'s videos ended up in `after`, matched by title: a
 * Map of old position -> new position, leaving out the videos `after` hasn't
 * got. When a title appears twice, the first copy wins, as it does in the
 * study order (see curriculum.js).
 */
function newPositionsOf(before, after) {
  const positionOf = new Map();
  after.forEach((video, index) => {
    if (!positionOf.has(video.title)) positionOf.set(video.title, index);
  });

  const moved = new Map();
  before.forEach((video, index) => {
    if (positionOf.has(video.title)) moved.set(index, positionOf.get(video.title));
  });
  return moved;
}

function showCatalogStatus(message) {
  catalogStatus.textContent = message;
  catalogStatus.hidden = false;
}
