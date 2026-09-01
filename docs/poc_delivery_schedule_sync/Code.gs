/**
 * TaDa → Delivery Schedule sync
 * -----------------------------
 * Populates the "TaDa Import" tab in place from the CommunityTechAid API.
 *
 * SETUP — on the "TaDa Import" tab:
 *   M2  a live bearer token (with or without the "Bearer " prefix)
 *   M3  "Production" or "UAT" — picks api. vs api-testing.
 *
 *   1. Extensions → Apps Script, paste this file in, Save.
 *   2. Reload the spreadsheet. A "TaDa" menu appears.
 *   3. Fill in M2 and M3.
 *   4. Run TaDa → Refresh TaDa Import once and accept the authorisation prompt.
 *
 *   The token and the environment must agree — a UAT token is rejected by production and
 *   vice versa, which surfaces as the HTTP 401 message in graphql_() below.
 *
 * THE CLICKABLE LINK IN L1
 *   Insert → Drawing, add a text box reading "Click here to refresh" styled as a link
 *   (blue, underlined), Save and Close, drag it over cell L1, then open its ⋮ menu →
 *   "Assign script" and enter:  refreshTaDaImport
 *
 *   It has to be a Drawing rather than the onSelectionChange trigger in the test stub.
 *   onSelectionChange is a *simple* trigger, and Google runs simple triggers in a
 *   restricted context that cannot call any service needing authorisation — UrlFetchApp
 *   included. The stub works because it only writes literal rows; the moment it fetches,
 *   it dies with "You do not have permission to call UrlFetchApp.fetch". A Drawing with
 *   an assigned script runs fully authorised, which is exactly how the bulk-insert sheet's
 *   "Insert Single Device" button already works. onSelectionChange is still wired up
 *   below, but only to point at the link — it cannot do the work itself.
 *
 * The token is read from a cell, matching the bulk-insert sheet's "Login first" tab.
 * Anyone who can open the spreadsheet can read that token and act as you until it
 * expires (~2h), so treat sharing on this sheet accordingly.
 */

var ENDPOINTS = {
  PRODUCTION: 'https://api.communitytechaid.org.uk/graphql',
  UAT: 'https://api-testing.communitytechaid.org.uk/graphql',
};

var SHEET_NAME = 'TaDa Import';
var TOKEN_CELL = 'M2';
var ENV_CELL = 'M3'; // "Production" or "UAT"
var LINK_CELL = 'L1';
var LOOKAHEAD_DAYS = 14;

// Column order and header text must match the "TaDa Import" tab exactly.
var HEADERS = ['Date', 'Req No.', 'Distributions Only', 'Name', 'Org', 'Address', 'Telephone no.', 'Access Notes'];
var HEADER_ROW = 1;
var FIRST_DATA_ROW = 2;
var LAST_DATA_COLUMN = 8; // H — everything right of this belongs to the driver.

var BOOKINGS_QUERY =
  'query DeliveryBookingsForExport($from: String, $to: String) {' +
  '  deliveryBookingsAdmin(from: $from, to: $to) {' +
  '    id date dayLabel' +
  '    window { id name startTime endTime }' +
  '    firstName surname email phone address accessNotes' +
  '    ctaReference matchedRequestId matchedRequestStatus matchedRequestOpen' +
  '  }' +
  '}';

