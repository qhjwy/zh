import csv
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

MAPPING_DIR = Path(__file__).resolve().parent.parent
SOURCE_DIR = MAPPING_DIR / "01_normalize_sources"
OUTPUT_DIR = Path(__file__).resolve().parent
SOURCE_FILES = (
    ("cedict.csv", "c_id"),
    ("frequency.csv", "f_id"),
    ("hsk.csv", "h_id"),
    ("subtlex.csv", "z_id"),
    ("boya.csv", "ID"),
)
BASE_SOURCE_IDS = ("c_id", "f_id", "h_id")
MAPPING_FILE = MAPPING_DIR.parent / "word_mapping.csv"
WORKBOOK_FILE = OUTPUT_DIR / "word_mapping_joined.xlsx"
JOIN_COLUMNS = ("Word", "Pinyin normalized")
MAX_ID = 999_999


def read_source_file(filename, id_column):
    source_path = SOURCE_DIR / filename
    if not source_path.is_file():
        raise FileNotFoundError(
            f"Normalized CSV not found: {source_path}. "
            "Run the corresponding normalization scripts first."
        )

    with source_path.open(encoding="utf-8-sig", newline="") as input_file:
        reader = csv.DictReader(input_file)
        required_columns = {id_column, *JOIN_COLUMNS, "Pinyin display"}
        missing_columns = required_columns.difference(reader.fieldnames or [])
        if missing_columns:
            raise ValueError(
                f"{source_path.name} is missing columns: "
                f"{', '.join(sorted(missing_columns))}"
            )

        rows = []
        ids_by_pair = {}
        for row_number, row in enumerate(reader, start=2):
            pair = tuple(row[column].strip() for column in JOIN_COLUMNS)
            source_id = row[id_column].strip()
            allow_blank_pinyin = id_column == "z_id"
            if not pair[0] or (not pair[1] and not allow_blank_pinyin) or not source_id:
                raise ValueError(
                    f"{source_path.name}, row {row_number} has an empty "
                    "word, required pinyin, or source ID."
                )
            rows.append((source_id, *pair, row["Pinyin display"].strip()))
            if all(pair):
                ids = ids_by_pair.setdefault(pair, [])
                if source_id not in ids:
                    ids.append(source_id)

    return {"rows": rows, "ids_by_pair": ids_by_pair}


def read_existing_mapping():
    if not MAPPING_FILE.is_file():
        return {}

    existing_ids = {}
    seen_ids = set()
    with MAPPING_FILE.open(encoding="utf-8-sig", newline="") as input_file:
        reader = csv.DictReader(input_file)
        required_columns = {"w_id", *JOIN_COLUMNS}
        missing_columns = required_columns.difference(reader.fieldnames or [])
        if missing_columns:
            raise ValueError(
                f"{MAPPING_FILE.name} is missing columns: "
                f"{', '.join(sorted(missing_columns))}"
            )

        for row_number, row in enumerate(reader, start=2):
            word_id = row["w_id"].strip()
            pair = tuple(row[column].strip() for column in JOIN_COLUMNS)
            if not word_id or not pair[0]:
                raise ValueError(
                    f"{MAPPING_FILE.name}, row {row_number} has an empty "
                    "ID or word."
                )
            if not word_id.startswith("W") or not word_id[1:].isdigit():
                raise ValueError(
                    f"{MAPPING_FILE.name}, row {row_number} has invalid "
                    f"word ID {word_id!r}."
                )
            if word_id in seen_ids:
                raise ValueError(
                    f"{MAPPING_FILE.name} uses word ID {word_id!r} more "
                    "than once."
                )
            existing_word_id = existing_ids.get(pair)
            if existing_word_id and existing_word_id != word_id:
                raise ValueError(
                    f"{MAPPING_FILE.name} assigns both {existing_word_id!r} "
                    f"and {word_id!r} to {pair!r}."
                )
            existing_ids[pair] = word_id
            seen_ids.add(word_id)

    return existing_ids


