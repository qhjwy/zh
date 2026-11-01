import argparse
import json
import os
import re

# --- Configuration ---
ROOT_DIR = os.path.dirname(
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
)
EXCEL_DIR = os.path.dirname(ROOT_DIR)
OUTPUT_DIR = os.path.join(ROOT_DIR, 'data')

EXCEL_FILES = {
    'cedict': 'c cedict.xlsx',
    'frequency': 'f Frequency.xlsx',
    'hsk': 'h HSK.xlsx',
    'boya': 'b Boya.xlsx',
    'subtlex': 'z Subtlex.xlsx',
}

OUTPUT_FILES = {
    'cedict': 'cedict.json',
    'frequency': 'frequency.json',
    'hsk': 'hsk.json',
    'boya': 'boya.json',
    'subtlex': 'zimu.json',
}
SOURCE_ID_FIELDS = {
    'cedict': 'c_id',
    'frequency': 'f_id',
    'hsk': 'h_id',
    'boya': 'ID',
    'subtlex': 'z_id',
}


def read_excel(source_name, excel_path=None):
    """Read the first worksheet from one of the source workbooks."""
    import pandas as pd

    if excel_path is None:
        excel_path = os.path.join(EXCEL_DIR, EXCEL_FILES[source_name])
    if not os.path.isfile(excel_path):
        raise FileNotFoundError(f"Excel workbook not found: {excel_path}")
    df = pd.read_excel(excel_path, dtype=str).fillna('')
    if source_name == 'frequency' and 'Pinyin' in df.columns:
        df['Pinyin'] = df['Pinyin'].map(restore_frequency_excel_date)
    return df


def restore_frequency_excel_date(value):
    """Recover Pinyin cells Excel auto-converted from jun1-jun5 into dates."""
    match = re.fullmatch(
        r"\d{4}-06-0([1-5])(?: 00:00:00)?",
        str(value).strip(),
    )
    return f"jun{match.group(1)}" if match else value


def order_record_fields(record, source_name):
    """Put source ID, simplified word, and pinyin fields before other data."""
    source_id = SOURCE_ID_FIELDS[source_name]
    leading_fields = [source_id, 'Word', 'Pinyin']
    return {
        **{field: record[field] for field in leading_fields if field in record},
        **{field: value for field, value in record.items() if field not in leading_fields},
    }


def convert_excel_to_json(source_name, output_filename, excel_path=None):
    """Read one source workbook and save it as a JSON file."""
    df = read_excel(source_name, excel_path)
    if source_name == 'hsk':
        df = df.drop(columns=['Pinyin original'], errors='ignore')

    data = [
        order_record_fields(record, source_name)
        for record in df.to_dict(orient='records')
    ]
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
            'convert only this source (cedict, frequency, hsk, boya, subtlex, or a '
            'configured workbook filename/path); subtlex writes zimu.json; '
            'default: convert all'
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
