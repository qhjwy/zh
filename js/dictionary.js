"use strict";

const searchInput = document.querySelector("#search");
const statusElement = document.querySelector("#status");
const resultsElement = document.querySelector("#results");
const clearButton = document.querySelector("#clear-btn");
const pasteButton = document.querySelector("#paste-btn");
const tagFilterOptions = document.querySelector("#tag-filter-options");
const scriptLabel = document.querySelector("#script-label");
const toggleButton = document.querySelector("#script-toggle");
const worker = new Worker(document.body.dataset.workerSrc || "worker.js");
const accountLink = document.querySelector("#hsk-account-link");
const connectionStatus = document.querySelector("#account-connection");
const accountAvatar = document.querySelector("#account-avatar");
const accountIcon = accountLink?.querySelector("svg");
const supabaseClient = window.supabase?.createClient(
  document.body.dataset.supabaseUrl,
  document.body.dataset.supabaseKey
);
const userWordState = window.createUserWordState?.(supabaseClient);

let showTraditional = false;
let lastQuery = "";
let debounceTimer;
let ready = false;
let readyStatus = "正在加载词典…";
let activeSession = null;
let currentEntries = [];
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
    message.textContent = "未找到结果。";
    resultsElement.append(message);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const wrapper = document.createElement("article");
    wrapper.className = "entry";

    const heading = document.createElement("div");
    heading.className = "dictionary-entry-heading";
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

    if (entry.w_id) {
      const saved = userWordState?.get(entry.w_id).saved ?? false;
      const saveButton = document.createElement("button");
      saveButton.className = `dictionary-save-button flag-toggle${saved ? " is-saved" : ""}`;
      saveButton.type = "button";
      saveButton.setAttribute("aria-pressed", String(saved));
      saveButton.setAttribute("aria-label", `${saved ? "Unsave" : "Save"} ${displayWord}`);
      saveButton.disabled = !supabaseClient || !activeSession || !userWordState?.ready;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("class", "dictionary-save-icon");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      const bookmark = document.createElementNS("http://www.w3.org/2000/svg", "path");
      bookmark.setAttribute("d", "M6 4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5Z");
      icon.append(bookmark);
      saveButton.append(icon);
      saveButton.addEventListener("click", () => toggleSaved(entry, saveButton));
      wrapper.append(saveButton);
    }
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

function updateAccount(session, error = false) {
  activeSession = session;
  updateAccountAvatar(Boolean(session));
  accountLink?.classList.toggle("is-authenticated", Boolean(session));
  accountLink?.classList.toggle("has-auth-error", error || !supabaseClient);
  accountLink?.setAttribute(
    "aria-label",
    session ? `Account: ${session.user.email}` : "登录"
  );
  accountLink?.setAttribute(
    "title",
    error || !supabaseClient
      ? "Connection unavailable"
      : session
        ? `Signed in as ${session.user.email}`
        : "登录"
  );
  if (connectionStatus) {
    connectionStatus.textContent = session ? "" : "登录";
  }
}

function updateAccountAvatar(isSignedIn) {
  if (!accountAvatar || !accountIcon) return;
  accountAvatar.hidden = true;
  accountIcon.hidden = isSignedIn;
  if (!isSignedIn) return;

  const imageUrl = document.body.dataset.profileImage;
  if (!imageUrl) return;
  accountAvatar.onload = () => {
    if (!activeSession) return;
    accountAvatar.hidden = false;
    accountIcon.hidden = true;
  };
  accountAvatar.onerror = () => {
    accountAvatar.hidden = true;
    accountIcon.hidden = true;
  };
  accountAvatar.src = imageUrl;
  if (accountAvatar.complete && accountAvatar.naturalWidth > 0) {
    accountAvatar.hidden = false;
    accountIcon.hidden = true;
  }
}

