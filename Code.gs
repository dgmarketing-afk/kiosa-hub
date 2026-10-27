/**
 * KIOSA Hub backend · Google Apps Script
 * The Google Sheet this script is attached to is the database.
 * Tabs: listings, vault, clients, interests, config (one row per record),
 *       users (team logins), history (every change).
 * Deploy: Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
 */
const COLLECTIONS = ['listings', 'vault', 'clients', 'interests', 'config'];
const SYS = ['id', '_version', '_updatedAt', '_updatedBy', '_json'];
const TOKEN_DAYS = 30;

/* ---------- one-time setup: run this once from the editor ---------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  COLLECTIONS.forEach(c => ensureSheet_(c, SYS));
  ensureSheet_('users', ['username', 'name', 'set_password', 'password_hash', 'salt', 'active', 'last_login']);
  ensureSheet_('history', ['time', 'user', 'action', 'collection', 'id', 'changes']);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('FOLDER')) {
    const f = DriveApp.createFolder('KIOSA Hub Files');
    props.setProperty('FOLDER', f.getId());
  }
  const u = ss.getSheetByName('users');
  u.getRange('C:C').setNumberFormat('@'); // keep passwords like 0000 as text
  if (u.getLastRow() < 2) u.appendRow(['user1', 'Pia', '0000', '', '', true, '']);
  ['listings', 'vault', 'clients', 'interests', 'config'].forEach(c => ss.getSheetByName(c).hideColumns(5));
  return 'Setup done. Folder: ' + props.getProperty('FOLDER');
}

/* ---------- HTTP ---------- */
function doGet() { return json_({ ok: true, service: 'KIOSA Hub API' }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: 'bad_request' }); }
  try {
    if (req.action === 'login') return json_(login_(req.password));
    const user = verify_(req.token);
    if (!user) return json_({ error: 'unauthorized' });
    switch (req.action) {
      case 'all': return json_(all_());
      case 'set': return json_(write_(user, req.collection, req.id, req.data, false));
      case 'update': return json_(write_(user, req.collection, req.id, req.data, true));
      case 'delete': return json_(remove_(user, req.collection, req.id));
      case 'import': return json_(importDocs_(user, req.collection, req.docs || []));
      case 'upload': return json_(upload_(user, req));
      case 'deleteFile': return json_(deleteFile_(req.id));
      case 'file': return json_(file_(req.id));
      case 'me': return json_({ user: user.u, name: user.n });
      default: return json_({ error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ error: 'server_error', message: String(err && err.message || err) });
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- auth ---------- */
function hash_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join(''); }
function sign_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, PropertiesService.getScriptProperties().getProperty('SECRET'))); }
function login_(password) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('users');
  const rows = sh.getDataRange().getDisplayValues();
  // passwords typed into the "set_password" column are stored hashed, then cleared
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][2] !== '' && rows[i][2] !== null) {
      const salt = Utilities.getUuid(), h = hash_(salt + String(rows[i][2]));
      sh.getRange(i + 1, 3, 1, 3).setValues([['', h, salt]]);
      rows[i][2] = ''; rows[i][3] = h; rows[i][4] = salt;
    }
  }
  for (let i = 1; i < rows.length; i++) {
    const [u, name, , h, salt, active] = rows[i];
    if (!u || !h) continue;
    if (hash_(salt + String(password || '')) !== h) continue;
    if (String(active).toUpperCase() === 'FALSE') return { error: 'inactive' };
    sh.getRange(i + 1, 7).setValue(new Date());
    const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ u: String(u), n: String(name || u), exp: Date.now() + TOKEN_DAYS * 864e5 }));
    return { token: payload + '.' + sign_(payload), name: String(name || u) };
  }
  Utilities.sleep(800);
  return { error: 'wrong_password' };
}
function verify_(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [payload, sig] = token.split('.');
  if (sign_(payload) !== sig) return null;
  const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payload)).getDataAsString());
  if (!p.exp || p.exp < Date.now()) return null;
  return p;
}

