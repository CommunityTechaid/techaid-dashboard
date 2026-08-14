# Ward lookup — postcode → borough + ward

Generates the lookup table the public device request page uses to answer "which borough and
ward is this postcode in, and do we cover it?".

## What this replaced, and why

The old lookup lived in the `communitytechaid.github.io` repo as `ward_lookup.html`, embedded
in the request page through an iframe. To resolve one postcode it:

1. geocoded it through the `cta-maps-proxy` Cloudflare Worker (Google Geocoding),
2. downloaded `LambethSouthwarkandAdjoiningAreas_Wards_highdef_Dec2024.geojson` — **3.3 MB**,
3. ran `turf.booleanPointInPolygon` over every feature until one matched.

Three moving parts, a third-party origin, a paid geocoding call per lookup, and a `frame-src`
CSP exception — all to look up a value the Office for National Statistics already publishes as
a flat table. It also broke outright for at least one referring organisation whose network
blocks `github.io`, which meant they could not start a request at all.

The ONS Postcode Directory (ONSPD) has one row per UK postcode already carrying its local
authority district and electoral ward. Filtering that to our three boroughs *is* the answer.
So we precompute once, at build time, and ship a small same-origin JSON file:

|                      | Old (GeoJSON + turf)   | New (precomputed table) |
| -------------------- | ---------------------- | ----------------------- |
| Downloaded           | 3.3 MB                 | 63 KB (~22 KB gzipped)  |
| Geocoding call       | one per lookup         | none                    |
| Third-party origins  | github.io, maps proxy  | none                    |
| Lookup cost          | point-in-polygon scan  | hash + short string scan|
| Tower Hamlets        | not in the data        | included                |

## Regenerating the table

Run by hand — **not in CI**. Requires Python 3.9+ and nothing else (standard library only).

```bash
python tools/ward-lookup/build_postcode_index.py
```

That writes `src/assets/ward-lookup/postcode-index.<edition>.json` and prints a per-borough
row count. Then:

1. Update `POSTCODE_INDEX_ASSET` in `src/app/shared/services/ward-lookup.service.ts` to the new
   filename.
2. Delete the previous artefact.
3. Commit both the generated file and the constant change.

The generated file is committed deliberately, exactly as the GeoJSON it replaces was. It is a
build input, not a build output — nothing in CI can regenerate it, and CI must not try.

Useful flags:

```bash
# write elsewhere, e.g. to diff against the committed artefact before replacing it
python tools/ward-lookup/build_postcode_index.py --out /tmp/index.json

# pretty-print for inspection (we ship minified)
python tools/ward-lookup/build_postcode_index.py --out /tmp/index.json --indent 2
```

## When to regenerate

- **ONSPD refreshes quarterly** — February, May, August, November. New postcodes (new-build
  developments especially) do not resolve until we pick up an edition containing them; until
  then those residents hit the "we couldn't find that" path and the email escape hatch.
- **Ward boundaries change**, usually at local government reorganisation.

To move to a new edition, change `ONSPD_SERVICE` / `ONSPD_EDITION` and `WARD_SERVICE` /
`WARD_VINTAGE` at the top of the script. The two **must be vintage-aligned**: ONSPD stores ward
*codes*, and the ward name table has to be the vintage those codes belong to. ONSPD "May 2026"
carries December 2025 ward codes, hence `WD_DEC_2025_UK_BFC`.

Browse editions at <https://geoportal.statistics.gov.uk>, or list them directly:

```bash
curl -s "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services?f=json" \
  | python -c "import json,sys; [print(s['name']) for s in json.load(sys.stdin)['services']]" \
  | grep -Ei 'postcode|^WD_'
```

### The column-rename trap

ONS renames its columns with every boundary vintage: the borough column has been `LAD23NM`,
then `LAD24NM`, now `LAD25CD`/`LAD25NM`; ward likewise `WD24NM` → `WD25NM`. The old
`ward_lookup.html` carried a comment warning about precisely this, because it was the kind of
change that silently produced empty results.

