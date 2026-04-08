export default function getAdminHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tunnel Admin</title>
<style>
  :root {
    --bg: #0f172a; --surface: #1e293b; --surface2: #334155;
    --border: #475569; --text: #e2e8f0; --text2: #94a3b8;
    --primary: #3b82f6; --primary-hover: #2563eb;
    --green: #22c55e; --green-bg: #052e16; --green-border: #166534;
    --red: #ef4444; --red-bg: #450a0a; --red-border: #991b1b;
    --yellow: #eab308; --yellow-bg: #422006; --yellow-border: #854d0e;
    --radius: 8px; --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; }

  .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text2); }
  .header .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot.on { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .dot.off { background: var(--red); }

  .container { width: 100%; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 24px; }

  /* Cards */
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .card-header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .card-header h2 { font-size: 15px; font-weight: 600; }
  .card-body { padding: 16px 18px; }

  /* Buttons */
  button, .btn { padding: 6px 14px; border-radius: var(--radius); font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: all .15s; }
  .btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
  .btn-primary:hover { background: var(--primary-hover); }
  .btn-danger { background: transparent; color: var(--red); border-color: var(--red-border); }
  .btn-danger:hover { background: var(--red-bg); }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  .btn-ghost { background: transparent; color: var(--text2); border-color: var(--border); }
  .btn-ghost:hover { color: var(--text); border-color: var(--text2); }

  /* Badge */
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .badge-green { background: var(--green-bg); color: var(--green); border: 1px solid var(--green-border); }
  .badge-red { background: var(--red-bg); color: var(--red); border: 1px solid var(--red-border); }
  .badge-yellow { background: var(--yellow-bg); color: var(--yellow); border: 1px solid var(--yellow-border); }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 8px 12px; color: var(--text2); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; font-weight: 500; }
  td { padding: 10px 12px; border-top: 1px solid var(--border); vertical-align: middle; }
  tr:hover td { background: rgba(255,255,255,.02); }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; color: var(--yellow); }

  /* Add form */
  .add-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .add-form input { padding: 7px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 13px; font-family: monospace; outline: none; }
  .add-form input:focus { border-color: var(--primary); }
  .add-form select { padding: 7px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 13px; outline: none; }

  /* Edit inline */
  .edit-input { padding: 4px 8px; background: var(--bg); border: 1px solid var(--primary); border-radius: 4px; color: var(--text); font-family: monospace; font-size: 13px; width: 200px; outline: none; }

  .empty { padding: 32px; text-align: center; color: var(--text2); font-size: 14px; }
  .actions { display: flex; gap: 6px; }

  /* Pending table */
  .socket-count { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; background: var(--surface2); color: var(--text2); }
  .socket-count.active { background: var(--green-bg); color: var(--green); border: 1px solid var(--green-border); }

  .toast { position: fixed; bottom: 20px; right: 20px; padding: 10px 18px; border-radius: var(--radius); font-size: 13px; color: #fff; opacity: 0; transition: opacity .3s; pointer-events: none; z-index: 999; }
  .toast.show { opacity: 1; }
  .toast.success { background: var(--green-border); }
  .toast.error { background: var(--red-border); }

  .refresh-btn { background: none; border: none; color: var(--text2); cursor: pointer; font-size: 16px; padding: 4px; }
  .refresh-btn:hover { color: var(--text); }
  .spin { animation: spin .6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>

<div class="header">
  <h1>&#9881; Tunnel Admin</h1>
  <div class="status">
    <span class="dot" id="statusDot"></span>
    <span id="statusText">-</span>
  </div>
</div>

<div class="container">
  <!-- Login -->
  <div id="loginBox" class="card">
    <div class="card-header"><h2>Login</h2></div>
    <div class="card-body">
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" id="adminUser" placeholder="Username" style="padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:14px;outline:none" />
        <input type="password" id="adminPass" placeholder="Password" style="padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:14px;outline:none" />
        <button class="btn btn-primary" onclick="doLogin()">Connect</button>
      </div>
    </div>
  </div>

  <!-- Filters -->
  <div class="card">
    <div class="card-header">
      <h2>Authorization Filters <span style="color:var(--text2);font-weight:400;font-size:12px">(first match wins)</span></h2>
      <button class="refresh-btn" onclick="loadFilters()" title="Refresh">&#x21bb;</button>
    </div>
    <div class="card-body">
      <div class="add-form" style="margin-bottom:14px">
        <input type="number" id="newPriority" placeholder="Priority" value="0" step="any" style="width:80px" />
        <input type="text" id="newPattern" placeholder="Regex pattern (e.g. ^device-.*)" style="flex:1;min-width:200px" />
        <select id="newAuthorized">
          <option value="true">&#x2705; Allow</option>
          <option value="false">&#x274C; Deny</option>
        </select>
        <button class="btn btn-primary" onclick="addFilter()">Add filter</button>
      </div>
      <table>
        <thead><tr><th>Priority</th><th>Pattern</th><th>Action</th><th></th></tr></thead>
        <tbody id="filtersBody"></tbody>
      </table>
      <div class="empty" id="filtersEmpty" style="display:none">No filters defined</div>
    </div>
  </div>

  <!-- Pending tunnels -->
  <div class="card">
    <div class="card-header">
      <h2>Pending Tunnels</h2>
      <button class="refresh-btn" onclick="loadPending()" title="Refresh">&#x21bb;</button>
    </div>
    <div class="card-body">
      <table id="pendingTable" style="display:none">
        <thead><tr><th>ID</th><th>URL / Endpoint</th><th>Target</th><th>Type</th><th>Authorization</th><th>Status</th><th>Sockets</th></tr></thead>
        <tbody id="pendingBody"></tbody>
      </table>
      <div class="empty" id="pendingEmpty" style="display:none">No pending tunnels</div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const $ = id => document.getElementById(id);
let authHeader = '';

function doLogin() {
  const u = $('adminUser').value;
  const p = $('adminPass').value;
  authHeader = 'Basic ' + btoa(u + ':' + p);
  loadAll();
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Authorization': authHeader } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    setStatus(false);
    stopPendingPolling();
    $('loginBox').style.display = '';
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

function toast(msg, type) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.className = 'toast', 2500);
}

function setStatus(ok) {
  $('statusDot').className = 'dot ' + (ok ? 'on' : 'off');
  $('statusText').textContent = ok ? 'Connected' : 'Disconnected';
}

// --- Filters ---
let currentFilters = [];

async function loadFilters() {
  try {
    currentFilters = await api('GET', '/api/filters');
    renderFilters();
  } catch(e) { toast(e.message, 'error'); setStatus(false); }
}

function renderFilters() {
  const tb = $('filtersBody');
  if (!currentFilters.length) {
    tb.innerHTML = '';
    $('filtersEmpty').style.display = '';
    return;
  }
  $('filtersEmpty').style.display = 'none';
  tb.innerHTML = currentFilters.map((f) => \`
    <tr data-id="\${f.id}">
      <td><span class="prio-val" id="prio-\${f.id}" onclick="editPriority('\${f.id}')" title="Click to edit" style="cursor:pointer;color:var(--text2)">\${f.priority}</span></td>
      <td><span class="mono" id="pat-\${f.id}">\${esc(f.pattern)}</span></td>
      <td><span class="badge \${f.authorized ? 'badge-green' : 'badge-red'}">\${f.authorized ? 'Allow' : 'Deny'}</span></td>
      <td>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onclick="toggleFilter('\${f.id}', \${!f.authorized})" title="Toggle">\${f.authorized ? '&#x274C;' : '&#x2705;'}</button>
          <button class="btn btn-ghost btn-sm" onclick="editPattern('\${f.id}')" title="Edit pattern">&#x270E;</button>
          <button class="btn btn-danger btn-sm" onclick="deleteFilter('\${f.id}')" title="Delete">&#x2716;</button>
        </div>
      </td>
    </tr>
  \`).join('');
}

async function addFilter() {
  const pattern = $('newPattern').value.trim();
  const authorized = $('newAuthorized').value === 'true';
  const priority = parseFloat($('newPriority').value);
  if (!pattern) return toast('Pattern is required', 'error');
  if (isNaN(priority)) return toast('Priority must be a number', 'error');
  try {
    await api('POST', '/api/filters', { pattern, authorized, priority });
    $('newPattern').value = '';
    $('newPriority').value = '0';
    toast('Filter added', 'success');
    loadAll();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteFilter(id) {
  try {
    await api('DELETE', '/api/filters/' + id);
    toast('Filter deleted', 'success');
    loadAll();
  } catch(e) { toast(e.message, 'error'); }
}

async function toggleFilter(id, authorized) {
  try {
    await api('PUT', '/api/filters/' + id, { authorized });
    toast('Filter updated', 'success');
    loadAll();
  } catch(e) { toast(e.message, 'error'); }
}

function inlineEdit(elId, currentVal, onSave) {
  const el = document.getElementById(elId);
  const isNumber = typeof currentVal === 'number';
  el.innerHTML = \`<input class="edit-input" id="ie-\${elId}" type="\${isNumber ? 'number' : 'text'}" step="any" value="\${esc(String(currentVal))}" style="width:\${isNumber ? '80px' : '200px'}" />\`;
  const input = document.getElementById('ie-' + elId);
  input.focus();
  input.select();
  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const raw = input.value.trim();
    const val = isNumber ? parseFloat(raw) : raw;
    if (raw === '' || val === currentVal || (isNumber && isNaN(val))) { renderFilters(); return; }
    await onSave(val);
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { saved = true; renderFilters(); } });
  input.addEventListener('blur', save);
}

function editPattern(id) {
  const f = currentFilters.find(x => x.id === id);
  if (!f) return;
  inlineEdit('pat-' + id, f.pattern, async (val) => {
    try {
      await api('PUT', '/api/filters/' + id, { pattern: val });
      toast('Pattern updated', 'success');
      loadAll();
    } catch(e) { toast(e.message, 'error'); renderFilters(); }
  });
}

function editPriority(id) {
  const f = currentFilters.find(x => x.id === id);
  if (!f) return;
  inlineEdit('prio-' + id, f.priority, async (val) => {
    try {
      await api('PUT', '/api/filters/' + id, { priority: val });
      toast('Priority updated', 'success');
      loadAll();
    } catch(e) { toast(e.message, 'error'); renderFilters(); }
  });
}

// --- Pending ---
let pendingInterval = null;

async function loadPending() {
  try {
    const pending = await api('GET', '/api/tunnels/pending');
    const tb = $('pendingBody');
    if (!pending.length) {
      tb.innerHTML = '';
      $('pendingTable').style.display = 'none';
      $('pendingEmpty').style.display = '';
      return;
    }
    $('pendingEmpty').style.display = 'none';
    $('pendingTable').style.display = '';
    tb.innerHTML = pending.map(p => {
      const endpointHtml = p.endpoint && p.endpoint !== '-'
        ? \`<a href="\${esc(p.endpoint)}" target="_blank" style="color:var(--primary);text-decoration:none;font-size:13px">\${esc(p.endpoint)}</a>\`
        : \`<span style="font-size:13px">-</span>\`;
      const typeBadge = p.type === 'tcp'
        ? '<span class="badge badge-yellow">TCP</span>'
        : p.type === 'http'
        ? '<span class="badge badge-green">HTTP</span>'
        : \`<span class="badge">\${esc(p.type)}</span>\`;
      return \`
      <tr>
        <td><span class="mono">\${esc(p.id)}</span></td>
        <td>\${endpointHtml}</td>
        <td>\${p.target ? \`<a href="\${esc(p.target)}" target="_blank" style="color:var(--primary);text-decoration:none;font-size:13px">\${esc(p.target)}</a>\` : '<span style="font-size:13px">-</span>'}</td>
        <td>\${typeBadge}</td>
        <td><span class="badge \${p.authorized ? 'badge-green' : 'badge-red'}">\${p.authorized ? 'Allowed' : 'Denied'}</span></td>
        <td><span class="badge \${p.connected ? 'badge-green' : 'badge-yellow'}">\${p.connected ? 'Connected' : 'Waiting'}</span></td>
        <td><span class="socket-count \${p.connectedSockets > 0 ? 'active' : ''}">\${p.type === 'tcp' && p.activeExternalConnections !== undefined ? p.activeExternalConnections + '/' : ''}\${p.connectedSockets}</span></td>
      </tr>
    \`}).join('');
  } catch(e) { /* silent for polling */ }
}

function startPendingPolling() {
  stopPendingPolling();
  pendingInterval = setInterval(loadPending, 2000);
}

function stopPendingPolling() {
  if (pendingInterval) { clearInterval(pendingInterval); pendingInterval = null; }
}

// --- Load all ---
async function loadAll() {
  try {
    await Promise.all([loadFilters(), loadPending()]);
    setStatus(true);
    $('loginBox').style.display = 'none';
    startPendingPolling();
  } catch(e) { setStatus(false); stopPendingPolling(); }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Support Enter key on login fields
$('adminUser').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('adminPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
</script>
</body>
</html>`;
}