/* ---------- sheet storage ---------- */
function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); sh.getRange(1, 1, 1, headers.length).setFontWeight('bold'); }
  return sh;
}
function sheetOf_(c) {
  if (COLLECTIONS.indexOf(c) < 0) throw new Error('Unknown collection ' + c);
  return ensureSheet_(c, SYS);
}
function headers_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }
function rowOf_(sh, id) {
  if (sh.getLastRow() < 2) return -1;
  const f = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return f ? f.getRow() : -1;
}
function readDoc_(sh, row) {
  const v = sh.getRange(row, 1, 1, 5).getValues()[0];
  return { id: String(v[0]), version: Number(v[1]) || 1, data: v[4] ? JSON.parse(v[4]) : {} };
}
function all_() {
  const out = {};
  COLLECTIONS.forEach(c => {
    const sh = sheetOf_(c);
    const n = sh.getLastRow() - 1;
    out[c] = n < 1 ? [] : sh.getRange(2, 1, n, 5).getValues().filter(r => r[0] !== '').map(r => ({ id: String(r[0]), version: Number(r[1]) || 1, data: r[4] ? JSON.parse(r[4]) : {} }));
  });
  return out;
}
function writeRow_(sh, row, id, version, user, data) {
  let heads = headers_(sh);
  const keys = Object.keys(data).filter(k => k !== 'id');
  const missing = keys.filter(k => heads.indexOf(k) < 0);
  if (missing.length) {
    sh.getRange(1, heads.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    heads = heads.concat(missing);
  }
  const vals = [], fmts = [];
  heads.forEach(h => {
    let v, f = '@';
    if (h === 'id') v = id;
    else if (h === '_version') { v = version; f = '0'; }
    else if (h === '_updatedAt') { v = new Date(); f = 'yyyy-mm-dd hh:mm'; }
    else if (h === '_updatedBy') v = user;
    else if (h === '_json') { v = JSON.stringify(data); }
    else {
      const x = data[h];
      if (x === null || x === undefined) v = '';
      else if (typeof x === 'number') { v = x; f = '#,##0.##'; }
      else if (typeof x === 'boolean') { v = x ? 'Yes' : ''; }
      else if (typeof x === 'object') v = JSON.stringify(x);
      else v = String(x);
      if (typeof v === 'string' && v.length > 49000) v = v.slice(0, 49000);
    }
    vals.push(v); fmts.push(f);
  });
  const r = sh.getRange(row, 1, 1, heads.length);
  r.setNumberFormats([fmts]); r.setValues([vals]);
}
function diff_(a, b) {
  const out = [];
  Object.keys(Object.assign({}, a, b)).forEach(k => {
    if (k === 'updatedAt') return;
    const x = JSON.stringify(a[k] === undefined ? null : a[k]), y = JSON.stringify(b[k] === undefined ? null : b[k]);
    if (x !== y) out.push(k + (x.length + y.length < 120 ? ': ' + x + ' → ' + y : ''));
  });
  return out.join('\n');
}
function log_(user, action, c, id, changes) {
  ensureSheet_('history', ['time', 'user', 'action', 'collection', 'id', 'changes'])
    .appendRow([new Date(), user, action, c, id, String(changes || '').slice(0, 45000)]);
}
function write_(user, c, id, data, merge) {
  if (!id) throw new Error('Missing id');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheetOf_(c);
    let row = rowOf_(sh, id), old = { version: 0, data: {} };
    if (row > 0) old = readDoc_(sh, row); else row = sh.getLastRow() + 1;
    const next = merge ? Object.assign({}, old.data, data) : Object.assign({}, data);
    Object.keys(next).forEach(k => { if (next[k] && next[k].__delete__) delete next[k]; });
    writeRow_(sh, row, id, old.version + 1, user.u, next);
    log_(user.u, old.version ? (merge ? 'update' : 'set') : 'create', c, id, c === 'vault' ? '(owner details changed)' : diff_(old.data, next));
    return { ok: true, id: id, version: old.version + 1 };
  } finally { lock.releaseLock(); }
}
function remove_(user, c, id) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheetOf_(c), row = rowOf_(sh, id);
    if (row > 0) sh.deleteRow(row);
    log_(user.u, 'delete', c, id, '');
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function importDocs_(user, c, docs) {
  docs.forEach(d => write_(user, c, d.id, d.data, false));
  return { ok: true, count: docs.length };
}

/* ---------- files (photos, PDFs) in Google Drive ---------- */
function folder_(sub) {
  const root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER'));
  if (!sub) return root;
  const it = root.getFoldersByName(sub);
  return it.hasNext() ? it.next() : root.createFolder(sub);
}
function upload_(user, req) {
  const blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mime || 'application/octet-stream', req.name || ('file-' + Date.now()));
  const f = folder_(req.folder || 'Uploads').createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  log_(user.u, 'upload', 'files', f.getId(), (req.folder || 'Uploads') + '/' + f.getName());
  return { id: f.getId() };
}
function deleteFile_(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} return { ok: true }; }
function file_(id) {
  const b = DriveApp.getFileById(id).getBlob();
  return { mime: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()), name: b.getName() };
}