This script fails loudly instead. It reads each service's field list before querying and aborts
with the actual column names if the ones it expects are missing, so a rename is a clear error
message rather than an artefact full of nulls. The column names are constants at the top of the
file — that is the one place to change.

## What is in the artefact

```jsonc
{
  "meta": {
    "onspdEdition": "May 2026",
    "wardVintage": "December 2025",
    "generated": "2026-08-14T15:02:11Z",
    "postcodeCount": 19346,
    "wardCount": 68,
    "attribution": ["Contains OS data (c) Crown copyright ...", ...]
  },
  "boroughs": [{ "code": "E09000022", "name": "Lambeth" }, ...],
  "wards":    [{ "code": "E05014085", "name": "Brixton Acre Lane", "borough": 0 }, ...],
  "postcodes": {
    "SW2": { "0": "1AA1AB5ZZ", "3": "9QP" }
  }
}
```

`postcodes` is keyed by outward code; each value maps a ward index to that ward's inward codes
concatenated with no separator. Every UK inward code is exactly three characters, which is what
makes the packing safe and what keeps 19,346 postcodes down to ~58 KB of payload instead of
19,346 JSON keys. A consumer must only accept matches that begin on a three-character boundary
— `"9GE" + "9GF"` packs to `"9GE9GF"`, which contains `"E9G"` spuriously.
`WardLookupService.lookup()` handles that; don't reimplement it.

### Deliberate exclusions

- **Only the three supported boroughs.** A postcode that is not in the table produces no borough
  or ward name at all. We do not tell someone which borough they are in, because we would be
  asserting something we have no data for. See issue #178 — this is a deviation from the design
  file, which drew "SE13 6TQ — Lewisham".
- **Only live postcodes.** ONSPD flags terminated postcodes with `doterm`; the builder drops
  them. Including them would attach a possibly-stale ward to an address that may no longer sit
  in it. This roughly halves the row count.

## Attribution (required)

ONSPD is Open Government Licence, but it is derived from Royal Mail and Ordnance Survey data and
the licence requires these acknowledgements wherever the derived data is published:

> Contains OS data © Crown copyright and database right \<year\>
> Contains Royal Mail data © Royal Mail copyright and database right \<year\>
> Source: Office for National Statistics licensed under the Open Government Licence v.3.0

They are written into the artefact's `meta.attribution` by the builder, so they travel with the
data and cannot be separated from it by a later refactor. If the table is ever surfaced somewhere
that renders its own credits, source them from there. Confirm the exact wording against the
current ONSPD user guide when moving to a new edition.

## Verifying a regenerated table

The script self-checks before writing — it aborts if the packed count disagrees with the count
the service reported, if any bucket is not a multiple of three characters, or if any borough
resolves zero postcodes. Beyond that, spot-check a few known postcodes:

```bash
python - <<'PY'
import json
idx = json.load(open('src/assets/ward-lookup/postcode-index.may-2026.json', encoding='utf-8'))
def lookup(pc):
    pc = pc.upper().replace(' ', ''); out, inw = pc[:-3], pc[-3:]
    for w, chunk in idx['postcodes'].get(out, {}).items():
        if any(chunk[i:i+3] == inw for i in range(0, len(chunk), 3)):
            ward = idx['wards'][int(w)]
            return ward['name'], idx['boroughs'][ward['borough']]['name']
for pc in ['SW2 1JF', 'SE15 5TD', 'E14 8JH', 'SE13 6TQ', 'M1 1AE']:
    print(f'{pc:<10} {lookup(pc)}')
PY
```

Expected: Lambeth, Southwark and Tower Hamlets results for the first three; `None` for the last
two (Lewisham and Manchester are out of area). The Playwright spec
`e2e/tests/streamlined-ward-lookup.spec.ts` pins the same postcodes end to end.
