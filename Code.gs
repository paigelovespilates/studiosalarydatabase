// ============================================================
// Constants
// ============================================================
const JOBS_SHEET_ID      = '1xOf85o3xLK7eg_dxIWL-SuZoxBVMx89h9_GOABve9_o';
const SUBS_SHEET_ID      = '1oR-u_nbAFs_b94Xtx3z841OpmGnDjrnQccyO7mgaW44';
const HAND_RAISERS_ID    = '1zG59bNRfIQ_VtA5Se_vJWNyDr13sx_Ff11AwWDplNf0';
const GEO_API_KEY        = 'AIzaSyAn5vwgqhfYarlZqGm-ebf4MswkdkSBPZQ';
const OWNER_EMAIL        = 'bachety@gmail.com';
const JOBS_SHEET_NAME    = 'JobPosting_Clean';
const HAND_RAISERS_SHEET = 'HandRaisers';
const CLICK_SHEET        = 'Click_Interactions';

// Column indices (1-based) — JobPosting_Clean
// 1  JobId
// 2  Submission ID
// 3  Studio Name
// 4  Studio City
// 5  Studio State        ← geocoder writes here (col E)
// 6  Studio Country
// 7  Class Formats
// 8  Position Type
// 9  Days/Times Needed
// 10 Dates & Times Needed
// 11 Pay Amount
// 12 Notes from Studio
// 13 Contact Email
// 14 Contact Other
// 15 Lat                 ← geocoder writes here (col O)
// 16 Lng                 ← geocoder writes here (col P)
// 17 Posted Date
// 18 Approved
// 19 Clean Name
// 20 Clean City
// 21 Clean Zip
// 22 Studio Postal Code
const COL_JOB_ID      = 1;
const COL_STUDIO      = 3;
const COL_CITY        = 4;
const COL_STATE       = 5;
const COL_COUNTRY     = 6;
const COL_FORMAT      = 7;
const COL_ROLE        = 8;
const COL_DAYS        = 9;
const COL_PAY         = 11;
const COL_NOTES       = 12;
const COL_EMAIL       = 13;
const COL_CONTACT_ALT = 14;
const COL_LAT         = 15;
const COL_LNG         = 16;
const COL_POSTED      = 17;
const COL_APPROVED    = 18;
const COL_POSTAL      = 22;

// ============================================================
// Router
// ============================================================
function doGet(e) {
  try {
    const action = (e.parameter.action || '').trim();
    const type   = (e.parameter.type   || '').trim();
    if (action === 'recordInterest' || type === 'recordInterest') return handleRecordInterest(e);
    if (action === 'trackClick'     || type === 'trackClick')     return handleTrackClick(e);
    return handleGetJobs(e); // default — jobs.html calls with no action param
  } catch (err) {
    return createJsonpResponse(e, { error: err.message });
  }
}

