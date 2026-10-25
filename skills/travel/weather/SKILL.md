---
name: weather
description: "Use for any weather question: current temperature, conditions, or a forecast for a city or trip dates."
version: 1.0.0
author: Sloth Trip Watcher
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Weather, Forecast, Travel, Open-Meteo]
    related_skills: []
---

# Weather

Answer weather questions with live data from Open-Meteo (free, no API key).
Never browse a weather website and never answer from memory: run the script.

## Run it

```bash
python3 scripts/weather.py "Chicago, USA"
```

| Ask | Command |
|-----|---------|
| Weather now / next few days | `python3 scripts/weather.py "<city>[, <country or state>]"` |
| Longer forecast (max 16 days) | add `--days 7` |
| Specific trip dates | add `--start YYYY-MM-DD --end YYYY-MM-DD` |
| Fahrenheit / mph | add `--units imperial` (default for US cities when the user doesn't say) |
| Structured output for further reasoning | add `--json` |

Add the country or state whenever the city name is ambiguous
("Paris, France" vs "Paris, Texas"; "Portland, Oregon").

## Answering

- Lead with the number the user asked for: "Chicago is 12°C (feels like 9°C), light rain."
- Name the resolved location the script printed, so a wrong match is visible.
- For trip planning, say plainly whether the weather suits the plan: rain chance
  above 50% or heavy rain/thunderstorm on a day means suggest indoor options or other dates.
- Dates beyond 16 days out have no forecast: say so instead of guessing.

## Failure handling

- "could not find a place": retry once with a country or state added, then ask the user.
- Resolved to an airport, park or mountain instead of the town: retry with the
  city's official name (e.g. "Puducherry" for "Pondicherry").
- Network/HTTP error: report it; do not substitute a guessed temperature.
