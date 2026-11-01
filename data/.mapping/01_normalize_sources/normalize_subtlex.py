import csv
from pathlib import Path

import pandas as pd


ROOT_DIR = Path(__file__).resolve().parents[3]
WORKBOOK_PATH = ROOT_DIR.parent / "z Subtlex.xlsx"
OUTPUT_PATH = Path(__file__).resolve().parent / "subtlex.csv"


def main():
    if not WORKBOOK_PATH.is_file():
        raise FileNotFoundError(f"Excel workbook not found: {WORKBOOK_PATH}")

    frame = pd.read_excel(WORKBOOK_PATH, dtype=str).fillna("")
    required_columns = {"z_id", "Word"}
    missing_columns = required_columns.difference(frame.columns)
    if missing_columns:
        raise ValueError(
            f"{WORKBOOK_PATH.name} is missing columns: "
            f"{', '.join(sorted(missing_columns))}"
        )

    seen_ids = set()
    seen_words = set()
    with OUTPUT_PATH.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.writer(output_file)
        writer.writerow(("z_id", "Word", "Pinyin normalized", "Pinyin display"))
        for row_number, row in enumerate(
            frame[["z_id", "Word"]].itertuples(index=False, name=None),
            start=2,
        ):
            source_id, word = (str(value).strip() for value in row)
            if not source_id or not word:
                raise ValueError(
                    f"{WORKBOOK_PATH.name}, row {row_number} has an empty "
                    "z_id or Word."
                )
            if source_id in seen_ids:
                raise ValueError(
                    f"{WORKBOOK_PATH.name}, row {row_number} repeats "
                    f"z_id {source_id!r}."
                )
            if word in seen_words:
                raise ValueError(
                    f"{WORKBOOK_PATH.name}, row {row_number} repeats "
                    f"Word {word!r}."
                )
            seen_ids.add(source_id)
            seen_words.add(word)
            writer.writerow((source_id, word, "", ""))

    print(f"Wrote {len(seen_ids)} rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
