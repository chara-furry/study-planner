/**
 * plan-list.js — a list of videos, shared by the Today's Videos and Prepare
 * for Tomorrow cards.
 *
 *   buildPlanRows(list, plan, catalogs)   rows for a <ul class="rows">
 *   buildPlanActions(list, plan)          the buttons under the list
 *
 * `list` is "today" or "prep" (see plan.js). Every video has a checkbox. Once
 * ticked, a box appears for the score you got on it. Until then it has a ✎
 * button, which turns the row into a small form for choosing a different
 * subject or video, or removing it. The buttons under the list add a video,
 * or reset the list once it's been changed.
 *
 * Nothing in the form is saved until "Save" is clicked. Only then does it call
 * the matching function in plan.js, and refreshAll().
 *
 * Elements you can type in or tab to have ids, so refreshAll() can put the
 * keyboard cursor back after redrawing. That way the page can be used with
 * the keyboard alone.
 */

// The form that's open: { list, slot }, where slot is a position in that
// list, or -1 for "Add a video". null when no form is open.
let openForm = null;

function isFormOpen(list, slot) {
  return openForm !== null && openForm.list === list && openForm.slot === slot;
}

async function openFormFor(list, slot) {
  openForm = { list, slot };
  await refreshAll();
  document.getElementById("plan-form-subject")?.focus();
}

/** Closes the form and puts the cursor back on the button that opened it. */
async function closeForm() {
  if (!openForm) return; // already closed, e.g. by a double click
  const { list, slot } = openForm;
  openForm = null;
  await refreshAll();
  document.getElementById(slot === -1 ? `add-${list}` : `edit-${list}-${slot}`)?.focus();
}

/** One <li> per video in the list, plus the "Add a video" form when it's open. */
function buildPlanRows(list, plan, catalogs) {
  const rows = [];

  plan.forEach((entry, slot) => {
    // Skip it if its catalog or video was removed after the list was made.
    const found = videoOf(entry, catalogs);
    if (!found) return;

    rows.push(isFormOpen(list, slot)
      ? buildFormRow(list, plan, slot, catalogs)
      : buildVideoRow(list, slot, entry, found.catalog, found.video));
  });

  if (isFormOpen(list, -1)) rows.push(buildFormRow(list, plan, -1, catalogs));
  return rows;
}

/** "+ Add a video", and "Reset" once the list has been changed by hand. */
function buildPlanActions(list, plan) {
  const buttons = [];

  if (!isFormOpen(list, -1)) {
    buttons.push(el("button", {
      id: `add-${list}`,
      className: "button secondary",
      textContent: "+ Add a video",
      onclick: () => openFormFor(list, -1),
    }));
  }

  if (canResetList(list, plan)) {
    buttons.push(el("button", {
      className: "button secondary",
      textContent: "Reset to automatic",
      onclick: () => {
        resetList(list);
        openForm = null;
        refreshAll();
      },
    }));
  }

  return buttons;
}

/**
 * One row: checkbox, video title with its topic underneath, the subject badge,
 * then the score box (once ticked) or the ✎ button (until then).
 */
function buildVideoRow(list, slot, entry, catalog, video) {
  return el("li", { className: entry.done ? "done" : "" }, [
    el("input", {
      type: "checkbox",
      id: `done-${list}-${slot}`,
      checked: entry.done,
      ariaLabel: `Watched: ${video.title}`,
      onchange: (event) => {
        markVideoDone(list, slot, event.target.checked);
        refreshAll();
      },
    }),
    el("div", { className: "row-text" }, [
      el("div", { className: "row-title" }, [
        video.title,
        entry.custom ? el("span", { className: "source-tag", textContent: "changed" }) : "",
        entry.catchUp
          ? el("span", {
              className: "source-tag",
              textContent: "catch-up",
              title: "An extra video, to get ahead of the class in this subject",
            })
          : "",
      ]),
      el("div", { className: "row-subtitle", textContent: videoTopicLabel(catalog, entry.videoIndex) }),
    ]),
    el("span", {
      className: entry.scheduled ? "subject-badge" : "subject-badge fill-in",
      textContent: catalog.subject,
    }),
    // A ticked video is done, so it can't be swapped (untick it first), but
    // now it can be scored. Both sit in a fixed-width slot so they line up.
    el("div", { className: "row-end" }, [
      entry.done
        ? buildScoreBox(list, slot, entry, video)
        : el("button", {
            id: `edit-${list}-${slot}`,
            className: "icon-button",
            textContent: "✎",
            title: "Change this video",
            ariaLabel: `Change video: ${video.title}`,
            onclick: () => openFormFor(list, slot),
          }),
    ]),
  ]);
}

