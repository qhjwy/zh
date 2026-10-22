"use strict";

let dictionary = [];
let hskLevels = new Map();
let hskRanks = new Map();
let boyaRanks = new Map();
let frequencyRanks = new Map();

function parseDefinitions(value) {
  return String(value ?? "").replace(/^\/|\/$/g, "").split("/").filter(Boolean);
}

function parseClassifiers(definitions) {
  const classifiers = [];
  const cleanDefinitions = [];

  for (const definition of definitions) {
    if (!definition.startsWith("CL:")) {
      cleanDefinitions.push(definition);
      continue;
    }
    const raw = definition.slice(3).replace(/\[.*?\]/g, "");
    for (const item of raw.split(",")) {
      const parts = item.trim().split("|");
      if (parts.length === 2) {
        classifiers.push({ traditional: parts[0], simplified: parts[1] });
      } else if (parts[0]) {
        classifiers.push({ traditional: parts[0], simplified: parts[0] });
      }
    }
  }
  return { classifiers, definitions: cleanDefinitions };
}

function levelsFor(word) {
  return [...(hskLevels.get(word) ?? [])]
    .sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));
}

function search(query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const isChinese = /[\u4e00-\u9fff]/.test(normalizedQuery);
  const pinyinQuery = normalizedQuery.replace(/[0-9]/g, "").replace(/\s+/g, "");
  const matches = [];

  for (const entry of dictionary) {
    let score = 0;
    if (isChinese) {
      if (entry.simplified.toLowerCase() === normalizedQuery || entry.traditional.toLowerCase() === normalizedQuery) {
        score = 1000;
      } else if (entry.simplified.startsWith(normalizedQuery) || entry.traditional.startsWith(normalizedQuery)) {
        score = 500;
      } else if (entry.simplified.includes(normalizedQuery) || entry.traditional.includes(normalizedQuery)) {
        score = 100;
      }
    } else {
      const pinyin = entry.pinyin.replace(/[0-9]/g, "").toLowerCase().replace(/\s+/g, "");
      if (pinyin === pinyinQuery) score = 900;
      else if (pinyin.startsWith(pinyinQuery)) score = 400;
      else if (pinyin.includes(pinyinQuery)) score = 80;
      else if (entry.definitions.some((definition) => definition.toLowerCase().includes(normalizedQuery))) score = 50;
    }
    if (score > 0) matches.push(entry);
  }

  matches.sort((first, second) => {
    const firstWord = first.simplified;
    const secondWord = second.simplified;
    const firstFrequency = frequencyRanks.get(firstWord);
    const secondFrequency = frequencyRanks.get(secondWord);
    if (firstFrequency !== undefined || secondFrequency !== undefined) {
      if (firstFrequency === undefined) return 1;
      if (secondFrequency === undefined) return -1;
      if (firstFrequency !== secondFrequency) return firstFrequency - secondFrequency;
    } else {
      const firstHsk = hskRanks.get(firstWord) ?? Number.POSITIVE_INFINITY;
      const secondHsk = hskRanks.get(secondWord) ?? Number.POSITIVE_INFINITY;
      if (firstHsk !== secondHsk) return firstHsk - secondHsk;

      const firstBoya = boyaRanks.get(firstWord) ?? Number.POSITIVE_INFINITY;
      const secondBoya = boyaRanks.get(secondWord) ?? Number.POSITIVE_INFINITY;
      if (firstBoya !== secondBoya) return firstBoya - secondBoya;
    }
    return firstWord.localeCompare(secondWord);
  });

  return {
    count: matches.length,
    entries: matches.slice(0, 100).map((entry) => ({
      ...entry,
      hskLevels: levelsFor(entry.simplified),
      frequencyRank: frequencyRanks.get(entry.simplified) ?? null
    }))
  };
}