// ============================================================
// handleGetJobs
// Reads JobPosting_Clean, filters approved rows (col 18 = "Y"), returns JSONP
// ============================================================
function handleGetJobs(e) {
  const ss    = SpreadsheetApp.openById(JOBS_SHEET_ID);
  const sheet = ss.getSheetByName(JOBS_SHEET_NAME);
  if (!sheet) return createJsonpResponse(e, { error: 'sheet not found' });

  const data = sheet.getDataRange().getValues();
  const jobs = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if ((row[COL_APPROVED - 1] || '').toString().trim().toUpperCase() !== 'Y') continue;
    jobs.push(rowToJobObject(row));
  }

  const cb = (e.parameter.callback || 'jobsCallback').replace(/[^a-zA-Z0-9_]/g, '');
  return ContentService.createTextOutput(cb + '(' + JSON.stringify({ jobs: jobs }) + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ============================================================
// handleRecordInterest
// Stores hand-raiser in HandRaisers sheet, deduplicates, notifies owner
// ============================================================
function handleRecordInterest(e) {
  const p     = e.parameter;
  const email = (p.email || '').trim().toLowerCase();
  const jobId = (p.jobId || '').toString().trim();

  if (!email || !jobId) return createJsonpResponse(e, { ok: false, error: 'missing params' });

  const ss    = SpreadsheetApp.openById(HAND_RAISERS_ID);
  let sheet   = ss.getSheetByName(HAND_RAISERS_SHEET);
  if (!sheet) sheet = ss.insertSheet(HAND_RAISERS_SHEET);

  const existing = sheet.getDataRange().getValues();
  for (let i = 1; i < existing.length; i++) {
    if ((existing[i][1] || '').toString().toLowerCase() === email &&
        (existing[i][2] || '').toString() === jobId) {
      return createJsonpResponse(e, { ok: true, duplicate: true });
    }
  }

  sheet.appendRow([new Date().toISOString(), email, jobId]);

  MailApp.sendEmail({
    to:      OWNER_EMAIL,
    subject: 'Job Board: New Hand-Raiser',
    body:    'Email: ' + email + '\nJob ID: ' + jobId + '\nTime: ' + new Date().toISOString()
  });

  return createJsonpResponse(e, { ok: true });
}

// ============================================================
// handleTrackClick
// Appends a row to Click_Interactions in the jobs spreadsheet
// ============================================================
function handleTrackClick(e) {
  const p     = e.parameter;
  const jobId = (p.jobId || '').toString().trim();
  const type  = (p.type  || 'view').trim();

  const ss    = SpreadsheetApp.openById(JOBS_SHEET_ID);
  let sheet   = ss.getSheetByName(CLICK_SHEET);
  if (!sheet) sheet = ss.insertSheet(CLICK_SHEET);

  sheet.appendRow([new Date().toISOString(), jobId, type]);
  return createJsonpResponse(e, { ok: true });
}

// ============================================================
// onJobPostingSubmit — install as onChange trigger on the jobs spreadsheet
// Geocodes the newest row; writes Lat (col O), Lng (col P), State (col E)
// ============================================================
function onJobPostingSubmit(e) {
  const ss    = SpreadsheetApp.openById(JOBS_SHEET_ID);
  const sheet = ss.getSheetByName(JOBS_SHEET_NAME);
  if (!sheet) return;

  // getLastRow() can return phantom rows from leftover formatting — scan col 1 for last real row
  const colValues = sheet.getRange(1, COL_JOB_ID, sheet.getLastRow(), 1).getValues();
  let lastRow = 0;
  for (let i = colValues.length - 1; i >= 0; i--) {
    if (colValues[i][0] !== '') { lastRow = i + 1; break; }
  }
  if (lastRow < 2) return;

  const row        = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const postalCode = (row[COL_POSTAL - 1]  || '').toString().trim();
  const countryRaw = (row[COL_COUNTRY - 1] || '').toString().trim();
  const country    = toCountryCode(countryRaw);

  if (!postalCode || !country) return;

  const geo = geocodePostalCode(postalCode, country);
  if (!geo) return;

  sheet.getRange(lastRow, COL_LAT).setValue(geo.lat);
  sheet.getRange(lastRow, COL_LNG).setValue(geo.lng);
  if (geo.state) sheet.getRange(lastRow, COL_STATE).setValue(geo.state);
}

// ============================================================
// onApprovalEdit — install as onEdit trigger on the jobs spreadsheet
// When col 18 (Approved) changes to "Y", fires real-time subscriber alerts
// ============================================================
function onApprovalEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  if (range.getColumn() !== COL_APPROVED) return;
  if ((e.value || '').toString().trim().toUpperCase() !== 'Y') return;

  const sheet = range.getSheet();
  if (sheet.getName() !== JOBS_SHEET_NAME) return;

  const rowNum = range.getRow();
  if (rowNum < 2) return;

  const row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
  sendAlertToMatchingSubscribers([rowToJobObject(row)]);
}

