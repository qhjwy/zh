import re
import unicodedata
from pathlib import Path

import pandas as pd


ROOT_DIR = Path(__file__).resolve().parents[3]
WORKBOOK_DIR = ROOT_DIR.parent
OUTPUT_DIR = Path(__file__).resolve().parent

SOURCE_WORKBOOKS = (
    "c cedict.xlsx",
    "f Frequency.xlsx",
    "h HSK.xlsx",
    "b Boya.xlsx",
)

TONE_MARKS = {
    "ā": ("a", "1"),
    "á": ("a", "2"),
    "ǎ": ("a", "3"),
    "à": ("a", "4"),
    "ē": ("e", "1"),
    "é": ("e", "2"),
    "ě": ("e", "3"),
    "è": ("e", "4"),
    "ī": ("i", "1"),
    "í": ("i", "2"),
    "ǐ": ("i", "3"),
    "ì": ("i", "4"),
    "ō": ("o", "1"),
    "ó": ("o", "2"),
    "ǒ": ("o", "3"),
    "ò": ("o", "4"),
    "ū": ("u", "1"),
    "ú": ("u", "2"),
    "ǔ": ("u", "3"),
    "ù": ("u", "4"),
    "ǖ": ("v", "1"),
    "ǘ": ("v", "2"),
    "ǚ": ("v", "3"),
    "ǜ": ("v", "4"),
}


def normalize_pinyin(value, preserve_final_neutral=False, syllable_separator=""):
    """Return compact numbered pinyin, treating ü, u:, and v alike."""
    pinyin = unicodedata.normalize("NFC", str(value)).lower()
    excel_june_tone = re.fullmatch(
        r"\d{4}-06-0([1-5])(?: 00:00:00)?",
        pinyin.strip(),
    )
    if excel_june_tone:
        pinyin = f"jun{excel_june_tone.group(1)}"

    syllables = []
    source_syllables = [
        syllable
        for syllable in re.split(r"[\s'’‘·-]+", pinyin)
        if syllable
    ]
    for index, syllable in enumerate(source_syllables):
        normalized_syllable = []
        tone = ""
        for character in syllable:
            base_and_tone = TONE_MARKS.get(character)
            if base_and_tone:
                base, tone = base_and_tone
                normalized_syllable.append(base)
            else:
                normalized_syllable.append(character)
        normalized = "".join(normalized_syllable)
        if tone and not re.search(r"[1-5]$", normalized):
            if normalized.endswith("r"):
                normalized = f"{normalized[:-1]}{tone}r"
            else:
                normalized += tone
        if not preserve_final_neutral or index != len(source_syllables) - 1:
            normalized = re.sub(r"5$", "", normalized)
        syllables.append(normalized)
    if syllables and syllables[-1] == "er":
        syllables[-1] = "r"
    return syllable_separator.join(syllables).replace("u:", "v").replace("ü", "v")


def has_final_neutral_tone(pinyin):
    """Return whether the source explicitly marks its final syllable neutral."""
    syllables = [
        syllable
        for syllable in re.split(r"[\s'’‘·-]+", str(pinyin).strip())
        if syllable
    ]
    if not syllables:
        return False

    final_syllable = syllables[-1].lower()
    if re.search(r"5$", final_syllable):
        return True
    if re.search(r"[1-4]$", final_syllable):
        return False
    return not any(character in TONE_MARKS for character in final_syllable)


def find_final_neutral_forms_by_workbook():
    """Find neutral word/pinyin forms separately for each source workbook."""
    neutral_forms_by_workbook = {}
    for workbook_name in SOURCE_WORKBOOKS:
        workbook_path = WORKBOOK_DIR / workbook_name
        if not workbook_path.is_file():
            raise FileNotFoundError(f"Excel workbook not found: {workbook_path}")

        df = pd.read_excel(workbook_path, dtype=str).fillna("")
        required_columns = {"Word", "Pinyin"}
        missing_columns = required_columns.difference(df.columns)
        if missing_columns:
            raise ValueError(
                f"{workbook_path.name} is missing columns: "
                f"{', '.join(sorted(missing_columns))}"
            )

        neutral_forms = set()
        for word, pinyin in zip(df["Word"], df["Pinyin"]):
            if not has_final_neutral_tone(pinyin):
                continue
            normalized = normalize_pinyin(pinyin, preserve_final_neutral=True)
            if normalized.endswith("5"):
                normalized = normalized[:-1]
            neutral_forms.add((str(word).strip(), normalized))
        neutral_forms_by_workbook[workbook_name] = neutral_forms
    return neutral_forms_by_workbook


def apply_final_neutral_forms(word, pinyin, neutral_forms, own_neutral_forms):
    """Use a cross-source neutral form unless this source distinguishes both."""
    neutral_key = (word, pinyin[:-1]) if pinyin and pinyin[-1] in "1234" else None
    if (
        neutral_key
        and neutral_key in neutral_forms
        and neutral_key not in own_neutral_forms
    ):
        return pinyin[:-1]
    return pinyin


def export_workbook(workbook_name, source_id_column, output_name):
    workbook_path = WORKBOOK_DIR / workbook_name
    if not workbook_path.is_file():
        raise FileNotFoundError(f"Excel workbook not found: {workbook_path}")

    df = pd.read_excel(workbook_path, dtype=str).fillna("")
    required_columns = {source_id_column, "Word", "Pinyin"}
    missing_columns = required_columns.difference(df.columns)
    if missing_columns:
        raise ValueError(
            f"{workbook_path.name} is missing columns: "
            f"{', '.join(sorted(missing_columns))}"
        )

    neutral_forms_by_workbook = find_final_neutral_forms_by_workbook()
    own_neutral_forms = neutral_forms_by_workbook[workbook_name]
    other_neutral_forms = set().union(
        *(
            forms
            for other_workbook, forms in neutral_forms_by_workbook.items()
            if other_workbook != workbook_name
            and other_workbook != "b Boya.xlsx"
        )
    )
    normalized_pinyin = df["Pinyin"].map(normalize_pinyin)
    normalized_display_pinyin = df["Pinyin"].map(
        lambda value: normalize_pinyin(value, syllable_separator=" ")
    )
    for index, (word, compact_pinyin) in enumerate(
        zip(df["Word"], normalized_pinyin)
    ):
        adjusted_pinyin = apply_final_neutral_forms(
            str(word).strip(),
            compact_pinyin,
            other_neutral_forms,
            own_neutral_forms,
        )
        if adjusted_pinyin != compact_pinyin:
            display_syllables = normalized_display_pinyin.iloc[index].split()
            display_syllables[-1] = re.sub(r"[1-4]$", "", display_syllables[-1])
            normalized_display_pinyin.iloc[index] = " ".join(display_syllables)

    output = pd.DataFrame({
        source_id_column: df[source_id_column],
        "Word": df["Word"],
        "Pinyin normalized": [
            apply_final_neutral_forms(
                str(word).strip(),
                pinyin,
                other_neutral_forms,
                own_neutral_forms,
            )
            for word, pinyin in zip(df["Word"], normalized_pinyin)
        ],
        "Pinyin display": normalized_display_pinyin,
    })
    output_path = OUTPUT_DIR / output_name
    output.to_csv(output_path, index=False, encoding="utf-8-sig")
    print(f"Wrote {len(output)} rows to {output_path}")
