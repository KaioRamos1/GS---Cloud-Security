'use strict';

const $ = id => document.getElementById(id);
const money = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});
const kilometers = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1});
const form = $('vehicle-form');
const dialog = $('vehicle-dialog');
const field = name => form.elements.namedItem(name);
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let vehicles = [];
let selectedFilter = 'all';
let saving = false;
let loadVersion = 0;
let customFuelOption = null;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: {'Content-Type': 'application/json', 'X-Requested-With': 'MinhaFrota'},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 204) return null;
  if (!(response.headers.get('Content-Type') || '').includes('application/json')) {
    throw new Error('Não foi possível acessar a API. Confira se o servidor está aberto e atualize a página.');
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || 'Não foi possível concluir a solicitação.');
    error.status = response.status;
    throw error;
  }
  return result.data ?? result;
}

function powertrain(value) {
  const fuel = fold(value);
  // Check hybrids first: a custom value can contain both hybrid and electric.
  if (fuel.includes('hibrid') || fuel.includes('hybrid')) return 'hybrid';
  if (fuel.includes('eletric') || fuel.includes('electric')) return 'electric';
  if (['flex', 'gasolina', 'etanol', 'diesel', 'gnv', 'alcool'].some(item => fuel.includes(item))) return 'combustion';
  return 'unknown';
}

function vehicleIcon(type) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 32');
  svg.setAttribute('aria-hidden', 'true');
  const paths = type === 'moto'
    ? ['M18 23a7 7 0 1 1-14 0 7 7 0 0 1 14 0M44 23a7 7 0 1 1-14 0 7 7 0 0 1 14 0', 'M11 23l9-13h9l8 13M11 23h15l5-12M28 5h6l3 18M16 10h8']
    : ['M3 22v-7l4-3 5-8h22l6 8 5 3v7H3Z', 'M7 12h33M16 4l-3 8M31 4l4 8M7 17h6M35 17h6M16 22h16M7 22v5h7v-5M34 22v5h7v-5'];
  for (const value of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', value);
    svg.append(path);
  }
  return svg;
}

function showFormError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = !message;
}

function openForm(vehicle = null) {
  if (saving) return;
  form.reset();
  if (customFuelOption) {customFuelOption.remove(); customFuelOption = null;}
  field('id').value = '';
  field('year').value = new Date().getFullYear();
  showFormError('');
  $('form-title').textContent = vehicle ? 'Editar veículo.' : 'Novo na garagem.';
  if (vehicle) {
    const fuel = vehicle.fuel || '';
    if (!Array.from(field('fuel').options).some(option => option.value === fuel)) {
      customFuelOption = node('option', fuel);
      customFuelOption.value = fuel;
      field('fuel').append(customFuelOption);
    }
    for (const name of ['id', 'brand', 'model', 'year', 'plate', 'type', 'fuel', 'odometer_km', 'status']) {
      field(name).value = vehicle[name] ?? '';
    }
  }
  dialog.showModal();
  document.body.classList.add('modal-open');
  field('brand').focus();
}

function closeForm() {
  if (!saving) dialog.close();
}

