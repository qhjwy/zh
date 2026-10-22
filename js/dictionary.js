"use strict";

const searchInput = document.querySelector("#search");
const statusElement = document.querySelector("#status");
const resultsElement = document.querySelector("#results");
const clearButton = document.querySelector("#clear-btn");
const scriptLabel = document.querySelector("#script-label");
const toggleButton = document.querySelector("#script-toggle");
const worker = new Worker(document.body.dataset.workerSrc || "worker.js");

let showTraditional = false;
let lastQuery = "";
let debounceTimer;
let ready = false;
let readyStatus = "Loading dictionary…";

function convertPinyin(pinyin) {
  const toneMap = {
    a: ["ā", "á", "ǎ", "à"],
    e: ["ē", "é", "ě", "è"],
    i: ["ī", "í", "ǐ", "ì"],
    o: ["ō", "ó", "ǒ", "ò"],
    u: ["ū", "ú", "ǔ", "ù"],
    ü: ["ǖ", "ǘ", "ǚ", "ǜ"]
  };

  return pinyin.split(" ").map((syllable) => {
    const match = syllable.match(/([1-5])$/);
    let word = syllable.replace(/u:/g, "ü").replace(/v/g, "ü");
    if (!match || match[1] === "5") return word.replace(/[1-5]$/, "");
    word = word.slice(0, -1);

    const lower = word.toLowerCase();
    let vowel = "";
    if (lower.includes("a")) vowel = "a";
    else if (lower.includes("e")) vowel = "e";
    else if (lower.includes("ou")) vowel = "o";
    else {
      for (let index = lower.length - 1; index >= 0; index -= 1) {
        if (Object.hasOwn(toneMap, lower[index])) {
          vowel = lower[index];
          break;
        }
      }
    }

    return vowel
      ? word.replace(new RegExp(vowel, "i"), toneMap[vowel][Number(match[1]) - 1])
      : word;
  }).join(" ");
}

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
    pinyin.textContent = `[${convertPinyin(entry.pinyin)}]`;
    heading.append(pinyin);

    if (entry.classifiers.length) {
      const classifier = document.createElement("span");
      classifier.className = "classifier";
      classifier.textContent = ` · ${entry.classifiers
        .map((item) => showTraditional ? item.traditional : item.simplified)
        .join(", ")}`;
      heading.append(classifier);
    }

    if (entry.frequencyRank !== null) {
      const frequencyRank = document.createElement("span");
      frequencyRank.className = "classifier";
      frequencyRank.textContent = `${entry.classifiers.length ? " · " : " "}${entry.frequencyRank}`;
      heading.append(frequencyRank);
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
  worker.postMessage({ type: "search", query });
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
    readyStatus = `${message.entryCount.toLocaleString()} entries loaded. ${message.hskCount.toLocaleString()} entries have HSK levels (${message.hskPercentage}%).`;
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
