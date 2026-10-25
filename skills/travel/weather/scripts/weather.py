#!/usr/bin/env python3
"""Current weather and daily forecast for a city, via Open-Meteo (free, no API key).

Usage:
    python weather.py "Chicago, USA"
    python weather.py "Chennai" --days 7
    python weather.py "Pondicherry" --start 2026-11-07 --end 2026-11-08
    python weather.py "Chicago" --units imperial --json
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes used by Open-Meteo.
WMO_CODES = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "rime fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    56: "freezing drizzle", 57: "heavy freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain",
    66: "freezing rain", 67: "heavy freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
    80: "light showers", 81: "showers", 82: "violent showers",
    85: "snow showers", 86: "heavy snow showers",
    95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
}

# Old or common names the geocoder only knows by their official name.
CITY_ALIASES = {"pondicherry": "Puducherry", "pondy": "Puducherry", "madras": "Chennai",
                "bombay": "Mumbai", "calcutta": "Kolkata", "trivandrum": "Thiruvananthapuram"}

COUNTRY_ALIASES = {"usa": "US", "us": "US", "united states": "US", "uk": "GB", "england": "GB"}


def get_json(url, params):
    with urllib.request.urlopen(f"{url}?{urllib.parse.urlencode(params)}", timeout=15) as resp:
        return json.load(resp)


def geocode(query):
    """Resolve "City", "City, Country" or "Country City" to the best matching town."""
    for name, hints in candidate_splits(query):
        name = CITY_ALIASES.get(name.lower(), name)
        results = get_json(GEOCODE_URL, {"name": name, "count": 10, "language": "en"}).get("results", [])
        if hints:
            results = [r for r in results if all(matches(r, h) for h in hints)]
        if results:
            # Prefer populated places (feature code PPL*) over airports, parks, etc.
            return max(results, key=lambda r: (r.get("feature_code", "").startswith("PPL"), r.get("population") or 0))
    sys.exit(f"Error: could not find a place called '{query}'")


def candidate_splits(query):
    """Yield (city name, [country/region hints]) guesses, most likely first."""
    if "," in query:
        parts = [p.strip() for p in query.split(",") if p.strip()]
        for i, name in enumerate(parts):
            yield name, [p.lower() for j, p in enumerate(parts) if j != i]
        return
    words = query.split()
    if not words:
        sys.exit("Error: empty location")
    yield " ".join(words), []
    # "usa chicago" / "chicago usa": peel words off either end as hints.
    for k in range(1, len(words)):
        yield " ".join(words[k:]), [" ".join(words[:k]).lower()]
        yield " ".join(words[:-k]), [" ".join(words[-k:]).lower()]


def matches(place, hint):
    code = COUNTRY_ALIASES.get(hint, hint.upper())
    fields = [place.get("country", ""), place.get("admin1", ""), place.get("country_code", "")]
    return place.get("country_code") == code or any(hint == f.lower() for f in fields)


def forecast(place, days, start, end, units):
    params = {
        "latitude": place["latitude"],
        "longitude": place["longitude"],
        "timezone": "auto",
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    }
    if start:
        params.update(start_date=start, end_date=end or start)
    else:
        params["forecast_days"] = days
    if units == "imperial":
        params.update(temperature_unit="fahrenheit", wind_speed_unit="mph", precipitation_unit="inch")
    return get_json(FORECAST_URL, params)


def summarize(place, data):
    cur, daily = data["current"], data["daily"]
    u = data["current_units"]
    du = data["daily_units"]
    return {
        "location": ", ".join(p for p in (place["name"], place.get("admin1"), place.get("country")) if p),
        "timezone": data["timezone"],
        "current": {
            "time": cur["time"],
            "temperature": f"{cur['temperature_2m']}{u['temperature_2m']}",
            "feels_like": f"{cur['apparent_temperature']}{u['apparent_temperature']}",
            "humidity": f"{cur['relative_humidity_2m']}%",
            "wind": f"{cur['wind_speed_10m']} {u['wind_speed_10m']}",
            "conditions": WMO_CODES.get(cur["weather_code"], "unknown"),
        },
        "daily": [
            {
                "date": daily["time"][i],
                "conditions": WMO_CODES.get(daily["weather_code"][i], "unknown"),
                "high": f"{daily['temperature_2m_max'][i]}{du['temperature_2m_max']}",
                "low": f"{daily['temperature_2m_min'][i]}{du['temperature_2m_min']}",
                "rain_chance": f"{daily['precipitation_probability_max'][i]}%",
                "rain_total": f"{daily['precipitation_sum'][i]} {du['precipitation_sum']}",
            }
            for i in range(len(daily["time"]))
        ],
    }


def print_text(report):
    c = report["current"]
    print(f"{report['location']} ({report['timezone']}), as of {c['time']}")
    print(f"Now: {c['temperature']} (feels like {c['feels_like']}), {c['conditions']}, "
          f"humidity {c['humidity']}, wind {c['wind']}")
    print("Forecast:")
    for d in report["daily"]:
        print(f"  {d['date']}: {d['conditions']}, {d['low']} to {d['high']}, "
              f"rain {d['rain_chance']} ({d['rain_total']})")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("location", help='City, optionally with country or state: "Chicago, USA"')
    parser.add_argument("--days", type=int, default=3, help="Forecast days from today, 1-16 (default 3)")
    parser.add_argument("--start", help="Trip start date YYYY-MM-DD (within the next 16 days)")
    parser.add_argument("--end", help="Trip end date YYYY-MM-DD (defaults to --start)")
    parser.add_argument("--units", choices=["metric", "imperial"], default="metric")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # "°" breaks on Windows consoles otherwise

    place = geocode(args.location)
    try:
        report = summarize(place, forecast(place, args.days, args.start, args.end, args.units))
    except urllib.error.HTTPError as e:
        sys.exit(f"Error: Open-Meteo returned {e.code}: {e.read().decode(errors='replace')}")

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_text(report)


if __name__ == "__main__":
    main()
