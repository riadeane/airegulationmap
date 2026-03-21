#!/usr/bin/env python3
"""
AI Regulation Map - Data Update Script

Uses the Claude API to research and update AI regulation data for each country.
Updates scores.csv, regulation_data.csv, and history.json.

Usage:
  python scripts/update_data.py [--countries "Germany,France"] [--force] [--dry-run] [--model MODEL] [--search]

Requirements:
  pip install anthropic

Environment:
  ANTHROPIC_API_KEY - required
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from regulation_pipeline.cli import main

if __name__ == "__main__":
    main()
