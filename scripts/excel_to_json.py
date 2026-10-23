import pandas as pd
import json
import os
import re

# --- Configuration ---
EXCEL_FILE_PATH = '../dictionaries.xlsx'
OUTPUT_DIR = 'data/'

# Map your Excel sheet names to the output JSON filenames
SHEETS_TO_EXPORT = {
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


def convert_sheet_to_json(sheet_name, output_filename):
    """Reads a specific sheet from Excel and saves it as a JSON file."""
    try:
        # Read the Excel sheet into a pandas DataFrame
        # dtype=str ensures things like "01" stay as strings, not numbers
        df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=sheet_name, dtype=str)

        # Replace any empty cells (NaN) with an empty string
        df = df.fillna('')
        if sheet_name == 'HSK':
            df = df.drop(columns=['Pinyin original'], errors='ignore')
            cedict = pd.read_excel(EXCEL_FILE_PATH, sheet_name='cedict', dtype=str).fillna('')
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

        # Convert the DataFrame to a list of dictionaries
        # Each dictionary represents a row, with column headers as keys
        data = df.to_dict(orient='records')

        # Write the list of dictionaries to a JSON file
        # indent=2 makes it human-readable (but larger file size)
        # ensure_ascii=False ensures Chinese characters are saved correctly
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"Successfully converted '{sheet_name}' to '{output_path}'")

    except Exception as e:
        print(f"Error processing sheet '{sheet_name}': {e}")

# --- Main execution ---
if __name__ == "__main__":
    # Create the data directory if it doesn't exist
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created directory: {OUTPUT_DIR}")

    # Loop through the mapping and convert each sheet
    for sheet, filename in SHEETS_TO_EXPORT.items():
        convert_sheet_to_json(sheet, filename)

    print("\nAll conversions complete! 🎉")
