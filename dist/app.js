import {createDeliveryModel} from './model.js';
import {createWorld} from './scene.js';
import {createInspector} from './inspector.js';
import {createSpatialSystem, OCCUPANT_TYPES} from './behaviors.js';
import {nextStep} from './next-step.js';

let model = createDeliveryModel(), state = model.state, world;
const spatial = createSpatialSystem(() => model);
spatial.loadScene('street');
const $ = id => document.getElementById(id);
const escape = text => String(text).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

let toastTimer, announced = state.history.length, nextKey = '';
function notify(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2600);
}

const inspector = createInspector({getModel: () => model, getWorld: () => world, spatial, notify, onChange: () => render()});

function renderNext() {
  const step = nextStep(state, spatial.obstruction());
  const fills = state.segments.map((_, index) => {
    const fill = index < state.nextIndex ? 1 : index === state.nextIndex && state.movement ? state.movement.progress : 0;
    return `<i><b style="width:${Math.round(fill * 100)}%"></b></i>`;
  }).join('');
  if ($('progress').dataset.fills !== fills) { $('progress').innerHTML = fills; $('progress').dataset.fills = fills; }
  const key = JSON.stringify([step.text, step.label, step.canWait, step.warning]);
  if (key === nextKey) return;
  nextKey = key;
  $('next-text').textContent = step.text;
  $('next-action').hidden = !step.action;
  $('next-action').textContent = step.label || '';
  $('wait').hidden = !step.canWait;
  document.querySelector('.next').classList.toggle('warning', !!step.warning);
  $('progress').setAttribute('aria-label', `${state.nextIndex} of ${state.segments.length} segments done`);
}

function render() {
  renderNext();
  if (state.history.length !== announced) {
    announced = state.history.length;
    notify(state.history.at(-1).message);
  }
  inspector.refresh();
}

function act(name) {
  try {
    const result = name === 'move' ? model.move(spatial.obstruction()) : model[name]();
    announced = state.history.length;
    render();
    notify(result.message);
    return result;
  } catch (error) {
    notify(error.message);
    throw error;
  }
}

function reset() {
  if (state.movement) { notify('Finish the current movement first.'); return; }
  model = createDeliveryModel();
  state = model.state;
  announced = state.history.length;
  spatial.reset();
  inspector.hide();
  nextKey = '';
  render();
}

$('next-action').onclick = () => {
  const {action} = nextStep(state, spatial.obstruction());
  if (action === 'reset') reset();
  else if (action) { try { act(action); } catch {} }
};
$('wait').onclick = () => { try { act('wait'); } catch {} };

$('scene-select').innerHTML = spatial.SCENES.map(scene => `<option value="${scene.id}">${escape(scene.name)}</option>`).join('');
$('scene-select').value = spatial.sceneId();
$('scene-select').onchange = () => {
  try {
    const scene = spatial.loadScene($('scene-select').value);
    inspector.hide();
    render();
    notify(scene.description);
  } catch (error) {
    $('scene-select').value = spatial.sceneId();
    notify(error.message);
  }
  $('scene-select').blur();
};

const menus = [['add-button', 'add-menu'], ['more-button', 'more-menu']];
function closeMenus() {
  for (const [button, menu] of menus) { $(menu).hidden = true; $(button).setAttribute('aria-expanded', 'false'); }
  $('find-results').hidden = true;
}
for (const [button, menu] of menus) $(button).onclick = event => {
  event.stopPropagation();
  const opening = $(menu).hidden;
  closeMenus();
  $(menu).hidden = !opening;
  $(button).setAttribute('aria-expanded', String(opening));
};
document.addEventListener('click', event => { if (!event.target.closest('.menu')) closeMenus(); });

$('add-menu').innerHTML = Object.entries(OCCUPANT_TYPES).map(([type, item]) => `<button data-add="${type}">${item.label}</button>`).join('');
$('add-menu').onclick = event => {
  const type = event.target.closest('[data-add]')?.dataset.add;
  if (!type) return;
  closeMenus();
  try {
    const occupant = spatial.add(type, spatial.firstOpenCell());
    inspector.show({kind: 'object', id: occupant.id});
    render();
  } catch (error) { notify(error.message); }
};

function showFindMessage(result) {
  $('find-results').innerHTML = `<p>${escape(result.message)}</p>` +
    (result.candidates || []).map((item, index) => `<button type="button" data-candidate="${index}">${escape(item.name)}</button>`).join('');
  $('find-results').hidden = false;
  $('find-results').onclick = event => {
    event.stopPropagation();
    const button = event.target.closest('[data-candidate]');
    if (!button) return;
    inspector.showResult(result.candidates[Number(button.dataset.candidate)]);
    closeMenus();
  };
}
$('find').onsubmit = event => {
  event.preventDefault();
  event.stopPropagation();
  closeMenus();
  try {
    const result = inspector.find($('find-input').value);
    if (result.kind === 'found') $('find-input').blur();
    else showFindMessage(result);
  } catch (error) { notify(error.message); }
};

