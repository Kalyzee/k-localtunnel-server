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
    --blue: #0090D1; --blue-bg: #013770; --blue-border: #0090D1;
    --purple: #a855f7; --purple-bg: #2e1065; --purple-border: #6b21a8;
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
  .badge-blue { background: var(--blue-bg); color: var(--blue); border: 1px solid var(--blue-border); }
  .badge-purple { background: var(--purple-bg); color: var(--purple); border: 1px solid var(--purple-border); }

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

  /* Tabs */
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); padding: 0 24px; }
  .tab { background: none; border: none; border-bottom: 2px solid transparent; color: var(--text2); padding: 12px 18px; font-size: 14px; font-weight: 500; cursor: pointer; border-radius: 0; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--primary); border-bottom-color: var(--primary); }

  /* Modal */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; max-width: 560px; width: 90%; }
  .modal h3 { font-size: 15px; margin-bottom: 12px; }
  .modal p { font-size: 13px; color: var(--text2); margin-bottom: 12px; line-height: 1.5; }
  .modal .key-reveal { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; word-break: break-all; color: var(--yellow); margin-bottom: 14px; }
  .modal .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .modal input[type="number"], .modal select { padding: 6px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 13px; outline: none; }
  .modal input[type="number"]:focus, .modal select:focus { border-color: var(--primary); }
  .modal input:disabled, .modal select:disabled { opacity: .4; cursor: not-allowed; }

  /* Allow-expiry chip (temporary allow countdown) */
  .chip-expiry { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; background: var(--yellow-bg); color: var(--yellow); border: 1px solid var(--yellow-border); cursor: pointer; margin-left: 6px; vertical-align: middle; }
  .chip-expiry:hover { background: var(--yellow-border); color: #fff; }
  .chip-expiry.expired { background: var(--red-bg); color: var(--red); border-color: var(--red-border); }
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

<div class="tabs" id="tabs" style="display:none">
  <button class="tab active" data-tab="dashboard" onclick="switchTab('dashboard')">Dashboard</button>
  <button class="tab" data-tab="keys" onclick="switchTab('keys')">API Keys</button>
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

<div data-panel="dashboard" style="display:none;flex-direction:column;gap:24px">
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
        <button class="btn btn-primary" onclick="addFilter()">Add filter</button>
      </div>
      <p style="margin:-6px 0 14px;font-size:12px;color:var(--text2)">New filters are created as <strong>deny</strong>. Toggle them to allow from the table to pick a duration.</p>
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
      <h2>Pending Tunnels <span id="pendingCount" style="color:var(--text2);font-weight:400;font-size:12px"></span></h2>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="text" id="pendingFilter" placeholder="Filter (regex)" oninput="renderPending()" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;font-family:monospace;outline:none;width:200px" />
        <button class="refresh-btn" onclick="loadPending()" title="Refresh">&#x21bb;</button>
      </div>
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
<!-- end dashboard panel -->

<div data-panel="keys" style="display:none;flex-direction:column;gap:24px">
  <div class="card">
    <div class="card-header">
      <h2>Create API Key</h2>
    </div>
    <div class="card-body">
      <div class="add-form">
        <input type="text" id="newKeyName" placeholder="Name (e.g. device-1)" style="flex:1;min-width:220px" />
        <input type="datetime-local" id="newKeyExpires" title="Expiration (optional)" />
        <button class="btn btn-primary" onclick="createKey()">Generate</button>
      </div>
      <p style="margin-top:10px;font-size:12px;color:var(--text2)">The key is shown <strong>once</strong> after creation. Copy it immediately — it cannot be recovered.</p>
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <h2>API Keys <span id="keysCount" style="color:var(--text2);font-weight:400;font-size:12px"></span></h2>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="text" id="keysFilter" placeholder="Filter (regex)" oninput="renderKeys()" style="padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;font-family:monospace;outline:none;width:200px" />
        <button class="refresh-btn" onclick="loadKeys()" title="Refresh">&#x21bb;</button>
      </div>
    </div>
    <div class="card-body">
      <table id="keysTable" style="display:none">
        <thead><tr><th>Name</th><th>Status</th><th>Expires</th><th>Usage</th><th>Last used</th><th>Last IP</th><th></th></tr></thead>
        <tbody id="keysBody"></tbody>
      </table>
      <div class="empty" id="keysEmpty" style="display:none">No API keys yet</div>
    </div>
  </div>
</div>
<!-- end keys panel -->

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

// Inline SVG trash icon — uses currentColor so it inherits the button colour
// (red via .btn-danger). Source: assets/trash.svg.
const TRASH_ICON = '<svg width="14" height="14" viewBox="0 0 14 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="vertical-align:-2px"><path fill-opacity="0.35" d="M0 3.50876C0 3.12119 0.268629 2.80701 0.6 2.80701L2.67219 2.80664C3.08391 2.79443 3.44712 2.48825 3.58722 2.03528C3.5909 2.02337 3.59514 2.00868 3.61033 1.95538L3.69962 1.64204C3.75426 1.44992 3.80186 1.28254 3.86847 1.13293C4.13162 0.541884 4.6185 0.131454 5.18114 0.0263742C5.32356 -0.000223918 5.47438 -0.000111433 5.64749 1.77292e-05H8.35264C8.52576 -0.000111433 8.67658 -0.000223918 8.81899 0.0263742C9.38163 0.131454 9.86851 0.541884 10.1317 1.13293C10.1983 1.28254 10.2459 1.44992 10.3005 1.64204L10.3898 1.95538C10.405 2.00868 10.4092 2.02337 10.4129 2.03528C10.553 2.48825 10.9883 2.79481 11.4 2.80701H13.4C13.7314 2.80701 14 3.12119 14 3.50876C14 3.89632 13.7314 4.2105 13.4 4.2105H0.6C0.268629 4.2105 0 3.89632 0 3.50876Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M6.68547 16H7.31453C9.47887 16 10.561 16 11.2646 15.2913C11.9683 14.5825 12.0402 13.42 12.1842 11.0948L12.3917 7.74453C12.4698 6.48295 12.5088 5.85216 12.1558 5.45243C11.8029 5.0527 11.2068 5.0527 10.0146 5.0527H3.98537C2.79321 5.0527 2.19713 5.0527 1.84415 5.45243C1.49117 5.85216 1.53023 6.48295 1.60835 7.74454L1.81579 11.0948C1.95976 13.42 2.03175 14.5825 2.73536 15.2913C3.43897 16 4.52113 16 6.68547 16ZM5.63599 8.15083C5.60394 7.80375 5.31808 7.55053 4.99751 7.58524C4.67694 7.61994 4.44306 7.92944 4.47512 8.27652L4.86401 12.487C4.89606 12.8341 5.18192 13.0873 5.50249 13.0526C5.82305 13.0179 6.05694 12.7084 6.02488 12.3613L5.63599 8.15083ZM9.00249 7.58524C9.32306 7.61994 9.55694 7.92944 9.52488 8.27652L9.13599 12.487C9.10394 12.8341 8.81808 13.0873 8.49751 13.0526C8.17695 13.0179 7.94306 12.7084 7.97512 12.3613L8.36401 8.15083C8.39606 7.80375 8.68192 7.55053 9.00249 7.58524Z"/></svg>';

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
    stopFiltersPolling();
    $('loginBox').style.display = '';
    $('tabs').style.display = 'none';
    document.querySelectorAll('[data-panel]').forEach(p => p.style.display = 'none');
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
  tb.innerHTML = currentFilters.map((f) => {
    const expiryChip = (f.authorized && f.allowUntil)
      ? \`<span class="chip-expiry\${isExpired(f.allowUntil) ? ' expired' : ''}" onclick="editAllowExpiry('\${f.id}')" title="Click to change">&#x23F1; \${fmtRemaining(f.allowUntil)}</span>\`
      : '';
    return \`
    <tr data-id="\${f.id}">
      <td><span class="prio-val" id="prio-\${f.id}" onclick="editPriority('\${f.id}')" title="Click to edit" style="cursor:pointer;color:var(--text2)">\${f.priority}</span></td>
      <td><span class="mono" id="pat-\${f.id}">\${esc(f.pattern)}</span></td>
      <td><span class="badge \${f.authorized ? 'badge-green' : 'badge-red'}">\${f.authorized ? 'Allow' : 'Deny'}</span>\${expiryChip}</td>
      <td>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onclick="toggleFilter('\${f.id}', \${!f.authorized})" title="Toggle">\${f.authorized ? '&#x274C;' : '&#x2705;'}</button>
          <button class="btn btn-ghost btn-sm" onclick="editPattern('\${f.id}')" title="Edit pattern">&#x270E;</button>
          <button class="btn btn-danger btn-sm" onclick="deleteFilter('\${f.id}')" title="Delete">\${TRASH_ICON}</button>
        </div>
      </td>
    </tr>\`;
  }).join('');
}

function fmtTimeOfDay(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return hh + 'h' + mm + ':' + ss;
}

function fmtRemaining(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  const at = ' (' + fmtTimeOfDay(iso) + ')';
  if (diff <= 0) return 'expired' + at;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1m' + at;
  if (mins < 60) return mins + 'm left' + at;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ' + (mins % 60) + 'm left' + at;
  const days = Math.floor(hours / 24);
  return days + 'd ' + (hours % 24) + 'h left' + at;
}

// Modal prompting the admin for an allow duration.
// Resolves to { allowUntil: ISOstring | null } on confirm, or null if cancelled.
// allowUntil=null means permanent.
function promptAllowDuration({ pattern = '', current = null } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = \`
      <div class="modal">
        <h3>Allow filter <span class="mono">\${esc(pattern)}</span></h3>
        <p>How long should this filter stay authorized before reverting to deny?</p>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
          <input type="number" id="pDurVal" value="60" min="1" style="width:90px" />
          <select id="pDurUnit">
            <option value="60" selected>minutes</option>
            <option value="3600">hours</option>
            <option value="86400">days</option>
          </select>
        </div>
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:10px;font-size:13px;cursor:pointer;color:var(--text2)">
          <input type="checkbox" id="pPerm" style="cursor:pointer" />
          Permanent (no expiration)
        </label>
        <div id="pPermWarn" style="display:none;margin-bottom:14px;padding:10px 12px;background:var(--red-bg);border:1px solid var(--red-border);border-radius:var(--radius);color:var(--red);font-size:12px;line-height:1.5">
          &#x26A0;&#xFE0F; Cela laissera les tunnels associ&eacute;s constamment ouverts &#x26A0;&#xFE0F;
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="pCancel">Cancel</button>
          <button class="btn btn-primary" id="pConfirm">Allow</button>
        </div>
      </div>\`;
    document.body.appendChild(backdrop);

    const durVal = backdrop.querySelector('#pDurVal');
    const durUnit = backdrop.querySelector('#pDurUnit');
    const perm = backdrop.querySelector('#pPerm');
    const permWarn = backdrop.querySelector('#pPermWarn');

    perm.addEventListener('change', () => {
      durVal.disabled = perm.checked;
      durUnit.disabled = perm.checked;
      permWarn.style.display = perm.checked ? '' : 'none';
    });

    const close = (result) => { backdrop.remove(); resolve(result); };

    backdrop.querySelector('#pCancel').addEventListener('click', () => close(null));
    backdrop.querySelector('#pConfirm').addEventListener('click', () => {
      if (perm.checked) return close({ allowUntil: null });
      const n = parseInt(durVal.value, 10);
      const unitSec = parseInt(durUnit.value, 10);
      if (!n || n <= 0 || !unitSec) { toast('Invalid duration', 'error'); return; }
      const allowUntil = new Date(Date.now() + n * unitSec * 1000).toISOString();
      close({ allowUntil });
    });

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.addEventListener('keydown', function onKey(e) {
      if (!document.body.contains(backdrop)) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', onKey); }
      if (e.key === 'Enter') { backdrop.querySelector('#pConfirm').click(); }
    });

    (perm.checked ? perm : durVal).focus();
    if (!perm.checked) durVal.select();
  });
}

async function addFilter() {
  const pattern = $('newPattern').value.trim();
  const priority = parseFloat($('newPriority').value);
  if (!pattern) return toast('Pattern is required', 'error');
  if (isNaN(priority)) return toast('Priority must be a number', 'error');
  try {
    // New filters are always created as deny. To allow, the admin toggles
    // the row, which opens the duration modal (required to set allowUntil).
    await api('POST', '/api/filters', { pattern, authorized: false, priority });
    $('newPattern').value = '';
    $('newPriority').value = '0';
    toast('Filter added (deny)', 'success');
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
    const f = currentFilters.find(x => x.id === id);
    const payload = { authorized };
    if (authorized) {
      const chosen = await promptAllowDuration({ pattern: f?.pattern });
      if (!chosen) return;
      payload.allowUntil = chosen.allowUntil;
    } else {
      payload.allowUntil = null;
    }
    await api('PUT', '/api/filters/' + id, payload);
    toast('Filter updated', 'success');
    loadAll();
  } catch(e) { toast(e.message, 'error'); }
}

async function editAllowExpiry(id) {
  try {
    const f = currentFilters.find(x => x.id === id);
    if (!f) return;
    const chosen = await promptAllowDuration({ pattern: f.pattern, current: f.allowUntil });
    if (!chosen) return;
    await api('PUT', '/api/filters/' + id, { allowUntil: chosen.allowUntil });
    toast('Expiration updated', 'success');
    loadFilters();
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
let currentPending = [];

async function loadPending() {
  try {
    currentPending = await api('GET', '/api/tunnels/pending');
    renderPending();
  } catch(e) { /* silent for polling */ }
}

function renderPending() {
  const tb = $('pendingBody');
  const filterVal = ($('pendingFilter')?.value || '').trim();
  let regex = null;
  try { if (filterVal) regex = new RegExp(filterVal, 'i'); } catch(e) {}

  const filtered = regex ? currentPending.filter(p => regex.test(p.id)) : currentPending;
  $('pendingCount').textContent = \`(\${filtered.length}/\${currentPending.length})\`;

  if (!filtered.length) {
    tb.innerHTML = '';
    $('pendingTable').style.display = 'none';
    $('pendingEmpty').style.display = '';
    return;
  }
  $('pendingEmpty').style.display = 'none';
  $('pendingTable').style.display = '';
  tb.innerHTML = filtered.map(p => {
    const endpointHtml = p.endpoint && p.endpoint !== '-'
      ? \`<a href="\${esc(p.endpoint)}" target="_blank" style="color:var(--primary);text-decoration:none;font-size:13px">\${esc(p.endpoint)}</a>\`
      : \`<span style="font-size:13px">-</span>\`;
    const typeBadge = p.type === 'tcp'
      ? '<span class="badge badge-blue">TCP</span>'
      : p.type === 'udp'
      ? '<span class="badge badge-purple">UDP</span>'
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
      <td><span class="socket-count \${p.connectedSockets > 0 ? 'active' : ''}">\${p.type === 'tcp' && p.activeExternalConnections !== undefined ? p.activeExternalConnections + '/' : ''}\${p.type === 'udp' && p.activeSessions !== undefined ? p.activeSessions + '/' : ''}\${p.connectedSockets}</span></td>
    </tr>
  \`}).join('');
}

function startPendingPolling() {
  stopPendingPolling();
  pendingInterval = setInterval(loadPending, 2000);
}

function stopPendingPolling() {
  if (pendingInterval) { clearInterval(pendingInterval); pendingInterval = null; }
}

// Light polling so temporary-allow countdown chips stay in sync with the server.
let filtersInterval = null;
function startFiltersPolling() {
  stopFiltersPolling();
  filtersInterval = setInterval(() => {
    // If filters are displayed, re-render every tick and refetch every 3rd tick.
    renderFilters();
  }, 5000);
  // Also refetch from server every 15s to catch auto-flips triggered by the store.
  filtersInterval._refetch = setInterval(loadFilters, 15000);
}
function stopFiltersPolling() {
  if (filtersInterval) {
    clearInterval(filtersInterval);
    if (filtersInterval._refetch) clearInterval(filtersInterval._refetch);
    filtersInterval = null;
  }
}

// --- Tabs ---
let currentTab = 'dashboard';

function switchTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('[data-panel]').forEach(p => p.style.display = (p.dataset.panel === name) ? 'flex' : 'none');
  if (name === 'keys') loadKeys();
}

// --- API Keys ---
let currentKeys = [];

async function loadKeys() {
  try {
    currentKeys = await api('GET', '/api/keys');
    renderKeys();
  } catch(e) {
    // Not fatal — keys are optional (only when authRequired=true on the server)
    currentKeys = [];
    renderKeys();
    if (e.message && !/disabled|not ready/i.test(e.message)) toast(e.message, 'error');
  }
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function fmtRelative(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff/60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff/3_600_000) + 'h ago';
  return Math.floor(diff/86_400_000) + 'd ago';
}

function isExpired(iso) {
  if (!iso) return false;
  return new Date(iso).getTime() <= Date.now();
}

function renderKeys() {
  const tb = $('keysBody');
  const filterVal = ($('keysFilter')?.value || '').trim();
  let regex = null;
  try { if (filterVal) regex = new RegExp(filterVal, 'i'); } catch(e) {}
  const filtered = regex ? currentKeys.filter(k => regex.test(k.name)) : currentKeys;

  $('keysCount').textContent = currentKeys.length ? \`(\${filtered.length}/\${currentKeys.length})\` : '';
  if (!filtered.length) {
    tb.innerHTML = '';
    $('keysTable').style.display = 'none';
    $('keysEmpty').style.display = '';
    $('keysEmpty').textContent = currentKeys.length ? 'No match' : 'No API keys yet';
    return;
  }
  $('keysEmpty').style.display = 'none';
  $('keysTable').style.display = '';
  tb.innerHTML = filtered.map(k => {
    const expired = isExpired(k.expiresAt);
    const statusBadge = !k.active
      ? '<span class="badge badge-red">Inactive</span>'
      : expired
      ? '<span class="badge badge-yellow">Expired</span>'
      : '<span class="badge badge-green">Active</span>';
    return \`
    <tr data-id="\${k.id}">
      <td><span class="mono" id="kname-\${k.id}" onclick="editKeyName('\${k.id}')" title="Click to rename" style="cursor:pointer">\${esc(k.name)}</span></td>
      <td>\${statusBadge}</td>
      <td><span id="kexp-\${k.id}" onclick="editKeyExpires('\${k.id}')" title="Click to edit" style="cursor:pointer;font-size:13px;color:var(--text2)">\${fmtDate(k.expiresAt)}</span></td>
      <td><span style="font-size:13px">\${k.usageCount ?? 0}</span></td>
      <td><span style="font-size:13px;color:var(--text2)" title="\${esc(fmtDate(k.lastUsedAt))}">\${fmtRelative(k.lastUsedAt)}</span></td>
      <td><span class="mono" style="font-size:12px">\${esc(k.lastIp || '-')}</span></td>
      <td>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onclick="toggleKey('\${k.id}', \${!k.active})" title="\${k.active ? 'Deactivate' : 'Activate'}">\${k.active ? '&#x274C;' : '&#x2705;'}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteKey('\${k.id}', '\${esc(k.name)}')" title="Delete">\${TRASH_ICON}</button>
        </div>
      </td>
    </tr>\`;
  }).join('');
}

async function createKey() {
  const name = $('newKeyName').value.trim();
  const expiresRaw = $('newKeyExpires').value;
  if (!name) return toast('Name is required', 'error');
  const payload = { name };
  if (expiresRaw) payload.expiresAt = new Date(expiresRaw).toISOString();
  try {
    const created = await api('POST', '/api/keys', payload);
    $('newKeyName').value = '';
    $('newKeyExpires').value = '';
    showKeyRevealModal(created);
    loadKeys();
  } catch(e) { toast(e.message, 'error'); }
}

function showKeyRevealModal(created) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = \`
    <div class="modal">
      <h3>API key created — "\${esc(created.name)}"</h3>
      <p>Copy this key now. It will <strong>not</strong> be shown again. Anyone with this value can authenticate as this client.</p>
      <div class="key-reveal" id="revealedKey">\${esc(created.key)}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="this.closest('.modal-backdrop').remove()">Close</button>
        <button class="btn btn-primary" id="copyKeyBtn">Copy</button>
      </div>
    </div>\`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#copyKeyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(created.key).then(
      () => toast('Key copied', 'success'),
      () => toast('Copy failed', 'error')
    );
  });
}

async function toggleKey(id, active) {
  try {
    await api('PATCH', '/api/keys/' + id, { active });
    toast('Key updated', 'success');
    loadKeys();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteKey(id, name) {
  if (!confirm(\`Delete key "\${name}"? This cannot be undone.\`)) return;
  try {
    await api('DELETE', '/api/keys/' + id);
    toast('Key deleted', 'success');
    loadKeys();
  } catch(e) { toast(e.message, 'error'); }
}

function editKeyName(id) {
  const k = currentKeys.find(x => x.id === id);
  if (!k) return;
  inlineEdit('kname-' + id, k.name, async (val) => {
    try {
      await api('PATCH', '/api/keys/' + id, { name: val });
      toast('Name updated', 'success');
      loadKeys();
    } catch(e) { toast(e.message, 'error'); renderKeys(); }
  });
}

function editKeyExpires(id) {
  const k = currentKeys.find(x => x.id === id);
  if (!k) return;
  const current = k.expiresAt ? k.expiresAt.slice(0, 16) : '';
  const el = $('kexp-' + id);
  el.innerHTML = \`<input class="edit-input" id="ie-kexp-\${id}" type="datetime-local" value="\${current}" />\`;
  const input = $('ie-kexp-' + id);
  input.focus();
  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const raw = input.value;
    const expiresAt = raw ? new Date(raw).toISOString() : null;
    if (expiresAt === k.expiresAt) { renderKeys(); return; }
    try {
      await api('PATCH', '/api/keys/' + id, { expiresAt });
      toast('Expiration updated', 'success');
      loadKeys();
    } catch(e) { toast(e.message, 'error'); renderKeys(); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { saved = true; renderKeys(); } });
  input.addEventListener('blur', save);
}

// --- Load all ---
async function loadAll() {
  try {
    await Promise.all([loadFilters(), loadPending()]);
    setStatus(true);
    $('loginBox').style.display = 'none';
    $('tabs').style.display = '';
    switchTab(currentTab);
    startPendingPolling();
    startFiltersPolling();
  } catch(e) { setStatus(false); stopPendingPolling(); stopFiltersPolling(); }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Support Enter key on login fields
$('adminUser').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('adminPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
</script>
</body>
</html>`;
}
