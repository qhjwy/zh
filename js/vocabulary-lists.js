"use strict";

const PAGE_SIZE = 60;

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
  const listView = document.querySelector("#hsk-list-view");
  const progressView = document.querySelector("#hsk-progress-view");
  const progressRows = document.querySelector("#hsk-progress-rows");
  const viewLinks = document.querySelectorAll(".hsk-view-nav a");
  const unknownFilter = document.querySelector("#unknown-filter");
  const pinyinToggle = document.querySelector("#pinyin-toggle");
  const onlyPinyinToggle = document.querySelector("#only-pinyin-toggle");
  const levelFilter = document.querySelector("#level-filter");
  const chapterFilter = document.querySelector("#chapter-filter");

  let entries = [];
  const requestedPage = Number(new URLSearchParams(window.location.search).get("page"));
  let currentPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  document.body.classList.toggle("hide-pinyin", !pinyinToggle.checked);

  function setHskView(view) {
    if (!listView || !progressView) return;
    const showProgress = view === "progress";
    listView.hidden = showProgress;
    progressView.hidden = !showProgress;
    for (const link of viewLinks) {
      if (link.hash === `#${view}`) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  function renderHskProgress() {
    if (!progressRows) return;
    const groups = [
      ...Array.from({ length: 6 }, (_, index) => ({
        label: `HSK${index + 1}`,
        levelClass: `hsk${index + 1}`,
        includes: (level) => level === index + 1
      })),
      { label: "HSK7-9", levelClass: "hsk7-9", includes: (level) => level >= 7 && level <= 9 }
    ];

    progressRows.replaceChildren();
    for (const group of groups) {
      const groupEntries = entries.filter((entry) => entry.levels.some(group.includes));
      const knownCount = groupEntries.filter((entry) => entry.known).length;
      const percentage = groupEntries.length
        ? Math.round((knownCount / groupEntries.length) * 100)
        : 0;
      const row = document.createElement("tr");
      const levelCell = document.createElement("th");
      levelCell.scope = "row";
      levelCell.className = `hsk-progress-level ${group.levelClass}`;
      levelCell.textContent = group.label;
      row.append(levelCell);

      const progressCell = document.createElement("td");
      const progress = document.createElement("div");
      progress.className = `hsk-progress-bar ${group.levelClass}`;
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", `${group.label} 已认识词语`);
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", String(groupEntries.length));
      progress.setAttribute("aria-valuenow", String(knownCount));
      const fill = document.createElement("span");
      fill.className = "hsk-progress-fill";
      fill.style.width = `${percentage}%`;
      const percentageLabel = document.createElement("span");
      percentageLabel.className = "hsk-progress-percentage";
      percentageLabel.textContent = `${percentage}%`;
      progress.append(fill, percentageLabel);

      const count = document.createElement("div");
      count.className = "hsk-progress-count";
      count.textContent = `已认识 ${knownCount} / ${groupEntries.length}`;
      progressCell.append(progress, count);
      row.append(progressCell);
      progressRows.append(row);
    }
  }

  function getPageUrl(pageNumber) {
    const url = new URL(window.location.href);
    if (pageNumber === 1) {
      url.searchParams.delete("page");
    } else {
      url.searchParams.set("page", String(pageNumber));
    }
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function writePageUrl(method = "replaceState") {
    window.history[method](null, "", getPageUrl(currentPage));
  }

  function createPageLink(label, pageNumber, accessibleLabel) {
    const link = document.createElement("a");
    link.href = getPageUrl(pageNumber);
    link.dataset.page = String(pageNumber);
    link.textContent = label;
    link.setAttribute("aria-label", accessibleLabel);
    return link;
  }

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
    writePageUrl();
    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = matches.slice(start, start + PAGE_SIZE);
    entriesElement.replaceChildren();

    for (const entry of visible) {
      const item = document.createElement("article");
      item.className = "entry";

      const heading = document.createElement("div");
      heading.className = "vocabulary-entry-heading";
      const word = document.createElement("span");
      word.className = "word";
      word.textContent = entry.word;
      heading.append(word);

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
      entryActions.append(level);
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
      const prompt = `Write three natural, everyday Chinese sentences using the word “${entry.word}”. For each sentence, show the Chinese, include pinyin, and provide a concise English translation.`;
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
    const count = document.createElement("span");
    count.textContent = `${first}–${last} of ${matches.length} entries`;
    status.replaceChildren(count);
    if (matches.length > PAGE_SIZE) {
      const pageLinks = document.createElement("span");
      pageLinks.className = "list-page-links";
      if (currentPage > 1) {
        pageLinks.append(createPageLink("←", currentPage - 1, "Previous page"));
      }
      if (currentPage < pageCount) {
        if (currentPage > 1) {
          pageLinks.append(document.createTextNode("·"));
        }
        pageLinks.append(createPageLink("→", currentPage + 1, "Next page"));
      }
      status.append(pageLinks);
    }
  }

  function resetAndRender() {
    currentPage = 1;
    render();
  }

  status.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-page]");
    if (!link) return;
    event.preventDefault();
    currentPage = Number(link.dataset.page);
    writePageUrl("pushState");
    render();
  });
  if (viewLinks.length) {
    for (const link of viewLinks) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (window.location.hash !== link.hash) {
          window.history.pushState(null, "", link.hash);
        }
        setHskView(link.hash.slice(1));
      });
    }
    window.addEventListener("popstate", () => {
      setHskView(window.location.hash === "#progress" ? "progress" : "list");
    });
    setHskView(window.location.hash === "#progress" ? "progress" : "list");
  }
  window.addEventListener("popstate", () => {
    const pageFromUrl = Number(new URLSearchParams(window.location.search).get("page"));
    currentPage = Number.isSafeInteger(pageFromUrl) && pageFromUrl > 0 ? pageFromUrl : 1;
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
      if (page === "hsk") {
        renderHskProgress();
      }
      status.classList.remove("error");
      render();
    })
    .catch((error) => {
      status.textContent = `Unable to load vocabulary: ${error.message}`;
      status.classList.add("error");
      if (page === "hsk") {
        window.history.replaceState(null, "", "#list");
        setHskView("list");
      }
    });
}

startVocabularyPage();
