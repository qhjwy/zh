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
const supabaseClient = window.supabase?.createClient(
  document.body.dataset.supabaseUrl,
  document.body.dataset.supabaseKey
);

let showTraditional = false;
let lastQuery = "";
let debounceTimer;
let ready = false;
let readyStatus = "正在加载词典…";
let activeSession = null;
let currentEntries = [];
let savedFlags = new Map();
let savedFlagsReady = false;
let savedFlagsGeneration = 0;
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

    if (entry.hskIds.length) {
      const saved = entry.hskIds.some((id) => savedFlags.get(id));
      const saveButton = document.createElement("button");
      saveButton.className = `saved-entry flag-toggle${saved ? " is-saved" : ""}`;
      saveButton.type = "button";
      saveButton.textContent = saved ? "Saved" : "Save";
      saveButton.setAttribute("aria-pressed", String(saved));
      saveButton.setAttribute("aria-label", `${saved ? "Unsave" : "Save"} ${displayWord}`);
      saveButton.disabled = !supabaseClient || !activeSession || !savedFlagsReady;
      saveButton.addEventListener("click", () => toggleSaved(entry, saveButton));
      heading.append(saveButton);
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
  accountLink?.classList.toggle("is-authenticated", Boolean(session));
  accountLink?.classList.toggle("has-auth-error", error || !supabaseClient);
  accountLink?.setAttribute(
    "aria-label",
    session ? `Account: ${session.user.email}` : "Account sign in"
  );
  accountLink?.setAttribute(
    "title",
    error || !supabaseClient
      ? "Connection unavailable"
      : session
        ? `Signed in as ${session.user.email}`
        : "Account sign in"
  );
  if (connectionStatus) {
    connectionStatus.textContent = error || !supabaseClient
      ? "Unavailable"
      : navigator.onLine ? "Connected" : "Offline";
  }
}

async function loadSavedFlags(entries, generation) {
  const ids = [...new Set(entries.flatMap((entry) => entry.hskIds))];
  if (!supabaseClient || !activeSession || !ids.length) {
    savedFlagsReady = true;
    render(currentEntries);
    return;
  }

  savedFlagsReady = false;
  render(currentEntries);
  const idColumn = document.body.dataset.supabaseIdColumn;
  const savedColumn = document.body.dataset.supabaseSavedColumn;
  const table = document.body.dataset.supabaseTable;
  try {
    const { data, error } = await supabaseClient
      .from(table)
      .select(`${idColumn},${savedColumn}`)
      .in(idColumn, ids.map(Number));
    if (error) throw error;
    if (generation !== savedFlagsGeneration) return;
    for (const id of ids) savedFlags.set(id, false);
    for (const row of data) {
      savedFlags.set(String(row[idColumn]), row[savedColumn] === true);
    }
    savedFlagsReady = true;
    render(currentEntries);
  } catch (error) {
    if (generation !== savedFlagsGeneration) return;
    savedFlagsReady = false;
    const message = error instanceof Error ? error.message : String(error);
    statusElement.textContent = `Could not load saved words: ${message}`;
    statusElement.classList.add("error");
  }
}

async function toggleSaved(entry, button) {
  if (!supabaseClient || !activeSession || !savedFlagsReady || button.disabled) return;
  const idColumn = document.body.dataset.supabaseIdColumn;
  const savedColumn = document.body.dataset.supabaseSavedColumn;
  const table = document.body.dataset.supabaseTable;
  const ids = entry.hskIds.map(Number);
  const nextValue = !entry.hskIds.some((id) => savedFlags.get(id));
  button.disabled = true;
  try {
    const { data, error } = await supabaseClient
      .from(table)
      .update({ [savedColumn]: nextValue })
      .in(idColumn, ids)
      .select(idColumn);
    if (error) throw error;
    if (data.length !== ids.length) {
      throw new Error(`Only ${data.length} of ${ids.length} HSK rows were updated.`);
    }
    for (const id of entry.hskIds) savedFlags.set(id, nextValue);
    render(currentEntries);
    statusElement.classList.remove("error");
    statusElement.textContent = `${nextValue ? "Saved" : "Removed"} ${entry.simplified}.`;
  } catch (error) {
    button.disabled = false;
    const message = error instanceof Error ? error.message : String(error);
    statusElement.textContent = `Could not save ${entry.simplified}: ${message}`;
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
      updateAccount(session);
      savedFlags.clear();
      savedFlagsReady = false;
      const generation = ++savedFlagsGeneration;
      render(currentEntries);
      loadSavedFlags(currentEntries, generation);
    }, 0);
  });
  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    updateAccount(data.session);
    const generation = ++savedFlagsGeneration;
    loadSavedFlags(currentEntries, generation);
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
      updateAccount(data.session);
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
    savedFlagsGeneration += 1;
    savedFlagsReady = true;
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
  savedFlagsGeneration += 1;
  savedFlagsReady = true;
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
    savedFlagsReady = !activeSession || !supabaseClient;
    render(currentEntries);
    const generation = ++savedFlagsGeneration;
    loadSavedFlags(currentEntries, generation);
  } else if (message.type === "error") {
    ready = false;
    readyStatus = `无法加载词典：${message.message}`;
    statusElement.textContent = readyStatus;
  }
});

worker.addEventListener("error", (event) => {
  statusElement.textContent = `词典工作线程运行失败：${event.message}`;
});
