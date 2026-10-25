import argparse
import json
import os
import re

# --- Configuration ---
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCEL_DIR = os.path.dirname(ROOT_DIR)
OUTPUT_DIR = os.path.join(ROOT_DIR, 'data')

EXCEL_FILES = {
    'cedict': '1 cedict.xlsx',
    'Frequency': '2 Frequency.xlsx',
    'HSK': '3 HSK.xlsx',
    'Boya': '4 Boya.xlsx',
}

OUTPUT_FILES = {
    'cedict': 'cedict.json',
    'Frequency': 'frequency.json',
    'HSK': 'hsk.json',
    'Boya': 'boya.json',
}

HIDDEN_CEDICT_TAGS = {
    'archaic',
    'dated',
    'latin_digit',
    'proper_noun',
    'regional',
    'variant',
}


def normalize_pinyin(value):
    """Normalize numbered pinyin separators for matching spreadsheet records."""
    return re.sub(
        r"[\s'’‘·-]+",
        "",
        str(value).lower().replace('u:', 'v').replace('ü', 'v'),
    )


def read_excel(source_name, excel_path=None):
    """Read the first worksheet from one of the source workbooks."""
    import pandas as pd

    if excel_path is None:
        excel_path = os.path.join(EXCEL_DIR, EXCEL_FILES[source_name])
    if not os.path.isfile(excel_path):
        raise FileNotFoundError(f"Excel workbook not found: {excel_path}")
    return pd.read_excel(excel_path, dtype=str).fillna('')


def add_dictionary_definitions(df):
    """Add visible CEDICT definitions to matching HSK entries."""
    cedict = read_excel('cedict')
    definitions_by_key = {}
    for record in cedict.to_dict(orient='records'):
        word = record.get('Word', '')
        pinyin = normalize_pinyin(record.get('Pinyin', ''))
        if not word or not pinyin:
            continue

        tags = json.loads(record.get('Tags') or '[]')
        if HIDDEN_CEDICT_TAGS.intersection(tags):
            continue

        definition = str(record.get('Definitions', '')).strip('/')
        if not definition:
            continue

        key = (word, pinyin)
        definitions = definitions_by_key.setdefault(key, [])
        for item in definition.split('/'):
            item = item.strip()
            if item and not item.startswith('CL:') and item not in definitions:
                definitions.append(item)

    df['Dictionary definitions'] = df.apply(
        lambda record: definitions_by_key.get(
            (str(record.get('Word', '')), normalize_pinyin(record.get('Pinyin', ''))),
            [],
        ),
        axis=1,
    )


def convert_excel_to_json(source_name, output_filename, excel_path=None):
    """Read one source workbook and save it as a JSON file."""
    df = read_excel(source_name, excel_path)
    if source_name == 'HSK':
        df = df.drop(columns=['Pinyin original'], errors='ignore')
        add_dictionary_definitions(df)

    data = df.to_dict(orient='records')
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Successfully converted '{EXCEL_FILES[source_name]}' to '{output_path}'")


def parse_excel_argument(value):
    """Resolve a source name or configured workbook filename to a source."""
    source_names = {
        name.casefold(): name for name in EXCEL_FILES
    }
    workbook_names = {
        filename.casefold(): name for name, filename in EXCEL_FILES.items()
    }
    source_name = source_names.get(value.casefold())
    if source_name is None:
        source_name = workbook_names.get(os.path.basename(value).casefold())
    if source_name is None:
        choices = ', '.join(EXCEL_FILES.values())
        raise argparse.ArgumentTypeError(
            f"unsupported Excel source {value!r}; choose one of: {choices}"
        )

    excel_path = value if os.path.dirname(value) else None
    return source_name, excel_path


def main():
    parser = argparse.ArgumentParser(
        description='Convert the dictionary Excel workbooks to JSON.'
    )
    parser.add_argument(
        '--excel',
        type=parse_excel_argument,
        metavar='SOURCE_OR_FILE',
        help=(
            'convert only this source (cedict, frequency, hsk, boya, or a '
            'configured workbook filename/path); default: convert all'
        ),
    )
    args = parser.parse_args()

    if args.excel:
        selected_source, selected_path = args.excel
        sources_to_convert = [selected_source]
        paths_to_check = [
            selected_path or os.path.join(EXCEL_DIR, EXCEL_FILES[selected_source])
        ]
    else:
        sources_to_convert = list(OUTPUT_FILES)
        paths_to_check = [
            os.path.join(EXCEL_DIR, EXCEL_FILES[source_name])
            for source_name in sources_to_convert
        ]

    if 'HSK' in sources_to_convert:
        paths_to_check.append(os.path.join(EXCEL_DIR, EXCEL_FILES['cedict']))

    missing_files = [path for path in paths_to_check if not os.path.isfile(path)]
    if missing_files:
        parser.error('Excel workbook not found: ' + ', '.join(missing_files))

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if args.excel:
        source_name, excel_path = args.excel
        convert_excel_to_json(
            source_name,
            OUTPUT_FILES[source_name],
            excel_path,
        )
    else:
        for source_name, output_filename in OUTPUT_FILES.items():
            convert_excel_to_json(source_name, output_filename)

    print("\nAll conversions complete! 🎉")


if __name__ == "__main__":
    main()
