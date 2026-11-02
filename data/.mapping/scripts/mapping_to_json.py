import csv
import json
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[3]
SOURCE_DIR = ROOT_DIR / "data" / ".mapping" / "01_normalize_sources"
SOURCE_FILES = (
    ("cedict.csv", "c_id", "cedict.json"),
    ("frequency.csv", "f_id", "frequency.json"),
    ("hsk.csv", "h_id", "hsk.json"),
    ("subtlex.csv", "z_id", "zimu.json"),
    ("boya.csv", "ID", "boya.json"),
)


def load_source_mapping(filename, source_id_column):
    """Read generated IDs keyed by each source record's stable ID and word."""
    source_path = SOURCE_DIR / filename
    if not source_path.is_file():
        raise FileNotFoundError(f"Generated mapping CSV not found: {source_path}")

    mappings = {}
    with source_path.open(encoding="utf-8-sig", newline="") as input_file:
        reader = csv.DictReader(input_file)
        required_columns = {
            source_id_column,
            "Word",
            "Pinyin normalized",
            "Pinyin display",
            "w_id",
        }
        missing_columns = required_columns.difference(reader.fieldnames or [])
        if missing_columns:
            raise ValueError(
                f"{source_path.name} is missing columns: "
                f"{', '.join(sorted(missing_columns))}"
            )

        for row_number, row in enumerate(reader, start=2):
            source_id = row[source_id_column].strip()
            word = row["Word"].strip()
            pinyin = row["Pinyin normalized"].strip()
            display_pinyin = row["Pinyin display"].strip()
            word_id = row["w_id"].strip()
            allow_blank_pinyin = source_id_column == "z_id"
            if (
                not source_id
                or not word
                or (not pinyin and not allow_blank_pinyin)
                or (not display_pinyin and pinyin)
                or not word_id
            ):
                raise ValueError(
                    f"{source_path.name}, row {row_number} has an empty "
                    "source ID, word, required pinyin, or w_id."
                )

            key = (source_id, word)
            mapping = (word_id, pinyin, display_pinyin)
            existing_mapping = mappings.get(key)
            if existing_mapping and existing_mapping != mapping:
                raise ValueError(
                    f"{source_path.name}, source ID {source_id!r} and word "
                    f"{word!r} map to conflicting IDs or normalized pinyin."
                )
            mappings[key] = mapping

    return mappings


def add_word_ids(source_filename, source_id_column, json_filename):
    """Apply generated IDs and arrange the core fields first in each record."""
    mappings = load_source_mapping(source_filename, source_id_column)
    json_path = ROOT_DIR / "data" / json_filename
    with json_path.open(encoding="utf-8") as input_file:
        records = json.load(input_file)
    if not isinstance(records, list):
        raise ValueError(f"{json_filename} must contain a JSON array.")

    for row_number, record in enumerate(records, start=1):
        source_id = str(record.get(source_id_column, "")).strip()
        word = str(record.get("Word", "")).strip()
        mapping = mappings.get((source_id, word))
        if not mapping:
            raise ValueError(
                f"Could not map {json_filename} row {row_number}: "
                f"{source_id_column}={source_id!r}, Word={word!r}."
            )
        word_id, _pinyin, display_pinyin = mapping
        record["w_id"] = word_id
        record["Pinyin"] = display_pinyin
        ordered_record = {
            "w_id": record["w_id"],
            source_id_column: record[source_id_column],
            "Word": record["Word"],
            "Pinyin": record["Pinyin"],
        }
        ordered_record.update(
            (key, value)
            for key, value in record.items()
            if key not in {"w_id", source_id_column, "Word", "Pinyin"}
        )
        records[row_number - 1] = ordered_record

    with json_path.open("w", encoding="utf-8") as output_file:
        json.dump(records, output_file, ensure_ascii=False, indent=2)
        output_file.write("\n")

    print(
        f"Applied generated w_id and normalized Pinyin to {len(records)} "
        f"records in '{json_path}'."
    )


def write_cedict_word_ids():
    """Write the CEDICT word IDs for checking definition availability."""
    json_path = ROOT_DIR / "data" / "cedict.json"
    with json_path.open(encoding="utf-8") as input_file:
        records = json.load(input_file)
    if not isinstance(records, list):
        raise ValueError("cedict.json must contain a JSON array.")

    word_ids = sorted({
        str(record.get("w_id", "")).strip()
        for record in records
        if str(record.get("w_id", "")).strip()
    })
    output_path = ROOT_DIR / "data" / "cedict-word-ids.json"
    with output_path.open("w", encoding="utf-8") as output_file:
        json.dump(word_ids, output_file, ensure_ascii=False, indent=2)
        output_file.write("\n")

    print(f"Wrote {len(word_ids)} CEDICT word IDs to '{output_path}'.")


def main():
    for source_filename, source_id_column, json_filename in SOURCE_FILES:
        add_word_ids(source_filename, source_id_column, json_filename)
    write_cedict_word_ids()


if __name__ == "__main__":
    main()
