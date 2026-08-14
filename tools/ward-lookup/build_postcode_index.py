#!/usr/bin/env python3
"""Build the postcode -> borough/ward lookup table shipped to the public request page.

Why this exists
---------------
The public device request page needs to answer one question: "given a postcode, which
borough and ward is it in, and do we cover it?". It used to answer that in the browser by
downloading a 3.3 MB GeoJSON of ward boundaries and running point-in-polygon over every
feature, after geocoding the postcode through a Cloudflare worker. That is three moving
parts (a geocoder, a boundary file, a geometry library) to look up a value that the Office
for National Statistics already publishes as a flat table.

So we precompute instead. ONS publishes the ONS Postcode Directory (ONSPD): one row per UK
postcode, already carrying the local authority district code and the electoral ward code it
falls in. Filtering that to our three boroughs gives us the whole answer as a hash lookup.
No geocoding, no geometry, no third-party call from the browser at runtime.

This script is run BY HAND when the data needs refreshing, not in CI. It writes a generated
artefact which is committed to the repo, exactly as the GeoJSON it replaces was committed.

Usage
-----
    python tools/ward-lookup/build_postcode_index.py

    # write somewhere else, e.g. to diff against the committed artefact
    python tools/ward-lookup/build_postcode_index.py --out /tmp/index.json

To move to a different ONSPD edition, edit ONSPD_SERVICE / WARD_SERVICE below — the two have to
stay vintage-aligned, so they are deliberately not command-line options.

Run `--help` for the rest. Requires only the standard library.

Refreshing the data
-------------------
ONSPD refreshes quarterly (February / May / August / November). To pick up a new edition,
change ONSPD_SERVICE and WARD_SERVICE below to the new vintage and re-run. Nothing else in
the codebase names a vintage: the artefact carries its own vintage in its filename and in
its `meta` block, and the app reads whichever file the manifest points at.

The one thing to watch is that ONS renames its columns with each boundary vintage — the
borough column has been `LAD23NM`, then `LAD24NM`, now `LAD25CD`/`LAD25NM`, and the ward
column likewise `WD24NM` -> `WD25NM`. That drift broke the old lookup silently. This script
fails loudly instead: it asks the service for its field list up front and aborts if the
columns it expects are missing, rather than emitting an artefact full of nulls.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# --- What we build against ---------------------------------------------------------------
#
# Both services are hosted by ONS on the Open Geography Portal. They must be VINTAGE-ALIGNED:
# the ward codes ONSPD stores (`wd25cd`) have to exist in the ward name table we join against,
# or every postcode resolves to an unknown ward. ONSPD "May 2026" carries December 2025 ward
# codes, hence WD_DEC_2025 below. If you bump one, check the other — verify_alignment() will
# catch a mismatch, but it is cheaper to get right than to debug.

ARCGIS_ROOT = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/ArcGIS/rest/services"

ONSPD_SERVICE = "ONS_Postcode_Directory_(May_2026)_for_the_United_Kingdom_(Hosted_Table)"
ONSPD_EDITION = "May 2026"

WARD_SERVICE = "WD_DEC_2025_UK_BFC"
WARD_VINTAGE = "December 2025"

# Column names for this vintage. Kept as constants so the rename drift described above is a
# one-line change in one place rather than a search across string literals.
PC_FIELD = "pcds"  # postcode, single-spaced variable length form
PC_TERMINATED = "doterm"  # date of termination; NULL means the postcode is live
PC_LAD = "lad25cd"
PC_WARD = "wd25cd"

WARD_CODE = "WD25CD"
WARD_NAME = "WD25NM"
WARD_LAD = "LAD25CD"
WARD_LAD_NAME = "LAD25NM"

# The boroughs we take referrals from. These mirror src/app/shared/utils/boroughs.ts, which is
# the app-side source of truth; we filter on the ONS codes rather than the names because names
# get re-spelled between vintages and codes do not.
BOROUGHS = [
    ("E09000022", "Lambeth"),
    ("E09000028", "Southwark"),
    ("E09000030", "Tower Hamlets"),
]

# ONSPD is Open Government Licence, but it is derived from Royal Mail and Ordnance Survey data
# and the licence requires these acknowledgements to be reproduced wherever the derived data is
# published. We publish this table on a public page, so the attribution travels inside the
# artefact itself — that way it cannot be separated from the data by a later refactor.
ATTRIBUTION = [
    "Contains OS data (c) Crown copyright and database right {year}",
    "Contains Royal Mail data (c) Royal Mail copyright and database right {year}",
    "Source: Office for National Statistics licensed under the Open Government Licence v.3.0",
]

DEFAULT_OUT_DIR = Path("src/assets/ward-lookup")

PAGE_SIZE = 1000  # the services cap maxRecordCount at 1000 (ONSPD) / 2000 (wards)

# A postcode is an outward code (2-4 chars) followed by an inward code that is ALWAYS exactly
# three characters: digit, letter, letter. The packing format below relies on that being
# invariant, so we assert it rather than assume it.
INWARD_RE = re.compile(r"^[0-9][A-Z]{2}$")
POSTCODE_RE = re.compile(r"^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$")


class BuildError(RuntimeError):
    """Anything that should stop the build rather than produce a half-right artefact."""


# --- ArcGIS plumbing ---------------------------------------------------------------------


def _get(url: str, params: dict[str, str], *, attempts: int = 4) -> dict:
    """GET a JSON payload, retrying transient failures.

    The ONS endpoints intermittently return a bare HTTP 400 with an empty message under load —
    we saw it on a query that succeeded unchanged seconds later. Retrying with backoff is the
    difference between a 20-request build that works and one that fails a third of the time.
    """
    query = urllib.parse.urlencode(params)
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(f"{url}?{query}", timeout=120) as resp:
                payload = json.load(resp)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
        else:
            # ArcGIS reports failure in a 200 body as often as in the status line.
            if "error" in payload:
                last = BuildError(f"service error: {payload['error']}")
            else:
                return payload
        if attempt < attempts - 1:
            time.sleep(2**attempt)
    raise BuildError(f"{url} failed after {attempts} attempts: {last}")


def _layer(service: str) -> str:
    return f"{ARCGIS_ROOT}/{urllib.parse.quote(service)}/FeatureServer/0"


_describe_cache: dict[str, dict] = {}


def describe(service: str) -> dict:
    if service not in _describe_cache:
        _describe_cache[service] = _get(_layer(service), {"f": "json"})
    return _describe_cache[service]


def object_id_field(service: str) -> str:
    """The layer's OID column, which is NOT consistently named across ONS services.

    The ONSPD hosted table calls it `ObjectId`; the ward boundary layer calls it `FID`. Paging
    needs a stable sort key, so ask the layer rather than assuming. The declared `objectIdField`
    is the fast path; falling back to the field typed `esriFieldTypeOID` covers layers that omit
    the declaration.
    """
    meta = describe(service)
    declared = meta.get("objectIdField") or meta.get("objectIdFieldName")
    if declared:
        return declared
    for field in meta.get("fields", []):
        if field.get("type") == "esriFieldTypeOID":
            return field["name"]
    raise BuildError(f"{service} declares no object-id field; cannot page it safely")


def require_fields(service: str, expected: list[str]) -> None:
    """Abort if the service does not expose the columns this script reads.

    This is the guard against ONS's vintage renames. Without it a rename produces an artefact
    where every ward is null, which looks like working software until someone types a postcode.
    """
    present = {f["name"] for f in describe(service).get("fields", [])}
    missing = [f for f in expected if f not in present]
    if missing:
        raise BuildError(
            f"{service} is missing expected column(s) {missing}.\n"
            f"  It exposes: {sorted(present)}\n"
            f"  ONS renames columns with each boundary vintage (LAD24NM -> LAD25CD, and so on).\n"
            f"  Update the *_FIELD / WARD_* constants at the top of this script to match."
        )


def count(service: str, where: str) -> int:
    payload = _get(
        f"{_layer(service)}/query",
        {"where": where, "returnCountOnly": "true", "f": "json"},
    )
    return int(payload["count"])


def fetch_all(service: str, where: str, fields: list[str], *, expected: int | None = None) -> list[dict]:
    """Page through every matching row.

    Ordered by ObjectId because offset paging over an unordered result set is not stable — the
    service is free to return rows in a different order per request, which silently duplicates
    some rows and drops others.
    """
    rows: list[dict] = []
    offset = 0
    oid = object_id_field(service)
    while True:
        payload = _get(
            f"{_layer(service)}/query",
            {
                "where": where,
                "outFields": ",".join(fields),
                "returnGeometry": "false",
                "orderByFields": f"{oid} ASC",
                "resultOffset": str(offset),
                "resultRecordCount": str(PAGE_SIZE),
                "f": "json",
            },
        )
        batch = [f["attributes"] for f in payload.get("features", [])]
        rows.extend(batch)
        if expected:
            pct = min(100, round(100 * len(rows) / expected))
            print(f"\r  {len(rows):,} / {expected:,} rows ({pct}%)", end="", file=sys.stderr)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    if expected:
        print(file=sys.stderr)
    return rows


# --- Shaping the artefact ------------------------------------------------------------------


def normalise(pcd: str) -> str:
    return re.sub(r"\s+", "", (pcd or "").upper())


def split_postcode(pc: str) -> tuple[str, str]:
    """Split a space-stripped postcode into (outward, inward). Inward is always 3 chars."""
    return pc[:-3], pc[-3:]


def build_index(postcode_rows: list[dict], ward_rows: list[dict]) -> dict:
    """Turn the two row sets into the packed structure the browser reads.

    Shape:

        wards:     [{"code": "E05014085", "name": "Brixton Acre Lane", "borough": 0}, ...]
        postcodes: {"SW2": {"0": "1AA1AB5ZZ", "3": "9QP"}}
                    ^outward  ^ward index    ^inward codes concatenated, 3 chars each

    Inward codes are packed into one string per (outward, ward) pair with no separator, which
    is safe precisely because every inward code is exactly three characters. That is the whole
    trick behind the size: ~19k postcodes cost ~58 KB of payload instead of ~19k JSON keys.
    A lookup is then: find the outward, walk its few ward buckets, and check whether the
    inward appears at a 3-aligned offset.
    """
    boroughs = [{"code": code, "name": name} for code, name in BOROUGHS]
    borough_index = {code: i for i, (code, _) in enumerate(BOROUGHS)}

    wards: list[dict] = []
    ward_index: dict[str, int] = {}
    for row in sorted(ward_rows, key=lambda r: (r[WARD_LAD], r[WARD_NAME])):
        code = row[WARD_CODE]
        if code in ward_index:
            continue
        ward_index[code] = len(wards)
        wards.append(
            {"code": code, "name": row[WARD_NAME], "borough": borough_index[row[WARD_LAD]]}
        )

    # outward -> ward index -> list of inward codes
    packed: dict[str, dict[int, list[str]]] = {}
    skipped: list[str] = []
    unknown_wards: set[str] = set()

    for row in postcode_rows:
        pc = normalise(row.get(PC_FIELD))
        if not POSTCODE_RE.match(pc):
            skipped.append(pc)
            continue
        ward_code = row.get(PC_WARD)
        if ward_code not in ward_index:
            # A postcode whose ward is not in the boundary set. With aligned vintages this
            # should be empty; if it is not, the two sources have drifted apart.
            unknown_wards.add(ward_code or "<null>")
            continue
        outward, inward = split_postcode(pc)
        if not INWARD_RE.match(inward):
            skipped.append(pc)
            continue
        packed.setdefault(outward, {}).setdefault(ward_index[ward_code], []).append(inward)

    postcodes = {
        outward: {
            str(widx): "".join(sorted(set(inwards)))
            for widx, inwards in sorted(buckets.items())
        }
        for outward, buckets in sorted(packed.items())
    }

    total = sum(
        len(chunk) // 3 for buckets in postcodes.values() for chunk in buckets.values()
    )
    year = datetime.now(timezone.utc).year

    return {
        "meta": {
            "onspdEdition": ONSPD_EDITION,
            "wardVintage": WARD_VINTAGE,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "generator": "tools/ward-lookup/build_postcode_index.py",
            "generatorVersion": 1,
            "source": {"onspd": ONSPD_SERVICE, "wards": WARD_SERVICE},
            "activeOnly": True,
            "postcodeCount": total,
            "wardCount": len(wards),
            "attribution": [line.format(year=year) for line in ATTRIBUTION],
        },
        "boroughs": boroughs,
        "wards": wards,
        "postcodes": postcodes,
    }, skipped, unknown_wards


def verify(index: dict, expected_postcodes: int, skipped: int = 0) -> None:
    """Sanity-check the artefact before it is written.

    These are cheap assertions that would each have caught a real class of silent corruption:
    a paging bug that drops rows, a vintage mismatch that empties a borough, a packing bug that
    misaligns the inward strings.
    """
    meta = index["meta"]
    # Every row the service reported must be accounted for: packed, or deliberately skipped as
    # malformed. Comparing against the raw count alone would make any skipped row look like a
    # paging bug — and, before this accounted for them, made the "skipped N malformed" note
    # unreachable because the build died immediately after printing it.
    if meta["postcodeCount"] + skipped != expected_postcodes:
        raise BuildError(
            f"packed {meta['postcodeCount']:,} postcodes and skipped {skipped:,}, but the "
            f"service reported {expected_postcodes:,} — paging or de-duplication is wrong"
        )

    # A handful of malformed rows is survivable; a flood means the postcode column has moved or
    # changed format, which would quietly produce a table full of holes.
    if skipped and skipped > max(10, expected_postcodes // 1000):
        raise BuildError(
            f"{skipped:,} of {expected_postcodes:,} rows were malformed — that is too many to "
            f"be data noise. Check that {PC_FIELD!r} is still the postcode column."
        )

    for buckets in index["postcodes"].values():
        for chunk in buckets.values():
            if len(chunk) % 3:
                raise BuildError(f"inward-code chunk {chunk!r} is not a multiple of 3")

    per_borough = [0] * len(index["boroughs"])
    ward_borough = [w["borough"] for w in index["wards"]]
    for buckets in index["postcodes"].values():
        for widx, chunk in buckets.items():
            per_borough[ward_borough[int(widx)]] += len(chunk) // 3
    for borough, n in zip(index["boroughs"], per_borough):
        if n == 0:
            raise BuildError(f"{borough['name']} resolved zero postcodes — check the vintages")
        print(f"  {borough['name']:<15} {n:>7,} postcodes", file=sys.stderr)


# --- Entry point ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build the postcode -> borough/ward lookup table for the public request page.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--out",
        type=Path,
        help=f"output file (default: {DEFAULT_OUT_DIR}/postcode-index.<vintage>.json)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"directory for the default filename (default: {DEFAULT_OUT_DIR})",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=None,
        help="pretty-print the JSON (default: minified, which is what we ship)",
    )
    args = parser.parse_args(argv)

    slug = ONSPD_EDITION.lower().replace(" ", "-")
    out = args.out or args.out_dir / f"postcode-index.{slug}.json"

    where_pc = (
        "lad25cd IN ({}) AND doterm IS NULL".format(
            ", ".join(f"'{code}'" for code, _ in BOROUGHS)
        )
    ).replace("lad25cd", PC_LAD).replace("doterm", PC_TERMINATED)
    where_wd = "{} IN ({})".format(
        WARD_LAD, ", ".join(f"'{code}'" for code, _ in BOROUGHS)
    )

    try:
        print(f"ONSPD  : {ONSPD_SERVICE}", file=sys.stderr)
        print(f"Wards  : {WARD_SERVICE}", file=sys.stderr)
        require_fields(ONSPD_SERVICE, [PC_FIELD, PC_TERMINATED, PC_LAD, PC_WARD])
        require_fields(WARD_SERVICE, [WARD_CODE, WARD_NAME, WARD_LAD, WARD_LAD_NAME])

        print("Fetching ward names...", file=sys.stderr)
        ward_rows = fetch_all(
            WARD_SERVICE, where_wd, [WARD_CODE, WARD_NAME, WARD_LAD, WARD_LAD_NAME]
        )
        print(f"  {len(ward_rows)} wards", file=sys.stderr)

        expected = count(ONSPD_SERVICE, where_pc)
        print(f"Fetching {expected:,} active postcodes...", file=sys.stderr)
        pc_rows = fetch_all(
            ONSPD_SERVICE, where_pc, [PC_FIELD, PC_LAD, PC_WARD], expected=expected
        )

        index, skipped, unknown = build_index(pc_rows, ward_rows)

        if skipped:
            print(
                f"  note: skipped {len(skipped)} malformed postcode(s), e.g. {skipped[:3]}",
                file=sys.stderr,
            )
        if unknown:
            raise BuildError(
                f"{len(unknown)} ward code(s) in ONSPD are absent from {WARD_SERVICE}, "
                f"e.g. {sorted(unknown)[:5]}. The ONSPD edition and ward vintage have drifted "
                f"apart — align ONSPD_SERVICE and WARD_SERVICE."
            )

        verify(index, expected, len(skipped))

        out.parent.mkdir(parents=True, exist_ok=True)
        separators = None if args.indent else (",", ":")
        out.write_text(
            json.dumps(index, indent=args.indent, separators=separators, ensure_ascii=False),
            encoding="utf-8",
        )
        size = out.stat().st_size
        print(
            f"\nWrote {out} ({size / 1024:.0f} KB raw, "
            f"{index['meta']['postcodeCount']:,} postcodes, {index['meta']['wardCount']} wards)",
            file=sys.stderr,
        )
    except BuildError as exc:
        print(f"\nBUILD FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
