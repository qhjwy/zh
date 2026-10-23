"use strict";

window.convertPinyin = function convertPinyin(pinyin) {
  const toneMap = {
    a: ["ā", "á", "ǎ", "à"],
    e: ["ē", "é", "ě", "è"],
    i: ["ī", "í", "ǐ", "ì"],
    o: ["ō", "ó", "ǒ", "ò"],
    u: ["ū", "ú", "ǔ", "ù"],
    ü: ["ǖ", "ǘ", "ǚ", "ǜ"]
  };

  return pinyin.split(" ").map((syllable) => {
    const match = syllable.match(/([1-5])$/);
    let word = syllable.replace(/u:/g, "ü").replace(/v/g, "ü");
    if (!match || match[1] === "5") return word.replace(/[1-5]$/, "");
    word = word.slice(0, -1);

    const lower = word.toLowerCase();
    let vowel = "";
    if (lower.includes("a")) vowel = "a";
    else if (lower.includes("e")) vowel = "e";
    else if (lower.includes("ou")) vowel = "o";
    else {
      for (let index = lower.length - 1; index >= 0; index -= 1) {
        if (Object.hasOwn(toneMap, lower[index])) {
          vowel = lower[index];
          break;
        }
      }
    }

    return vowel
      ? word.replace(new RegExp(vowel, "i"), toneMap[vowel][Number(match[1]) - 1])
      : word;
  }).join(" ");
};
