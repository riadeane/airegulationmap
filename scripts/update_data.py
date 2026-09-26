#!/usr/bin/env python3
"""AI Regulation Map - data update script (thin shim).

Delegates to ``regulation_pipeline.cli.main``. Kept so the historical invocation
``python scripts/update_data.py ...`` keeps working without installing the
package; once installed (``pip install -e .``) the ``update-regulation-data``
console command is equivalent.

The defaults are the weekly run: every country, web search on, the Message
Batches API, the stability gate on, and the default model (claude-opus-5).
The flags opt out or narrow the run; ``--help`` lists them all.

Usage:
  python scripts/update_data.py [--countries "Germany,France"] [--no-force]
                                [--dry-run] [--model MODEL] [--no-search]
                                [--no-batch] [--max-runtime-minutes N]
                                [--mirror | --no-mirror]
                                [--grounded] [--evidence-file PATH]
                                [--no-gate [--break-reason TEXT]]
                                [--digest | --no-digest] [--verbose]

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
