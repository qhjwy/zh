"use strict";

const PAGE_SIZE = 60;
const DAILY_TOKEN_COUNT = 17000;
const FREQUENCY_VOCABULARY_SIZE = 50000;
const EULER_MASCHERONI = 0.5772156649015329;
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
  createSentenceAction: makeSentenceAction,
  renderListPagination: renderSharedListPagination
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
let listMetricsById = new Map();
const initialPage = Number(new URLSearchParams(window.location.search).get("page"));
let currentPage = Number.isSafeInteger(initialPage) && initialPage > 0 ? initialPage : 1;

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

async function loadListMetrics() {
  const frequencySource = document.body.dataset.frequencySource;
  const zimuSource = document.body.dataset.zimuSource;
  if (!frequencySource || !zimuSource) {
    throw new Error("The frequency and 字幕 sources are not configured.");
  }

  const [frequencyResponse, zimuResponse] = await Promise.all([
    fetch(frequencySource),
    fetch(zimuSource)
  ]);
  if (!frequencyResponse.ok) {
    throw new Error(`Could not load the frequency list (HTTP ${frequencyResponse.status}).`);
  }
  if (!zimuResponse.ok) {
    throw new Error(`Could not load the 字幕 list (HTTP ${zimuResponse.status}).`);
  }

  const [frequencyRecords, zimuRecords] = await Promise.all([
    frequencyResponse.json(),
    zimuResponse.json()
  ]);
  if (!Array.isArray(frequencyRecords) || !Array.isArray(zimuRecords)) {
    throw new Error("The frequency or 字幕 data format is invalid.");
  }

  const metrics = new Map();
  for (const record of frequencyRecords) {
    const wordId = String(record.w_id ?? "");
    const rank = Number(record.Frequency ?? record.frequency);
    if (!wordId || !Number.isFinite(rank) || rank < 1) continue;
    const lambda = DAILY_TOKEN_COUNT
      / (rank * (Math.log(FREQUENCY_VOCABULARY_SIZE) + EULER_MASCHERONI));
    const dailyProbability = -Math.expm1(-lambda);
    const current = metrics.get(wordId) ?? {};
    if (
      current.frequencyProbability === undefined
      || dailyProbability > current.frequencyProbability
    ) {
      current.frequencyProbability = dailyProbability;
    }
    metrics.set(wordId, current);
  }

  for (const record of zimuRecords) {
    const wordId = String(record.w_id ?? "");
    const probability = Number(record.Probability ?? record.probability);
    if (!wordId || !Number.isFinite(probability) || probability < 0 || probability > 1) continue;
    const current = metrics.get(wordId) ?? {};
    current.zimuProbability = probability;
    metrics.set(wordId, current);
  }
  return metrics;
}

function getDisplayPinyin(wordId) {
  const normalized = pinyinById.get(wordId) ?? "";
  const syllables = normalized.match(/\d+[a-züv]+[1-5]?|[a-züv]+[1-5]?/gi);
  return syllables?.length ? window.convertPinyin(syllables.join(" ")) : normalized;
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

function getDaysSinceSaved(timestamp, now = new Date()) {
  const savedDate = new Date(timestamp);
  if (!Number.isFinite(savedDate.getTime())) return null;
  const savedDay = Date.UTC(savedDate.getFullYear(), savedDate.getMonth(), savedDate.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((today - savedDay) / 86400000));
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
  writePageUrl();
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

    const metrics = listMetricsById.get(wordId);
    if (metrics) {
      const metricTags = document.createElement("div");
      metricTags.className = "frequency-entry-tags";
      if (metrics.frequencyProbability !== undefined) {
        const frequencyTag = document.createElement("span");
        frequencyTag.className = "hsk-level frequency-rank";
        frequencyTag.title = "Estimated chance of use at least once in a day based on the frequency-list rank.";
        frequencyTag.textContent = `词频 ${Math.round(metrics.frequencyProbability * 100)}%`;
        metricTags.append(frequencyTag);
      }
      if (metrics.zimuProbability !== undefined) {
        const zimuTag = document.createElement("span");
        zimuTag.className = "hsk-level frequency-rank";
        zimuTag.title = "Probability listed in the 字幕 list.";
        zimuTag.textContent = `字幕 ${Math.round(metrics.zimuProbability * 100)}%`;
        metricTags.append(zimuTag);
      }
      if (metricTags.childElementCount) entry.append(metricTags);
    }

    const savedTime = document.createElement("time");
    savedTime.className = "saved-word-time";
    const timestamp = new Date(row.updated_at);
    if (!Number.isFinite(timestamp.getTime())) {
      throw new Error(`Saved word ${wordId} has an invalid timestamp.`);
    }
    savedTime.dateTime = row.updated_at;
    const daysSinceSaved = getDaysSinceSaved(row.updated_at);
    savedTime.textContent = `${daysSinceSaved} day${daysSinceSaved === 1 ? "" : "s"}`;
    savedTime.setAttribute("aria-label", `Saved ${daysSinceSaved} day${daysSinceSaved === 1 ? "" : "s"} ago`);
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
  renderSharedListPagination(pagination, {
    currentPage,
    pageSize: PAGE_SIZE,
    total: matches.length,
    getPageUrl,
    onPageChange: (nextPage) => {
      currentPage = nextPage;
      writePageUrl("pushState");
      renderSavedRows();
    }
  });
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
  listMetricsById = new Map();
  savedWordsElement.replaceChildren();
  pagination.replaceChildren();
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
      const [mapping, hskIds, listMetrics] = await Promise.all([
        loadWordMapping(),
        loadHskWordIds(),
        loadListMetrics()
      ]);
      wordsById = mapping.words;
      pinyinById = mapping.pinyin;
      hskWordIds = hskIds;
      listMetricsById = listMetrics;
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
window.addEventListener("popstate", () => {
  const pageFromUrl = Number(new URLSearchParams(window.location.search).get("page"));
  currentPage = Number.isSafeInteger(pageFromUrl) && pageFromUrl > 0 ? pageFromUrl : 1;
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
