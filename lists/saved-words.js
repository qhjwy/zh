"use strict";

const PAGE_SIZE = 60;
const supabaseClient = window.supabase?.createClient(
  document.body.dataset.supabaseUrl,
  document.body.dataset.supabaseKey
);
const userWordState = window.createUserWordState?.(supabaseClient);
window.bindKnownWordsExport?.(supabaseClient);
const {
  createKnownToggle: makeKnownToggle,
  createSavedToggle: makeSavedToggle,
  createCopyButton: makeCopyButton,
  createSentenceAction: makeSentenceAction
} = window.vocabularyListUi;
const accountLink = document.querySelector("#hsk-account-link");
const accountConnection = document.querySelector("#account-connection");
const accountAvatar = document.querySelector("#account-avatar");
const accountIcon = accountLink?.querySelector("svg");
const statusElement = document.querySelector("#status");
const savedWordsElement = document.querySelector("#saved-words");
const searchInput = document.querySelector("#ranked-list-search");
const searchClearButton = document.querySelector("#ranked-list-search-clear");
const knownStatusFilter = document.querySelector("#known-status-filter");
const hskMembershipFilter = document.querySelector("#hsk-membership-filter");
const pinyinToggle = document.querySelector("#pinyin-toggle");
const pagination = document.querySelector("#list-pagination");
let activeSession = null;
let authGeneration = 0;
let savedRows = [];
let wordsById = new Map();
let pinyinById = new Map();
let hskWordIds = new Set();
let currentPage = 1;

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function updateAccount(session, isError = false) {
  activeSession = session;
  accountLink?.classList.toggle("is-authenticated", Boolean(session));
  accountLink?.classList.toggle("has-auth-error", isError);
  accountLink?.setAttribute(
    "aria-label",
    session ? `Account: ${session.user.email}` : "登录"
  );
  accountLink?.setAttribute(
    "title",
    isError ? "Connection unavailable" : session ? `Signed in as ${session.user.email}` : "登录"
  );
  if (accountConnection) accountConnection.textContent = session ? "" : "登录";
  if (!accountAvatar || !accountIcon) return;

  accountAvatar.hidden = true;
  accountIcon.hidden = Boolean(session);
  if (!session) return;

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

function parseWordMapping(csv) {
  const words = new Map();
  const pinyin = new Map();
  let row = [];
  let field = "";
  let inQuotes = false;

  function finishRow() {
    const [rawId, word, rawPinyin] = row;
    const wId = String(rawId ?? "").replace(/^\uFEFF/, "");
    if (wId && wId !== "w_id" && word) {
      words.set(wId, word);
      pinyin.set(wId, String(rawPinyin ?? ""));
    }
    row = [];
  }

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (inQuotes) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      row.push(field);
      field = "";
      finishRow();
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error("The word mapping CSV contains an unclosed quoted field.");
  if (field || row.length) {
    row.push(field);
    finishRow();
  }
  if (!words.size) throw new Error("The word mapping CSV contains no word records.");
  return { words, pinyin };
}

async function loadSavedRows(session) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabaseClient
      .from("user_word_state")
      .select("w_id,updated_at")
      .eq("user_id", session.user.id)
      .eq("saved", true)
      .order("updated_at", { ascending: false })
      .order("w_id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    if (!Array.isArray(data)) {
      throw new Error("Supabase returned an invalid saved-word response.");
    }
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

async function loadWordMapping() {
  const source = document.body.dataset.wordMappingSource;
  if (!source) throw new Error("The word mapping source is not configured.");
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Could not load the word mapping (HTTP ${response.status}).`);
  return parseWordMapping(await response.text());
}

async function loadHskWordIds() {
  const source = document.body.dataset.hskSource;
  if (!source) throw new Error("The HSK source is not configured.");
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Could not load HSK data (HTTP ${response.status}).`);
  const records = await response.json();
  if (!Array.isArray(records)) throw new Error("The HSK data format is invalid.");
  return new Set(records.map((record) => String(record.w_id ?? "")).filter(Boolean));
}