// Bookings don't carry the referring organisation, so it comes from the device request
// the ctaReference points at.
var REQUESTS_QUERY =
  'query DeviceRequestsForExport($ids: [Long]) {' +
  '  deviceRequestConnection(page: { size: 500 }, where: { id: { _in: $ids } }) {' +
  '    content {' +
  '      id status clientRef collectionMethod' +
  '      referringOrganisationContact {' +
  '        fullName phoneNumber' +
  '        referringOrganisation { name }' +
  '      }' +
  '    }' +
  '  }' +
  '}';

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
var DELIVERY_REQUESTS_QUERY =
  'query DeliveryRequestsForExport($from: Instant, $to: Instant) {' +
  '  deviceRequestConnection(' +
  '    page: { size: 500 }' +
  '    where: {' +
  '      AND: [' +
  '        { collectionMethod: { _eq: DELIVERY } }' +
  '        { collectionDate: { _gte: $from } }' +
  '        { collectionDate: { _lte: $to } }' +
  '      ]' +
  '    }' +
  '  ) {' +
  '    content {' +
  '      id status collectionDate collectionContactName' +
  '      referringOrganisationContact {' +
  '        fullName phoneNumber' +
  '        referringOrganisation { name }' +
  '      }' +
  '    }' +
  '  }' +
  '}';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('TaDa').addItem('Refresh TaDa Import', 'refreshTaDaImport').addToUi();
}

/**
 * Simple trigger — cannot fetch (see the note at the top of this file), so it only
 * nudges toward the link. Harmless to leave in place.
 */
function onSelectionChange(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() === SHEET_NAME && e.range.getA1Notation() === LINK_CELL) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Click the "Click here to refresh" link itself, or use the TaDa menu.',
      'Selecting the cell does nothing',
      5
    );
  }
}

/** Entry point — assign this to the Drawing sitting over L1. */
function refreshTaDaImport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('No "' + SHEET_NAME + '" tab in this spreadsheet.');
  }

  var token = getToken_(sheet);
  var endpoint = getEndpoint_(sheet);
  var from = isoDate_(new Date());
  var to = isoDate_(new Date(new Date().getTime() + LOOKAHEAD_DAYS * 86400000));

  var envLabel = endpoint === ENDPOINTS.PRODUCTION ? 'Production' : 'UAT';
  ss.toast('Fetching ' + envLabel + ' deliveries ' + from + ' → ' + to + ' …', 'TaDa Import', 3);

  var bookings = graphql_(endpoint, token, BOOKINGS_QUERY, { from: from, to: to }).deliveryBookingsAdmin || [];
  var orgByRequestId = fetchOrgs_(endpoint, token, bookings);
  var bookingRows = buildRows_(bookings, orgByRequestId);

  // Staff-arranged deliveries - which is everything, until the public booking flow is in use.
  var deliveryRequestsData = graphql_(endpoint, token, DELIVERY_REQUESTS_QUERY, {
    from: from + 'T00:00:00Z',
    to: to + 'T23:59:59Z',
  });
  var requests = (deliveryRequestsData.deviceRequestConnection && deliveryRequestsData.deviceRequestConnection.content) || [];
  // A request that already has a booking is described better by the booking (that carries
  // the recipient's own name, phone and address), so the booking wins and the request drops.
  var bookedIds = {};
  for (var i = 0; i < bookings.length; i++) {
    bookedIds[String(bookings[i].ctaReference)] = true;
  }
  var unbooked = requests.filter(function (r) {
    return !bookedIds[String(r.id)];
  });
  var requestRows = unbooked.map(rowFromRequest_);

  // One combined, date-ordered sheet - the driver doesn't care which system a job came from.
  var rows = bookingRows.concat(requestRows).sort(function (a, b) {
    return a[0] - b[0];
  });

  writeSheet_(sheet, rows);

  var unmatched = countUnmatchedOrgs_(bookingRows);
  var message =
    rows.length + ' ' + envLabel + ' deliveries loaded for ' + from + ' → ' + to +
    ' (' + bookingRows.length + ' booked, ' + requestRows.length + ' staff-arranged)';
  if (unmatched > 0) {
    // A blank Org means the booking's request ID matched no device request — worth
    // knowing about, because the driver gets a row with no referring organisation.
    message += ' (' + unmatched + ' with no matching request, so no Org)';
  }
  ss.toast(message, 'TaDa Import refreshed', 8);
}

// ---------------------------------------------------------------- auth

