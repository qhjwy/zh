"use strict";

const PAGE_SIZE = 100;

function readKnownState(storageKey) {
  const stored = localStorage.getItem(storageKey);
  if (stored === null) {
    return {};
  }

  const parsed = JSON.parse(stored);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Saved progress for ${storageKey} is not valid.`);
  }
  return parsed;
}

function getLevelInfo(record, page) {
  if (page === "dictionary") {
    return { levels: [], label: "" };
  }

  const source = page === "hsk"
    ? String(record.hsk_level ?? record["HSK几"] ?? "")
    : String(record.boya_level ?? record.Book ?? "");
  const levels = [...source.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (levels.length === 2 && source.includes("-")) {
    return {
      levels: Array.from(
        { length: levels[1] - levels[0] + 1 },
        (_, index) => levels[0] + index
      ),
      label: source
    };
  }
  return { levels: levels.slice(0, 1), label: source };
}

function normalizeRecord(record, page, knownState) {
  const word = String(record.word ?? record.Word ?? "");
  const pinyin = String(record.pinyin ?? record.Pinyin ?? "");
  const meaning = String(record.meaning ?? record.Meaning ?? record.Definitions ?? "");
  const id = String(record.ID ?? `${word}\u0000${pinyin}`);
  const known = Object.prototype.hasOwnProperty.call(knownState, id)
    ? Boolean(knownState[id])
    : Boolean(record.known ?? record["学会"] === "x");
  const levelInfo = getLevelInfo(record, page);

  return {
    id,
    word,
    pinyin,
    meaning,
    levels: levelInfo.levels,
    levelLabel: levelInfo.label,
    chapter: String(record.chapter ?? record.Chapter ?? ""),
    known
  };
}

function startVocabularyPage() {
  const page = document.body.dataset.page;
  const source = document.body.dataset.source;
  const storageKey = document.body.dataset.storageKey;
  const entriesElement = document.querySelector("#vocabulary-entries");
  const status = document.querySelector("#status");
  const unknownFilter = document.querySelector("#unknown-filter");
  const pinyinToggle = document.querySelector("#pinyin-toggle");
  const onlyPinyinToggle = document.querySelector("#only-pinyin-toggle");
  const levelFilter = document.querySelector("#level-filter");
  const chapterFilter = document.querySelector("#chapter-filter");
  const previousButton = document.querySelector("#previous-page");
  const nextButton = document.querySelector("#next-page");
  const pageIndicator = document.querySelector("#page-indicator");
  const titleMenu = document.querySelector(".title-menu");
  const titleMenuTrigger = document.querySelector(".title-menu-trigger");

  let entries = [];
  let currentPage = 1;

  function filteredEntries() {
    const selectedLevel = levelFilter?.querySelector('[aria-pressed="true"]')?.dataset.level ?? "";
    const selectedChapter = chapterFilter?.querySelector('[aria-pressed="true"]')?.dataset.chapter ?? "";

    return entries.filter((entry) => {
      if (unknownFilter?.checked && entry.known) {
        return false;
      }
      if (selectedLevel && !entry.levels.some((level) =>
        selectedLevel === "7-9" ? level >= 7 && level <= 9 : level === Number(selectedLevel)
      )) {
        return false;
      }
      if (selectedChapter && entry.chapter !== selectedChapter) {
        return false;
      }
      return true;
    });
  }

  function render() {
    status.classList.remove("error");
    const matches = filteredEntries();
    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount);
    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = matches.slice(start, start + PAGE_SIZE);
    entriesElement.replaceChildren();

    for (const entry of visible) {
      const item = document.createElement("article");
      item.className = "entry";

      const heading = document.createElement("div");
      const word = document.createElement("span");
      word.className = "word";
      word.textContent = entry.word;
      heading.append(word, " ");

      if (entry.pinyin) {
        const pinyin = document.createElement("span");
        pinyin.className = "pinyin vocabulary-pinyin";
        pinyin.textContent = `[${entry.pinyin}]`;
        heading.append(pinyin);
      }

      const level = document.createElement("span");
      level.className = page === "hsk"
        ? `hsk-level list-level ${entry.levelLabel.toLowerCase().replace(/[^a-z0-9-]/g, "")}`
        : "list-level boya-level";
      level.textContent = page === "hsk"
        ? entry.levelLabel ? `HSK${entry.levelLabel.replace(/^HSK/i, "")}` : "Unassigned"
        : entry.levelLabel
          ? `Boya ${entry.levelLabel.replace(/^Boya\s*/i, "")}${entry.chapter ? ` · ${entry.chapter}` : ""}`
          : "Unassigned";
      heading.append(level);
      item.append(heading);

      if (entry.meaning) {
        const meaning = document.createElement("div");
        meaning.className = "defs";
        const chip = document.createElement("span");
        chip.textContent = entry.meaning;
        meaning.append(chip);
        item.append(meaning);
      }

      const entryActions = document.createElement("div");
      entryActions.className = "entry-actions";
      if (page === "hsk") {
        const knownLabel = document.createElement("span");
        knownLabel.className = `known-entry${entry.known ? " is-known" : " is-unknown"}`;
        knownLabel.textContent = entry.known ? "Known" : "Unknown";
        entryActions.append(knownLabel);
      }

      const sentenceButton = document.createElement("button");
      sentenceButton.className = "sentence-button";
      sentenceButton.type = "button";
      sentenceButton.textContent = "例句";
      sentenceButton.setAttribute("aria-label", `Copy an example-sentence prompt for ${entry.word}`);
      sentenceButton.setAttribute("aria-expanded", "false");
      entryActions.append(sentenceButton);

      const sentenceHelper = document.createElement("section");
      sentenceHelper.className = "sentence-helper";
      sentenceHelper.hidden = true;
      const prompt = `Write one natural, everyday Chinese sentence using the word “${entry.word}”. Show the sentence in Chinese, include pinyin, and provide a concise English translation.`;
      const promptText = document.createElement("textarea");
      promptText.className = "sentence-prompt";
      promptText.value = prompt;
      promptText.readOnly = true;
      promptText.setAttribute("aria-label", `AI prompt for ${entry.word}`);

      const helperActions = document.createElement("div");
      helperActions.className = "sentence-actions";
      const copyButton = document.createElement("button");
      copyButton.className = "sentence-copy";
      copyButton.type = "button";
      copyButton.textContent = "Copy prompt again";
      const openLink = document.createElement("a");
      openLink.href = "https://chat.deepseek.com/";
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      openLink.textContent = "Open DeepSeek";
      const helperStatus = document.createElement("span");
      helperStatus.className = "sentence-status";
      helperStatus.setAttribute("role", "status");
      helperActions.append(copyButton, openLink, helperStatus);
      sentenceHelper.append(promptText, helperActions);
      item.append(entryActions, sentenceHelper);

      function copyPromptFallback() {
        try {
          promptText.focus();
          promptText.select();
          return document.execCommand("copy");
        } catch (error) {
          return false;
        }
      }

      function copyPrompt() {
        let clipboardWrite;
        try {
          clipboardWrite = navigator.clipboard?.writeText(prompt);
        } catch {
          clipboardWrite = null;
        }

        if (copyPromptFallback()) {
          helperStatus.textContent = "Prompt copied. Paste it into DeepSeek.";
          clipboardWrite?.catch(() => {});
          return;
        }

        if (clipboardWrite) {
          clipboardWrite.then(
            () => {
              helperStatus.textContent = "Prompt copied. Paste it into DeepSeek.";
            },
            (error) => {
              helperStatus.textContent = `Could not copy automatically. Select and copy the prompt above. (${error.message})`;
            }
          );
          return;
        }

        helperStatus.textContent = "Could not copy automatically. Select and copy the prompt above.";
      }

      sentenceButton.addEventListener("click", () => {
        const isOpen = sentenceHelper.hidden;
        sentenceHelper.hidden = !isOpen;
        sentenceButton.setAttribute("aria-expanded", String(isOpen));
        if (isOpen) {
          copyPrompt();
          window.open(openLink.href, "_blank", "noopener,noreferrer");
        }
      });
      copyButton.addEventListener("click", copyPrompt);

      entriesElement.append(item);
    }

    const first = matches.length ? start + 1 : 0;
    const last = Math.min(start + PAGE_SIZE, matches.length);
    status.textContent = `${first}–${last} of ${matches.length} entries`;
    pageIndicator.textContent = `Page ${currentPage} of ${pageCount}`;
    previousButton.disabled = currentPage === 1;
    nextButton.disabled = currentPage === pageCount;
  }

  function resetAndRender() {
    currentPage = 1;
    render();
  }

  previousButton.addEventListener("click", () => {
    currentPage -= 1;
    render();
  });
  nextButton.addEventListener("click", () => {
    currentPage += 1;
    render();
  });
  if (unknownFilter) {
    unknownFilter.addEventListener("change", resetAndRender);
  }
  if (levelFilter) {
    levelFilter.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-level]");
      if (!button) return;
      const wasSelected = button.getAttribute("aria-pressed") === "true";
      for (const filterButton of levelFilter.querySelectorAll("button[data-level]")) {
        filterButton.setAttribute("aria-pressed", String(filterButton === button && !wasSelected));
      }
      resetAndRender();
    });
  }
  if (chapterFilter) {
    chapterFilter.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-chapter]");
      if (!button) return;
      const wasSelected = button.getAttribute("aria-pressed") === "true";
      for (const filterButton of chapterFilter.querySelectorAll("button[data-chapter]")) {
        filterButton.setAttribute("aria-pressed", String(filterButton === button && !wasSelected));
      }
      resetAndRender();
    });
  }
  pinyinToggle.addEventListener("change", () => {
    document.body.classList.toggle("hide-pinyin", !pinyinToggle.checked);
  });
  if (onlyPinyinToggle) {
    onlyPinyinToggle.addEventListener("change", () => {
      if (onlyPinyinToggle.checked) {
        pinyinToggle.checked = true;
        document.body.classList.remove("hide-pinyin");
      }
      pinyinToggle.disabled = onlyPinyinToggle.checked;
      document.body.classList.toggle("only-pinyin", onlyPinyinToggle.checked);
    });
  }
  titleMenuTrigger.addEventListener("click", () => {
    const isOpen = titleMenu.classList.toggle("menu-open");
    titleMenuTrigger.setAttribute("aria-expanded", String(isOpen));
    syncTitleMenuOverlay();
  });

  function syncTitleMenuOverlay() {
    const isActive = titleMenu.matches(":hover")
      || titleMenu.contains(document.activeElement)
      || titleMenu.classList.contains("menu-open");
    document.body.classList.toggle("menu-active", isActive);
  }

  titleMenu.addEventListener("pointerenter", syncTitleMenuOverlay);
  titleMenu.addEventListener("pointerleave", syncTitleMenuOverlay);
  titleMenu.addEventListener("focusin", syncTitleMenuOverlay);
  titleMenu.addEventListener("focusout", (event) => {
    if (!titleMenu.contains(event.relatedTarget)) {
      titleMenu.classList.remove("menu-open");
      titleMenuTrigger.setAttribute("aria-expanded", "false");
    }
    syncTitleMenuOverlay();
  });
  titleMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      titleMenu.classList.remove("menu-open");
      titleMenuTrigger.setAttribute("aria-expanded", "false");
      syncTitleMenuOverlay();
      titleMenuTrigger.focus();
    }
  });

  fetch(source)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${source} (${response.status}).`);
      }
      return response.json();
    })
    .then((data) => {
      if (!Array.isArray(data)) {
        throw new Error(`Expected ${source} to contain a JSON array.`);
      }
      const knownState = page === "hsk" ? readKnownState(storageKey) : {};
      entries = data.map((record) => normalizeRecord(record, page, knownState));
      status.classList.remove("error");
      render();
    })
    .catch((error) => {
      status.textContent = `Unable to load vocabulary: ${error.message}`;
      status.classList.add("error");
    });
}

startVocabularyPage();