def build_word_mapping(source_data, existing_ids):
    base_pairs = {
        (word, pinyin)
        for id_column in BASE_SOURCE_IDS
        for _, word, pinyin, _ in source_data[id_column]["rows"]
    }
    boya_pairs = {
        (word, pinyin)
        for _, word, pinyin, _ in source_data["ID"]["rows"]
    }
    base_words = {word for word, _ in base_pairs}
    boya_words = {word for word, _ in boya_pairs}
    subtlex_words = {word for _, word, _, _ in source_data["z_id"]["rows"]}
    boya_only_words = {
        word
        for word in boya_words
        if word not in base_words and word not in subtlex_words
    }
    boya_pairs_to_move = {
        pair for pair in boya_pairs - base_pairs if pair[0] in boya_only_words
    }
    existing_order = {pair: index for index, pair in enumerate(existing_ids)}
    last_subtlex_index = max(
        (
            index
            for pair, index in existing_order.items()
            if not pair[1] and pair[0] in subtlex_words
        ),
        default=-1,
    )
    retained_boya_pairs = {
        pair
        for pair in boya_pairs_to_move
        if last_subtlex_index >= 0
        and existing_order.get(pair, -1) > last_subtlex_index
    }
    legacy_boya_pairs = {
        pair
        for pair in existing_ids
        if pair[0] in boya_words
        and pair not in base_pairs
        and pair[1]
        and pair not in retained_boya_pairs
    }
    word_ids = {
        pair: word_id
        for pair, word_id in existing_ids.items()
        if pair not in legacy_boya_pairs
    }
    word_mappings = [
        pair
        for pair in word_ids
        if pair not in boya_pairs_to_move
    ]
    seen_pairs = set(word_mappings)
    next_number = max(
        (int(word_id[1:]) for word_id in existing_ids.values()),
        default=0,
    ) + 1

    def ensure_pair(pair):
        nonlocal next_number
        if pair not in seen_pairs:
            word_mappings.append(pair)
            if pair not in word_ids:
                if next_number > MAX_ID:
                    raise ValueError(
                        f"Cannot assign an ID to {pair!r}: six-digit numbering "
                        f"is limited to {MAX_ID:,}."
                    )
                word_ids[pair] = f"W{next_number:06d}"
                next_number += 1
            seen_pairs.add(pair)
        return word_ids[pair]

    for id_column in BASE_SOURCE_IDS:
        for _, word, pinyin, _ in source_data[id_column]["rows"]:
            ensure_pair((word, pinyin))

    first_pair_by_word = {}
    for id_column in BASE_SOURCE_IDS:
        for _, word, pinyin, _ in source_data[id_column]["rows"]:
            first_pair_by_word.setdefault(word, (word, pinyin))
    for pair in word_mappings:
        if pair[1]:
            first_pair_by_word.setdefault(pair[0], pair)
    first_frequency_pair_by_word = {}
    for _, word, pinyin, _ in source_data["f_id"]["rows"]:
        first_frequency_pair_by_word.setdefault(word, (word, pinyin))

    display_by_pair = {}
    for id_column in BASE_SOURCE_IDS:
        for _, word, pinyin, display_pinyin in source_data[id_column]["rows"]:
            display_by_pair.setdefault((word, pinyin), display_pinyin)

    assigned_rows = {id_column: [] for _, id_column in SOURCE_FILES}
    assigned_ids_by_pair = {id_column: {} for _, id_column in SOURCE_FILES}

    def record_assignment(
        id_column,
        source_id,
        word,
        pinyin,
        display_pinyin,
        mapping_pair,
        word_id,
    ):
        assigned_rows[id_column].append(
            (source_id, word, pinyin, display_pinyin, word_id)
        )
        assigned_ids_by_pair[id_column].setdefault(mapping_pair, []).append(source_id)

    for id_column in BASE_SOURCE_IDS:
        for source_id, word, pinyin, display_pinyin in source_data[id_column]["rows"]:
            pair = (word, pinyin)
            record_assignment(
                id_column,
                source_id,
                word,
                pinyin,
                display_pinyin,
                pair,
                word_ids[pair],
            )

    for source_id, word, _, _ in source_data["z_id"]["rows"]:
        mapping_pair = first_frequency_pair_by_word.get(word, first_pair_by_word.get(word))
        if mapping_pair is None:
            mapping_pair = (word, "")
            first_pair_by_word[word] = mapping_pair
            ensure_pair(mapping_pair)
        display_pinyin = display_by_pair.get(mapping_pair, "")
        record_assignment(
            "z_id",
            source_id,
            word,
            mapping_pair[1],
            display_pinyin,
            mapping_pair,
            word_ids[mapping_pair],
        )

    for source_id, word, pinyin, display_pinyin in source_data["ID"]["rows"]:
        source_pair = (word, pinyin)
        if source_pair in word_ids:
            mapping_pair = source_pair
            ensure_pair(mapping_pair)
        else:
            mapping_pair = first_pair_by_word.get(word)
            if mapping_pair is None:
                mapping_pair = source_pair
                ensure_pair(mapping_pair)
                first_pair_by_word[word] = mapping_pair
        record_assignment(
            "ID",
            source_id,
            word,
            pinyin,
            display_pinyin,
            mapping_pair,
            word_ids[mapping_pair],
        )

    if len(word_mappings) > MAX_ID:
        raise ValueError(
            f"Found {len(word_mappings)} active or retained pairs, exceeding "
            f"the {MAX_ID:,} IDs supported by six-digit numbering."
        )

    return word_mappings, word_ids, assigned_rows, assigned_ids_by_pair


def write_mapping_csv(word_mappings, word_ids):
    with MAPPING_FILE.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.writer(output_file, lineterminator="\n")
        writer.writerow(("w_id", "Word", "Pinyin normalized"))
        for pair in word_mappings:
            word, pinyin = pair
            writer.writerow((word_ids[pair], word, pinyin))
    print(f"Wrote {len(word_mappings)} unique pairs to {MAPPING_FILE}")


