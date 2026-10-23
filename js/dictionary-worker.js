"use strict";

let dictionary = [];
let hskLevels = new Map();
let hskRanks = new Map();
let boyaRanks = new Map();
let frequencyRanks = new Map();

const DAILY_TOKEN_COUNT = 17000;
const FREQUENCY_VOCABULARY_SIZE = 50000;
const EULER_MASCHERONI = 0.5772156649015329;
const FREQUENCY_NORMALIZER = Math.log(FREQUENCY_VOCABULARY_SIZE) + EULER_MASCHERONI;
const PINYIN_TONE_MARKS = {
  ā: "a1", á: "a2", ǎ: "a3", à: "a4",
  ē: "e1", é: "e2", ě: "e3", è: "e4",
  ī: "i1", í: "i2", ǐ: "i3", ì: "i4",
  ō: "o1", ó: "o2", ǒ: "o3", ò: "o4",
  ū: "u1", ú: "u2", ǔ: "u3", ù: "u4",
  ǖ: "v1", ǘ: "v2", ǚ: "v3", ǜ: "v4",
  ń: "n2", ň: "n3", ǹ: "n4", ḿ: "m2"
};

function estimateDailyProbability(rank) {
  const lambda = DAILY_TOKEN_COUNT / (rank * FREQUENCY_NORMALIZER);
  return -Math.expm1(-lambda);
}

function normalizePinyin(value, preserveCase = false) {
  let pinyin = String(value ?? "").normalize("NFC");
  if (!preserveCase) pinyin = pinyin.toLowerCase();
  const syllables = pinyin
    .replace(/u:/gi, (match) => preserveCase && match[0] === "U" ? "V" : "v")
    .replace(/ü/gi, (match) => preserveCase && match === "Ü" ? "V" : "v")
    .split(/[\s'’‘·-]+/)
    .filter(Boolean);

  return syllables.map((syllable) => {
    const normalized = [...syllable]
      .map((character) => {
        const tone = PINYIN_TONE_MARKS[character.toLowerCase()] ?? character.toLowerCase();
        return preserveCase && character !== character.toLowerCase()
          ? tone.toUpperCase()
          : tone;
      })
      .join("");
    const toneMatch = normalized.match(/([1-5])$/);
    if (!toneMatch) return normalized;

    const tone = toneMatch[1];
    const base = normalized.slice(0, -1);
    if (tone === "5") return base;

    let vowelIndex = base.indexOf("a");
    if (vowelIndex < 0) vowelIndex = base.indexOf("e");
    if (vowelIndex < 0 && base.includes("ou")) vowelIndex = base.indexOf("o");
    if (vowelIndex < 0) {
      for (let index = base.length - 1; index >= 0; index -= 1) {
        if ("aeiouv".includes(base[index])) {
          vowelIndex = index;
          break;
        }
      }
    }

    return vowelIndex < 0
      ? normalized
      : `${base.slice(0, vowelIndex + 1)}${tone}${base.slice(vowelIndex + 1)}`;
  }).join("");
}

function entryKey(word, pinyin) {
  const normalizedPinyin = normalizePinyin(pinyin);
  return word && normalizedPinyin ? `${word}\u0000${normalizedPinyin}` : "";
}

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

function levelsFor(entry) {
  return [...(hskLevels.get(entryKey(entry.simplified, entry.pinyin)) ?? [])]
    .sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));
}

