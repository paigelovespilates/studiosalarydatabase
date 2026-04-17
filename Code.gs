const SUBS_SHEET_ID = '1oR-u_nbAFs_b94Xtx3z841OpmGnDjrnQccyO7mgaW44';

function doGet(e) {
  const action = (e.parameter.action || '').trim();
  if (action === 'subscribe') return handleSubscribeFromGet(e);
  return ContentService.createTextOutput(JSON.stringify({ error: 'unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const type = body.type || '';
    if (type === 'subscribeInstructor') return handleSubscribeInstructor(body);
    return jsonResponse({ error: 'unknown type' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function handleSubscribeFromGet(e) {
  const p = e.parameter;
  const body = {
    email:          p.email          || '',
    country:        p.country        || '',
    postalCode:     p.postalCode     || '',
    classFormats:   p.classFormats   || '',
    distanceRadius: p.distanceRadius || '',
    radiusUnit:     p.radiusUnit     || '',
    frequency:      p.frequency      || '',
    timestamp:      p.timestamp      || new Date().toISOString()
  };
  const result = subscribeInstructorCore(body);
  // Sanitize callback name and wrap response — falls back to plain expression if no callback
  const cb = (p.callback || '').replace(/[^a-zA-Z0-9_]/g, '');
  const output = cb ? cb + '(' + JSON.stringify(result) + ')' : '(' + JSON.stringify(result) + ')';
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function handleSubscribeInstructor(body) {
  return jsonResponse(subscribeInstructorCore(body));
}

function subscribeInstructorCore(body) {
  try {
    const ss    = SpreadsheetApp.openById(SUBS_SHEET_ID);
    const sheet = ss.getSheetByName('Instructor Job Board Preferences') || ss.getSheets()[0];
    sheet.appendRow([
      body.timestamp      || new Date().toISOString(),
      body.email          || '',
      body.country        || '',
      body.postalCode     || '',
      body.classFormats   || '',
      body.distanceRadius || '',
      body.radiusUnit     || '',
      body.frequency      || ''
    ]);
    notifyOwnerSubscription(body);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function notifyOwnerSubscription(body) {
  MailApp.sendEmail({
    to: 'bachety@gmail.com',
    subject: 'New Job Alert Subscription',
    body: [
      'New subscriber:',
      'Email: '     + (body.email          || '—'),
      'Location: '  + (body.postalCode     || '—') + ', ' + (body.country || '—'),
      'Formats: '   + (body.classFormats   || '—'),
      'Radius: '    + (body.distanceRadius || '—') + ' ' + (body.radiusUnit || ''),
      'Frequency: ' + (body.frequency      || '—'),
      'Timestamp: ' + (body.timestamp      || '—')
    ].join('\n')
  });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