function getToken_(sheet) {
  var raw = sheet.getRange(TOKEN_CELL).getValue();
  var token = String(raw == null ? '' : raw).trim();
  // Tolerate a token pasted with the "Bearer " prefix still attached.
  token = token.replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new Error('Paste a live bearer token into cell ' + TOKEN_CELL + ' of the "' + SHEET_NAME + '" tab first.');
  }
  return token;
}

/**
 * Reads the target environment from M3. Deliberately refuses to guess: an unrecognised or
 * empty value stops with an error rather than silently defaulting, because defaulting the
 * wrong way either writes the driver's sheet from test data or points a UAT token at
 * production. A token is only valid for the environment it was issued by, so the two
 * cells have to agree.
 */
function getEndpoint_(sheet) {
  var raw = String(sheet.getRange(ENV_CELL).getValue() || '').trim().toUpperCase();
  if (raw === 'PRODUCTION' || raw === 'PROD') return ENDPOINTS.PRODUCTION;
  if (raw === 'UAT' || raw === 'TESTING') return ENDPOINTS.UAT;
  throw new Error('Cell ' + ENV_CELL + ' must say "Production" or "UAT" (it currently says "' + raw + '").');
}

// ---------------------------------------------------------------- data

function fetchOrgs_(endpoint, token, bookings) {
  var seen = {};
  var ids = [];
  for (var i = 0; i < bookings.length; i++) {
    var ref = bookings[i].ctaReference;
    if (ref !== null && ref !== undefined && !seen[ref]) {
      seen[ref] = true;
      ids.push(ref);
    }
  }
  var byId = {};
  if (!ids.length) return byId;

  // One batched lookup rather than a query per booking.
  var data = graphql_(endpoint, token, REQUESTS_QUERY, { ids: ids });
  var content = (data.deviceRequestConnection && data.deviceRequestConnection.content) || [];
  for (var j = 0; j < content.length; j++) {
    byId[String(content[j].id)] = content[j];
  }
  return byId;
}

function buildRows_(bookings, orgByRequestId) {
  var sorted = bookings.slice().sort(function (a, b) {
    var byDate = String(a.date || '').localeCompare(String(b.date || ''));
    if (byDate !== 0) return byDate;
    return String((a.window || {}).startTime || '').localeCompare(String((b.window || {}).startTime || ''));
  });

  return sorted.map(function (b) {
    var req = orgByRequestId[String(b.ctaReference)];
    var org = '';
    if (req && req.referringOrganisationContact && req.referringOrganisationContact.referringOrganisation) {
      org = req.referringOrganisationContact.referringOrganisation.name || '';
    }
    return [
      // A real Date so the sheet's own date formatting applies, matching the weekly tabs.
      b.date ? new Date(b.date + 'T00:00:00') : '',
      b.ctaReference === null || b.ctaReference === undefined ? '' : b.ctaReference,
      // Every row here is a booked delivery of devices to a beneficiary, which is what
      // the driver's sheet calls a Distribution.
      'Distribution',
      [b.firstName, b.surname].filter(Boolean).join(' ').trim(),
      org,
      composeAddress_(b),
      b.phone || '',
      String(b.accessNotes || '').trim(),
    ];
  });
}

function countUnmatchedOrgs_(rows) {
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][4]) n++;
  }
  return n;
}

/**
 * The booking's `address` is one free-text blob (building detail, address lines and
 * postcode joined by newlines by the public booking form) and the driver's sheet keeps a
 * single Address cell too, so it goes across as-is. Access notes are NOT folded in here -
 * they have their own column.
 */
function composeAddress_(booking) {
  var address = String(booking.address || '').trim();
  return address;
}

// Shown in the Address column for staff-arranged deliveries, where TaDa holds no delivery
// address at all (see rowFromRequest_ below).
var ADDRESS_NEEDED = '[N/A]';