// ============================================================
// Digest senders
// ============================================================
function sendDailyDigest() {
  _sendDigest('daily');
}

function sendWeeklyDigest() {
  _sendDigest('weekly');
}

function _sendDigest(frequency) {
  const subscribers = getSubscribers(frequency);
  if (!subscribers.length) return;

  const jobs = getApprovedJobs();
  if (!jobs.length) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (frequency === 'weekly' ? 7 : 1));

  const recentJobs = jobs.filter(j => {
    const d = parseJobDate(j.posted);
    return d && d >= cutoff;
  });
  if (!recentJobs.length) return;

  const geoCache = {};

  for (const sub of subscribers) {
    const matches = matchJobsToSubscriber(sub, recentJobs, geoCache);
    if (!matches.length) continue;
    try {
      MailApp.sendEmail({
        to:       sub.email,
        subject:  'New Pilates jobs near you',
        htmlBody: buildDigestEmail(sub, matches)
      });
    } catch (err) {
      Logger.log('Digest email failed for ' + sub.email + ': ' + err.message);
    }
  }
}

function sendAlertToMatchingSubscribers(jobs) {
  const subscribers = getSubscribers('all');
  if (!subscribers.length) return;

  const geoCache = {};

  for (const sub of subscribers) {
    const matches = matchJobsToSubscriber(sub, jobs, geoCache);
    if (!matches.length) continue;
    try {
      MailApp.sendEmail({
        to:       sub.email,
        subject:  'New Pilates job alert',
        htmlBody: buildDigestEmail(sub, matches)
      });
    } catch (err) {
      Logger.log('Alert email failed for ' + sub.email + ': ' + err.message);
    }
  }
}

// ============================================================
// Subscriber / job data helpers
// ============================================================
function getSubscribers(frequency) {
  const ss    = SpreadsheetApp.openById(SUBS_SHEET_ID);
  const sheet = ss.getSheetByName('Instructor Job Board Preferences') || ss.getSheets()[0];
  const rows  = sheet.getDataRange().getValues();
  const subs  = [];

  // Subscriber sheet column layout (0-based):
  // 0  email  1  country  2  postalCode  5  radius  6  radiusUnit  7  frequency  13  classFormats
  for (let i = 1; i < rows.length; i++) {
    const r     = rows[i];
    const email = (r[0] || '').toString().trim();
    if (!email) continue;
    const subFreq = (r[7] || '').toString().trim().toLowerCase();
    if (frequency !== 'all' && subFreq !== frequency) continue;
    subs.push({
      email:      email,
      country:    (r[1]  || '').toString().trim(),
      postalCode: (r[2]  || '').toString().trim(),
      formats:    (r[13] || '').toString().split(',').map(f => f.trim().toLowerCase()).filter(Boolean),
      radius:     parseFloat(r[5]) || 50,
      radiusUnit: (r[6]  || 'km').toString().trim().toLowerCase(),
      frequency:  subFreq
    });
  }
  return subs;
}

function getApprovedJobs() {
  const ss    = SpreadsheetApp.openById(JOBS_SHEET_ID);
  const sheet = ss.getSheetByName(JOBS_SHEET_NAME);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const jobs = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if ((row[COL_APPROVED - 1] || '').toString().trim().toUpperCase() !== 'Y') continue;
    jobs.push(rowToJobObject(row));
  }
  return jobs;
}

function rowToJobObject(row) {
  return {
    id:           (row[COL_JOB_ID - 1]      || '').toString(),
    studio:        row[COL_STUDIO - 1]       || '',
    city:          row[COL_CITY - 1]         || '',
    state:         row[COL_STATE - 1]        || '',
    country:       row[COL_COUNTRY - 1]      || '',
    postalCode:    row[COL_POSTAL - 1]       || '',
    format:        row[COL_FORMAT - 1]       || '',
    role:          row[COL_ROLE - 1]         || '',
    days:          row[COL_DAYS - 1]         || '',
    pay:           row[COL_PAY - 1]          || '',
    notes:         row[COL_NOTES - 1]        || '',
    contactEmail:  row[COL_EMAIL - 1]        || '',
    contactOther:  row[COL_CONTACT_ALT - 1]  || '',
    lat:           parseFloat(row[COL_LAT - 1])  || null,
    lng:           parseFloat(row[COL_LNG - 1])  || null,
    posted:        row[COL_POSTED - 1]       ? row[COL_POSTED - 1].toString() : ''
  };
}

