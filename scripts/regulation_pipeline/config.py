"""Configuration constants for the regulation data pipeline."""

SCORES_CSV = "public/scores.csv"
REGULATION_CSV = "public/regulation_data.csv"
HISTORY_JSON = "public/history.json"
COUNTRY_NAMES_JSON = "public/data/country_names.json"

SCORES_FIELDS = [
    "Country", "Regulation Status", "Policy Lever", "Governance Type",
    "Actor Involvement", "Average Score", "Enforcement Level",
    "Last Updated", "Data Version"
]

REGULATION_FIELDS = [
    "Country", "Regulation Status", "Policy Lever", "Governance Type",
    "Actor Involvement", "Enforcement Level", "Specific Laws",
    "Sources", "Last Updated", "Confidence"
]

STALENESS_DAYS = 90

PRIORITY_COUNTRIES = {
    "United States of America", "United Kingdom", "China", "European Union",
    "Germany", "France", "Brazil", "India", "Japan", "Canada", "Australia",
    "Singapore", "South Korea", "United Arab Emirates", "Saudi Arabia", "South Africa",
    "Kenya", "Nigeria", "Indonesia", "Mexico", "Chile", "Argentina"
}
