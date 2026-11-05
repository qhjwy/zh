"use strict";

const PAGE_SIZE = 60;
const USER_STATE_PAGES = new Set(["hsk", "frequency", "zimu", "boya"]);
const HIDDEN_CEDICT_TAGS = new Set([
  "archaic",
  "dated",
  "latin_digit",
  "proper_noun",
  "regional",
  "variant"
]);

function getLevelInfo(record, page) {
  if (page === "dictionary" || page === "frequency" || page === "zimu") {
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

function normalizeRecord(record, page, userWordState) {
  const word = String(record.word ?? record.Word ?? "");
  const pinyin = String(record.pinyin ?? record.Pinyin ?? "");
  const meaning = String(record.meaning ?? record.Meaning ?? record.Definitions ?? "");
  const definitions = Array.isArray(record["Dictionary definitions"])
    ? record["Dictionary definitions"].map(String).filter(Boolean)
    : meaning ? [meaning] : [];
  const id = String(record.ID ?? `${word}\u0000${pinyin}`);
  const wId = String(record.w_id ?? "");
  const hasUserState = USER_STATE_PAGES.has(page);
  const initialKnown = Boolean(record.known ?? record["学会"] === "x");
  const levelInfo = getLevelInfo(record, page);
  const rawProbability = String(record.Probability ?? record.probability ?? "");
  const probability = page === "zimu" ? Number(rawProbability) : null;
  if (
    page === "zimu"
    && (!rawProbability || !Number.isFinite(probability) || probability < 0 || probability > 1)
  ) {
    throw new Error(`Invalid zimu probability for ${word}: ${rawProbability}`);
  }

  const entry = {
    id,
    wId,
    word,
    variants: [...new Set([word, String(record.Original ?? "")].filter(Boolean))],
    pinyin,
    meaning,
    definitions,
    levels: levelInfo.levels,
    levelLabel: levelInfo.label,
    hskLevels: [],
    frequency: String(record.Frequency ?? record.frequency ?? ""),
    probability,
    week: String(record["周"] ?? "")
  };
  Object.defineProperties(entry, {
    known: {
      enumerable: true,
      get: () => hasUserState
        ? Boolean(wId && userWordState?.get(wId).known)
        : initialKnown
    },
    saved: {
      enumerable: true,
      get: () => Boolean(hasUserState && wId && userWordState?.get(wId).saved)
    }
  });
  return entry;
}

function startVocabularyPage() {
  const page = document.body.dataset.page;
  const {
    copyText,
    createKnownToggle,
    createSavedToggle,
    createCopyButton,
    createSentenceAction
  } = window.vocabularyListUi;
  const isRankedList = page === "frequency" || page === "zimu";
  const source = document.body.dataset.source;
  const entriesElement = document.querySelector("#vocabulary-entries");
  const status = document.querySelector("#status");
  const pagination = document.querySelector("#list-pagination") ?? status;
  const accountLink = document.querySelector("#hsk-account-link");
  const connectionStatus = document.querySelector("#account-connection");
  const accountAvatar = document.querySelector("#account-avatar");
  const accountIcon = accountLink?.querySelector("svg");
  const listView = document.querySelector("#hsk-list-view");
  const frequencyListView = document.querySelector("#frequency-list-view");
  const hskFilters = document.querySelector(".hsk-filters");
  const progressView = document.querySelector("#hsk-progress-view");
  const progressRows = document.querySelector("#hsk-progress-rows");
  const frequencyProgressView = document.querySelector("#frequency-progress-view");
  const frequencyProgressRows = document.querySelector("#frequency-progress-rows");
  const rankedListSearchContainer = document.querySelector("#ranked-list-search-container");
  const rankedListSearch = document.querySelector("#ranked-list-search");
  const rankedListSearchClear = document.querySelector("#ranked-list-search-clear");
  const musicView = document.querySelector("#hsk-music-view");
  const musicLink = document.querySelector('.list-view-nav a[href="#music"]');
  const musicEditor = document.querySelector("#music-editor");
  const musicText = document.querySelector("#music-text");
  const musicAnalyze = document.querySelector("#music-analyze");
  const musicRedo = document.querySelector("#music-redo");
  const musicStatus = document.querySelector("#music-status");
  const musicResults = document.querySelector("#music-results");
  const viewLinks = document.querySelectorAll(".list-view-nav a");
  const unknownFilter = document.querySelector("#unknown-filter");
  const savedFilter = document.querySelector("#saved-filter");
  const pinyinToggle = document.querySelector("#pinyin-toggle");
  const onlyPinyinToggle = document.querySelector("#only-pinyin-toggle");
  const knownFilter = document.querySelector("#known-filter");
  const levelFilter = document.querySelector("#level-filter");
  const chapterFilter = document.querySelector("#chapter-filter");
  const hskMembershipFilter = document.querySelector("#hsk-membership-filter");
  const knownStatusFilter = document.querySelector("#known-status-filter");

  const selectedIds = new Set();
  const knownThisSession = new Set();
  const supabaseClient = USER_STATE_PAGES.has(page) && window.supabase
    ? window.supabase.createClient(document.body.dataset.supabaseUrl, document.body.dataset.supabaseKey)
    : null;
  const userWordState = window.createUserWordState?.(supabaseClient);
  window.bindKnownWordsExport?.(supabaseClient);
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
  let activeSession = null;
  let authSessionReady = false;
  let hskReady = page !== "hsk";
  let remoteFlagsReady = false;
  let authGeneration = 0;
  let hskWordTrie = null;
  let cedictWordTrie = null;
  let cedictDefinitionsById = null;
  let cedictLoadPromise = null;
  let cedictWordIds = null;
  let cedictWordIdsLoadPromise = null;
  let musicRequested = window.location.hash === "#music";
  let activeMusicWord = null;
  const musicDefinitionPopover = document.createElement("div");
  musicDefinitionPopover.className = "music-definition-popover";
  musicDefinitionPopover.setAttribute("role", "tooltip");
  musicDefinitionPopover.hidden = true;
  document.body.append(musicDefinitionPopover);
  const requestedPage = Number(new URLSearchParams(window.location.search).get("page"));
  let currentPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  document.body.classList.toggle("hide-pinyin", !pinyinToggle.checked);

  accountLink?.addEventListener("click", (event) => {
    event.preventDefault();
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const loginUrl = new URL(accountLink.href);
    loginUrl.searchParams.set("return", returnTo);
    window.location.assign(loginUrl);
  });

  function updateSelectionToolbar() {
    const selectedCount = selectedIds.size;
    selectionToolbar.hidden = selectedCount === 0;
    document.body.classList.toggle("has-selection", selectedCount > 0);
    selectionCount.textContent = `已选 ${selectedCount} 个`;
    selectionStatus.textContent = "";
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
    if (!listView || !progressView || !musicView) return;
    const showProgress = view === "progress";
    const showMusic = view === "music";
    listView.hidden = showProgress || showMusic;
    hskFilters.hidden = showProgress || showMusic;
    status.hidden = showProgress || showMusic;
    progressView.hidden = !showProgress;
    musicView.hidden = !showMusic;
    for (const link of viewLinks) {
      if (link.hash === `#${view}`) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  function setFrequencyView(view) {
    if (!frequencyListView || !frequencyProgressView) return;
    const showProgress = view === "progress";
    frequencyListView.hidden = showProgress;
    document.querySelector(".frequency-filters").hidden = showProgress;
    status.hidden = showProgress;
    pagination.hidden = showProgress;
    if (rankedListSearchContainer) rankedListSearchContainer.hidden = showProgress;
    frequencyProgressView.hidden = !showProgress;
    for (const link of viewLinks) {
      if (link.hash === `#${view}`) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  function setAuthStatus(message, isError = false) {
    if (!accountLink) return;
    accountLink.title = message;
    accountLink.classList.toggle("has-auth-error", isError);
  }

  function setConnectionStatus(_message, isError = false) {
    if (connectionStatus) connectionStatus.textContent = activeSession ? "" : "登录";
    accountLink?.classList.toggle("has-auth-error", isError);
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

  async function updateAuthSession(session) {
    activeSession = session;
    authSessionReady = true;
    const generation = ++authGeneration;
    const isSignedIn = Boolean(session);
    updateAccountAvatar(isSignedIn);
    if (accountLink) {
      accountLink.classList.toggle("is-authenticated", isSignedIn);
      accountLink.title = isSignedIn ? `Signed in as ${session.user.email}` : "登录";
      accountLink.setAttribute("aria-label", isSignedIn ? `Account: ${session.user.email}` : "登录");
    }
    setConnectionStatus(navigator.onLine ? "Connected" : "Offline", !navigator.onLine);
    remoteFlagsReady = false;

    if (!supabaseClient) {
      setConnectionStatus("Connection unavailable", true);
      setAuthStatus("Supabase client failed to load. Reload the page and try again.", true);
      if (page === "hsk") {
        hskReady = true;
        render();
      }
      if (USER_STATE_PAGES.has(page)) {
        status.textContent = "Supabase client failed to load. Reload the page and try again.";
        status.classList.add("error");
      }
      return;
    }
    if (!USER_STATE_PAGES.has(page)) return;
    if (!authSessionReady) return;
    if (!userWordState) {
      hskReady = true;
      render();
      status.textContent = "Word-state support failed to load. Reload the page and try again.";
      status.classList.add("error");
      setAuthStatus("Word-state support failed to load. Reload the page and try again.", true);
      return;
    }
    if (page === "hsk") hskReady = false;
    const loadingState = userWordState.load(session);
    render();
    status.textContent = isSignedIn ? "Loading your word state…" : "Sign in to sync word status.";
    setAuthStatus(isSignedIn ? "Loading your word state…" : "Sign in to sync Known and Saved flags.");
    try {
      await loadingState;
      if (generation !== authGeneration) return;
      remoteFlagsReady = true;
      hskReady = true;
      render();
      renderProgress();
      status.classList.remove("error");
      if (isSignedIn) {
        status.textContent = "Your word state is synced.";
        setAuthStatus(`Synced word state for ${session.user.email}.`);
      } else {
        status.textContent = "Sign in to sync word status.";
        setAuthStatus("Sign in to sync Known and Saved flags.");
      }
    } catch (error) {
      if (generation !== authGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      hskReady = true;
      render();
      status.textContent = `Could not load your word state: ${message}`;
      status.classList.add("error");
      setAuthStatus(`Could not load your word state: ${message}`, true);
    }
  }

  async function updateWordFlag(entry, field, button) {
    if (
      !supabaseClient
      || !activeSession
      || !remoteFlagsReady
      || !entry.wId
      || button.disabled
    ) return;
    const nextValue = !userWordState.get(entry.wId)[field];
    if ((page === "frequency" || page === "zimu") && field === "known") {
      if (nextValue) {
        knownThisSession.add(entry.id);
      } else {
        knownThisSession.delete(entry.id);
      }
    }
    button.disabled = true;
    const write = userWordState.toggle(entry.wId, field);
    render();
    renderProgress();
    setAuthStatus(`Saving ${entry.word}…`);
    try {
      await write;
      render();
      renderProgress();
      status.classList.remove("error");
      status.textContent = `${nextValue ? "Marked" : "Unmarked"} ${entry.word} ${field}.`;
      setAuthStatus(`Saved ${entry.word} ${field} status.`);
    } catch (error) {
      if ((page === "frequency" || page === "zimu") && field === "known") {
        knownThisSession.delete(entry.id);
      }
      render();
      renderProgress();
      const message = error instanceof Error ? error.message : String(error);
      status.textContent = `Could not save ${entry.word} status: ${message}`;
      status.classList.add("error");
      setAuthStatus(`Could not save ${entry.word} status: ${message}`, true);
    }
  }

  if (!supabaseClient) {
    setConnectionStatus("Connection unavailable", true);
    if (USER_STATE_PAGES.has(page)) {
      setAuthStatus("Supabase client failed to load. Reload the page and try again.", true);
      status.textContent = "Supabase client failed to load. Reload the page and try again.";
      status.classList.add("error");
      if (page === "hsk") {
        hskReady = true;
        render();
      }
    }
  } else {
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        updateAuthSession(session);
      }, 0);
    });
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      return updateAuthSession(data.session);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setConnectionStatus("Connection unavailable", true);
      if (USER_STATE_PAGES.has(page)) {
        hskReady = true;
        render();
        status.textContent = `Could not check Supabase session: ${message}`;
        status.classList.add("error");
        setAuthStatus(`Could not check Supabase session: ${message}`, true);
      }
    });
  }
  window.addEventListener("offline", () => setConnectionStatus("Offline", true));
  window.addEventListener("online", () => {
    setConnectionStatus("Reconnecting…");
    if (!supabaseClient) return;
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      return updateAuthSession(data.session);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setConnectionStatus("Connection unavailable", true);
      if (USER_STATE_PAGES.has(page)) {
        hskReady = true;
        render();
        status.textContent = `Could not check Supabase session: ${message}`;
        status.classList.add("error");
        setAuthStatus(`Could not check Supabase session: ${message}`, true);
      }
    });
  });

  function buildHskWordTrie() {
    const root = { children: new Map(), entries: [] };
    for (const entry of entries) {
      for (const variant of entry.variants) {
        const characters = [...variant];
        if (!characters.some((character) => /\p{Script=Han}/u.test(character))) continue;
        let node = root;
        for (const character of characters) {
          if (!node.children.has(character)) {
            node.children.set(character, { children: new Map(), entries: [] });
          }
          node = node.children.get(character);
        }
        node.entries.push(entry);
      }
    }
    return root;
  }

  function buildCedictWordTrie(records) {
    const root = { children: new Map(), entries: [] };
    for (const record of records) {
      const definitions = String(record.Definitions ?? "")
        .replace(/^\/|\/$/g, "")
        .split("/")
        .filter(Boolean);
      if (!definitions.length) continue;

      const entry = { pinyin: String(record.Pinyin ?? ""), definitions };
      for (const variant of new Set([
        String(record.Word ?? ""),
        String(record.Traditional ?? "")
      ])) {
        const characters = [...variant];
        if (!characters.some((character) => /\p{Script=Han}/u.test(character))) continue;
        let node = root;
        for (const character of characters) {
          if (!node.children.has(character)) {
            node.children.set(character, { children: new Map(), entries: [] });
          }
          node = node.children.get(character);
        }
        node.entries.push(entry);
      }
    }
    return root;
  }

  function buildCedictDefinitionsById(records) {
    const definitionsById = new Map();
    for (const record of records) {
      const wordId = String(record.w_id ?? "");
      if (!wordId) continue;

      const tags = JSON.parse(String(record.Tags ?? "[]"));
      if (tags.some((tag) => HIDDEN_CEDICT_TAGS.has(tag))) continue;

      const definitions = String(record.Definitions ?? "")
        .replace(/^\/|\/$/g, "")
        .split("/")
        .map((definition) => definition.trim())
        .filter((definition) => definition && !definition.startsWith("CL:"));
      if (!definitions.length) continue;

      const existing = definitionsById.get(wordId) ?? [];
      for (const definition of definitions) {
        if (!existing.includes(definition)) existing.push(definition);
      }
      definitionsById.set(wordId, existing);
    }
    return definitionsById;
  }

  function loadCedict() {
    if (cedictDefinitionsById && (!musicRequested || cedictWordTrie)) {
      return Promise.resolve();
    }
    if (cedictLoadPromise) return cedictLoadPromise;

    if (musicRequested) {
      musicAnalyze.disabled = true;
      musicStatus.textContent = "正在加载词典释义…";
    }
    const source = document.body.dataset.cedictSource;
    cedictLoadPromise = fetch(source)
      .then((response) => {
        if (!response.ok) throw new Error(`无法加载 CEDICT（${response.status}）。`);
        return response.json();
      })
      .then((records) => {
        if (!Array.isArray(records)) throw new Error("CEDICT 数据格式无效。");
        cedictDefinitionsById = buildCedictDefinitionsById(records);
        if (musicRequested) {
          cedictWordTrie = buildCedictWordTrie(records);
          musicAnalyze.disabled = false;
          musicStatus.textContent = "粘贴歌词或中文文本，然后点击“确定”识别词语。";
        }
      })
      .catch((error) => {
        cedictLoadPromise = null;
        if (musicStatus) {
          musicStatus.textContent = `无法加载词典释义：${error.message}`;
        }
      });
    return cedictLoadPromise;
  }

  function loadCedictWordIds() {
    if (cedictWordIds) return Promise.resolve(cedictWordIds);
    if (cedictWordIdsLoadPromise) return cedictWordIdsLoadPromise;

    const source = document.body.dataset.cedictWordIdsSource;
    if (!source) {
      return Promise.reject(new Error("The CEDICT word ID source is not configured."));
    }

    cedictWordIdsLoadPromise = fetch(source)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load CEDICT word IDs (HTTP ${response.status}).`);
        }
        return response.json();
      })
      .then((wordIds) => {
        if (!Array.isArray(wordIds) || wordIds.some((wordId) =>
          typeof wordId !== "string" || !wordId
        )) {
          throw new Error("The CEDICT word ID data is invalid.");
        }
        cedictWordIds = new Set(wordIds);
        for (const button of entriesElement.querySelectorAll("button[data-cedict-word-id]")) {
          button.disabled = !cedictWordIds.has(button.dataset.cedictWordId);
        }
        return cedictWordIds;
      })
      .catch((error) => {
        cedictWordIdsLoadPromise = null;
        throw error;
      });
    return cedictWordIdsLoadPromise;
  }

  function showMusicDefinition(word, anchor) {
    if (activeMusicWord) activeMusicWord.setAttribute("aria-expanded", "false");
    if (activeMusicWord === anchor && !musicDefinitionPopover.hidden) {
      musicDefinitionPopover.hidden = true;
      activeMusicWord = null;
      return;
    }

    activeMusicWord = anchor;
    anchor.setAttribute("aria-expanded", "true");
    musicDefinitionPopover.replaceChildren();
    if (word.pinyin.length) {
      const pinyin = document.createElement("span");
      pinyin.className = "pinyin";
      pinyin.textContent = `[${word.pinyin.map((value) => (
        window.convertPinyin(value.replace(/([1-5])(?=[a-züv:])/gi, "$1 "))
      )).join(" / ")}]`;
      musicDefinitionPopover.append(pinyin, " ");
    }
    const definitions = document.createElement("span");
    definitions.textContent = word.definitions.length
      ? word.definitions.join("；")
      : "暂无释义。";
    musicDefinitionPopover.append(definitions);
    musicDefinitionPopover.hidden = false;
    const bounds = anchor.getBoundingClientRect();
    const popoverBounds = musicDefinitionPopover.getBoundingClientRect();
    const left = Math.min(
      Math.max(popoverBounds.width / 2 + 8, bounds.left + bounds.width / 2),
      window.innerWidth - popoverBounds.width / 2 - 8
    );
    musicDefinitionPopover.style.left = `${left}px`;
    musicDefinitionPopover.style.top = `${Math.max(8, bounds.top - 8)}px`;
    musicDefinitionPopover.style.transform = bounds.top - 8 >= popoverBounds.height
      ? "translate(-50%, -100%)"
      : "translate(-50%, 0)";
  }

  function analyzeMusicText(text) {
    const characters = [...text];
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < characters.length;) {
      if (!/\p{Script=Han}/u.test(characters[index])) {
        const start = index;
        while (index < characters.length && !/\p{Script=Han}/u.test(characters[index])) {
          index += 1;
        }
        fragment.append(document.createTextNode(characters.slice(start, index).join("")));
        continue;
      }

      let hskNode = hskWordTrie;
      let cedictNode = cedictWordTrie;
      let hskEntries = null;
      let hskEnd = index;
      let cedictEntries = null;
      let cedictEnd = index;
      for (let cursor = index; cursor < characters.length; cursor += 1) {
        hskNode = hskNode?.children.get(characters[cursor]) ?? null;
        cedictNode = cedictNode?.children.get(characters[cursor]) ?? null;
        if (!hskNode && !cedictNode) break;
        if (hskNode?.entries.length) {
          hskEntries = hskNode.entries;
          hskEnd = cursor + 1;
        }
        if (cedictNode?.entries.length) {
          cedictEntries = cedictNode.entries;
          cedictEnd = cursor + 1;
        }
      }

      const useHsk = hskEntries && hskEnd >= cedictEnd;
      const matchEntries = useHsk ? hskEntries : cedictEntries;
      const end = useHsk ? hskEnd : cedictEntries ? cedictEnd : index + 1;
      const word = characters.slice(index, end).join("");
      const matchingCedictEntries = cedictEnd === end ? cedictEntries : null;
      const unknownEntries = useHsk
        ? matchEntries.filter((entry) => !entry.known && entry.levels.length > 0)
        : [];
      const hskDefinitions = [...new Set(unknownEntries.flatMap((entry) => entry.definitions))];
      const definitions = useHsk && hskDefinitions.length
        ? hskDefinitions
        : [...new Set((matchingCedictEntries ?? matchEntries ?? []).flatMap((entry) => entry.definitions))];
      const pinyinEntries = matchingCedictEntries ?? (useHsk ? unknownEntries : matchEntries ?? []);
      const pinyin = [...new Set(pinyinEntries.map((entry) => entry.pinyin).filter(Boolean))];
      if (useHsk && !unknownEntries.length || !matchEntries) {
        fragment.append(document.createTextNode(word));
      } else {
        const highlight = document.createElement("mark");
        if (unknownEntries.length) {
          const levels = unknownEntries.flatMap((entry) => entry.levels);
          const level = levels.includes(7) || levels.includes(8) || levels.includes(9)
            ? "7-9"
            : Math.min(...levels);
          highlight.className = `music-unknown-word hsk${level}`;
        } else {
          highlight.className = "music-unknown-word";
        }
        highlight.textContent = word;
        highlight.setAttribute("aria-expanded", "false");
        highlight.setAttribute("aria-label", `${word}：点击查看释义`);
        highlight.setAttribute("role", "button");
        highlight.tabIndex = 0;

        function toggleDefinition() {
          showMusicDefinition({ pinyin, definitions }, highlight);
        }
        highlight.addEventListener("click", toggleDefinition);
        highlight.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleDefinition();
          }
        });
        fragment.append(highlight);
      }
      index = end;
    }
    return fragment;
  }

  if (musicAnalyze && musicText && musicResults && musicEditor && musicRedo) {
    musicAnalyze.addEventListener("click", () => {
      musicResults.replaceChildren(analyzeMusicText(musicText.value));
      musicStatus.textContent = "";
      musicEditor.hidden = true;
      musicRedo.hidden = false;
    });
    musicRedo.addEventListener("click", () => {
      musicEditor.hidden = false;
      musicResults.replaceChildren();
      musicRedo.hidden = true;
      musicText.focus();
    });
  }
  musicLink?.addEventListener("click", () => {
    musicRequested = true;
    if (entries.length && !cedictWordTrie) loadCedict();
  });
  document.addEventListener("click", (event) => {
    if (
      activeMusicWord
      && event.target !== activeMusicWord
      && !musicDefinitionPopover.contains(event.target)
    ) {
      activeMusicWord.setAttribute("aria-expanded", "false");
      activeMusicWord = null;
      musicDefinitionPopover.hidden = true;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeMusicWord) {
      activeMusicWord.setAttribute("aria-expanded", "false");
      activeMusicWord = null;
      musicDefinitionPopover.hidden = true;
    }
  });
  window.addEventListener("scroll", () => {
    if (!activeMusicWord) return;
    activeMusicWord.setAttribute("aria-expanded", "false");
    activeMusicWord = null;
    musicDefinitionPopover.hidden = true;
  }, true);
  window.addEventListener("resize", () => {
    if (!activeMusicWord) return;
    activeMusicWord.setAttribute("aria-expanded", "false");
    activeMusicWord = null;
    musicDefinitionPopover.hidden = true;
  });

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

  function renderFrequencyProgress() {
    if (!frequencyProgressRows) return;
    const groups = [
      { label: "一百", limit: 100 },
      { label: "五百", limit: 500 },
      { label: "一千", limit: 1_000 },
      { label: "五千", limit: 5_000 },
      { label: "一万 - fluency", limit: 10_000 },
      { label: "五万 - ~all", limit: 50_000 }
    ];

    frequencyProgressRows.replaceChildren();
    for (const group of groups) {
      const groupEntries = entries.slice(0, group.limit);
      const knownCount = groupEntries.filter((entry) => entry.known).length;
      const percentage = groupEntries.length
        ? Math.round((knownCount / groupEntries.length) * 100)
        : 0;
      const row = document.createElement("tr");
      const levelCell = document.createElement("th");
      levelCell.scope = "row";
      levelCell.className = "frequency-progress-level";
      if (percentage === 100) levelCell.classList.add("is-complete");
      levelCell.textContent = group.label;
      row.append(levelCell);

      const progressCell = document.createElement("td");
      const progress = document.createElement("div");
      progress.className = "hsk-progress-bar frequency-progress-bar";
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
      frequencyProgressRows.append(row);
    }
  }

  async function loadHskLevels() {
    const hskSource = document.body.dataset.hskSource;
    if (!hskSource) {
      throw new Error("The HSK data source is not configured for this frequency list.");
    }

    const response = await fetch(hskSource);
    if (!response.ok) {
      throw new Error(`Could not load ${hskSource} (HTTP ${response.status}).`);
    }
    const records = await response.json();
    if (!Array.isArray(records)) {
      throw new Error(`Expected ${hskSource} to contain a JSON array.`);
    }

    const levelsByWordId = new Map();
    for (const record of records) {
      const wId = String(record.w_id ?? "").trim();
      const level = String(record.hsk_level ?? record["HSK几"] ?? "").trim();
      if (!wId || !level) {
        throw new Error(`An HSK record in ${hskSource} is missing w_id or level.`);
      }
      const levels = levelsByWordId.get(wId) ?? new Set();
      levels.add(level);
      levelsByWordId.set(wId, levels);
    }

    return new Map(
      [...levelsByWordId].map(([wId, levels]) => [
        wId,
        [...levels].sort((first, second) =>
          Number(first.match(/\d+/)?.[0] ?? 0) - Number(second.match(/\d+/)?.[0] ?? 0)
        )
      ])
    );
  }

  function renderProgress() {
    if (page === "hsk") renderHskProgress();
    if (page === "frequency" || page === "zimu") renderFrequencyProgress();
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
    const knownStatus = isRankedList ? knownStatusFilter?.value ?? "unknown" : null;
    const showKnown = isRankedList
      ? knownStatus === "known"
      : knownFilter?.checked ?? false;
    const showUnknown = isRankedList
      ? knownStatus === "unknown"
      : unknownFilter?.checked ?? false;
    const hskMembership = page === "frequency" || page === "zimu"
      ? hskMembershipFilter?.value ?? "all"
      : "all";
    const query = page === "frequency" || page === "zimu"
      ? rankedListSearch?.value.trim().toLocaleLowerCase() ?? ""
      : "";

    const matches = entries.filter((entry) => {
      const keepKnownThisSession = (page === "frequency" || page === "zimu")
        && showUnknown
        && knownThisSession.has(entry.id);
      if (
        USER_STATE_PAGES.has(page)
        && (showKnown || showUnknown)
        && !(entry.known ? showKnown || keepKnownThisSession : showUnknown)
      ) {
        return false;
      }
      if (savedFilter?.checked && !entry.saved) {
        return false;
      }
      if (hskMembership === "only" && !entry.hskLevels.length) {
        return false;
      }
      if (hskMembership === "hide" && entry.hskLevels.length) {
        return false;
      }
      if (query) {
        const searchableText = [
          entry.word,
          entry.pinyin,
          entry.frequency,
          entry.probability === null ? "" : `${Math.round(entry.probability * 100)}%`,
          ...entry.hskLevels
        ].join(" ").toLocaleLowerCase();
        if (!searchableText.includes(query)) return false;
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
    if (page === "hsk" && !hskReady) {
      entriesElement.replaceChildren();
      status.textContent = "Waiting for HSK data…";
      return;
    }
    const matches = filteredEntries();
    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount);
    writePageUrl();
    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = matches.slice(start, start + PAGE_SIZE);
    entriesElement.replaceChildren();

    for (const entry of visible) {
      const item = document.createElement("article");
      item.className = `entry${page !== "boya" && selectedIds.has(entry.id) ? " is-selected" : ""}${page === "boya" && entry.saved ? " is-marked" : ""}`;

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
      const isBoya = page === "boya";
      word.setAttribute("aria-pressed", String(isBoya ? entry.saved : selectedIds.has(entry.id)));
      word.setAttribute("aria-label", isBoya
        ? `${entry.saved ? "取消标记" : "标记"}${entry.word}`
        : `选择${entry.word}`);
      if (isBoya) {
        word.disabled = !remoteFlagsReady || !activeSession || !entry.wId;
      }
      word.addEventListener("click", () => {
        if (isBoya) {
          updateWordFlag(entry, "saved", word);
          return;
        }
        const selected = selectedIds.has(entry.id);
        if (selected) {
          selectedIds.delete(entry.id);
        } else {
          selectedIds.add(entry.id);
        }
        item.classList.toggle("is-selected", !selected);
        selectionIndicator.textContent = selected ? "" : "✓";
        word.setAttribute("aria-pressed", String(!selected));
        updateSelectionToolbar();
      });
      if (!isBoya) {
        heading.addEventListener("click", (event) => {
          if (
            !selectedIds.has(entry.id)
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
      }
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
      level.className = page === "hsk" || isRankedList
        ? `hsk-level list-level${page === "hsk" ? ` ${entry.levelLabel.toLowerCase().replace(/[^a-z0-9-]/g, "")}` : " frequency-rank"}`
        : "list-level boya-level";
      level.textContent = page === "hsk"
        ? entry.levelLabel ? `HSK${entry.levelLabel.replace(/^HSK/i, "")}` : "Unassigned"
        : isRankedList
          ? entry.frequency ? `#${entry.frequency}` : "Unranked"
        : entry.levelLabel
          ? `Boya ${entry.levelLabel.replace(/^Boya\s*/i, "")}${entry.chapter ? ` · ${entry.chapter}` : ""}`
          : "Unassigned";
      const frequencyTags = isRankedList ? document.createElement("div") : null;
      if (frequencyTags) {
        frequencyTags.className = "frequency-entry-tags";
        frequencyTags.append(level);
        if (page === "zimu" && entry.probability !== null) {
          const probabilityTag = document.createElement("span");
          probabilityTag.className = "hsk-level frequency-rank";
          probabilityTag.textContent = `${Math.round(entry.probability * 100)}%`;
          frequencyTags.append(probabilityTag);
        }
        for (const hskLevel of entry.hskLevels) {
          const hskTag = document.createElement("span");
          hskTag.className = `hsk-level ${hskLevel.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
          hskTag.textContent = hskLevel;
          frequencyTags.append(hskTag);
        }
      }
      item.append(heading);
      if (frequencyTags) item.append(frequencyTags);

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
      if (!frequencyTags) entryActions.append(level);
      let frequencySavedToggle = null;
      if (USER_STATE_PAGES.has(page)) {
        if (!isBoya) {
          const knownToggle = createKnownToggle({
            word: entry.word,
            known: entry.known,
            disabled: !remoteFlagsReady || !activeSession || !entry.wId,
            onToggle: () => {
            updateWordFlag(entry, "known", knownToggle);
            }
          });
          entryActions.append(knownToggle);
        }

        const savedToggle = createSavedToggle({
          word: entry.word,
          saved: entry.saved,
          disabled: !remoteFlagsReady || !activeSession || !entry.wId,
          useIcon: isRankedList,
          onToggle: () => updateWordFlag(entry, "saved", savedToggle)
        });
        if (isRankedList) {
          frequencySavedToggle = savedToggle;
        } else {
          entryActions.append(savedToggle);
        }
      }

      const individualCopyButton = createCopyButton(entry.word);
      entryActions.append(individualCopyButton);

      const sentenceAction = createSentenceAction(entry.word, supabaseClient);
      const { button: sentenceButton, helper: sentenceHelper } = sentenceAction;
      entryActions.append(sentenceButton);

      if (page === "hsk" || isRankedList) {
        const detailButton = document.createElement("button");
        detailButton.className = "sentence-button";
        detailButton.type = "button";
        detailButton.textContent = "详情";
        if (isRankedList) {
          detailButton.dataset.cedictWordId = entry.wId;
          detailButton.disabled = !cedictWordIds?.has(entry.wId);
        }
        detailButton.setAttribute("aria-expanded", "false");
        detailButton.setAttribute("aria-label", `显示${entry.word}的拼音和释义`);
        detailButton.addEventListener("click", async () => {
          const expanded = item.classList.toggle("is-expanded");
          detailButton.textContent = expanded ? "收起" : "详情";
          detailButton.setAttribute("aria-expanded", String(expanded));
          detailButton.setAttribute(
            "aria-label",
            `${expanded ? "隐藏" : "显示"}${entry.word}的拼音和释义`
          );
          if (!expanded || !isRankedList) return;

          if (!cedictDefinitionsById) {
            detailButton.disabled = true;
            await loadCedict();
            detailButton.disabled = false;
          }

          entry.definitions = cedictDefinitionsById?.get(entry.wId) ?? [];
          const meaning = item.querySelector(".defs") ?? document.createElement("div");
          meaning.className = "defs";
          meaning.replaceChildren();
          if (entry.definitions.length) {
            for (const definition of entry.definitions) {
              const chip = document.createElement("span");
              chip.textContent = definition;
              meaning.append(chip, " ");
            }
          } else {
            const message = document.createElement("span");
            message.textContent = cedictDefinitionsById
              ? "暂无释义"
              : "释义加载失败，请稍后重试。";
            meaning.append(message);
          }
          if (!meaning.isConnected) item.insertBefore(meaning, entryActions);
        });
        entryActions.append(detailButton);
      }
      if (frequencySavedToggle) {
        entryActions.append(frequencySavedToggle);
      }
      item.insertBefore(entryActions, item.querySelector(".defs"));
      item.append(sentenceHelper);

      entriesElement.append(item);
    }

    const first = matches.length ? start + 1 : 0;
    const last = Math.min(start + PAGE_SIZE, matches.length);
    const count = document.createElement("span");
    count.textContent = `${first}–${last} of ${matches.length} entries`;
    pagination.replaceChildren(count);
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
      pagination.append(pageLinks);
    }
  }

  function resetAndRender() {
    currentPage = 1;
    render();
  }

  pagination.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-page]");
    if (!link) return;
    event.preventDefault();
    const nextPage = Number(link.dataset.page);
    if (nextPage !== currentPage) knownThisSession.clear();
    currentPage = nextPage;
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
        if (page === "hsk") {
          setHskView(link.hash.slice(1));
        } else {
          setFrequencyView(link.hash.slice(1));
        }
      });
    }
    window.addEventListener("popstate", () => {
      if (page === "hsk") {
        const view = ["#progress", "#music"].includes(window.location.hash)
          ? window.location.hash.slice(1)
          : "list";
        setHskView(view);
        musicRequested = view === "music";
        if (musicRequested && entries.length && !cedictWordTrie) loadCedict();
      } else {
        const view = window.location.hash === "#progress" ? "progress" : "list";
        setFrequencyView(view);
      }
    });
    if (page === "hsk") {
      const view = ["#progress", "#music"].includes(window.location.hash)
        ? window.location.hash.slice(1)
        : "list";
      setHskView(view);
      musicRequested = view === "music";
    } else {
      setFrequencyView(window.location.hash === "#progress" ? "progress" : "list");
    }
  }
  window.addEventListener("popstate", () => {
    const pageFromUrl = Number(new URLSearchParams(window.location.search).get("page"));
    const nextPage = Number.isSafeInteger(pageFromUrl) && pageFromUrl > 0 ? pageFromUrl : 1;
    if (nextPage !== currentPage) knownThisSession.clear();
    currentPage = nextPage;
    render();
  });
  if (unknownFilter) {
    unknownFilter.addEventListener("change", () => {
      if (page === "hsk" && unknownFilter.checked && knownFilter) {
        knownFilter.checked = false;
      }
      resetAndRender();
    });
  }
  if (knownFilter) {
    knownFilter.addEventListener("change", () => {
      if (page === "hsk" && knownFilter.checked && unknownFilter) {
        unknownFilter.checked = false;
      }
      resetAndRender();
    });
  }
  if (savedFilter) {
    savedFilter.addEventListener("change", resetAndRender);
  }
  knownStatusFilter?.addEventListener("change", resetAndRender);
  hskMembershipFilter?.addEventListener("change", resetAndRender);
  rankedListSearch?.addEventListener("input", () => {
    const hasText = rankedListSearch.value.length > 0;
    rankedListSearchClear.textContent = hasText ? "✕" : "→";
    rankedListSearchClear.classList.toggle("has-text", hasText);
    resetAndRender();
  });
  rankedListSearchClear?.addEventListener("click", () => {
    if (!rankedListSearch) return;
    rankedListSearch.value = "";
    rankedListSearchClear.textContent = "→";
    rankedListSearchClear.classList.remove("has-text");
    resetAndRender();
    rankedListSearch.focus();
  });
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
      button.setAttribute(
        "aria-pressed",
        String(button.getAttribute("aria-pressed") !== "true")
      );
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
  async function loadVocabulary() {
    try {
      if (page === "hsk") {
        hskReady = false;
        entriesElement.replaceChildren();
        status.textContent = "Waiting for HSK data…";
      }
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Could not load ${source} (HTTP ${response.status}).`);
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error(`Expected ${source} to contain a JSON array.`);
      }
      entries = data.map((record) => normalizeRecord(record, page, userWordState));
      if (page === "frequency" || page === "zimu") {
        const hskLevelsByWordId = await loadHskLevels();
        for (const entry of entries) {
          entry.hskLevels = hskLevelsByWordId.get(entry.wId) ?? [];
        }
      }
      renderBoyaWeekFilters();
      renderProgress();
      if (page === "hsk") {
        hskWordTrie = buildHskWordTrie();
        if (musicRequested) {
          loadCedict();
        } else {
          musicStatus.textContent = "进入音乐页面后加载词典释义…";
        }
        renderProgress();
        if (authSessionReady) await updateAuthSession(activeSession);
        else render();
        loadCedict().then(() => {
          if (!cedictDefinitionsById) {
            status.textContent = "Could not load CEDICT definitions for HSK words.";
            status.classList.add("error");
            return;
          }
          for (const entry of entries) {
            entry.definitions = cedictDefinitionsById.get(entry.wId) ?? [];
          }
          render();
        });
      } else {
        render();
        await updateAuthSession(activeSession);
        if (isRankedList) {
          loadCedictWordIds().catch((error) => {
            console.error("Could not load CEDICT word IDs:", error);
            status.textContent = `Unable to check CEDICT mappings: ${error.message}`;
            status.classList.add("error");
          });
        }
      }
      status.classList.remove("error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status.textContent = `Unable to load vocabulary: ${message}`;
      status.classList.add("error");
      if (page === "hsk") {
        hskReady = true;
        musicStatus.textContent = `无法加载 HSK 词表：${message}`;
        window.history.replaceState(null, "", "#list");
        setHskView("list");
      }
    }
  }

  loadVocabulary();
}

startVocabularyPage();