async function toggleSaved(entry, button) {
  if (!supabaseClient || !activeSession || !userWordState?.ready || button.disabled) return;
  button.disabled = true;
  const nextValue = !userWordState.get(entry.w_id).saved;
  const write = userWordState.toggle(entry.w_id, "saved");
  render(currentEntries);
  try {
    await write;
    render(currentEntries);
    statusElement.classList.remove("error");
    statusElement.textContent = `${nextValue ? "Saved" : "Removed"} ${entry.simplified}.`;
  } catch (error) {
    render(currentEntries);
    const message = error instanceof Error ? error.message : String(error);
    statusElement.textContent = `Could not save ${entry.simplified}: ${message}`;
    statusElement.classList.add("error");
  }
}

async function loadUserState(session) {
  updateAccount(session);
  if (!userWordState) {
    updateAccount(session, true);
    return;
  }
  try {
    const loadingState = userWordState.load(session);
    render(currentEntries);
    await loadingState;
    render(currentEntries);
    statusElement.classList.remove("error");
    statusElement.textContent = readyStatus;
  } catch (error) {
    render(currentEntries);
    const message = error instanceof Error ? error.message : String(error);
    updateAccount(session, true);
    statusElement.textContent = `Could not load your word state: ${message}`;
    statusElement.classList.add("error");
  }
}

accountLink?.addEventListener("click", (event) => {
  event.preventDefault();
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const loginUrl = new URL(accountLink.href);
  loginUrl.searchParams.set("return", returnTo);
  window.location.assign(loginUrl);
});

if (!supabaseClient) {
  updateAccount(null, true);
} else {
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      loadUserState(session);
    }, 0);
  });
  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    return loadUserState(data.session);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    updateAccount(null, true);
    statusElement.textContent = `Could not check account connection: ${message}`;
    statusElement.classList.add("error");
  });
  window.addEventListener("offline", () => updateAccount(activeSession));
  window.addEventListener("online", () => {
    updateAccount(activeSession);
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      return loadUserState(data.session);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      updateAccount(null, true);
      statusElement.textContent = `Could not check account connection: ${message}`;
      statusElement.classList.add("error");
    });
  });
}

function runSearch(query) {
  if (!ready) return;
  if (!query.trim()) {
    currentEntries = [];
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
    heading.textContent = hiddenByDefault ? "默认隐藏" : "默认显示";
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
      text.textContent = `显示 ${tag.name}（${tag.count}）`;
      label.append(checkbox, text);
      fragment.append(label);
    }
  }
  tagFilterOptions.append(fragment);
}

searchInput.addEventListener("input", () => {
  lastQuery = searchInput.value;
  statusElement.textContent = readyStatus;
  const hasText = lastQuery.length > 0;
  clearButton.textContent = hasText ? "✕" : "→";
  clearButton.classList.toggle("has-text", hasText);
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => runSearch(lastQuery), 150);
});

clearButton.addEventListener("click", () => {
  searchInput.value = "";
  lastQuery = "";
  currentEntries = [];
  resultsElement.replaceChildren();
  statusElement.textContent = readyStatus;
  clearButton.textContent = "→";
  clearButton.classList.remove("has-text");
  searchInput.focus();
});

pasteButton.addEventListener("click", async () => {
  try {
    if (!navigator.clipboard?.readText) {
      throw new Error("此浏览器或页面环境不支持剪贴板读取。");
    }
    searchInput.value = await navigator.clipboard.readText();
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    searchInput.focus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusElement.textContent = `无法读取剪贴板：${message}`;
  }
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
    readyStatus = `已加载 ${message.entryCount.toLocaleString()} 条词条。${message.hskCount.toLocaleString()} 条词条与 HSK 词汇及读音匹配（${message.hskPercentage}%）。`;
    statusElement.textContent = readyStatus;
    runSearch(lastQuery);
  } else if (message.type === "results") {
    currentEntries = message.entries;
    render(currentEntries);
  } else if (message.type === "error") {
    ready = false;
    readyStatus = `无法加载词典：${message.message}`;
    statusElement.textContent = readyStatus;
  }
});

worker.addEventListener("error", (event) => {
  statusElement.textContent = `词典工作线程运行失败：${event.message}`;
});
