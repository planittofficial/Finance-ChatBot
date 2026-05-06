'use strict';

function formatINR(n) {
  const num = Number(n || 0);
  return num.toLocaleString('en-IN');
}

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let ALL_LEADS = [];

async function api(path, opts) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts && opts.headers ? opts.headers : {}) },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json && json.error ? json.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

function renderLeads(leads) {
  const tbody = el('leads-tbody');
  tbody.innerHTML = '';

  const empty = el('empty-state');
  if (!leads || leads.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }

  leads.forEach((lead) => {
    const tr = document.createElement('tr');

    const name = lead.name ? escapeHtml(lead.name) : '';
    const phone = lead.phone ? escapeHtml(lead.phone) : '';
    const address = lead.address ? escapeHtml(lead.address) : '';
    const salary = typeof lead.monthlySalary === 'number' ? `₹${formatINR(lead.monthlySalary)}` : '';

    const peak = lead.peakInsight || '';
    const arr = Array.isArray(lead.keyFinancialInsights) ? lead.keyFinancialInsights.filter(Boolean) : [];

    const convoDtRaw = lead.conversationCompletedAt || lead.conversationStartedAt || lead.createdAt || lead.updatedAt;
    const convoDt = convoDtRaw ? new Date(convoDtRaw) : null;
    const convoText = convoDt && !Number.isNaN(convoDt.getTime())
      ? convoDt.toLocaleString()
      : '—';

    const insightsHtml = (() => {
      if (arr.length > 0) {
        const items = arr.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
        return `
          <div class="insights">
            <div class="small">${peak ? escapeHtml(String(peak).slice(0, 140)) : ''}</div>
            <details>
              <summary>View all insights (${arr.length})</summary>
              <ul>${items}</ul>
            </details>
          </div>
        `;
      }
      return `<div class="small">${peak ? escapeHtml(String(peak)) : '—'}</div>`;
    })();

    tr.innerHTML = `
      <td class="small">${convoText}</td>
      <td>${name}</td>
      <td>${phone}</td>
      <td>${address}</td>
      <td>${salary}</td>
      <td>${insightsHtml}</td>
    `;

    tbody.appendChild(tr);
  });

  el('total-count').textContent = String(leads.length);
}

function applySearch() {
  const q = (el('search')?.value || '').trim().toLowerCase();
  if (!q) {
    renderLeads(ALL_LEADS);
    return;
  }

  const filtered = ALL_LEADS.filter((lead) => {
    const hay = [lead.name, lead.phone, lead.address]
      .filter(Boolean)
      .map(String)
      .join(' | ')
      .toLowerCase();
    return hay.includes(q);
  });

  renderLeads(filtered);
}

async function loadLeads() {
  el('leads-error').textContent = '';
  const data = await api('/api/admin/leads?limit=200');
  ALL_LEADS = Array.isArray(data.leads) ? data.leads : [];
  applySearch();
}

async function checkSession() {
  try {
    const me = await api('/api/admin/me', { method: 'GET' });
    el('whoami').textContent = me.username || 'admin';
    el('login-card').classList.add('hidden');
    el('leads-card').classList.remove('hidden');
    await loadLeads();
  } catch (_e) {
    el('login-card').classList.remove('hidden');
    el('leads-card').classList.add('hidden');
  }
}

async function onLogin(e) {
  e.preventDefault();
  el('login-error').textContent = '';
  const username = el('username').value.trim();
  const password = el('password').value;

  try {
    const res = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    el('whoami').textContent = res.username || username;
    el('login-card').classList.add('hidden');
    el('leads-card').classList.remove('hidden');
    await loadLeads();
  } catch (err) {
    el('login-error').textContent = err.message;
  }
}

async function onLogout() {
  try {
    await api('/api/admin/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch (_e) {
    // ignore
  }
  el('whoami').textContent = '—';
  el('login-card').classList.remove('hidden');
  el('leads-card').classList.add('hidden');
}

async function onRefresh() {
  try {
    await loadLeads();
  } catch (err) {
    el('leads-error').textContent = err.message;
  }
}

function onClear() {
  if (!el('search')) return;
  el('search').value = '';
  applySearch();
}

window.addEventListener('DOMContentLoaded', () => {
  el('login-form').addEventListener('submit', onLogin);
  el('btn-logout').addEventListener('click', onLogout);
  el('btn-refresh').addEventListener('click', onRefresh);
  el('btn-clear')?.addEventListener('click', onClear);
  el('search')?.addEventListener('input', applySearch);
  checkSession();
});
