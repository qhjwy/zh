"use strict";

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

function createKnownToggle({ word, known, disabled, onToggle }) {
  const button = document.createElement("button");
  button.className = `known-entry flag-toggle${known ? " is-known" : " is-unknown"}`;
  button.type = "button";
  button.textContent = known ? "Known" : "Unknown";
  button.setAttribute("aria-pressed", String(known));
  button.setAttribute("aria-label", `Mark ${word} ${known ? "unknown" : "known"}`);
  button.disabled = disabled;
  button.addEventListener("click", onToggle);
  return button;
}

function createSavedToggle({ word, saved, disabled, useIcon, onToggle }) {
  const button = document.createElement("button");
  button.className = useIcon
    ? `frequency-save-button flag-toggle${saved ? " is-saved" : ""}`
    : `saved-entry flag-toggle${saved ? " is-saved" : ""}`;
  button.type = "button";
  button.setAttribute("aria-pressed", String(saved));
  button.setAttribute("aria-label", `${saved ? "Unsave" : "Save"} ${word}`);
  button.disabled = disabled;
  if (useIcon) {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "dictionary-save-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const bookmark = document.createElementNS("http://www.w3.org/2000/svg", "path");
    bookmark.setAttribute("d", "M6 4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5Z");
    icon.append(bookmark);
    button.append(icon);
  } else {
    button.textContent = saved ? "Saved" : "Save";
  }
  button.addEventListener("click", onToggle);
  return button;
}

function createCopyButton(word) {
  const button = document.createElement("button");
  button.className = "sentence-button";
  button.type = "button";
  button.textContent = "复制";
  button.setAttribute("aria-label", `复制${word}`);
  button.addEventListener("click", async () => {
    const copied = await copyText(word);
    button.textContent = copied ? "已复制" : "复制失败";
    if (!copied) console.error("Could not copy word:", word);
    window.setTimeout(() => {
      button.textContent = "复制";
    }, 1500);
  });
  return button;
}

function renderSentenceMarkdown(text, container) {
  container.replaceChildren();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    const listItem = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
    const content = heading?.[1] ?? listItem?.[1] ?? line;
    const block = document.createElement(heading ? "h4" : "p");
    if (listItem) {
      block.className = "sentence-list-item";
      const marker = document.createElement("span");
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = line.match(/^\s*(?:[-*+]|\d+[.)])/)?.[0].trim() ?? "•";
      block.append(marker, " ");
    }

    const boldParts = content.split(/(\*\*.+?\*\*|\*[^*]+?\*|__.+?__|_[^_]+?_)/g);
    for (const part of boldParts) {
      const boldMatch = part.match(/^(?:\*\*(.+)\*\*|\*(.+)\*|__(.+)__|_(.+)_)$/);
      if (boldMatch) {
        const bold = document.createElement("strong");
        bold.textContent = boldMatch[1] ?? boldMatch[2] ?? boldMatch[3] ?? boldMatch[4];
        block.append(bold);
      } else {
        block.append(document.createTextNode(part));
      }
    }
    container.append(block);
  }
}

function renderListPagination(container, {
  currentPage,
  pageSize,
  total,
  getPageUrl,
  onPageChange
}) {
  container.replaceChildren();
  if (!total) return;

  const first = (currentPage - 1) * pageSize + 1;
  const last = Math.min(currentPage * pageSize, total);
  const summary = document.createElement("span");
  summary.textContent = `${first}–${last} of ${total} entries`;
  container.append(summary);

  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return;

  const pageLinks = document.createElement("span");
  pageLinks.className = "list-page-links";
  const addPageLink = (label, targetPage, accessibleLabel) => {
    const link = document.createElement("a");
    link.href = getPageUrl(targetPage);
    link.dataset.page = String(targetPage);
    link.textContent = label;
    link.setAttribute("aria-label", accessibleLabel);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      onPageChange(targetPage);
    });
    pageLinks.append(link);
  };

  if (currentPage > 1) addPageLink("←", currentPage - 1, "Previous page");
  if (currentPage < pageCount) {
    if (currentPage > 1) pageLinks.append(document.createTextNode("·"));
    addPageLink("→", currentPage + 1, "Next page");
  }
  container.append(pageLinks);
}

function createSentenceAction(word, supabaseClient) {
  const button = document.createElement("button");
  button.className = "sentence-button";
  button.type = "button";
  button.textContent = "例句";
  button.setAttribute("aria-label", `为${word}生成例句`);
  button.setAttribute("aria-expanded", "false");

  const helper = document.createElement("section");
  helper.className = "sentence-helper";
  helper.hidden = true;
  const result = document.createElement("div");
  result.className = "sentence-result";
  result.setAttribute("role", "status");
  result.setAttribute("aria-live", "polite");
  helper.append(result);

  button.addEventListener("click", async () => {
    const isOpen = helper.hidden;
    helper.hidden = !isOpen;
    button.setAttribute("aria-expanded", String(isOpen));
    if (!isOpen) return;
    button.disabled = true;
    result.classList.remove("is-error");
    result.textContent = "正在生成例句…";
    try {
      if (!supabaseClient) throw new Error("Supabase client is unavailable.");
      const { data, error } = await supabaseClient.functions.invoke("generate-sentence", {
        body: { prompt: `「${word}」中文解释：意思、3个例句+解释、常用吗、近义词或易混词。` }
      });
      if (error) throw error;
      if (typeof data?.sentence !== "string" || !data.sentence.trim()) {
        throw new Error("The generate-sentence response did not contain a sentence.");
      }
      renderSentenceMarkdown(data.sentence, result);
    } catch (error) {
      console.error("Could not generate sentence:", error);
      result.classList.add("is-error");
      result.textContent = "生成失败，请稍后重试。";
    } finally {
      button.disabled = false;
    }
  });
  return { button, helper };
}

window.vocabularyListUi = {
  copyText,
  createKnownToggle,
  createSavedToggle,
  createCopyButton,
  createSentenceAction,
  renderSentenceMarkdown,
  renderListPagination
};
