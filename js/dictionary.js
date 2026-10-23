"use strict";

const searchInput = document.querySelector("#search");
const statusElement = document.querySelector("#status");
const resultsElement = document.querySelector("#results");
const clearButton = document.querySelector("#clear-btn");
const tagFilterOptions = document.querySelector("#tag-filter-options");
const scriptLabel = document.querySelector("#script-label");
const toggleButton = document.querySelector("#script-toggle");
const worker = new Worker(document.body.dataset.workerSrc || "worker.js");

let showTraditional = false;
let lastQuery = "";
let debounceTimer;
let ready = false;
let readyStatus = "Loading dictionary…";
const hiddenByDefaultTags = new Set([
  "archaic",
  "dated",
  "latin_digit",
  "proper_noun",
  "regional",
  "variant"
]);
const hiddenTags = new Set(hiddenByDefaultTags);

function appendHskBadges(parent, levels) {
  for (const level of levels) {
    const badge = document.createElement("span");
    badge.className = `hsk-level ${level.toLowerCase()}`;
    badge.textContent = level;
    parent.append(badge);
  }
}

function render(entries) {
  resultsElement.replaceChildren();
  if (!entries.length) {
    const message = document.createElement("p");
    message.textContent = "No results found.";
    resultsElement.append(message);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const wrapper = document.createElement("article");
    wrapper.className = "entry";

    const heading = document.createElement("div");
    const word = document.createElement("span");
    const displayWord = showTraditional ? entry.traditional : entry.simplified;
    word.className = `word${displayWord === lastQuery.trim() ? " exact-match" : ""}`;
    word.textContent = displayWord;
    heading.append(word, " ");

    const pinyin = document.createElement("span");
    pinyin.className = "pinyin";
    pinyin.textContent = `[${window.convertPinyin(entry.pinyin)}]`;
    heading.append(pinyin);

    if (entry.classifiers.length) {
      const classifier = document.createElement("span");
      classifier.className = "classifier";
      classifier.textContent = ` · ${entry.classifiers
        .map((item) => showTraditional ? item.traditional : item.simplified)
        .join(", ")}`;
      heading.append(classifier);
    }

    if (entry.frequencyProbability !== null) {
      const frequencyProbability = document.createElement("span");
      frequencyProbability.className = "classifier";
      frequencyProbability.title = "Estimated chance of use at least once in a day; see About for assumptions.";
      frequencyProbability.textContent = `${entry.classifiers.length ? " · " : " "}${Math.round(entry.frequencyProbability * 100)}%`;
      heading.append(frequencyProbability);
    }

    appendHskBadges(heading, entry.hskLevels);
    wrapper.append(heading);

    const definitions = document.createElement("div");
    definitions.className = "defs";
    for (const definition of entry.definitions) {
      const chip = document.createElement("span");
      chip.textContent = definition;
      definitions.append(chip, " ");
    }
    wrapper.append(definitions);
    fragment.append(wrapper);
  }
  resultsElement.append(fragment);
}

function runSearch(query) {
  if (!ready) return;
  if (!query.trim()) {
    resultsElement.replaceChildren();
    statusElement.textContent = readyStatus;
    return;
  }
  worker.postMessage({ type: "search", query, hiddenTags: [...hiddenTags] });
}

function renderTagFilters(tags) {
  tagFilterOptions.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (const hiddenByDefault of [false, true]) {
    const group = tags
      .filter((tag) => hiddenByDefaultTags.has(tag.name) === hiddenByDefault)
      .sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));
    if (!group.length) continue;

    const heading = document.createElement("strong");
    heading.className = "tag-filter-group-heading";
    heading.textContent = hiddenByDefault ? "Hidden by default" : "Shown by default";
    fragment.append(heading);

    for (const tag of group) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !hiddenTags.has(tag.name);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) hiddenTags.delete(tag.name);
        else hiddenTags.add(tag.name);
        runSearch(lastQuery);
      });

      const text = document.createElement("span");
      text.textContent = `Show ${tag.name} (${tag.count})`;
      label.append(checkbox, text);
      fragment.append(label);
    }
  }
  tagFilterOptions.append(fragment);
}

searchInput.addEventListener("input", () => {
  lastQuery = searchInput.value;
  const hasText = lastQuery.length > 0;
  clearButton.textContent = hasText ? "✕" : "→";
  clearButton.classList.toggle("has-text", hasText);
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => runSearch(lastQuery), 150);
});

clearButton.addEventListener("click", () => {
  searchInput.value = "";
  lastQuery = "";
  resultsElement.replaceChildren();
  statusElement.textContent = readyStatus;
  clearButton.textContent = "→";
  clearButton.classList.remove("has-text");
  searchInput.focus();
});

toggleButton.addEventListener("click", () => {
  showTraditional = !showTraditional;
  scriptLabel.textContent = showTraditional ? "繁體" : "简体";
  toggleButton.title = showTraditional ? "Switch to Simplified" : "Switch to Traditional";
  if (lastQuery.trim()) runSearch(lastQuery);
});

worker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "ready") {
    ready = true;
    renderTagFilters(message.tags);
    readyStatus = `${message.entryCount.toLocaleString()} entries loaded. ${message.hskCount.toLocaleString()} dictionary entries match an HSK word and reading (${message.hskPercentage}%).`;
    statusElement.textContent = readyStatus;
    runSearch(lastQuery);
  } else if (message.type === "results") {
    render(message.entries);
  } else if (message.type === "error") {
    ready = false;
    readyStatus = `Unable to load dictionary: ${message.message}`;
    statusElement.textContent = `Unable to load dictionary: ${message.message}`;
  }
});

worker.addEventListener("error", (event) => {
  statusElement.textContent = `Dictionary worker failed: ${event.message}`;
});
