// The single card that opens when something is selected.
import {describeCityPosition, describePosition, findInCity, fromFrame, objectLocation, occupantsAt, parseCoordinates, resolveDescription, segmentsAt, toFrame} from './locations.js';
import {OCCUPANT_TYPES} from './behaviors.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const number = value => Number(value.toFixed(2)).toString();
const row = (label, value) => `<div class="row"><dt>${escape(label)}</dt><dd>${value}</dd></div>`;
const field = (label, name, value, attributes = 'min="0.01"') =>
  `<div class="row"><dt><label for="field-${name}">${escape(label)}</label></dt><dd><input id="field-${name}" data-field="${name}" type="number" step="0.1" ${attributes} value="${value}"></dd></div>`;
const capitalized = text => text[0].toUpperCase() + text.slice(1);

export function createInspector({getModel, getWorld, spatial, notify, onChange, agents = null}) {
  const card = document.getElementById('inspector');
  const state = () => getModel().state;
  const delivery = () => state().delivery !== false;
  let selection = null, frame = 'world', radius = 0.5, optionsOpen = false;

  const format = position => {
    const p = toFrame(state(), position, frame);
    return `(${number(p.x)}, ${number(p.z)}) m`;
  };

  function location() {
    if (!selection) return null;
    if (selection.kind === 'agent') return agents?.card(selection.id) || null;
    if (selection.kind !== 'object') return selection.result;
    try { return objectLocation(state(), selection.id); } catch { return null; }
  }

  function robotBody() {
    const {robot, package: parcel, movement} = state();
    const editable = !movement && parcel.deliveryStatus === 'waiting';
    return row('State', capitalized(robot.motionState)) + row('Position', format(robot.position)) +
      row('Carrying', robot.carryingId || 'Nothing') +
      (editable ? field('Width (m)', 'width', robot.width) + field('Capacity (kg)', 'payloadCapacity', robot.payloadCapacity)
        : row('Width', `${robot.width} m`) + row('Capacity', `${robot.payloadCapacity} kg`));
  }

  function packageBody() {
    const {package: parcel, movement} = state();
    return row('Status', capitalized(parcel.deliveryStatus)) + row('Position', format(parcel.position)) +
      (!movement && parcel.deliveryStatus === 'waiting' ? field('Weight (kg)', 'weight', parcel.weight) : row('Weight', `${parcel.weight} kg`));
  }

  function segmentBody(segment) {
    const {robot, movement} = state();
    const status = segment.blocked ? 'Blocked' : segment.clearWidth <= robot.width ? 'Too narrow' : 'Passable';
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z);
    return row('Status', status) + row('Length', `${length} m`) +
      (movement ? row('Clear width', `${segment.clearWidth} m`) + row('Blocked', segment.blocked ? 'Yes' : 'No')
        : field('Clear width (m)', 'clearWidth', segment.clearWidth, 'min="0"') +
          `<div class="row"><dt><label for="field-blocked">Blocked</label></dt><dd><input id="field-blocked" data-field="blocked" type="checkbox" role="switch" ${segment.blocked ? 'checked' : ''}></dd></div>`) +
      `<p class="hint">Must be wider than the robot (${robot.width} m).</p>`;
  }

  function occupantBody(occupant) {
    const place = toFrame(state(), occupant.position, frame);
    const where = occupant.walk ? row('Position', format(occupant.position)) + row('State', 'Walking')
      : field('x (m)', 'x', number(place.x), 'data-step="2"').replace('step="0.1"', 'step="2"') + field('z (m)', 'z', number(place.z), 'data-step="2"').replace('step="0.1"', 'step="2"');
    return where + `<button class="quiet-button" data-remove="${escape(occupant.id)}">Remove</button>`;
  }

  function placeBody(result) {
    const here = occupantsAt(state(), result.position, radius);
    const paths = delivery() ? segmentsAt(state(), result.position).map(segment => segment.name) : [];
    const lede = result.kind === 'segment' ? `${number(result.length)} m long` : delivery() ? describePosition(state(), result.position) : describeCityPosition(result.position);
    const within = here.length
      ? `<ul class="links">${here.map(item => `<li><button data-open="${escape(item.id)}">${escape(item.name)}</button></li>`).join('')}</ul>`
      : '<p class="hint">Nobody here.</p>';
    return `<p class="lede">${escape(lede)}</p>` +
      row('Position', format(result.position)) + (paths.length ? row('On', escape(paths.join(', '))) : '') + within +
      `<details class="options" ${optionsOpen ? 'open' : ''}><summary>Options</summary>` +
      (!delivery() ? '' : `<div class="row"><dt><label for="field-frame">Measured from</label></dt><dd><select id="field-frame" data-field="frame"><option value="world" ${frame === 'world' ? 'selected' : ''}>World</option><option value="pickup" ${frame === 'pickup' ? 'selected' : ''}>Pickup</option></select></dd></div>`) +
      field('Search radius (m)', 'radius', radius, 'min="0"') + '</details>';
  }

  function content(result) {
    if (selection.kind === 'agent') return [result.title, result.html];
    if (selection.kind !== 'object') return [result.name, placeBody(result)];
    const {robot, package: parcel, segments, occupants} = state();
    if (selection.id === robot.id) return [`Robot ${robot.id}`, robotBody()];
    if (selection.id === parcel.id) return [`Package ${parcel.id}`, packageBody()];
    const segment = segments.find(item => item.id === selection.id);
    if (segment) return [segment.name, segmentBody(segment)];
    const occupant = occupants.find(item => item.id === selection.id);
    return [`${OCCUPANT_TYPES[occupant.type].label} ${occupant.id}`, occupantBody(occupant)];
  }

  function refresh() {
    const result = location();
    if (!result) {
      if (selection) selection = null;
      card.hidden = true;
      getWorld()?.setFocus(null);
      getWorld()?.select(null);
      getWorld()?.highlightLocation(null);
      return;
    }
    card.hidden = false;
    const editing = card.contains(document.activeElement) && document.activeElement.matches('input,select');
    if (!editing) {
      const [title, body] = content(result);
      const html = `<div class="card-top"><h2>${escape(title)}</h2><button class="icon-button" data-close aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div><dl>${body}</dl>`;
      if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html; }
    }
    const world = getWorld();
    const isObject = selection.kind !== 'place';
    world?.setFocus(isObject ? selection.id : null);
    world?.select(result.kind === 'segment' ? result.id : null);
    world?.highlightLocation(result.kind === 'segment' ? {...result, radius: 0.65}
      : isObject ? null : {...result, radius, showLabel: true});
  }

  function show(next) { selection = next; card.dataset.html = ''; refresh(); }
  function hide() { selection = null; refresh(); }
  const isOpen = () => !!selection;
  function toggleObject(id) {
    if (selection?.kind === 'object' && selection.id === id) hide();
    else show({kind: 'object', id});
  }

  // A search box result: an object opens its own card; anything else opens a place card.
  function find(text) {
    const typed = parseCoordinates(text);
    if (typed) {
      const position = fromFrame(state(), typed, frame);
      show({kind: 'place', result: {kind: 'point', name: 'Location', position}});
      getWorld()?.centerOn(position);
      return {kind: 'found'};
    }
    const agent = agents?.position(text.trim().toUpperCase());
    if (agent) { show({kind: 'agent', id: text.trim().toUpperCase()}); getWorld()?.centerOn(agent); return {kind: 'found'}; }
    const id = state().occupants.find(item => item.id.toLowerCase() === text.trim().toLowerCase())?.id;
    if (id) { show({kind: 'object', id}); getWorld()?.centerOn(objectLocation(state(), id).position); return {kind: 'found'}; }
    const result = delivery() ? resolveDescription(state(), text) : findInCity(text);
    if (result.kind === 'error' || result.kind === 'candidates') return result;
    showResult(result);
    return {kind: 'found'};
  }
  function showResult(result) {
    const objects = delivery() ? [state().robot.id, state().package.id, ...state().segments.map(item => item.id)] : [];
    show(objects.includes(result.id) ? {kind: 'object', id: result.id} : {kind: 'place', result});
    getWorld()?.centerOn(result.position);
  }

  function apply(input) {
    const value = input.type === 'checkbox' ? input.checked : Number(input.value);
    const name = input.dataset.field;
    if (name === 'frame') { frame = input.value; return; }
    if (name === 'radius') {
      if (input.value === '' || !Number.isFinite(value) || value < 0) throw new Error('Enter a search radius of zero or more.');
      radius = value;
      return;
    }
    if (input.type === 'number' && input.value === '') throw new Error('Enter a number.');
    if (['width', 'payloadCapacity', 'weight'].includes(name)) getModel().updateSpecs({[name]: value});
    if (['clearWidth', 'blocked'].includes(name)) getModel().updateSegment(selection.id, {[name]: value});
    if (name === 'x' || name === 'z') {
      const typed = toFrame(state(), objectLocation(state(), selection.id).position, frame);
      spatial.place(selection.id, fromFrame(state(), {...typed, [name]: value}, frame));
    }
  }

  card.addEventListener('change', event => {
    const input = event.target.closest('[data-field]');
    if (!input) return;
    try { apply(input); onChange(); } catch (error) { notify(error.message); }
    input.blur();
    card.dataset.html = '';
    refresh();
  });
  card.addEventListener('toggle', event => { optionsOpen = event.target.open; }, true);
  card.addEventListener('click', event => {
    const open = event.target.closest('[data-open]'), remove = event.target.closest('[data-remove]');
    if (event.target.closest('[data-close]')) hide();
    if (open) show({kind: 'object', id: open.dataset.open});
    if (remove) { spatial.remove(remove.dataset.remove); onChange(); refresh(); }
  });

  // An agent's card is redrawn as it moves, so close on press rather than on a full click.
  card.addEventListener('pointerdown', event => { if (selection?.kind === 'agent' && event.target.closest('[data-close]')) hide(); });
  function toggleAgent(id) {
    if (selection?.kind === 'agent' && selection.id === id) hide();
    else show({kind: 'agent', id});
  }
  return {show, hide, refresh, isOpen, find, showResult, toggleObject, toggleAgent, selection: () => selection};
}
