"use strict";

const KNOWN_WORDS_PAGE_SIZE = 500;

function parseKnownWordsMapping(csv) {
  const words = new Map();
  let row = [];
  let field = "";
  let inQuotes = false;

  function finishRow() {
    const [rawId, word] = row;
    const wId = String(rawId ?? "").replace(/^\uFEFF/, "");
    if (wId && wId !== "w_id" && word) words.set(wId, word);
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
  return words;
}

function encodeCsvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function loadKnownWordIds(supabaseClient, userId) {
  const wordIds = [];
  for (let offset = 0; ; offset += KNOWN_WORDS_PAGE_SIZE) {
    const { data, error } = await supabaseClient
      .from("user_word_state")
      .select("w_id")
      .eq("user_id", userId)
      .eq("known", true)
      .order("w_id", { ascending: true })
      .range(offset, offset + KNOWN_WORDS_PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data)) {
      throw new Error("Supabase returned an invalid known-word response.");
    }
    for (const row of data) {
      if (typeof row.w_id !== "string" || !row.w_id) {
        throw new Error("A known-word row is missing its word ID.");
      }
      wordIds.push(row.w_id);
    }
    if (data.length < KNOWN_WORDS_PAGE_SIZE) return wordIds;
  }
}

async function loadKnownWordMapping(source) {
  if (!source) throw new Error("The word mapping source is not configured.");
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Could not load the word mapping (HTTP ${response.status}).`);
  }
  return parseKnownWordsMapping(await response.text());
}

function bindKnownWordsExport(supabaseClient) {
  const button = document.querySelector("#download-known-words");
  const status = document.querySelector("#known-words-export-status");
  if (!button || !status) return;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("error", isError);
    status.hidden = !message;
  }

  if (!supabaseClient) {
    setStatus("Could not initialize Supabase for known-word export.", true);
    return;
  }

  let currentSession = null;
  let isBusy = false;

  function updateSession(session) {
    currentSession = session;
    button.disabled = isBusy || !session;
    button.title = session
      ? "Download all known words as a CSV"
      : "Sign in to export known words";
  }

  button.addEventListener("click", async () => {
    if (button.disabled || !supabaseClient) return;
    isBusy = true;
    button.disabled = true;
    button.textContent = "导出中…";
    setStatus("Loading known words…");
    try {
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      const session = sessionData.session;
      if (!session) {
        currentSession = null;
        throw new Error("Sign in to export known words.");
      }
      currentSession = session;

      const wordIds = await loadKnownWordIds(supabaseClient, session.user.id);
      const wordsById = await loadKnownWordMapping(document.body.dataset.wordMappingSource);
      const words = wordIds.map((wordId) => {
        const word = wordsById.get(wordId);
        if (!word) throw new Error(`Could not resolve known word ID ${wordId}.`);
        return word;
      });
      const csv = `\uFEFFWord\r\n${words.map(encodeCsvCell).join("\r\n")}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const downloadUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement("a");
      downloadLink.href = downloadUrl;
      downloadLink.download = "known.csv";
      downloadLink.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setStatus(`Downloaded ${words.length.toLocaleString()} known word${words.length === 1 ? "" : "s"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Could not export known words: ${message}`, true);
    } finally {
      isBusy = false;
      button.textContent = "认识词CSV";
      updateSession(currentSession);
    }
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => updateSession(session), 0);
  });
  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    updateSession(data.session);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Could not check account for export: ${message}`, true);
  });
}

window.bindKnownWordsExport = bindKnownWordsExport;