function select(id) { inspector.toggleObject(id); }
function pickGround(selection) {
  if (inspector.isOpen()) inspector.hide();
  else inspector.show({kind: 'place', result: {kind: 'point', name: 'Location', position: selection.position}});
}
try {
  world = createWorld($('scene'), () => state, select, pickGround, {
    snapshot: spatial.snapshot,
    occupants: spatial.occupants,
    placementProblem: spatial.placementProblem,
    click: select,
    drop(id, position) {
      try { spatial.place(id, position); render(); } catch (error) { notify(error.message); }
    }
  });
} catch {
  $('scene').innerHTML = '<div class="error-overlay">The 3D view needs WebGL. Turn on hardware acceleration or try another browser.</div>';
}
render();

let previous = performance.now(), lastUI = 0;
function frame(now) {
  const elapsed = now - previous;
  previous = now;
  if (state.movement) model.advance(elapsed * spatial.speedFactor());
  const {changed} = spatial.tick(elapsed);
  if (changed || now - lastUI > 100) { render(); lastUI = now; }
  world?.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

$('reset').onclick = () => { closeMenus(); reset(); };
$('zoom-out').onclick = () => world?.zoom(-.12);
$('zoom-in').onclick = () => world?.zoom(.12);
$('view-reset').onclick = () => world?.resetView();
$('view-top').onclick = () => world?.toggleTop();

function showDialog(html) {
  closeMenus();
  $('dialog-content').innerHTML = html;
  if (!$('info-dialog').open) $('info-dialog').showModal();
}
$('close-dialog').onclick = () => $('info-dialog').close();
$('info-dialog').addEventListener('click', event => { if (event.target === $('info-dialog')) $('info-dialog').close(); });
$('rules').onclick = () => showDialog(`<h2>How it works</h2><ol class="rules-list">
  <li>Pick up the package, move along the route one segment at a time, then deliver. Keys <strong>1–4</strong> are pick up, move, wait, and deliver.</li>
  <li>A segment must be open and <strong>wider than the robot</strong>. If not, the robot waits; fix it and press Move again.</li>
  <li><strong>Adjacent</strong> means no open grid cell between two objects, so a building can make them adjacent.</li>
  <li><strong>Between</strong> means on the straight line joining two others. <strong>Among</strong> means inside the outline of three or more others.</li>
  <li>A person or cone on the next segment, or a crowd of three or more over it, makes the robot wait.</li>
  <li>A <strong>cone</strong> next to the robot slows it. A <strong>recipient</strong> next to the robot at the destination takes the package automatically; otherwise press Deliver.</li>
  <li>Click anything on the map to inspect or edit it. Drag people and cones to move them. Drag the ground to orbit.</li>
</ol>`);
$('activity-button').onclick = () => showDialog(`<h2>Activity</h2><ul class="activity-list">${[...state.history].reverse().map(entry => `<li class="${entry.kind}">${escape(entry.message)}</li>`).join('')}</ul>`);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeMenus(); if (!$('info-dialog').open) inspector.hide(); return; }
  if ($('info-dialog').open || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const action = {'1': 'pickup', '2': 'move', '3': 'wait', '4': 'deliver'}[event.key];
  if (action) { event.preventDefault(); try { act(action); } catch {} }
});

if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), {once: true});
  const entries = [
    {name: 'read_delivery', description: 'Read robot, package, segments, carrying relationship, traversal, and delivery progress.', props: {}, required: [], readOnly: true, run: () => structuredClone(state)},
    ...['pickup', 'move', 'wait', 'deliver'].map(name => ({
      name: {pickup: 'pick_up_package', move: 'move_robot', wait: 'wait_robot', deliver: 'deliver_package'}[name],
      description: {pickup: 'Pick up the waiting package at its pickup position within capacity.', move: 'Begin continuous traversal of the next segment, or wait if blocked or too narrow.', wait: 'Wait at the current stationary position, retaining any package.', deliver: 'Complete delivery at the destination and detach the carried package.'}[name],
      props: {}, required: [], run: () => act(name)
    })),
    {name: 'update_path_segment', description: 'While stationary, set an existing segment’s blocked flag or nonnegative clear width. Does not automatically move the robot.', props: {segmentId: {type: 'string', enum: ['S1', 'S2', 'S3', 'S4']}, blocked: {type: 'boolean'}, clearWidth: {type: 'number', minimum: 0}}, required: ['segmentId'], run: input => {
      if (!('blocked' in input) && !('clearWidth' in input)) throw new Error('Supply a blockage or clear width change.');
      const changes = {};
      if ('blocked' in input) changes.blocked = input.blocked;
      if ('clearWidth' in input) changes.clearWidth = input.clearWidth;
      const result = model.updateSegment(input.segmentId, changes);
      render();
      return result;
    }}
  ];
  for (const entry of entries) {
    try {
      Promise.resolve(document.modelContext.registerTool({name: entry.name, description: entry.description, inputSchema: {type: 'object', properties: entry.props, required: entry.required, additionalProperties: false}, annotations: {readOnlyHint: !!entry.readOnly, untrustedContentHint: false}, execute: input => {
        if (!input || typeof input !== 'object' || Object.keys(input).some(key => !(key in entry.props)) || entry.required.some(key => !(key in input))) throw new Error('Invalid action parameters.');
        return entry.run(input);
      }}, {signal: lifecycle.signal})).catch(() => {});
    } catch {}
  }
}