function rowFor(vehicle) {
  const row = node('article', undefined, 'vehicle-row');
  const icon = node('div', undefined, 'vehicle-glyph');
  icon.append(vehicleIcon(vehicle.type));
  const identity = node('div', undefined, 'vehicle-identity');
  const title = `${vehicle.brand} ${vehicle.model}`;
  identity.append(node('h3', title), node('span', `${vehicle.year} · ${vehicle.type === 'moto' ? 'Moto' : 'Carro'} · ${kilometers.format(vehicle.odometer_km)} km`, 'vehicle-year'));
  const meta = node('div', undefined, 'row-meta');
  meta.append(node('span', vehicle.plate, 'plate'), node('span', vehicle.fuel || 'Motorização não informada', `fuel-badge ${powertrain(vehicle.fuel)}`));
  const statusLabels = {ativo: 'Ativo', inativo: 'Inativo', vendido: 'Vendido'};
  meta.append(node('span', statusLabels[vehicle.status] || vehicle.status, `status-label${vehicle.status === 'ativo' ? '' : ' inactive'}`));
  identity.append(meta);
  const engine = node('div', undefined, 'vehicle-data');
  engine.append(node('span', 'Motorização'), node('strong', vehicle.fuel || 'Não informada'));
  const distance = node('div', undefined, 'vehicle-data');
  distance.append(node('span', 'Quilometragem'), node('strong', `${kilometers.format(vehicle.odometer_km)} km`));
  const actions = node('div', undefined, 'vehicle-actions');
  const edit = node('button', 'Editar', 'row-button');
  edit.type = 'button';
  edit.setAttribute('aria-label', `Editar ${title}, placa ${vehicle.plate}`);
  edit.addEventListener('click', () => openForm(vehicle));
  const remove = node('button', 'Excluir', 'row-button delete');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Excluir ${title}, placa ${vehicle.plate}`);
  remove.addEventListener('click', async () => {
    if (!window.confirm(`Excluir ${title}, placa ${vehicle.plate}? Os registros de despesas e manutenção relacionados também serão excluídos.`)) return;
    remove.disabled = true;
    edit.disabled = true;
    try {
      await api(`/api/vehicles/${vehicle.id}?confirm=true`, 'DELETE');
    } catch (error) {
      notice(error.message, true);
      remove.disabled = false;
      edit.disabled = false;
      return;
    }
    // Reflect the successful mutation even if refreshing other data fails.
    vehicles = vehicles.filter(item => item.id !== vehicle.id);
    renderVehicles();
    try {await load(); notice('Veículo excluído.');}
    catch (error) {notice('Veículo excluído. Não foi possível atualizar o resumo; clique em Atualizar.', true);}
  });
  actions.append(edit, remove);
  row.append(icon, identity, engine, distance, actions);
  return row;
}

function renderVehicles() {
  const query = fold($('search').value).trim();
  const compactQuery = query.replace(/[\s-]/g, '');
  const items = vehicles.filter(vehicle => {
    const matchesFuel = selectedFilter === 'all' || powertrain(vehicle.fuel) === selectedFilter;
    const matchesQuery = fold(`${vehicle.brand} ${vehicle.model} ${vehicle.plate}`).includes(query) || (compactQuery && fold(vehicle.plate).includes(compactQuery));
    return matchesFuel && matchesQuery;
  });
  const sort = $('sort').value;
  items.sort((a, b) => sort === 'name' ? `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`, 'pt-BR') : sort === 'year' ? b.year - a.year || b.id - a.id : b.id - a.id);
  $('vehicles').replaceChildren(...items.map(rowFor));
  $('result-count').textContent = `${items.length} ${items.length === 1 ? 'veículo' : 'veículos'}${items.length === vehicles.length ? ' na garagem' : ` de ${vehicles.length} no total`}`;
  $('all-count').textContent = vehicles.length;
  if (!items.length) {
    const empty = node('div', undefined, 'empty-state');
    empty.append(node('h3', vehicles.length ? 'Nenhum veículo por aqui.' : 'Sua garagem começa aqui.'), node('p', vehicles.length ? 'Tente outra busca ou escolha outra motorização.' : 'Cadastre o primeiro veículo para acompanhar os detalhes da sua garagem.'));
    const action = node('button', vehicles.length ? 'Limpar filtros' : 'Cadastrar meu primeiro veículo', 'button button-dark');
    action.type = 'button';
    action.addEventListener('click', () => {
      if (!vehicles.length) {openForm(); return;}
      selectedFilter = 'all';
      $('search').value = '';
      updateFilters();
      renderVehicles();
    });
    empty.append(action);
    $('vehicles').append(empty);
  }
}

function updateFilters() {
  for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === selectedFilter));
}

function renderSummary(summary) {
  $('total').textContent = vehicles.length;
  $('electric-total').textContent = vehicles.filter(vehicle => ['electric', 'hybrid'].includes(powertrain(vehicle.fuel))).length;
  $('cost').textContent = money.format(summary.monthly_cost);
  $('agenda-cost').textContent = money.format(summary.monthly_cost);
  $('pending-count').textContent = summary.upcoming.length;
  $('records').replaceChildren();
  for (const record of summary.upcoming) {
    const item = node('div', undefined, 'record');
    const date = node('div', undefined, 'record-date');
    if (record.due_date) {
      const [year, month, day] = record.due_date.split('-').map(Number);
      const localDate = new Date(year, month - 1, day);
      date.append(node('strong', String(day).padStart(2, '0')), node('small', localDate.toLocaleDateString('pt-BR', {month: 'short'}).replace('.', '')));
    } else {
      date.append(node('strong', '—'), node('small', 's/data'));
    }
    const detail = node('div');
    detail.append(node('strong', record.description, 'record-title'), node('span', `${record.vehicle_name}${record.due_date ? ' · ' + record.due_date.split('-').reverse().join('/') : ' · Sem vencimento'}`, 'record-detail'));
    item.append(date, detail, node('span', money.format(record.amount), 'record-amount'));
    $('records').append(item);
  }
  if (!summary.upcoming.length) $('records').append(node('p', 'Nenhuma pendência registrada. Sua agenda está livre por aqui.', 'record-empty'));
}

async function load() {
  const version = ++loadVersion;
  $('refresh').disabled = true;
  $('vehicles').setAttribute('aria-busy', 'true');
  try {
    const [items, summary] = await Promise.all([api('/api/vehicles'), api('/api/dashboard')]);
    if (version !== loadVersion) return;
    vehicles = items;
    renderVehicles();
    renderSummary(summary);
    $('connection-dot').classList.remove('offline');
    $('connection-dot').classList.add('online');
    $('connection-label').textContent = 'Garagem conectada';
    $('updated-at').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;
  } catch (error) {
    if (version !== loadVersion) return;
    $('connection-dot').classList.remove('online');
    $('connection-dot').classList.add('offline');
    $('connection-label').textContent = 'Conexão indisponível';
    $('updated-at').textContent = 'Confira o servidor e tente atualizar';
    if (!vehicles.length) $('result-count').textContent = 'Não foi possível carregar os veículos';
    throw error;
  } finally {
    if (version === loadVersion) {
      $('refresh').disabled = false;
      $('vehicles').setAttribute('aria-busy', 'false');
    }
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || !form.reportValidity()) return;
  saving = true;
  $('save-vehicle').disabled = true;
  $('cancel').disabled = true;
  $('close-dialog').disabled = true;
  $('save-vehicle').textContent = 'Salvando…';
  showFormError('');
  const id = field('id').value;
  const payload = Object.fromEntries(['brand', 'model', 'plate', 'type', 'status'].map(name => [name, field(name).value.trim()]));
  payload.fuel = field('fuel').value || null;
  payload.year = Number(field('year').value);
  payload.odometer_km = Number(field('odometer_km').value);
  let result;
  try {
    result = await api(`/api/vehicles${id ? '/' + id : ''}`, id ? 'PUT' : 'POST', payload);
  } catch (error) {
    showFormError(error.status === 409 ? 'Já existe um veículo com essa placa. Confira a placa ou edite o veículo cadastrado.' : error.message);
  } finally {
    saving = false;
    $('save-vehicle').disabled = false;
    $('cancel').disabled = false;
    $('close-dialog').disabled = false;
    $('save-vehicle').textContent = 'Salvar veículo ↗';
  }
  if (!result) return;
  closeForm();
  vehicles = [...vehicles.filter(vehicle => vehicle.id !== result.id), result];
  selectedFilter = 'all';
  $('search').value = '';
  $('sort').value = 'recent';
  updateFilters();
  renderVehicles();
  try {await load(); notice(`${result.brand} ${result.model} salvo na garagem.`);}
  catch (error) {notice('Veículo salvo. Não foi possível atualizar o resumo; clique em Atualizar.', true);}
});

for (const button of document.querySelectorAll('.new-vehicle')) button.addEventListener('click', () => openForm());
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
  selectedFilter = button.dataset.filter;
  updateFilters();
  renderVehicles();
});
$('search').addEventListener('input', renderVehicles);
$('sort').addEventListener('change', renderVehicles);
$('refresh').addEventListener('click', async () => {
  try {await load(); notice('Garagem atualizada.');}
  catch (error) {notice(error.message, true);}
});
$('close-dialog').addEventListener('click', closeForm);
$('cancel').addEventListener('click', closeForm);
dialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
dialog.addEventListener('cancel', event => {if (saving) event.preventDefault();});
field('year').max = new Date().getFullYear() + 2;
field('plate').addEventListener('input', () => {field('plate').value = field('plate').value.toUpperCase();});
$('current-year').textContent = new Date().getFullYear();
load().catch(error => notice(error.message, true));

// Motion uses CSS transforms and data attributes; the existing CSP stays intact.
(function initHeroMotion() {
  const hero = document.querySelector('.hero');
  const toggle = $('hero-motion-toggle');
  if (!hero || !toggle || !window.matchMedia) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let pausedByUser = false;
  let inViewport = true;
  let active = false;
  let frame = 0;
  let pointerX = 0;
  let pointerY = 0;

  function cancelFrame() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  }

  function centerPointer() {
    cancelFrame();
    hero.dataset.motionX = '0';
    hero.dataset.motionY = '0';
  }

  function syncMotion() {
    active = !pausedByUser && !reducedMotion.matches && inViewport && !document.hidden && !dialog.open;
    hero.classList.toggle('is-motion-active', active);
    toggle.disabled = reducedMotion.matches;
    toggle.textContent = reducedMotion.matches ? 'Movimento reduzido' : pausedByUser ? 'Ativar movimento' : 'Pausar movimento';
    toggle.setAttribute('aria-label', reducedMotion.matches ? 'Movimento desativado pela preferência do sistema' : pausedByUser ? 'Ativar movimento da imagem' : 'Pausar movimento da imagem');
    if (!active) cancelFrame();
    if (reducedMotion.matches) centerPointer();
  }

  toggle.addEventListener('click', () => {
    pausedByUser = !pausedByUser;
    syncMotion();
  });
  hero.addEventListener('pointermove', event => {
    if (!active || !finePointer.matches || event.pointerType !== 'mouse') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (!active) return;
      const bounds = hero.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      // Five positions per axis, interpolated smoothly by CSS transitions.
      const position = (value, start, size) => String(Math.max(-2, Math.min(2, Math.round(((value - start) / size - .5) * 4))));
      hero.dataset.motionX = position(pointerX, bounds.left, bounds.width);
      hero.dataset.motionY = position(pointerY, bounds.top, bounds.height);
    });
  }, {passive: true});
  hero.addEventListener('pointerleave', () => {if (active) centerPointer();});
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  finePointer.addEventListener('change', () => {if (!finePointer.matches) centerPointer();});
  if ('IntersectionObserver' in window) {
    const observer = new window.IntersectionObserver(entries => {
      inViewport = entries[0].isIntersecting;
      syncMotion();
    }, {threshold: 0});
    observer.observe(hero);
  }
  if ('MutationObserver' in window) {
    const observer = new window.MutationObserver(syncMotion);
    observer.observe(dialog, {attributes: true, attributeFilter: ['open']});
  }
  hero.classList.add('is-motion-ready');
  toggle.hidden = false;
  centerPointer();
  syncMotion();
})();