function getDisplayPinyin(wordId) {
  const normalized = pinyinById.get(wordId) ?? "";
  const syllables = normalized.match(/\d+[a-züv]+[1-5]?|[a-züv]+[1-5]?/gi);
  return syllables?.length ? window.convertPinyin(syllables.join(" ")) : normalized;
}

function updatePagination(pageCount, matchCount) {
  pagination.replaceChildren();
  if (!matchCount) return;
  const controls = document.createElement("div");
  controls.className = "list-page-links";
  const summary = document.createElement("span");
  summary.textContent = `Page ${currentPage} of ${pageCount}`;
  controls.append(summary);

  for (const [label, targetPage] of [
    ["Previous", currentPage - 1],
    ["Next", currentPage + 1]
  ]) {
    const button = document.createElement("button");
    button.className = "sentence-button";
    button.type = "button";
    button.textContent = label;
    button.disabled = targetPage < 1 || targetPage > pageCount;
    button.addEventListener("click", () => {
      currentPage = targetPage;
      renderSavedRows();
    });
    controls.append(button);
  }
  pagination.append(controls);
}

function renderSavedRows() {
  savedWordsElement.replaceChildren();
  const query = searchInput.value.trim().toLocaleLowerCase();
  const knownStatus = knownStatusFilter.value;
  const hskMembership = hskMembershipFilter.value;
  const matches = savedRows.filter((row) => {
    const word = wordsById.get(row.w_id) ?? row.w_id;
    const pinyin = getDisplayPinyin(row.w_id);
    const known = userWordState.get(row.w_id).known;
    if (knownStatus === "known" && !known) return false;
    if (knownStatus === "unknown" && known) return false;
    if (hskMembership === "only" && !hskWordIds.has(row.w_id)) return false;
    if (hskMembership === "hide" && hskWordIds.has(row.w_id)) return false;
    return !query
      || word.toLocaleLowerCase().includes(query)
      || pinyin.toLocaleLowerCase().includes(query);
  });
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visibleRows = matches.slice(start, start + PAGE_SIZE);
  const fragment = document.createDocumentFragment();

  for (const row of visibleRows) {
    const wordId = row.w_id;
    const word = wordsById.get(wordId) ?? wordId;
    const entry = document.createElement("article");
    entry.className = "entry saved-word-entry";

    const heading = document.createElement("div");
    heading.className = "vocabulary-entry-heading";
    const wordElement = document.createElement("span");
    wordElement.className = "word";
    wordElement.textContent = word;
    heading.append(wordElement);
    const pinyin = getDisplayPinyin(wordId);
    if (pinyin) {
      const pinyinElement = document.createElement("span");
      pinyinElement.className = "pinyin vocabulary-pinyin";
      pinyinElement.textContent = `[${pinyin}]`;
      heading.append(pinyinElement);
    }
    entry.append(heading);

    const savedTime = document.createElement("time");
    savedTime.className = "saved-word-time";
    const timestamp = new Date(row.updated_at);
    if (!Number.isFinite(timestamp.getTime())) {
      throw new Error(`Saved word ${wordId} has an invalid timestamp.`);
    }
    savedTime.dateTime = row.updated_at;
    savedTime.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(timestamp);
    entry.append(savedTime);

    const actions = document.createElement("div");
    actions.className = "entry-actions";

    const knownToggle = makeKnownToggle({
      word,
      known: userWordState.get(wordId).known,
      disabled: !userWordState.ready || !activeSession,
      onToggle: () => updateWordFlag(row, "known")
    });
    actions.append(knownToggle);

    const savedToggle = makeSavedToggle({
      word,
      saved: true,
      disabled: !userWordState.ready || !activeSession,
      useIcon: true,
      onToggle: () => updateWordFlag(row, "saved")
    });
    actions.append(savedToggle);

    actions.append(makeCopyButton(word));
    const sentenceAction = makeSentenceAction(word, supabaseClient);
    actions.append(sentenceAction.button);
    entry.append(actions, sentenceAction.helper);
    fragment.append(entry);
  }

  savedWordsElement.append(fragment);
  if (!savedRows.length) {
    setStatus(activeSession ? "You have no saved words yet." : "Sign in to see your saved words.");
  } else if (!matches.length) {
    setStatus("No saved words match these filters.");
  } else {
    setStatus(`${matches.length.toLocaleString()} saved word${matches.length === 1 ? "" : "s"}.`);
  }
  updatePagination(pageCount, matches.length);
}

