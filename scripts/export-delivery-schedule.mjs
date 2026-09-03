#!/usr/bin/env node
/**
 * Exports booked deliveries to the CSV shape of the "TaDa Import" tab in the
 * driver's Delivery Schedule spreadsheet.
 *
 * The source of truth is `deliveryBookingsAdmin(from:, to:)` — the same query the
 * admin Delivery Slots page runs, so what lands in the CSV is exactly what staff
 * see there. Bookings carry no organisation, so a second query resolves each
 * booking's `ctaReference` to its device request and reads the referring org from
 * there; a booking whose reference matches no request still exports, just with a
 * blank Org.
 *
 * Usage:
 *   CTA_BEARER_TOKEN=<token> node scripts/export-delivery-schedule.mjs
 *   CTA_BEARER_TOKEN=<token> node scripts/export-delivery-schedule.mjs --prod --days 14 --out sched.csv
 *
 * Get a token by logging into the dashboard, then DevTools → Application →
 * Local Storage → the Auth0 access token.
 */

import { writeFileSync } from 'node:fs';

const ENDPOINTS = {
  uat: 'https://api-testing.communitytechaid.org.uk/graphql',
  prod: 'https://api.communitytechaid.org.uk/graphql',
};

function parseArgs(argv) {
  const args = { env: 'uat', days: 14, from: null, out: null, requests: true, bookings: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prod') args.env = 'prod';
    else if (a === '--uat') args.env = 'uat';
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--no-requests') args.requests = false;
    else if (a === '--no-bookings') args.bookings = false;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const BOOKINGS_QUERY = `
  query DeliveryBookingsForExport($from: String, $to: String) {
    deliveryBookingsAdmin(from: $from, to: $to) {
      id
      date
      dayLabel
      window { id name startTime endTime }
      firstName
      surname
      email
      phone
      address
      accessNotes
      ctaReference
      matchedRequestId
      matchedRequestStatus
      matchedRequestOpen
    }
  }
`;

// Bookings don't carry the referring organisation, so it comes from the device
// request the ctaReference points at.
const REQUESTS_QUERY = `
  query DeviceRequestsForExport($ids: [Long]) {
    deviceRequestConnection(page: { size: 500 }, where: { id: { _in: $ids } }) {
      content {
        id
        status
        clientRef
        collectionMethod
        referringOrganisationContact {
          fullName
          phoneNumber
          referringOrganisation { name }
        }
      }
    }
  }
`;

/**
 * Deliveries arranged by staff rather than booked through the public flow.
 * `collectionMethod: DELIVERY` is an explicit marker staff already set - verified against
 * the driver's 31 Aug tab, where this filter returned exactly the 13 requests listed there
 * and nothing else, while correctly excluding 18 COLLECTION requests in the same week.
 *
 * `collectionDate` is an Instant and the server only accepts it as a *variable* - an inline
 * "2026-09-01T00:00:00Z" literal in the query body is rejected as "not a valid 'Instant'".
 * Hence $from/$to rather than string interpolation.
 */
const DELIVERY_REQUESTS_QUERY = `
  query DeliveryRequestsForExport($from: Instant, $to: Instant) {
    deviceRequestConnection(
      page: { size: 500 }
      where: {
        AND: [
          { collectionMethod: { _eq: DELIVERY } }
          { status: { _eq: PROCESSING_COLLECTION_DELIVERY_ARRANGED } }
          { collectionDate: { _gte: $from } }
          { collectionDate: { _lte: $to } }
        ]
      }
    ) {
      content {
        id
        status
        collectionDate
        collectionContactName
        referringOrganisationContact {
          fullName
          phoneNumber
          referringOrganisation { name }
        }
      }
    }
  }
`;

async function gql(endpoint, token, query, variables) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${endpoint}\n${await res.text()}`);
  }
  // GraphQL errors come back as HTTP 200 with an `errors` array.
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return body.data;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** dd/mm/yyyy does not sort lexically, so flip it back for ordering. */
function toSortableDate(uk) {
  const [d, m, y] = String(uk).split('/');
  return y && m && d ? y + '-' + m + '-' + d : '';
}

/** The spreadsheet's Date column is UK-formatted, matching the weekly driver tabs. */
function ukDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * `collectionDate` is a UTC Instant (e.g. "2026-09-07T23:00:00Z" for midnight London/BST) -
 * truncating the raw string reads the UTC calendar day, which is a day early for evening UTC
 * timestamps. Format the instant in the Europe/London timezone instead, so the export shows
 * the date the delivery actually falls on in London. Same dd/mm/yyyy shape as ukDate().
 */
function londonDate(instant) {
  if (!instant) return '';
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}

/**
 * The booking's `address` is one free-text blob (building detail, address lines and postcode
 * joined by newlines by the public form). The driver's sheet keeps a single Address cell too,
 * so newlines are preserved - Excel and Sheets both render them inside the cell as long as the
 * field is quoted, which csvCell() always does for multiline text. Access notes are NOT folded
 * in here; they have their own column.
 */
function composeAddress(booking) {
  return (booking.address ?? '').trim();
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Shown in the Address column for staff-arranged deliveries, where TaDa holds no delivery
// address at all (see rowFromRequest below).
const ADDRESS_NEEDED = '[N/A]';

/**
 * Builds a driver-sheet row from a staff-arranged delivery request.
 *
 * The Address column is deliberately NOT filled from the request. A request's only address
 * is `referringOrganisationContact.address`, which is the REFERRING ORGANISATION'S OFFICE,
 * not where the devices go - checked against the driver's 31 Aug tab it was wrong for 4 of
 * the 6 rows sampled (request 6977 holds "336 Brixton Rd" but the delivery went to
 * "119 Lockwood House, Kennington Oval"). Sending a driver to a charity's head office
 * instead of someone's flat is worse than an obviously empty cell, so it is marked N/A and
 * filled in by hand.
 *
 * Name and phone are the REFERRER's for the same reason - the recipient's own details only
 * exist once they book through the public flow.
 */
function rowFromRequest(req) {
  const contact = req.referringOrganisationContact;
  // Contact names in prod contain stray tabs and double spaces (e.g. "Samuel\tEnchill"),
  // which render as a mangled cell — collapse any run of whitespace to a single space.
  const name = (req.collectionContactName || contact?.fullName || '').replace(/\s+/g, ' ').trim();
  return [
    londonDate(req.collectionDate),
    req.id ?? '',
    'Distribution',
    name,
    (contact?.referringOrganisation?.name ?? '').trim(),
    ADDRESS_NEEDED,
    (contact?.phoneNumber ?? '').trim(),
    '',
    '',
    // A staff-arranged request has no access notes - only a booking captures them.
    '',
  ];
}

// Column order and header text must match the "TaDa Import" tab exactly.
// Access Notes sits in column J, leaving H and I empty, so a block of rows pasted into one of
// the weekly driver tabs lines up: there H is "Delivered (Y or N)", I is the follow-up call
// permission and J is "Notes". The two blanks are load-bearing — don't tidy them away.
const HEADERS = ['Date', 'Req No.', 'Distributions Only', 'Name', 'Org', 'Address', 'Telephone no.', '', '', 'Access Notes'];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: CTA_BEARER_TOKEN=<token> node scripts/export-delivery-schedule.mjs [--prod|--uat] [--days N] [--from YYYY-MM-DD] [--out file.csv]');
    return;
  }

  const token = process.env.CTA_BEARER_TOKEN;
  if (!token) {
    throw new Error('CTA_BEARER_TOKEN is not set. Copy the Auth0 access token from the dashboard (DevTools → Application → Local Storage).');
  }

  const endpoint = ENDPOINTS[args.env];
  const from = args.from ?? isoDate(new Date());
  const to = isoDate(new Date(new Date(from).getTime() + args.days * 86400000));

  console.error(`Exporting ${args.env} deliveries ${from} → ${to} …`);

  const { deliveryBookingsAdmin: bookings } = await gql(endpoint, token, BOOKINGS_QUERY, { from, to });
  console.error(`  ${bookings.length} booking(s)`);

  // One batched lookup rather than a query per booking.
  const ids = [...new Set(bookings.map((b) => b.ctaReference).filter((r) => r !== null && r !== undefined))];
  const orgByRequestId = new Map();
  if (ids.length) {
    const { deviceRequestConnection } = await gql(endpoint, token, REQUESTS_QUERY, { ids });
    for (const req of deviceRequestConnection?.content ?? []) {
      orgByRequestId.set(String(req.id), req);
    }
    console.error(`  ${orgByRequestId.size} of ${ids.length} reference(s) matched a device request`);
  }

  // Staff-arranged deliveries - which is everything, until the public booking flow is in use.
  let requestRows = [];
  if (args.requests) {
    const { deviceRequestConnection } = await gql(endpoint, token, DELIVERY_REQUESTS_QUERY, {
      from: from + "T00:00:00Z",
      to: to + "T23:59:59Z",
    });
    const requests = deviceRequestConnection?.content ?? [];
    // A request that already has a booking is described better by the booking (that carries
    // the recipient's own name, phone and address), so the booking wins and the request drops.
    const bookedIds = new Set(bookings.map((b) => String(b.ctaReference)));
    const unbooked = requests.filter((r) => !bookedIds.has(String(r.id)));
    console.error(`  ${requests.length} staff-arranged delivery request(s), ${unbooked.length} without a booking`);
    requestRows = unbooked.map(rowFromRequest);
  }

  const bookingRows = bookings
    .slice()
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.window?.startTime ?? '').localeCompare(b.window?.startTime ?? ''))
    .map((b) => {
      const req = orgByRequestId.get(String(b.ctaReference));
      return [
        ukDate(b.date),
        b.ctaReference ?? '',
        // Every row here is a booked delivery of devices to a beneficiary, which is
        // what the driver's sheet calls a Distribution.
        'Distribution',
        [b.firstName, b.surname].filter(Boolean).join(' ').trim(),
        req?.referringOrganisationContact?.referringOrganisation?.name ?? '',
        composeAddress(b),
        b.phone ?? '',
        '',
        '',
        (b.accessNotes ?? '').trim(),
      ];
    });

  // One combined, date-ordered sheet - the driver doesn't care which system a job came from.
  const rows = [...(args.bookings ? bookingRows : []), ...requestRows].sort((a, b) =>
    toSortableDate(a[0]).localeCompare(toSortableDate(b[0])),
  );

  const csv = [HEADERS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

  if (args.out) {
    writeFileSync(args.out, '﻿' + csv, 'utf8'); // BOM so Excel reads UTF-8
    console.error(`Wrote ${rows.length} row(s) to ${args.out}`);
  } else {
    process.stdout.write(csv);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
