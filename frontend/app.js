// ===========================
// State
// ===========================
const state = {
  clients: [],
  currentPage: 1,
  totalPages: 1,
  total: 0,
  search: '',
  filterType: '',
  filterActive: '',
  editingClientId: null,
  isResidentValue: false,
  cityValue: 'astana',
};

// ===========================
// API
// ===========================
function getApiBase() {
  return (document.getElementById('api-url-input').value || 'http://localhost:8989/api').replace(/\/$/, '');
}

async function apiFetch(path, options = {}) {
  const url = getApiBase() + path;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(data?.message || data || `HTTP ${res.status}`);
  return data;
}

// ===========================
// Toast
// ===========================
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ===========================
// API Health Check
// ===========================
async function checkApiHealth() {
  const dot = document.getElementById('api-status').querySelector('.status-dot');
  const text = document.getElementById('api-status').querySelector('.status-text');
  try {
    await apiFetch('/health');
    dot.className = 'status-dot online';
    text.textContent = 'API онлайн';
  } catch {
    dot.className = 'status-dot offline';
    text.textContent = 'API недоступен';
  }
}

// ===========================
// Clients
// ===========================
async function loadClients(page = 1) {
  state.currentPage = page;
  const tbody = document.getElementById('clients-tbody');
  tbody.innerHTML = `<tr><td colspan="8" class="loading-row"><div class="spinner"></div> Загрузка...</td></tr>`;
  try {
    let path = `/clients?page=${page}&limit=15`;
    const data = await apiFetch(path);
    const items = data.data || data.clients || data || [];
    state.clients = items;
    state.totalPages = data.totalPages || Math.ceil((data.total || items.length) / 15) || 1;
    state.total = data.total || items.length;
    renderClientsTable(items);
    renderPagination('clients-pagination', state.currentPage, state.totalPages, loadClients);
    populateGroupClientSelect(items);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">❌ Ошибка: ${e.message}</td></tr>`;
  }
}

