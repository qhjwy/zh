import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[3]
NORMALIZERS = (
    ROOT_DIR / "data" / ".mapping" / "01_normalize_sources" / "normalize_cedict.py",
    ROOT_DIR / "data" / ".mapping" / "01_normalize_sources" / "normalize_frequency.py",
    ROOT_DIR / "data" / ".mapping" / "01_normalize_sources" / "normalize_hsk.py",
    ROOT_DIR / "data" / ".mapping" / "01_normalize_sources" / "normalize_subtlex.py",
    ROOT_DIR / "data" / ".mapping" / "01_normalize_sources" / "normalize_boya.py",
)
COMMANDS = (
    *NORMALIZERS,
    ROOT_DIR / "data" / ".mapping" / "02_generate_mapping" / "generate_word_mapping.py",
    ROOT_DIR / "data" / ".mapping" / "scripts" / "excel_to_json.py",
    ROOT_DIR / "data" / ".mapping" / "scripts" / "mapping_to_json.py",
)


def main():
    for script_path in COMMANDS:
        if not script_path.is_file():
            raise FileNotFoundError(f"Build script not found: {script_path}")
        subprocess.run([sys.executable, str(script_path)], check=True, cwd=ROOT_DIR)


if __name__ == "__main__":
    main()
