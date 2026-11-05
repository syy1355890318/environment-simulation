import {OCCUPANT_TYPES} from './behaviors.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const EVENT_TEXT = {past: 'past', into: 'into', out: 'out of'};

export function createSpatialLab(system, {onChange, notify, onOpen}) {
  const panel = document.createElement('aside');
  panel.id = 'spatial-lab'; panel.className = 'location-panel spatial-panel panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Spatial Lab');
  panel.innerHTML = `
    <div class="location-heading"><div><span class="eyebrow">POSITION + MOVEMENT</span><h2>Who is where?</h2></div><button id="spatial-close" aria-label="Close Spatial Lab">×</button></div>
    <p class="location-intro">Drag people and cones on the ground. Placement triggers behavior.</p>
    <div class="spatial-heading">Scene</div>
    <div class="spatial-scenes" id="spatial-scenes" role="group" aria-label="Demo scenes">${system.SCENES.map(scene => `<button data-scene="${scene.id}">${scene.name}</button>`).join('')}</div>
    <p class="location-help" id="spatial-scene-description"></p>
    <div class="spatial-heading">Position now</div>
    <ul class="spatial-list" id="spatial-relations" aria-live="polite"></ul>
    <div class="spatial-heading">Movement now</div>
    <ul class="spatial-list" id="spatial-movement"></ul>
    <div class="spatial-heading">Occupants</div>
    <div class="spatial-add" role="group" aria-label="Add occupant">${Object.entries(OCCUPANT_TYPES).map(([type, item]) => `<button data-add="${type}">＋ ${item.label}</button>`).join('')}</div>
    <div id="spatial-occupants"></div>`;
  document.body.append(panel);
  const $ = id => document.getElementById(id);
  let opened = false, rosterKey = '', relationsText = '', movementText = '';

  function open(value = true) {
    opened = value; panel.hidden = !value;
    document.body.classList.toggle('spatial-open', value);
    $('spatial').setAttribute('aria-expanded', String(value));
    if (value) { onOpen(); refresh(); }
  }
  function attempt(action) {
    try { action(); onChange(); refresh(); } catch (error) { notify(error.message); refresh(); }
  }

  function renderRoster() {
    const occupants = system.occupants();
    const key = JSON.stringify([system.sceneId(), occupants.map(o => [o.id, !!o.walk, o.walk ? 0 : o.position])]);
    if (key === rosterKey || panel.contains(document.activeElement) && document.activeElement.matches('#spatial-occupants input')) return;
    rosterKey = key;
    $('spatial-occupants').innerHTML = occupants.length ? occupants.map(o => `
      <div class="spatial-roster-row" data-occupant="${o.id}">
        <strong>${o.id}<small>${OCCUPANT_TYPES[o.type].label}${o.walk ? ' · walking' : ''}</small></strong>
        <label>x<input type="number" step="2" data-axis="x" value="${o.walk ? '' : o.position.x}" aria-label="${o.id} x position in meters" ${o.walk ? 'placeholder="…"' : ''}></label>
        <label>z<input type="number" step="2" data-axis="z" value="${o.walk ? '' : o.position.z}" aria-label="${o.id} z position in meters" ${o.walk ? 'placeholder="…"' : ''}></label>
        <button data-remove="${o.id}" aria-label="Remove ${o.id}">×</button>
      </div>`).join('') : '<p class="empty-location">No occupants. Add one above.</p>';
  }

  function refresh() {
    if (!opened) return;
    panel.querySelectorAll('[data-scene]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scene === system.sceneId())));
    $('spatial-scene-description').textContent = system.SCENES.find(scene => scene.id === system.sceneId()).description;
    renderRoster();
    const {relations, crowds, warnings, trends, events} = system.snapshot();
    const relationRows = [
      ...relations.adjacent.map(pair => ['adjacent', `${pair.a} adjacent to ${pair.b}${pair.acrossObstacle ? ' (no open cell between)' : ''}`]),
      ...relations.between.map(triple => ['between', `${triple.middle} between ${triple.a} and ${triple.c}`]),
      ...relations.among.map(group => ['among', `${group.center} among ${group.others.join(', ')}`]),
      ...crowds.map(crowd => ['crowd', `Crowd: ${crowd.members.join(', ')}`]),
      ...warnings.map(id => ['warning', `${id} warns the robot: slower`])
    ];
    const movementRows = [
      ...trends.map(trend => [trend.kind, `${trend.mover} ${trend.kind === 'toward' ? 'toward' : 'away from'} ${trend.referentName}`]),
      ...events.slice(-5).reverse().map(event => [event.kind, `${event.mover} ${EVENT_TEXT[event.kind]} ${event.referentName}`])
    ];
    const row = ([kind, text]) => `<li class="spatial-row spatial-${kind}"><i></i>${escape(text)}</li>`;
    const nextRelations = relationRows.map(row).join('') || '<li class="empty-location">No relation yet. Move an occupant next to another.</li>';
    const nextMovement = movementRows.map(row).join('') || '<li class="empty-location">Nothing is moving.</li>';
    if (nextRelations !== relationsText) $('spatial-relations').innerHTML = relationsText = nextRelations;
    if (nextMovement !== movementText) $('spatial-movement').innerHTML = movementText = nextMovement;
  }

  $('spatial').onclick = () => open(!opened);
  $('spatial-close').onclick = () => { open(false); $('spatial').focus(); };
  panel.addEventListener('click', event => {
    const scene = event.target.closest('[data-scene]'), add = event.target.closest('[data-add]'), remove = event.target.closest('[data-remove]');
    if (scene) attempt(() => { system.loadScene(scene.dataset.scene); rosterKey = ''; });
    if (add) attempt(() => { system.add(add.dataset.add, system.firstOpenCell()); });
    if (remove) attempt(() => { system.remove(remove.dataset.remove); });
  });
  panel.addEventListener('change', event => {
    const input = event.target.closest('[data-axis]');
    if (!input) return;
    const row = input.closest('[data-occupant]');
    const occupant = system.occupants().find(item => item.id === row.dataset.occupant);
    if (!occupant) return;
    const position = {...occupant.position, [input.dataset.axis]: input.value === '' ? NaN : Number(input.value)};
    input.blur();
    rosterKey = '';
    attempt(() => { system.place(occupant.id, position); });
  });
  return {refresh, isOpen: () => opened, close: () => open(false), forceRoster: () => { rosterKey = ''; refresh(); }};
}