def write_source_files(assigned_rows):
    for filename, id_column in SOURCE_FILES:
        output_path = SOURCE_DIR / filename
        temporary_path = output_path.with_suffix(".tmp")
        with temporary_path.open("w", encoding="utf-8-sig", newline="") as output_file:
            writer = csv.writer(output_file)
            writer.writerow((id_column, *JOIN_COLUMNS, "Pinyin display", "w_id"))
            for source_id, word, pinyin, display_pinyin, word_id in assigned_rows[id_column]:
                writer.writerow((
                    source_id,
                    word,
                    pinyin,
                    display_pinyin,
                    word_id,
                ))
        temporary_path.replace(output_path)
        print(f"Added w_id to {len(assigned_rows[id_column])} rows in {output_path}")


def style_worksheet(worksheet, table_name):
    worksheet.freeze_panes = "A2"
    worksheet.auto_filter.ref = worksheet.dimensions
    table = Table(displayName=table_name, ref=worksheet.dimensions)
    table.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium2",
        showFirstColumn=False,
        showLastColumn=False,
        showRowStripes=True,
        showColumnStripes=False,
    )
    worksheet.add_table(table)

    for cell in worksheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1F4E78")
    for column_cells in worksheet.columns:
        max_length = max(len(str(cell.value or "")) for cell in column_cells)
        column_letter = get_column_letter(column_cells[0].column)
        worksheet.column_dimensions[column_letter].width = min(max_length + 2, 60)


def add_frequency_review_sheet(workbook, source_data):
    worksheet = workbook.create_sheet("Frequency not in CEDICT")
    headers = (
        "Review status",
        "f_id",
        "Word",
        "Frequency pinyin",
        "CEDICT pinyin for word",
        "CEDICT c_id",
        "HSK pinyin for word",
        "HSK h_id",
    )
    worksheet.append(headers)

    cedict_by_word = {}
    for (word, pinyin), ids in source_data["c_id"]["ids_by_pair"].items():
        entry = cedict_by_word.setdefault(word, {})
        entry[pinyin] = ids

    hsk_by_word = {}
    for (word, pinyin), ids in source_data["h_id"]["ids_by_pair"].items():
        entry = hsk_by_word.setdefault(word, {})
        entry[pinyin] = ids

    cedict_pairs = set(source_data["c_id"]["ids_by_pair"])
    for (word, pinyin), frequency_ids in source_data["f_id"]["ids_by_pair"].items():
        if (word, pinyin) in cedict_pairs:
            continue

        cedict_matches = cedict_by_word.get(word, {})
        hsk_matches = hsk_by_word.get(word, {})
        status = (
            "Word exists in CEDICT with different pinyin"
            if cedict_matches
            else "Word not found in CEDICT"
        )
        worksheet.append((
            status,
            "; ".join(frequency_ids),
            word,
            pinyin,
            "; ".join(sorted(cedict_matches)),
            "; ".join(
                source_id
                for ids in cedict_matches.values()
                for source_id in ids
            ),
            "; ".join(sorted(hsk_matches)),
            "; ".join(
                source_id
                for ids in hsk_matches.values()
                for source_id in ids
            ),
        ))

    style_worksheet(worksheet, "FrequencyNotInCedict")
    return worksheet.max_row - 1


def write_joined_workbook(
    word_mappings,
    word_ids,
    source_data,
    assigned_ids_by_pair,
):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Joined mapping"
    headers = (
        "Status",
        "w_id",
        *JOIN_COLUMNS,
        *(id_column for _, id_column in SOURCE_FILES),
    )
    worksheet.append(headers)

    active_pairs = {
        pair
        for _, id_column in SOURCE_FILES
        for pair in assigned_ids_by_pair[id_column]
    }
    for pair in word_mappings:
        worksheet.append((
            "Active" if pair in active_pairs else "Retired",
            word_ids[pair],
            *pair,
            *(
                "; ".join(assigned_ids_by_pair[id_column].get(pair, []))
                for _, id_column in SOURCE_FILES
            ),
        ))

    style_worksheet(worksheet, "JoinedWordMapping")
    review_count = add_frequency_review_sheet(workbook, source_data)

    workbook.save(WORKBOOK_FILE)
    print(
        f"Wrote {len(word_mappings)} joined rows and {review_count} "
        f"Frequency review rows to {WORKBOOK_FILE}"
    )


def main():
    source_data = {
        id_column: read_source_file(filename, id_column)
        for filename, id_column in SOURCE_FILES
    }
    existing_ids = read_existing_mapping()
    (
        word_mappings,
        word_ids,
        assigned_rows,
        assigned_ids_by_pair,
    ) = build_word_mapping(source_data, existing_ids)

    write_mapping_csv(word_mappings, word_ids)
    write_source_files(assigned_rows)
    write_joined_workbook(
        word_mappings,
        word_ids,
        source_data,
        assigned_ids_by_pair,
    )


if __name__ == "__main__":
    main()