async function loadDictionary() {
  const [dictionaryResponse, hskResponse, boyaResponse, frequencyResponse] = await Promise.all([
    fetch("../data/cedict.json"),
    fetch("../data/hsk.json"),
    fetch("../data/boya.json"),
    fetch("../data/frequency.json")
  ]);
  if (!dictionaryResponse.ok) {
    throw new Error(`Could not load cedict.json (HTTP ${dictionaryResponse.status}).`);
  }
  if (!hskResponse.ok) {
    throw new Error(`Could not load hsk.json (HTTP ${hskResponse.status}).`);
  }
  if (!boyaResponse.ok) {
    throw new Error(`Could not load boya.json (HTTP ${boyaResponse.status}).`);
  }
  if (!frequencyResponse.ok) {
    throw new Error(`Could not load frequency.json (HTTP ${frequencyResponse.status}).`);
  }

  const [rawDictionary, rawHsk, rawBoya, rawFrequency] = await Promise.all([
    dictionaryResponse.json(),
    hskResponse.json(),
    boyaResponse.json(),
    frequencyResponse.json()
  ]);
  if (![rawDictionary, rawHsk, rawBoya, rawFrequency].every(Array.isArray)) {
    throw new Error("Dictionary, HSK, Boya, and frequency data must be JSON arrays.");
  }

  const hskMap = new Map();
  const hskRankMap = new Map();
  for (const record of rawHsk) {
    const word = String(record.word ?? record.Word ?? "");
    const level = String(record.hsk_level ?? record["HSK几"] ?? "");
    if (!word || !level) continue;
    if (!hskMap.has(word)) hskMap.set(word, new Set());
    hskMap.get(word).add(level);
    const rank = Number(level.match(/\d+/)?.[0] ?? Infinity);
    hskRankMap.set(word, Math.min(hskRankMap.get(word) ?? Infinity, rank));
  }
  hskLevels = hskMap;
  hskRanks = hskRankMap;

  const boyaRankMap = new Map();
  for (const record of rawBoya) {
    const word = String(record.word ?? record.Word ?? "");
    const level = String(record.boya_level ?? record.Book ?? "");
    if (!word || !level) continue;
    const rank = Number(level.match(/\d+/)?.[0] ?? Infinity);
    boyaRankMap.set(word, Math.min(boyaRankMap.get(word) ?? Infinity, rank));
  }
  boyaRanks = boyaRankMap;

  const frequencyMap = new Map();
  for (const record of rawFrequency) {
    const word = String(record.word ?? record.Word ?? "");
    const rank = Number(record.frequency ?? record.Frequency);
    if (!word || !Number.isFinite(rank)) continue;
    if (!frequencyMap.has(word) || rank < frequencyMap.get(word)) {
      frequencyMap.set(word, rank);
    }
  }
  frequencyRanks = frequencyMap;

  dictionary = rawDictionary.map((record) => {
    const parsed = parseClassifiers(parseDefinitions(record.meaning ?? record.Meaning ?? record.Definitions));
    return {
      traditional: String(record.Traditional ?? record.traditional ?? record.Word ?? ""),
      simplified: String(record.Word ?? record.word ?? ""),
      pinyin: String(record.Pinyin ?? record.pinyin ?? ""),
      ...parsed
    };
  }).filter((entry) => entry.simplified && entry.pinyin);

  const hskCount = dictionary.reduce((count, entry) => count + Number(hskLevels.has(entry.simplified)), 0);
  self.postMessage({
    type: "ready",
    entryCount: dictionary.length,
    hskCount,
    hskPercentage: dictionary.length ? (hskCount / dictionary.length * 100).toFixed(1) : "0.0"
  });
}

self.addEventListener("message", (event) => {
  if (event.data.type !== "search") return;
  const result = search(String(event.data.query ?? ""));
  self.postMessage({
    type: "results",
    ...result,
    truncated: result.count > result.entries.length
  });
});

loadDictionary().catch((error) => {
  self.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error)
  });
});
