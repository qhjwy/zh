import pandas as pd
import json
import os

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

def convert_sheet_to_json(sheet_name, output_filename):
    """Reads a specific sheet from Excel and saves it as a JSON file."""
    try:
        # Read the Excel sheet into a pandas DataFrame
        # dtype=str ensures things like "01" stay as strings, not numbers
        df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=sheet_name, dtype=str)

        # Replace any empty cells (NaN) with an empty string
        df = df.fillna('')

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