/** The box for the score (in percent) you got on a video's exercises. */
function buildScoreBox(list, slot, entry, video) {
  return el("label", { className: "score" }, [
    el("input", {
      type: "number",
      id: `score-${list}-${slot}`,
      min: 0,
      max: 100,
      inputMode: "numeric",
      placeholder: "–",
      value: entry.score ?? "",
      ariaLabel: `Score for ${video.title}, in percent`,
      onchange: (event) => {
        setScore(list, slot, readScore(event.target.value));
        // Wait until the cursor has moved on (say, Tab to the next score box)
        // before redrawing, so refreshAll() puts it back there.
        setTimeout(refreshAll);
      },
    }),
    "%",
  ]);
}

/** Turns what was typed into a whole number from 0 to 100, or null if blank. */
function readScore(text) {
  if (text.trim() === "") return null;
  const score = Math.round(Number(text));
  return Number.isNaN(score) ? null : Math.min(100, Math.max(0, score));
}

/**
 * The form that replaces a row while it's being changed: a subject list, a
 * video list for that subject, and Save / Remove / Cancel. `slot` is -1 when
 * adding a new video, in which case there's no Remove button.
 */
function buildFormRow(list, plan, slot, catalogs) {
  const current = plan[slot]; // undefined when adding
  const choices = videosToChooseFrom(list, plan, slot, catalogs);

  const cancelButton = el("button", {
    className: "button secondary",
    textContent: "Cancel",
    onclick: closeForm,
  });

  if (choices.size === 0) {
    return el("li", { className: "plan-form" }, [
      el("span", { className: "muted", textContent: "Every video is watched or already planned." }),
      cancelButton,
    ]);
  }

  const subjectList = el("select", { id: "plan-form-subject", ariaLabel: "Subject" },
    catalogs
      .filter((catalog) => choices.has(catalog.id))
      .map((catalog) => el("option", { value: catalog.id, textContent: catalog.label })));

  const videoList = el("select", { ariaLabel: "Video" });

  // Refill the video list whenever a different subject is chosen.
  const showVideosOfSubject = () => {
    const catalog = catalogs.find((c) => c.id === subjectList.value);
    videoList.replaceChildren(...videoOptions(catalog, choices.get(catalog.id)));
    if (current && current.catalogId === catalog.id) videoList.value = String(current.videoIndex);
  };
  subjectList.onchange = showVideosOfSubject;

  // A subject with nothing left to choose isn't in the list.
  if (current && choices.has(current.catalogId)) subjectList.value = current.catalogId;
  showVideosOfSubject();

  return el("li", { className: "plan-form" }, [
    subjectList,
    videoList,
    el("div", { className: "plan-form-buttons" }, [
      el("button", {
        className: "button",
        textContent: "Save",
        onclick: async () => {
          const catalogId = subjectList.value;
          const videoIndex = Number(videoList.value);
          if (slot === -1) await addVideo(list, catalogId, videoIndex);
          else await changeVideo(list, slot, catalogId, videoIndex);
          closeForm();
        },
      }),
      slot === -1
        ? ""
        : el("button", {
            className: "button danger",
            textContent: "Remove",
            onclick: async () => {
              await removeVideo(list, slot);
              closeForm();
            },
          }),
      cancelButton,
    ]),
  ]);
}

/**
 * <option>s for the given video positions, grouped under their curriculum
 * topic and heading.
 */
function videoOptions(catalog, videoIndexes) {
  const groups = [];

  for (const index of videoIndexes) {
    const video = catalog.videos[index];
    const topic = videoTopicLabel(catalog, index);

    if (groups.length === 0 || groups[groups.length - 1].label !== topic) {
      groups.push(el("optgroup", { label: topic }));
    }
    groups[groups.length - 1].append(el("option", { value: String(index), textContent: video.title }));
  }

  return groups;
}

/**
 * A short description of a day, e.g. "Thursday · Lessons: Mathematik,
 * Geschichte" or "Monday · Autumn holidays, no lessons · 9 videos to get ahead".
 */
function describeDay(dateStr) {
  const date = strToDate(dateStr);
  const day = dayType(date);
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });

  if (day.kind === "school") return `${weekday} · Lessons: ${day.lessons.join(", ")}`;
  if (day.kind === "weekend") return `${weekday} · No school`;
  return `${weekday} · ${day.name}, no lessons · ${day.videos} videos to get ahead`;
}