/**
 * Builds a driver-sheet row from a staff-arranged delivery request.
 *
 * The Address column is deliberately NOT filled from the request. A request's only address
 * is `referringOrganisationContact.address`, which is the REFERRING ORGANISATION'S OFFICE,
 * not where the devices go - checked against the driver's 31 Aug tab it was wrong for 4 of
 * the 6 rows sampled (request 6977 holds "336 Brixton Rd" but the delivery went to
 * "119 Lockwood House, Kennington Oval"). Sending a driver to a charity's head office
 * instead of someone's flat is worse than an obviously empty cell, so the cell says what
 * is missing instead.
 *
 * Name and phone are the REFERRER's for the same reason - the recipient's own details only
 * exist once they book through the public flow.
 */
function rowFromRequest_(req) {
  var contact = req.referringOrganisationContact || {};
  // Contact names in prod contain stray tabs and double spaces (e.g. "Samuel\tEnchill"),
  // which render as a mangled cell — collapse any run of whitespace to a single space.
  var name = String(req.collectionContactName || contact.fullName || '').replace(/\s+/g, ' ').trim();
  var org = contact.referringOrganisation ? contact.referringOrganisation.name : '';
  var collectionDate = req.collectionDate ? String(req.collectionDate).slice(0, 10) : '';
  return [
    // A real Date so the sheet's own date formatting applies, matching the weekly tabs.
    collectionDate ? new Date(collectionDate + 'T00:00:00') : '',
    req.id === null || req.id === undefined ? '' : req.id,
    'Distribution',
    name,
    String(org || '').trim(),
    ADDRESS_NEEDED,
    String(contact.phoneNumber || '').trim(),
    // A staff-arranged request has no access notes - only a booking captures them.
    '',
  ];
}

function isoDate_(date) {
  return Utilities.formatDate(date, 'Europe/London', 'yyyy-MM-dd');
}

// ---------------------------------------------------------------- sheet

function writeSheet_(sheet, rows) {
  // Headers are rewritten every time so a renamed column can't silently shift the data.
  sheet.getRange(HEADER_ROW, 1, 1, HEADERS.length).setValues([HEADERS]);

  // Clear only the columns this script owns — the driver's own columns, the token in M2
  // and the refresh link in L1 all sit to the right of column G and are left alone.
  var lastRow = sheet.getLastRow();
  if (lastRow >= FIRST_DATA_ROW) {
    sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, LAST_DATA_COLUMN).clearContent();
  }

  if (!rows.length) return;

  sheet.getRange(FIRST_DATA_ROW, 1, rows.length, HEADERS.length).setValues(rows);
  sheet.getRange(FIRST_DATA_ROW, 1, rows.length, 1).setNumberFormat('dd/mm/yyyy');
  // Address (F) and Access Notes (H) are the two free-text columns that need to wrap.
  sheet.getRange(FIRST_DATA_ROW, 6, rows.length, 1).setWrap(true);
  sheet.getRange(FIRST_DATA_ROW, 8, rows.length, 1).setWrap(true);
}

// ---------------------------------------------------------------- transport

function graphql_(endpoint, token, query, variables) {
  var res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'User-Agent': 'Google Sheets Apps Script',
    },
    payload: JSON.stringify({ query: query, variables: variables }),
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  if (code === 401 || code === 403) {
    throw new Error(
      'The token in ' + TOKEN_CELL + ' was rejected (HTTP ' + code + '). Either it has expired ' +
      '(they last about two hours) or it was issued by the other environment — check it matches ' + ENV_CELL + '.'
    );
  }
  if (code !== 200) {
    throw new Error('GraphQL HTTP ' + code + ': ' + res.getContentText().slice(0, 500));
  }
  // GraphQL errors come back as HTTP 200 with an `errors` array.
  var body = JSON.parse(res.getContentText());
  if (body.errors && body.errors.length) {
    throw new Error(
      'GraphQL error: ' +
        body.errors
          .map(function (e) {
            return e.message;
          })
          .join('; ')
    );
  }
  return body.data;
}