function renderClientsTable(clients) {
  const tbody = document.getElementById('clients-tbody');
  if (!clients.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Нет аккаунтов</td></tr>`;
    return;
  }

  const searchVal = state.search.toLowerCase();
  const filtered = clients.filter(c => {
    const matchSearch = !searchVal || c.email?.toLowerCase().includes(searchVal);
    const matchType = !state.filterType ||
      (state.filterType === 'resident' && c.isResident) ||
      (state.filterType === 'non-resident' && !c.isResident);
    const matchActive = !state.filterActive ||
      (state.filterActive === 'true' && c.isActive) ||
      (state.filterActive === 'false' && !c.isActive);
    return matchSearch && matchType && matchActive;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Нет аккаунтов по фильтру</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(client => {
    const statusBadge = client.isActive
      ? `<span class="badge badge-success">● Активен</span>`
      : `<span class="badge badge-danger">● Неактивен</span>`;
    const typeBadge = client.isResident
      ? `<span class="badge badge-info">Резидент</span>`
      : `<span class="badge badge-muted">Нерезидент</span>`;
    const groupsCount = client.visaGroups?.length ?? '—';
    const lastProcessed = client.lastProcessedAt
      ? new Date(client.lastProcessedAt).toLocaleDateString('ru', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '—';

    return `
      <tr>
        <td><span style="color:var(--text-muted);font-size:12px;">#${client.id}</span></td>
        <td>
          <div style="font-weight:500;">${client.email}</div>
          ${client.companyEmail ? `<div style="font-size:11.5px;color:var(--text-muted);">${client.companyEmail}</div>` : ''}
        </td>
        <td>${typeBadge}</td>
        <td>${statusBadge}</td>
        <td><span class="badge badge-accent">${groupsCount} групп</span></td>
        <td><span style="font-size:12.5px;color:var(--text-secondary);">${client.queueIndex ?? '—'}</span></td>
        <td><span style="font-size:12.5px;color:var(--text-secondary);">${lastProcessed}</span></td>
        <td>
          <div class="actions">
            <button class="action-btn" onclick="openGroupsForClient(${client.id})" title="Группы">🗂️</button>
            <button class="action-btn ${client.isActive ? 'danger' : 'success'}" 
              onclick="toggleClientActive(${client.id}, ${!client.isActive})" 
              title="${client.isActive ? 'Деактивировать' : 'Активировать'}">
              ${client.isActive ? '⏸' : '▶'}
            </button>
            <button class="action-btn danger" onclick="deleteClient(${client.id}, '${client.email}')" title="Удалить">🗑</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function toggleClientActive(id, newValue) {
  try {
    await apiFetch(`/clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: newValue }),
    });
    showToast(`Аккаунт ${newValue ? 'активирован' : 'деактивирован'}`, 'success');
    loadClients(state.currentPage);
  } catch (e) {
    showToast(`Ошибка: ${e.message}`, 'error');
  }
}

async function deleteClient(id, email) {
  if (!confirm(`Удалить аккаунт ${email}? Это действие необратимо.`)) return;
  try {
    await apiFetch(`/clients/${id}`, { method: 'DELETE' });
    showToast('Аккаунт удалён', 'success');
    loadClients(state.currentPage);
  } catch (e) {
    showToast(`Ошибка: ${e.message}`, 'error');
  }
}

// ===========================
// Pagination
// ===========================
function renderPagination(containerId, currentPage, totalPages, onPageChange) {
  const container = document.getElementById(containerId);
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = `<button ${currentPage === 1 ? 'disabled' : ''} onclick="${onPageChange.name}(${currentPage - 1})">‹</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
      html += `<button class="${i === currentPage ? 'active' : ''}" onclick="${onPageChange.name}(${i})">${i}</button>`;
    } else if (Math.abs(i - currentPage) === 2) {
      html += `<button disabled>…</button>`;
    }
  }
  html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="${onPageChange.name}(${currentPage + 1})">›</button>`;
  container.innerHTML = html;
}

// ===========================
// Client Modal
// ===========================
function openAddClientModal() {
  state.editingClientId = null;
  state.isResidentValue = false;
  document.getElementById('client-modal-title').textContent = 'Добавить аккаунт';
  document.getElementById('client-email').value = '';
  document.getElementById('client-password').value = '';
  document.getElementById('client-company-email').value = '';
  document.getElementById('client-password').required = true;
  document.getElementById('password-group').style.display = '';
  document.getElementById('manual-mode-toggle').checked = false;
  document.getElementById('manual-groups-group').style.display = 'none';
  document.getElementById('manual-groups-list').innerHTML = createManualGroupHTML(0);
  setTypeValue(false);
  document.getElementById('client-modal').classList.add('open');
}

function createManualGroupHTML(index) {
  return `
    <div class="manual-group-item" data-index="${index}">
      <div class="form-row">
        <div class="form-col">
          <label class="form-label-sm">Schedule Path</label>
          <input type="text" class="form-input" name="schedulePath" placeholder="/ru-kz/niv/schedule/12345/appointment" />
        </div>
        <div class="form-col" style="max-width:160px">
          <label class="form-label-sm">Статус</label>
          <select class="form-input" name="status">
            <option value="register">register</option>
            <option value="attend">attend</option>
            <option value="pay_fee">pay_fee</option>
          </select>
        </div>
        <button type="button" class="btn-remove-group" onclick="this.closest('.manual-group-item').remove()">✕</button>
      </div>
    </div>`;
}

function setTypeValue(isResident) {
  state.isResidentValue = isResident;
  document.getElementById('type-non-resident').classList.toggle('active', !isResident);
  document.getElementById('type-resident').classList.toggle('active', isResident);
}

async function saveClient() {
  const email = document.getElementById('client-email').value.trim();
  const password = document.getElementById('client-password').value.trim();
  const companyEmail = document.getElementById('client-company-email').value.trim();
  const isManual = document.getElementById('manual-mode-toggle').checked;

  if (!email) { showToast('Введите email', 'error'); return; }

  const saveBtn = document.getElementById('client-modal-save');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<div class="spinner"></div> Сохранение...';

  try {
    if (isManual) {
      // Manual mode
      const items = document.querySelectorAll('.manual-group-item');
      const groups = [];
      items.forEach(item => {
        const sp = item.querySelector('[name="schedulePath"]').value.trim();
        const st = item.querySelector('[name="status"]').value;
        if (sp) groups.push({ schedulePath: sp, status: st });
      });
      if (!password) { showToast('Введите пароль', 'error'); return; }
      await apiFetch('/clients/manual', {
        method: 'POST',
        body: JSON.stringify({ email, password, isResident: state.isResidentValue, companyEmail: companyEmail || undefined, groups }),
      });
    } else {
      if (!password) { showToast('Введите пароль', 'error'); return; }
      await apiFetch('/clients', {
        method: 'POST',
        body: JSON.stringify({ email, password, isResident: state.isResidentValue, companyEmail: companyEmail || undefined }),
      });
    }

    showToast('Аккаунт добавлен! Идёт синхронизация с посольством...', 'success', 6000);
    document.getElementById('client-modal').classList.remove('open');
    setTimeout(() => loadClients(1), 2000);
  } catch (e) {
    showToast(`Ошибка: ${e.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить';
  }
}

// ===========================
// Groups View
// ===========================
function populateGroupClientSelect(clients) {
  const sel = document.getElementById('group-client-select');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">— Выберите аккаунт —</option>';
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.email} (ID: ${c.id})`;
    sel.appendChild(opt);
  });
  if (currentVal) sel.value = currentVal;
}

async function loadGroupsForClient(clientId) {
  const container = document.getElementById('groups-container');
  if (!clientId) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🗂️</div><p>Выберите аккаунт для просмотра групп</p></div>`;
    return;
  }
  container.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`;
  try {
    const groups = await apiFetch(`/clients/${clientId}/visa-groups`);
    renderGroupCards(groups, clientId);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>❌ Ошибка: ${e.message}</p></div>`;
  }
}

