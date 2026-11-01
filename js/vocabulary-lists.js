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
    frequency: String(record.Frequency ?? record.frequency ?? ""),
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

function startVocabularyPage() {
  const page = document.body.dataset.page;
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

  const selectedIds = new Set();
  const knownThisSession = new Set();
  const supabaseClient = USER_STATE_PAGES.has(page) && window.supabase
    ? window.supabase.createClient(document.body.dataset.supabaseUrl, document.body.dataset.supabaseKey)
    : null;
  const userWordState = window.createUserWordState?.(supabaseClient);
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
        musicStatus.textContent = `无法加载词典释义：${error.message}`;
      });
    return cedictLoadPromise;
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
    const showKnown = knownFilter?.checked ?? false;
    const showUnknown = unknownFilter?.checked ?? false;

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
      if (selectedLevels.size && ![...selectedLevels].some((selectedLevel) =>
        entry.levels.some((level) =>
          selectedLevel === "7-9" ? level >= 7 && level <= 9 : level === Number(selectedLevel)
        )
      )) {
        return false;
      }
      return true;
    });
    return matches;
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

      const isRankedList = page === "frequency" || page === "zimu";
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
      let frequencySavedToggle = null;
      if (USER_STATE_PAGES.has(page)) {
        if (!isBoya) {
          const knownToggle = document.createElement("button");
          knownToggle.className = `known-entry flag-toggle${entry.known ? " is-known" : " is-unknown"}`;
          knownToggle.type = "button";
          knownToggle.textContent = entry.known ? "Known" : "Unknown";
          knownToggle.setAttribute("aria-pressed", String(entry.known));
          knownToggle.setAttribute("aria-label", `Mark ${entry.word} ${entry.known ? "unknown" : "known"}`);
          knownToggle.disabled = !remoteFlagsReady || !activeSession || !entry.wId;
          knownToggle.addEventListener("click", () => {
            updateWordFlag(entry, "known", knownToggle);
          });
          entryActions.append(knownToggle);
        }

        const savedToggle = document.createElement("button");
        savedToggle.className = isRankedList
          ? `frequency-save-button flag-toggle${entry.saved ? " is-saved" : ""}`
          : `saved-entry flag-toggle${entry.saved ? " is-saved" : ""}`;
        savedToggle.type = "button";
        savedToggle.setAttribute("aria-pressed", String(entry.saved));
        savedToggle.setAttribute("aria-label", `${entry.saved ? "Unsave" : "Save"} ${entry.word}`);
        savedToggle.disabled = !remoteFlagsReady || !activeSession || !entry.wId;
        if (isRankedList) {
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("class", "dictionary-save-icon");
          icon.setAttribute("viewBox", "0 0 24 24");
          icon.setAttribute("aria-hidden", "true");
          const bookmark = document.createElementNS("http://www.w3.org/2000/svg", "path");
          bookmark.setAttribute("d", "M6 4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5Z");
          icon.append(bookmark);
          savedToggle.append(icon);
          frequencySavedToggle = savedToggle;
        } else {
          savedToggle.textContent = entry.saved ? "Saved" : "Save";
          entryActions.append(savedToggle);
        }
        savedToggle.addEventListener("click", () => {
          updateWordFlag(entry, "saved", savedToggle);
        });
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
      sentenceButton.setAttribute("aria-label", `为${entry.word}生成例句`);
      sentenceButton.setAttribute("aria-expanded", "false");
      entryActions.append(sentenceButton);

      const sentenceHelper = document.createElement("section");
      sentenceHelper.className = "sentence-helper";
      sentenceHelper.hidden = true;
      const prompt = `「${entry.word}」中文解释：意思、3个例句+解释、常用吗、近义词或易混词。`;
      const sentenceResult = document.createElement("div");
      sentenceResult.className = "sentence-result";
      sentenceResult.setAttribute("role", "status");
      sentenceResult.setAttribute("aria-live", "polite");
      sentenceHelper.append(sentenceResult);

      sentenceButton.addEventListener("click", async () => {
        const isOpen = sentenceHelper.hidden;
        sentenceHelper.hidden = !isOpen;
        sentenceButton.setAttribute("aria-expanded", String(isOpen));
        if (!isOpen) return;
        sentenceButton.disabled = true;
        sentenceResult.classList.remove("is-error");
        sentenceResult.textContent = "正在生成例句…";
        try {
          if (!supabaseClient) {
            throw new Error("Supabase client is unavailable.");
          }
          const { data, error } = await supabaseClient.functions.invoke("generate-sentence", {
            body: { prompt }
          });
          if (error) throw error;
          if (typeof data?.sentence !== "string" || !data.sentence.trim()) {
            throw new Error("The generate-sentence response did not contain a sentence.");
          }
          renderSentenceMarkdown(data.sentence, sentenceResult);
        } catch (error) {
          console.error("Could not generate sentence:", error);
          sentenceResult.classList.add("is-error");
          sentenceResult.textContent = "生成失败，请稍后重试。";
        } finally {
          sentenceButton.disabled = false;
        }
      });

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
    currentPage = Number.isSafeInteger(pageFromUrl) && pageFromUrl > 0 ? pageFromUrl : 1;
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
