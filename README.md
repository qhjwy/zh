# 中文词典

Run locally with `python3 -m http.server 8081` and open `http://localhost:8081/`.

- `index.html` is the main dictionary page; `css/` contains shared styles and `js/` contains browser scripts.
- `hsk/` and `boya/` contain the vocabulary list pages, which share `js/vocabulary-lists.js`.
- `data/` contains the JSON files used by all pages.
- `scripts/` contains data conversion utilities. Install the converter dependencies with `python3 -m pip install -r requirements.txt`, then run `python3 scripts/excel_to_json.py` to regenerate all JSON files. It reads `1 cedict.xlsx`, `2 Frequency.xlsx`, `3 HSK.xlsx`, and `4 Boya.xlsx` from the repository's parent folder (the same folder that contains the `zh` repository); paths are resolved relative to the script, so you can run it from another directory too.
- To convert only one source, add `--excel` with its short name or workbook filename, for example `python3 scripts/excel_to_json.py --excel hsk` or `python3 scripts/excel_to_json.py --excel "3 HSK.xlsx"`. A workbook path is also accepted. Only that source's JSON file is written; HSK still reads the CEDICT workbook to add dictionary definitions.
- The HSK page reads and updates Known/Saved flags in the configured Supabase `HSK` table. Sign in through `/login/` using Supabase Auth email/password; the account icon returns to the page and view you came from after sign-in. The browser-safe publishable key is in `hsk/index.html` and `login/index.html`; never put a `service_role` key in frontend code. The table needs `ID` (numeric), `Known` (boolean), and `Saved` (boolean) columns. Configure Supabase RLS policies to allow authenticated users to select and update these rows. The current table has no per-user column, so authenticated users share the same flags.