function renderGroupCards(groups, clientId) {
  const container = document.getElementById('groups-container');
  if (!groups || !groups.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🗂️</div><p>У этого аккаунта нет групп</p></div>`;
    return;
  }

  container.innerHTML = groups.map(g => {
    const matchStatusColors = {
      NEW: 'badge-muted',
      REMATCH_REQUIRED: 'badge-warning',
      MATCH_PENDING: 'badge-info',
      BOOKING_IN_PROGRESS: 'badge-warning',
      BOOKED: 'badge-success',
    };
    const statusBadgeClass = matchStatusColors[g.matchStatus] || 'badge-muted';
    const isActiveClass = g.isActive ? 'badge-success' : 'badge-danger';

    const applicants = g.applicants?.map(a => a.name || a.ivrNumber).join(', ') || '—';

    return `
      <div class="group-card">
        <div class="group-card-header">
          <div class="group-card-title">
            <span>Группа #${g.id}</span>
            <span class="badge ${isActiveClass}">${g.isActive ? 'Активна' : 'Неактивна'}</span>
            <span class="badge ${statusBadgeClass}">${g.matchStatus || 'NEW'}</span>
            ${g.status ? `<span class="badge badge-muted">${g.status}</span>` : ''}
          </div>
          <div class="group-card-actions">
            <button class="btn btn-primary btn-sm" onclick="openMatchingModal(${clientId}, ${g.id}, ${JSON.stringify(g).replace(/"/g, '&quot;')})">
              ⚙️ Настроить
            </button>
            <button class="action-btn ${g.isActive ? 'danger' : 'success'}"
              onclick="toggleGroupActive(${clientId}, ${g.id}, ${!g.isActive})"
              title="${g.isActive ? 'Деактивировать группу' : 'Активировать группу'}">
              ${g.isActive ? '⏸' : '▶'}
            </button>
          </div>
        </div>
        <div class="group-card-body">
          <div class="group-info-item">
            <span class="group-info-label">Schedule Path</span>
            <span class="group-path">${g.schedulePath || '—'}</span>
          </div>
          <div class="group-info-item">
            <span class="group-info-label">Город</span>
            <span class="group-info-value">${g.city ? '🏙️ ' + g.city : '—'}</span>
          </div>
          <div class="group-info-item">
            <span class="group-info-label">Окно поиска</span>
            <span class="group-info-value">${g.slotStartDate && g.slotEndDate ? g.slotStartDate + ' — ' + g.slotEndDate : '—'}</span>
          </div>
          <div class="group-info-item">
            <span class="group-info-label">Задержка</span>
            <span class="group-info-value">${g.delayDays ?? 0} дн.</span>
          </div>
          <div class="group-info-item">
            <span class="group-info-label">Автозапись</span>
            <span class="group-info-value">${g.isAutoBookEnabled ? '<span class="badge badge-success">Вкл</span>' : '<span class="badge badge-muted">Выкл</span>'}</span>
          </div>
          <div class="group-info-item">
            <span class="group-info-label">Участников</span>
            <span class="group-info-value">${g.applicantsCount ?? (g.applicants?.length ?? '—')}</span>
          </div>
          <div class="group-info-item">
            <span class="group-info-label">Заявители</span>
            <span class="group-info-value" style="font-size:12.5px;color:var(--text-secondary);">${applicants}</span>
          </div>
          ${g.candidateSlot ? `
          <div class="group-info-item">
            <span class="group-info-label">Кандидат-слот</span>
            <span class="group-info-value"><span class="badge badge-info">📅 ${g.candidateSlot.date} · ${g.candidateSlot.city}</span></span>
          </div>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function toggleGroupActive(clientId, groupId, newValue) {
  try {
    await apiFetch(`/clients/${clientId}`, {
      method: 'PATCH',
      body: JSON.stringify({ visaGroupId: groupId, isActive: newValue }),
    });
    showToast(`Группа ${newValue ? 'активирована' : 'деактивирована'}`, 'success');
    loadGroupsForClient(clientId);
  } catch (e) {
    showToast(`Ошибка: ${e.message}`, 'error');
  }
}

function openGroupsForClient(clientId) {
  // Switch to groups view and select client
  switchView('groups');
  document.getElementById('group-client-select').value = clientId;
  loadGroupsForClient(clientId);
}

// ===========================
// Matching Modal
// ===========================
function openMatchingModal(clientId, groupId, group) {
  document.getElementById('matching-client-id').value = clientId;
  document.getElementById('matching-group-id').value = groupId;

  const info = document.getElementById('matching-group-info');
  info.innerHTML = `
    <strong>Группа #${group.id}</strong>
    <span style="font-size:12px;color:var(--text-muted);">${group.schedulePath || 'Путь не задан'}</span>
  `;

  // Prefill existing values
  const currentCity = group.city || 'astana';
  setCityValue(currentCity);

  // Prefill dates using date picker
  window.dpStart.setFromString(group.slotStartDate || '');
  window.dpEnd.setFromString(group.slotEndDate || '');

  document.getElementById('delay-days').value = group.delayDays ?? 0;
  document.getElementById('applicants-count').value = group.applicantsCount || group.applicants?.length || '';
  document.getElementById('auto-book-toggle').checked = !!group.isAutoBookEnabled;

  document.getElementById('matching-modal').classList.add('open');
}

function setCityValue(city) {
  state.cityValue = city;
  document.getElementById('city-astana').classList.toggle('active', city === 'astana');
  document.getElementById('city-almaty').classList.toggle('active', city === 'almaty');
}

async function saveMatching() {
  const clientId = document.getElementById('matching-client-id').value;
  const groupId = document.getElementById('matching-group-id').value;
  const slotStartDate = window.dpStart.getApiValue();
  const slotEndDate   = window.dpEnd.getApiValue();
  const delayDays = parseInt(document.getElementById('delay-days').value) || 0;
  const applicantsCount = parseInt(document.getElementById('applicants-count').value) || undefined;
  const isAutoBookEnabled = document.getElementById('auto-book-toggle').checked;

  if (!slotStartDate || !slotEndDate) {
    showToast('Укажите даты начала и конца поиска', 'error');
    return;
  }

  const saveBtn = document.getElementById('matching-modal-save');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<div class="spinner"></div> Сохранение...';

  try {
    await apiFetch(`/clients/${clientId}/visa-groups/setup-matching`, {
      method: 'POST',
      body: JSON.stringify({
        visaGroupId: parseInt(groupId),
        city: state.cityValue,
        slotStartDate,
        slotEndDate,
        delayDays,
        isAutoBookEnabled,
        ...(applicantsCount ? { applicantsCount } : {}),
      }),
    });
    showToast('Настройки поиска сохранены!', 'success');
    document.getElementById('matching-modal').classList.remove('open');
    loadGroupsForClient(clientId);
  } catch (e) {
    showToast(`Ошибка: ${e.message}`, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить настройки';
  }
}

// ===========================
// Navigation
// ===========================
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(`view-${view}`).classList.add('active');
  document.getElementById(`nav-${view}`).classList.add('active');
  document.getElementById('page-title').textContent = view === 'clients' ? 'Аккаунты' : 'Группы виз';

  const addBtn = document.getElementById('add-client-btn');
  addBtn.style.display = view === 'clients' ? '' : 'none';
}

// ===========================
// Event Listeners
// ===========================
document.addEventListener('DOMContentLoaded', () => {
  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      switchView(item.dataset.view);
    });
  });

  // Clients
  document.getElementById('add-client-btn').addEventListener('click', openAddClientModal);
  document.getElementById('refresh-clients-btn').addEventListener('click', () => loadClients(state.currentPage));

  // Search/filter
  document.getElementById('search-clients').addEventListener('input', e => {
    state.search = e.target.value;
    renderClientsTable(state.clients);
  });
  document.getElementById('filter-type').addEventListener('change', e => {
    state.filterType = e.target.value;
    renderClientsTable(state.clients);
  });
  document.getElementById('filter-active').addEventListener('change', e => {
    state.filterActive = e.target.value;
    renderClientsTable(state.clients);
  });

  // Client modal
  document.getElementById('client-modal-close').addEventListener('click', () => {
    document.getElementById('client-modal').classList.remove('open');
  });
  document.getElementById('client-modal-cancel').addEventListener('click', () => {
    document.getElementById('client-modal').classList.remove('open');
  });
  document.getElementById('client-modal-save').addEventListener('click', saveClient);
  document.getElementById('client-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  // Resident toggle
  document.getElementById('type-non-resident').addEventListener('click', () => setTypeValue(false));
  document.getElementById('type-resident').addEventListener('click', () => setTypeValue(true));

  // Manual mode
  document.getElementById('manual-mode-toggle').addEventListener('change', e => {
    document.getElementById('manual-groups-group').style.display = e.target.checked ? '' : 'none';
  });
  document.getElementById('add-group-btn').addEventListener('click', () => {
    const list = document.getElementById('manual-groups-list');
    const count = list.querySelectorAll('.manual-group-item').length;
    list.insertAdjacentHTML('beforeend', createManualGroupHTML(count));
  });

  // Matching modal
  document.getElementById('matching-modal-close').addEventListener('click', () => {
    document.getElementById('matching-modal').classList.remove('open');
  });
  document.getElementById('matching-modal-cancel').addEventListener('click', () => {
    document.getElementById('matching-modal').classList.remove('open');
  });
  document.getElementById('matching-modal-save').addEventListener('click', saveMatching);
  document.getElementById('matching-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  // City toggle in matching modal
  document.getElementById('city-astana').addEventListener('click', () => setCityValue('astana'));
  document.getElementById('city-almaty').addEventListener('click', () => setCityValue('almaty'));

  // Groups view: client select
  document.getElementById('group-client-select').addEventListener('change', e => {
    loadGroupsForClient(e.target.value);
  });
  document.getElementById('refresh-groups-btn').addEventListener('click', () => {
    const sel = document.getElementById('group-client-select');
    loadGroupsForClient(sel.value);
  });

  // API URL change → recheck health
  document.getElementById('api-url-input').addEventListener('change', () => {
    checkApiHealth();
    loadClients(1);
  });

  // Init
  checkApiHealth();
  loadClients(1);
  setInterval(checkApiHealth, 30000);

  // Init date pickers
  window.dpStart = new DatePicker('dp-start-wrap', 'slot-start-date', 'dp-start-popup');
  window.dpEnd   = new DatePicker('dp-end-wrap',   'slot-end-date',   'dp-end-popup');
});

// ===========================
// DatePicker Component
// ===========================
class DatePicker {
  constructor(wrapId, inputId, popupId) {
    this.wrap  = document.getElementById(wrapId);
    this.input = document.getElementById(inputId);
    this.popup = document.getElementById(popupId);
    this.selectedDate = null;
    this.viewDate = new Date();
    this.viewDate.setDate(1);

    this.MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    this.DAYS   = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

    this._build();
    this._bindEvents();
  }

  _build() {
    this.popup.innerHTML = `
      <div class="dp-header">
        <button type="button" class="dp-nav-btn dp-prev">‹</button>
        <span class="dp-month-year"></span>
        <button type="button" class="dp-nav-btn dp-next">›</button>
      </div>
      <div class="dp-weekdays">${this.DAYS.map(d => `<div class="dp-weekday">${d}</div>`).join('')}</div>
      <div class="dp-days"></div>
      <div class="dp-footer">
        <button type="button" class="dp-clear-btn">Очистить</button>
        <button type="button" class="dp-today-btn">Сегодня</button>
      </div>`;
    this._render();
  }

  _bindEvents() {
    this.input.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.toggle(); });
    this.popup.querySelector('.dp-prev').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.viewDate.setMonth(this.viewDate.getMonth() - 1); this._render(); });
    this.popup.querySelector('.dp-next').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.viewDate.setMonth(this.viewDate.getMonth() + 1); this._render(); });
    this.popup.querySelector('.dp-clear-btn').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.setValue(null); this.close(); });
    this.popup.querySelector('.dp-today-btn').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.setValue(new Date()); this.close(); });
    this.popup.addEventListener('click', (e) => { e.stopPropagation(); });

    document.addEventListener('click', (e) => {
      if (!this.wrap.contains(e.target)) this.close();
    });
  }

  _render() {
    const year  = this.viewDate.getFullYear();
    const month = this.viewDate.getMonth();
    this.popup.querySelector('.dp-month-year').textContent = `${this.MONTHS[month]} ${year}`;

    const today = new Date(); today.setHours(0,0,0,0);
    const firstDay = new Date(year, month, 1);
    // Monday-based week: 0=Mon..6=Sun
    let startDow = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev  = new Date(year, month, 0).getDate();

    let html = '';
    // Leading days from previous month
    for (let i = startDow - 1; i >= 0; i--) {
      html += `<button type="button" class="dp-day dp-day-other">${daysInPrev - i}</button>`;
    }
    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const isToday    = date.getTime() === today.getTime();
      const isSelected = this.selectedDate && date.getTime() === this._midnight(this.selectedDate).getTime();
      const cls = ['dp-day', isToday ? 'dp-day-today' : '', isSelected ? 'dp-day-selected' : ''].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-date="${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}">${d}</button>`;
    }
    // Trailing
    const totalCells = startDow + daysInMonth;
    const trailing = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= trailing; d++) {
      html += `<button type="button" class="dp-day dp-day-other">${d}</button>`;
    }

    const daysEl = this.popup.querySelector('.dp-days');
    daysEl.innerHTML = html;
    daysEl.querySelectorAll('.dp-day[data-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [y, m, d] = btn.dataset.date.split('-').map(Number);
        this.setValue(new Date(y, m - 1, d));
        this.close();
      });
    });
  }

  _midnight(date) {
    const d = new Date(date);
    d.setHours(0,0,0,0);
    return d;
  }

  _formatDate(date) {
    const d = String(date.getDate()).padStart(2,'0');
    const m = String(date.getMonth() + 1).padStart(2,'0');
    const y = date.getFullYear();
    return `${d}.${m}.${y}`;
  }

  // Format for API: YYYY-MM-DD
  _apiFormat(date) {
    const d = String(date.getDate()).padStart(2,'0');
    const m = String(date.getMonth() + 1).padStart(2,'0');
    const y = date.getFullYear();
    return `${y}-${m}-${d}`;
  }

  setValue(date) {
    this.selectedDate = date;
    if (date) {
      this.input.value = this._formatDate(date);
      // Store API value as data attribute for easy retrieval in saveMatching
      this.input.dataset.apiValue = this._apiFormat(date);
      this.viewDate = new Date(date.getFullYear(), date.getMonth(), 1);
    } else {
      this.input.value = '';
      this.input.dataset.apiValue = '';
    }
    this._render();
  }

  // Set value from existing string (dd.mm.yyyy or YYYY-MM-DD)
  setFromString(str) {
    if (!str) { this.setValue(null); return; }
    let date = null;
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      date = new Date(str.slice(0, 10));
    } else if (/^\d{2}\.\d{2}/.test(str)) {
      const parts = str.split('.');
      const d = parseInt(parts[0]), m = parseInt(parts[1]);
      const y = parts[2] ? parseInt(parts[2]) : new Date().getFullYear();
      date = new Date(y, m - 1, d);
    }
    if (date && !isNaN(date)) this.setValue(date);
    else { this.input.value = str; this.input.dataset.apiValue = str; }
  }

  getApiValue() {
    return this.input.dataset.apiValue || this.input.value || '';
  }

  open()   { this.popup.classList.add('open'); this._render(); }
  close()  { this.popup.classList.remove('open'); }
  toggle() { this.popup.classList.contains('open') ? this.close() : this.open(); }
}