async function updateWordFlag(row, field) {
  if (!userWordState?.ready || !activeSession) return;
  const word = wordsById.get(row.w_id) ?? row.w_id;
  const nextValue = !userWordState.get(row.w_id)[field];
  try {
    await userWordState.toggle(row.w_id, field);
    if (field === "saved" && !nextValue) {
      savedRows = savedRows.filter((item) => item.w_id !== row.w_id);
    }
    renderSavedRows();
  } catch (error) {
    renderSavedRows();
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Could not update ${word}: ${message}`, true);
  }
}

async function updateSession(session) {
  const generation = ++authGeneration;
  updateAccount(session);
  savedRows = [];
  savedWordsElement.replaceChildren();
  pagination.replaceChildren();
  currentPage = 1;
  if (!session) {
    setStatus("Sign in to see your saved words.");
    return;
  }
  if (!userWordState) {
    setStatus("Word-state support failed to load. Reload the page and try again.", true);
    return;
  }

  setStatus("Loading your saved words…");
  try {
    const [, rows] = await Promise.all([
      userWordState.load(session),
      loadSavedRows(session)
    ]);
    if (generation !== authGeneration) return;
    savedRows = rows;
    if (savedRows.some((row) => !row.w_id || typeof row.updated_at !== "string")) {
      throw new Error("A saved-word row is missing a word ID or timestamp.");
    }
    if (savedRows.length) {
      const [mapping, hskIds] = await Promise.all([loadWordMapping(), loadHskWordIds()]);
      wordsById = mapping.words;
      pinyinById = mapping.pinyin;
      hskWordIds = hskIds;
    }
    if (generation !== authGeneration) return;
    renderSavedRows();
  } catch (error) {
    if (generation !== authGeneration) return;
    const message = error instanceof Error ? error.message : String(error);
    updateAccount(session, true);
    setStatus(`Could not load your saved words: ${message}`, true);
  }
}

accountLink?.addEventListener("click", (event) => {
  event.preventDefault();
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const loginUrl = new URL(accountLink.href);
  loginUrl.searchParams.set("return", returnTo);
  window.location.assign(loginUrl);
});

searchInput.addEventListener("input", () => {
  currentPage = 1;
  renderSavedRows();
});
searchClearButton.addEventListener("click", () => {
  searchInput.value = "";
  currentPage = 1;
  renderSavedRows();
  searchInput.focus();
});
knownStatusFilter.addEventListener("change", () => {
  currentPage = 1;
  renderSavedRows();
});
hskMembershipFilter.addEventListener("change", () => {
  currentPage = 1;
  renderSavedRows();
});
pinyinToggle.addEventListener("change", () => {
  document.body.classList.toggle("hide-pinyin", !pinyinToggle.checked);
});
document.body.classList.toggle("hide-pinyin", !pinyinToggle.checked);

if (!supabaseClient) {
  updateAccount(null, true);
  setStatus("Supabase client failed to load. Check your connection and reload.", true);
} else {
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => updateSession(session), 0);
  });
  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    return updateSession(data.session);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    updateAccount(null, true);
    setStatus(`Could not check your account: ${message}`, true);
  });
}