function search(query, hiddenTags) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];
  const isChinese = /[\u4e00-\u9fff]/.test(normalizedQuery);
  const pinyinQuery = normalizePinyin(normalizedQuery, true).replace(/[0-9]/g, "");
  const caseInsensitivePinyinQuery = pinyinQuery.toLowerCase();
  const matches = [];

  for (const entry of dictionary) {
    if (entry.tags.some((tag) => hiddenTags.has(tag))) continue;

    let score = 0;
    if (isChinese) {
      if (entry.simplified.toLowerCase() === normalizedQuery.toLowerCase() || entry.traditional.toLowerCase() === normalizedQuery.toLowerCase()) {
        score = 1000;
      } else if (entry.simplified.startsWith(normalizedQuery) || entry.traditional.startsWith(normalizedQuery)) {
        score = 500;
      } else if (entry.simplified.includes(normalizedQuery) || entry.traditional.includes(normalizedQuery)) {
        score = 100;
      }
    } else {
      const pinyin = normalizePinyin(entry.pinyin, true).replace(/[0-9]/g, "");
      if (pinyin === pinyinQuery) score = 900;
      else if (pinyin.startsWith(pinyinQuery)) score = 400;
      else if (pinyin.includes(pinyinQuery)) score = 80;
      else {
        const pinyinCaseMismatch = pinyin.toLowerCase().includes(caseInsensitivePinyinQuery);
        const definitionQuery = normalizedQuery.toLowerCase();
        if (!pinyinCaseMismatch && entry.definitions.some((definition) => definition.toLowerCase().includes(definitionQuery))) {
          score = 50;
        }
      }
    }
    if (score > 0) matches.push(entry);
  }

  matches.sort((first, second) => {
    const firstWord = first.simplified;
    const secondWord = second.simplified;
    const firstKey = entryKey(firstWord, first.pinyin);
    const secondKey = entryKey(secondWord, second.pinyin);
    const firstFrequency = frequencyRanks.get(firstKey);
    const secondFrequency = frequencyRanks.get(secondKey);
    if (firstFrequency !== undefined || secondFrequency !== undefined) {
      if (firstFrequency === undefined) return 1;
      if (secondFrequency === undefined) return -1;
      if (firstFrequency !== secondFrequency) return firstFrequency - secondFrequency;
    } else {
      const firstHsk = hskRanks.get(firstKey) ?? Number.POSITIVE_INFINITY;
      const secondHsk = hskRanks.get(secondKey) ?? Number.POSITIVE_INFINITY;
      if (firstHsk !== secondHsk) return firstHsk - secondHsk;

      const firstBoya = boyaRanks.get(firstKey) ?? Number.POSITIVE_INFINITY;
      const secondBoya = boyaRanks.get(secondKey) ?? Number.POSITIVE_INFINITY;
      if (firstBoya !== secondBoya) return firstBoya - secondBoya;
    }
    return firstWord.localeCompare(secondWord);
  });

  return {
    count: matches.length,
    entries: matches.slice(0, 100).map((entry) => {
      const frequencyRank = frequencyRanks.get(entryKey(entry.simplified, entry.pinyin));
      return {
        ...entry,
        hskLevels: levelsFor(entry),
        frequencyProbability: frequencyRank === undefined
          ? null
          : estimateDailyProbability(frequencyRank)
      };
    })
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
    const key = entryKey(word, record.Pinyin);
    const level = String(record.hsk_level ?? record["HSK几"] ?? "");
    if (!key || !level) continue;
    if (!hskMap.has(key)) hskMap.set(key, new Set());
    hskMap.get(key).add(level);
    const rank = Number(level.match(/\d+/)?.[0] ?? Infinity);
    hskRankMap.set(key, Math.min(hskRankMap.get(key) ?? Infinity, rank));
  }
  hskLevels = hskMap;
  hskRanks = hskRankMap;

  const boyaRankMap = new Map();
  for (const record of rawBoya) {
    const word = String(record.word ?? record.Word ?? "");
    const key = entryKey(word, record.pinyin ?? record.Pinyin);
    const level = String(record.boya_level ?? record.Book ?? "");
    if (!key || !level) continue;
    const rank = Number(level.match(/\d+/)?.[0] ?? Infinity);
    boyaRankMap.set(key, Math.min(boyaRankMap.get(key) ?? Infinity, rank));
  }
  boyaRanks = boyaRankMap;

  const frequencyMap = new Map();
  for (const record of rawFrequency) {
    const word = String(record.word ?? record.Word ?? "");
    const key = entryKey(word, record.pinyin ?? record.Pinyin);
    const rank = Number(record.frequency ?? record.Frequency);
    if (!key || !Number.isFinite(rank) || rank < 1) continue;
    if (!frequencyMap.has(key) || rank < frequencyMap.get(key)) {
      frequencyMap.set(key, rank);
    }
  }
  frequencyRanks = frequencyMap;

  dictionary = rawDictionary.map((record) => {
    const parsed = parseClassifiers(parseDefinitions(record.meaning ?? record.Meaning ?? record.Definitions));
    const rawTags = record.Tags ?? record.tags ?? [];
    const tags = Array.isArray(rawTags) ? rawTags : JSON.parse(String(rawTags || "[]"));
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
      throw new Error("CEDICT tags must be a JSON array of strings.");
    }
    return {
      traditional: String(record.Traditional ?? record.traditional ?? record.Word ?? ""),
      simplified: String(record.Word ?? record.word ?? ""),
      pinyin: String(record.Pinyin ?? record.pinyin ?? ""),
      tags,
      ...parsed
    };
  }).filter((entry) => entry.simplified && entry.pinyin);

  const tagCounts = new Map();
  for (const entry of dictionary) {
    for (const tag of new Set(entry.tags)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const hskCount = dictionary.reduce(
    (count, entry) => count + Number(hskLevels.has(entryKey(entry.simplified, entry.pinyin))),
    0
  );
  self.postMessage({
    type: "ready",
    entryCount: dictionary.length,
    hskCount,
    hskPercentage: dictionary.length ? (hskCount / dictionary.length * 100).toFixed(1) : "0.0",
    tags: [...tagCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((first, second) => first.name.localeCompare(second.name))
  });
}

self.addEventListener("message", (event) => {
  if (event.data.type !== "search") return;
  const hiddenTags = new Set(
    Array.isArray(event.data.hiddenTags)
      ? event.data.hiddenTags.filter((tag) => typeof tag === "string")
      : []
  );
  const result = search(String(event.data.query ?? ""), hiddenTags);
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
