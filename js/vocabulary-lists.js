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
  const definitions = Array.isArray(record["Dictionary definitions"])
    ? record["Dictionary definitions"].map(String).filter(Boolean)
    : meaning ? [meaning] : [];
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
    definitions,
    levels: levelInfo.levels,
    levelLabel: levelInfo.label,
    week: String(record["周"] ?? ""),
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
  const hskFilters = document.querySelector(".hsk-filters");
  const progressView = document.querySelector("#hsk-progress-view");
  const progressRows = document.querySelector("#hsk-progress-rows");
  const viewLinks = document.querySelectorAll(".hsk-view-nav a");
  const unknownFilter = document.querySelector("#unknown-filter");
  const pinyinToggle = document.querySelector("#pinyin-toggle");
  const onlyPinyinToggle = document.querySelector("#only-pinyin-toggle");
  const levelFilter = document.querySelector("#level-filter");
  const chapterFilter = document.querySelector("#chapter-filter");

  const selectedIds = new Set();
  const selectionToolbar = document.createElement("div");
  selectionToolbar.className = "selection-toolbar";
  selectionToolbar.setAttribute("role", "toolbar");
  selectionToolbar.setAttribute("aria-label", "所选词语操作");
  selectionToolbar.hidden = true;
  const selectionCount = document.createElement("span");
  selectionCount.className = "selection-count";
  const copyWordsButton = document.createElement("button");
  copyWordsButton.className = "selection-action";
  copyWordsButton.type = "button";
  copyWordsButton.textContent = "复制词语";
  const copyPromptsButton = document.createElement("button");
  copyPromptsButton.className = "selection-action";
  copyPromptsButton.type = "button";
  copyPromptsButton.textContent = "复制AI提示";
  const selectionStatus = document.createElement("span");
  selectionStatus.className = "selection-status";
  selectionStatus.setAttribute("role", "status");
  selectionToolbar.append(selectionCount, copyWordsButton, copyPromptsButton, selectionStatus);
  if (page !== "boya") {
    document.body.append(selectionToolbar);
  }

  let entries = [];
  const requestedPage = Number(new URLSearchParams(window.location.search).get("page"));
  let currentPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  document.body.classList.toggle("hide-pinyin", !pinyinToggle.checked);

  function updateSelectionToolbar() {
    if (page === "boya") return;

    const selectedCount = selectedIds.size;
    selectionToolbar.hidden = selectedCount === 0;
    document.body.classList.toggle("has-selection", selectedCount > 0);
    selectionCount.textContent = `已选 ${selectedCount} 个`;
    selectionStatus.textContent = "";
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const copyField = document.createElement("textarea");
      copyField.value = text;
      copyField.setAttribute("readonly", "");
      copyField.style.position = "fixed";
      copyField.style.opacity = "0";
      document.body.append(copyField);
      copyField.select();
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      } finally {
        copyField.remove();
      }
    }
  }

  async function copySelection(makeText, successMessage) {
    const selected = entries.filter((entry) => selectedIds.has(entry.id));
    if (!selected.length) return;
    const text = makeText(selected);
    const copied = await copyText(text);

    selectionStatus.textContent = copied
      ? successMessage(selected.length)
      : "复制失败，请重试。";
  }

  copyWordsButton.addEventListener("click", () => {
    copySelection(
      (selected) => selected.map((entry) => entry.word).join("\n"),
      (count) => `已复制 ${count} 个词语`
    );
  });
  copyPromptsButton.addEventListener("click", () => {
    copySelection(
      (selected) => `「${selected.map((entry) => entry.word).join("、")}」中文解释：意思、3个例句+解释、常用吗、近义词或易混词。`,
      (count) => `已复制 ${count} 个词语的AI提示`
    );
  });

  function setHskView(view) {
    if (!listView || !progressView) return;
    const showProgress = view === "progress";
    listView.hidden = showProgress;
    hskFilters.hidden = showProgress;
    status.hidden = showProgress;
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
    const selectedLevels = new Set(
      [...(levelFilter?.querySelectorAll('button[data-level][aria-pressed="true"]') ?? [])]
        .map((button) => button.dataset.level)
    );
    const selectedWeeks = new Set(
      [...(chapterFilter?.querySelectorAll('button[data-week][aria-pressed="true"]') ?? [])]
        .map((button) => button.dataset.week)
    );

    const matches = entries.filter((entry) => {
      if (unknownFilter?.checked && entry.known) {
        return false;
      }
      if (selectedLevels.size && ![...selectedLevels].some((selectedLevel) =>
        entry.levels.some((level) =>
          selectedLevel === "7-9" ? level >= 7 && level <= 9 : level === Number(selectedLevel)
        )
      )) {
        return false;
      }
      if (selectedWeeks.size && !selectedWeeks.has(entry.week || "-")) {
        return false;
      }
      return true;
    });
    if (page === "boya") {
      const selectedRank = new Map(
        [...selectedIds].map((id, index) => [id, index])
      );
      matches.sort((left, right) =>
        (selectedRank.get(left.id) ?? Infinity) - (selectedRank.get(right.id) ?? Infinity)
      );
    }
    return matches;
  }

  function renderBoyaWeekFilters() {
    if (page !== "boya" || !chapterFilter) return;

    const weeks = new Set(entries.map((entry) => entry.week || "-"));
    chapterFilter.replaceChildren();
    const sortedWeeks = [...weeks].sort((left, right) =>
      left === "-" ? 1 : right === "-" ? -1 : Number(left) - Number(right)
    );
    for (const week of sortedWeeks) {
      const weekButton = document.createElement("button");
      weekButton.className = "boya-level level-chip week-chip";
      weekButton.type = "button";
      weekButton.dataset.week = week;
      weekButton.setAttribute("aria-pressed", "false");
      weekButton.textContent = week === "-" ? "-" : `周${week}`;
      weekButton.setAttribute(
        "aria-label",
        week === "-" ? "筛选无周" : `筛选第${week}周`
      );
      chapterFilter.append(weekButton);
    }
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
      item.className = `entry${selectedIds.has(entry.id) ? " is-selected" : ""}`;

      const heading = document.createElement("div");
      heading.className = "vocabulary-entry-heading";
      const selectionIndicator = document.createElement("span");
      selectionIndicator.className = "selection-indicator";
      selectionIndicator.setAttribute("aria-hidden", "true");
      selectionIndicator.textContent = selectedIds.has(entry.id) ? "✓" : "";
      const word = document.createElement("button");
      word.className = "word word-select";
      word.textContent = entry.word;
      word.type = "button";
      word.setAttribute("aria-pressed", String(selectedIds.has(entry.id)));
      word.setAttribute("aria-label", `选择${entry.word}`);
      word.addEventListener("click", () => {
        const selected = selectedIds.has(entry.id);
        if (selected) {
          selectedIds.delete(entry.id);
        } else {
          selectedIds.add(entry.id);
        }
        if (page === "boya") {
          resetAndRender();
          return;
        }
        item.classList.toggle("is-selected", !selected);
        selectionIndicator.textContent = selected ? "" : "✓";
        word.setAttribute("aria-pressed", String(!selected));
        updateSelectionToolbar();
      });
      heading.addEventListener("click", (event) => {
        if (
          page === "boya"
          || !selectedIds.has(entry.id)
          || event.target === word
          || event.clientX >= word.getBoundingClientRect().left
        ) {
          return;
        }

        selectedIds.delete(entry.id);
        item.classList.remove("is-selected");
        selectionIndicator.textContent = "";
        word.setAttribute("aria-pressed", "false");
        updateSelectionToolbar();
      });
      if (page === "boya") {
        heading.append(word);
      } else {
        heading.append(selectionIndicator, word);
      }

      if (entry.pinyin) {
        const pinyin = document.createElement("span");
        pinyin.className = "pinyin vocabulary-pinyin";
        pinyin.textContent = `[${window.convertPinyin(entry.pinyin)}]`;
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

      if (entry.definitions.length) {
        const meaning = document.createElement("div");
        meaning.className = "defs";
        for (const definition of entry.definitions) {
          const chip = document.createElement("span");
          chip.textContent = definition;
          meaning.append(chip, " ");
        }
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

      const individualCopyButton = document.createElement("button");
      individualCopyButton.className = "sentence-button";
      individualCopyButton.type = "button";
      individualCopyButton.textContent = "复制";
      individualCopyButton.setAttribute("aria-label", `复制${entry.word}`);
      individualCopyButton.addEventListener("click", async () => {
        const copied = await copyText(entry.word);
        individualCopyButton.textContent = copied ? "已复制" : "复制失败";
        window.setTimeout(() => {
          individualCopyButton.textContent = "复制";
        }, 1500);
      });
      entryActions.append(individualCopyButton);

      const sentenceButton = document.createElement("button");
      sentenceButton.className = "sentence-button";
      sentenceButton.type = "button";
      sentenceButton.textContent = "例句";
      sentenceButton.setAttribute("aria-label", `复制${entry.word}的AI提示`);
      sentenceButton.setAttribute("aria-expanded", "false");
      entryActions.append(sentenceButton);

      const sentenceHelper = document.createElement("section");
      sentenceHelper.className = "sentence-helper";
      sentenceHelper.hidden = true;
      const prompt = `「${entry.word}」中文解释：意思、3个例句+解释、常用吗、近义词或易混词。`;
      const promptText = document.createElement("textarea");
      promptText.className = "sentence-prompt";
      promptText.value = prompt;
      promptText.readOnly = true;
      promptText.setAttribute("aria-label", `AI提示：${entry.word}`);
      const sentenceActions = document.createElement("div");
      sentenceActions.className = "sentence-actions";
      const copyPromptButton = document.createElement("button");
      copyPromptButton.className = "sentence-copy";
      copyPromptButton.type = "button";
      copyPromptButton.textContent = "再次复制提示";
      const openAiLink = document.createElement("a");
      openAiLink.href = "https://chat.deepseek.com/";
      openAiLink.target = "_blank";
      openAiLink.rel = "noopener noreferrer";
      openAiLink.textContent = "打开 DeepSeek";
      const promptStatus = document.createElement("span");
      promptStatus.className = "sentence-status";
      promptStatus.setAttribute("role", "status");
      sentenceActions.append(copyPromptButton, openAiLink, promptStatus);
      sentenceHelper.append(promptText, sentenceActions);

      async function copyIndividualPrompt() {
        const copied = await copyText(prompt);
        promptStatus.textContent = copied
          ? "提示已复制，可粘贴到 DeepSeek。"
          : "复制失败，请选中上方提示并手动复制。";
      }

      sentenceButton.addEventListener("click", () => {
        const isOpen = sentenceHelper.hidden;
        sentenceHelper.hidden = !isOpen;
        sentenceButton.setAttribute("aria-expanded", String(isOpen));
        if (isOpen) {
          copyIndividualPrompt();
          window.open(openAiLink.href, "_blank", "noopener,noreferrer");
        }
      });
      copyPromptButton.addEventListener("click", copyIndividualPrompt);

      if (page === "hsk") {
        const detailButton = document.createElement("button");
        detailButton.className = "sentence-button";
        detailButton.type = "button";
        detailButton.textContent = "详情";
        detailButton.setAttribute("aria-expanded", "false");
        detailButton.setAttribute("aria-label", `显示${entry.word}的拼音和释义`);
        detailButton.addEventListener("click", () => {
          const expanded = item.classList.toggle("is-expanded");
          detailButton.textContent = expanded ? "收起" : "详情";
          detailButton.setAttribute("aria-expanded", String(expanded));
          detailButton.setAttribute(
            "aria-label",
            `${expanded ? "隐藏" : "显示"}${entry.word}的拼音和释义`
          );
        });
        entryActions.append(detailButton);
      }
      item.insertBefore(entryActions, item.querySelector(".defs"));
      item.append(sentenceHelper);

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
      if (page === "boya") {
        button.setAttribute("aria-pressed", String(!wasSelected));
      } else {
        for (const filterButton of levelFilter.querySelectorAll("button[data-level]")) {
          filterButton.setAttribute("aria-pressed", String(filterButton === button && !wasSelected));
        }
      }
      resetAndRender();
    });
  }
  if (chapterFilter) {
    chapterFilter.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-week]");
      if (!button) return;
      const wasSelected = button.getAttribute("aria-pressed") === "true";
      button.setAttribute("aria-pressed", String(!wasSelected));
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
      renderBoyaWeekFilters();
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