function matchJobsToSubscriber(sub, jobs, geoCache) {
  let subLat = null, subLng = null;
  if (sub.postalCode && sub.country) {
    const cc  = toCountryCode(sub.country);
    const key = sub.postalCode + '|' + cc;
    if (!geoCache[key]) geoCache[key] = geocodePostalCode(sub.postalCode, cc) || {};
    subLat = geoCache[key].lat || null;
    subLng = geoCache[key].lng || null;
  }

  const radiusKm = sub.radiusUnit === 'mi' ? sub.radius * 1.60934 : sub.radius;

  return jobs.filter(job => {
    if (sub.formats.length) {
      const jobFormats = job.format.toLowerCase().split(/[,\/]/).map(f => f.trim());
      const overlap    = sub.formats.some(sf => jobFormats.some(jf => jf.includes(sf) || sf.includes(jf)));
      if (!overlap) return false;
    }
    if (subLat !== null && job.lat !== null) {
      const dist = haversineDistance(subLat, subLng, job.lat, job.lng);
      if (dist > radiusKm) return false;
    }
    return true;
  });
}

// ============================================================
// buildDigestEmail — branded HTML template
// ============================================================
function buildDigestEmail(subscriber, jobs) {
  const jobRows = jobs.map(j => {
    const location = [j.city, j.state, j.country].filter(Boolean).map(esc).join(', ');
    const formats  = j.format ? '<div style="font-size:12px;color:#666;margin-top:4px;">' + esc(j.format) + '</div>' : '';
    const pay      = j.pay    ? '<div style="font-size:12px;color:#666;">' + esc(j.pay) + '</div>' : '';
    const days     = j.days   ? '<div style="font-size:12px;color:#888;">' + esc(j.days) + '</div>' : '';
    const contact  = j.contactEmail
      ? '<a href="mailto:' + esc(j.contactEmail) + '" style="display:inline-block;margin-top:10px;padding:9px 18px;background:#373930;color:#EDEBE4;text-decoration:none;font-family:\'DM Sans\',sans-serif;font-size:13px;letter-spacing:0.03em;">Apply</a>'
      : (j.contactOther ? '<div style="font-size:12px;color:#555;margin-top:8px;">' + esc(j.contactOther) + '</div>' : '');
    return '<tr><td style="padding:20px 0;border-bottom:1px solid #dedad2;">' +
      '<div style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:20px;font-weight:600;color:#373930;">' + esc(j.studio) + '</div>' +
      '<div style="font-family:\'DM Sans\',sans-serif;font-size:13px;color:#555;margin-top:4px;">' + (j.role ? esc(j.role) + ' · ' : '') + location + '</div>' +
      formats + pay + days + contact +
      '</td></tr>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#EDEBE4;font-family:\'DM Sans\',Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#EDEBE4"><tr><td align="center" style="padding:48px 16px;">' +
    '<table width="580" cellpadding="0" cellspacing="0" style="background:#EDEBE4;">' +
    '<tr><td style="padding-bottom:28px;border-bottom:2px solid #373930;">' +
    '<div style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:30px;font-weight:600;color:#373930;letter-spacing:0.01em;">New jobs for you</div>' +
    '</td></tr>' +
    '<tr><td><table width="100%" cellpadding="0" cellspacing="0">' + jobRows + '</table></td></tr>' +
    '<tr><td style="padding-top:28px;border-top:1px solid #ccc9c0;">' +
    '<p style="font-family:\'DM Sans\',Arial,sans-serif;font-size:11px;color:#999;margin:0;line-height:1.6;">' +
    'You\'re receiving this because you subscribed to Pilates job alerts. ' +
    '<a href="https://pilatesalarydatabase.com" style="color:#373930;text-decoration:underline;">Visit the job board</a>' +
    '</p></td></tr>' +
    '</table></td></tr></table>' +
    '</body></html>';
}

// ============================================================
// setupDigestTrigger — run once from the Apps Script editor
// ============================================================
function setupDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'sendDailyDigest' || fn === 'sendWeeklyDigest' ||
        fn === 'onJobPostingSubmit' || fn === 'onApprovalEdit') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('sendDailyDigest')
    .timeBased().everyDays(1).atHour(8).create();

  ScriptApp.newTrigger('sendWeeklyDigest')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();

  const ss = SpreadsheetApp.openById(JOBS_SHEET_ID);
  ScriptApp.newTrigger('onJobPostingSubmit').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('onApprovalEdit').forSpreadsheet(ss).onEdit().create();
}

