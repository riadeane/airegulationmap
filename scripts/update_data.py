#!/usr/bin/env python3
"""AI Regulation Map — data update script (thin shim).

Delegates to ``regulation_pipeline.cli.main``. Kept so the historical invocation
``python scripts/update_data.py ...`` keeps working without installing the
package; once installed (``pip install -e .``) the ``update-regulation-data``
console command is equivalent.

Usage:
  python scripts/update_data.py [--countries "Germany,France"] [--force]
                                [--dry-run] [--model MODEL] [--search]
                                [--search-all] [--batch]

Requirements:
  pip install -r requirements.txt
  ANTHROPIC_API_KEY in the environment
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

try:
    from regulation_pipeline.cli import main
except ImportError as exc:  # missing anthropic / typer / pydantic
    sys.exit(f"ERROR: {exc}\nInstall dependencies with: pip install -r requirements.txt")

if __name__ == "__main__":
    main()