// ============================================================
// Helpers
// ============================================================
function geocodePostalCode(postalCode, countryCode) {
  try {
    const url  = 'https://maps.googleapis.com/maps/api/geocode/json?address=' +
      encodeURIComponent(postalCode + ' ' + countryCode) + '&key=' + GEO_API_KEY;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(resp.getContentText());
    if (data.status !== 'OK' || !data.results.length) return null;

    const result = data.results[0];
    const loc    = result.geometry.location;
    let state    = '';
    for (const c of (result.address_components || [])) {
      if (c.types.includes('administrative_area_level_1')) {
        state = c.short_name || c.long_name || '';
        break;
      }
    }
    return { lat: loc.lat, lng: loc.lng, state: state };
  } catch (err) {
    Logger.log('geocodePostalCode error: ' + err.message);
    return null;
  }
}

function toCountryCode(country) {
  const map = {
    'united states': 'US', 'usa': 'US', 'u.s.': 'US', 'us': 'US',
    'canada': 'CA', 'ca': 'CA',
    'united kingdom': 'GB', 'uk': 'GB', 'gb': 'GB', 'england': 'GB',
    'australia': 'AU', 'au': 'AU',
    'germany': 'DE', 'de': 'DE',
    'france': 'FR', 'fr': 'FR',
    'netherlands': 'NL', 'nl': 'NL',
    'new zealand': 'NZ', 'nz': 'NZ',
    'ireland': 'IE', 'ie': 'IE',
    'sweden': 'SE', 'se': 'SE',
    'norway': 'NO', 'no': 'NO',
    'denmark': 'DK', 'dk': 'DK',
    'switzerland': 'CH', 'ch': 'CH',
    'south africa': 'ZA', 'za': 'ZA',
    'singapore': 'SG', 'sg': 'SG',
    'uae': 'AE', 'united arab emirates': 'AE', 'ae': 'AE',
    'japan': 'JP', 'jp': 'JP',
    'brazil': 'BR', 'br': 'BR',
    'mexico': 'MX', 'mx': 'MX'
  };
  const key = (country || '').trim().toLowerCase();
  return map[key] || (key.length === 2 ? key.toUpperCase() : country.trim());
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
               Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
               Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return deg * Math.PI / 180;
}

function parseJobDate(str) {
  if (!str) return null;
  const num = parseFloat(str);
  if (!isNaN(num) && num > 40000) return new Date((num - 25569) * 86400 * 1000);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function esc(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createJsonpResponse(e, obj) {
  const cb     = ((e && e.parameter && e.parameter.callback) || '').replace(/[^a-zA-Z0-9_]/g, '');
  const output = cb ? cb + '(' + JSON.stringify(obj) + ')' : JSON.stringify(obj);
  const mime   = cb ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(output).setMimeType(mime);
}
