import {getLandmarks, toFrame, fromFrame, objectLocation, describePosition, occupantsAt, segmentsAt, resolveDescription} from './locations.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const format = p => `(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) m`;

export function createLocationExplorer(stateProvider, worldProvider) {
  const panel = document.createElement('aside');
  panel.id = 'location-explorer'; panel.className = 'location-panel panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Location Explorer');
  panel.innerHTML = `
    <div class="location-heading"><div><span class="eyebrow">LOCATION WORKSHOP</span><h2>Where in the world?</h2></div><button id="location-close" aria-label="Close Location Explorer">×</button></div>
    <p class="location-intro">One position. Two ways to understand it.</p>
    <label class="location-field" for="location-frame">Reference frame<select id="location-frame"><option value="world">World coordinates</option><option value="pickup">Relative to pickup</option></select></label>
    <p class="location-axis" id="location-axis">Origin: world (0, 0). +x east · +z south.</p>
    <div class="location-tabs" role="tablist" aria-label="Location query">
      <button id="tab-object" role="tab" aria-selected="true" aria-controls="location-object">Object</button>
      <button id="tab-occupants" role="tab" aria-selected="false" aria-controls="location-occupants" tabindex="-1">Occupants</button>
      <button id="tab-describe" role="tab" aria-selected="false" aria-controls="location-describe" tabindex="-1">Describe</button>
    </div>
    <section id="location-object" role="tabpanel" aria-labelledby="tab-object">
      <label class="location-field" for="location-entity">Locate an object<select id="location-entity"><option value="R-01">Robot · R-01</option><option value="PKG-001">Package · PKG-001</option><option value="S1">Path · Market Street</option><option value="S2">Path · Garden Passage</option><option value="S3">Path · Canal Walk</option><option value="S4">Path · Willow Lane</option></select></label>
      <p class="location-help">Object positions follow the delivery live. Paths have a start and an end.</p>
    </section>
    <section id="location-occupants" role="tabpanel" aria-labelledby="tab-occupants" hidden>
      <label class="location-field" for="location-landmark">Choose a named place<select id="location-landmark"><option value="">Choose a landmark…</option></select></label>
      <form id="location-coordinate-form"><div class="location-input-row"><label class="location-field" for="location-x">x (m)<input id="location-x" type="number" step="any" required value="-12"></label><label class="location-field" for="location-z">z (m)<input id="location-z" type="number" step="any" required value="8"></label></div>
      <label class="location-field" for="location-radius">Search radius (m)<input id="location-radius" type="number" min="0" step="any" required value="0.5"></label><button class="location-submit" type="submit">Find occupants</button></form>
      <button id="location-map-pick" class="location-map-button">⌖ Pick a location on the map</button>
      <p class="location-help">Lists robot and package within the radius, including its boundary. Paths appear as context.</p>
    </section>
    <section id="location-describe" role="tabpanel" aria-labelledby="tab-describe" hidden>
      <form id="location-description-form"><label class="location-field" for="location-description">Describe a location<input id="location-description" type="text" placeholder="halfway along Garden Passage" autocomplete="off" required></label><button class="location-submit" type="submit">Resolve description</button></form>
      <div class="location-examples"><button data-description="pickup">Pickup</button><button data-description="halfway along Garden Passage">Garden midpoint</button><button data-description="junction">Junctions</button></div>
      <p class="location-help">Try a landmark, a path name, “50% along S2”, or “6 m along Garden Passage”. A path name describes its whole extent.</p>
    </section>
    <p id="location-error" class="location-error" role="status" aria-live="polite"></p>
    <div id="location-candidates" class="location-candidates"></div>
    <section class="location-result" aria-label="Location query result"><div class="location-result-top"><span id="location-result-label">ROBOT R-01</span><span class="tiny-tag">LIVE</span></div><p id="location-human"></p><dl><div><dt id="location-coordinate-label">World position</dt><dd id="location-coordinate"></dd></div><div id="location-world-row" hidden><dt>World position</dt><dd id="location-world-coordinate"></dd></div><div><dt>Screen anchor</dt><dd id="location-screen">—</dd></div></dl><p id="location-context" class="location-context"></p><p id="location-relation" class="location-relation"></p><div id="location-occupant-results"></div></section>
    <div class="location-footnote">Locations use ground anchors in meters. Screen anchors use CSS pixels and follow the camera. Package height is visual; carrying is a separate relationship.</div>`;
  document.body.append(panel);
  const banner = document.createElement('div'); banner.className = 'map-pick-banner'; banner.hidden = true;
  banner.innerHTML = '<span>Click the map to query a location.</span><button id="location-cancel-pick">Cancel</button>';
  document.body.append(banner);
  const $ = id => document.getElementById(id);
  let opened = false, picking = false, mode = 'object', reference = 'world';
  let query = {type: 'object', id: 'R-01'}, radius = 0.5, candidates = [], lastOutput = '', lastRefresh = 0;
  let activeLocation;
  const landmarks = getLandmarks(stateProvider());
  $('location-landmark').insertAdjacentHTML('beforeend', landmarks.map(place => `<option value="${escape(place.id)}">${escape(place.name)}</option>`).join(''));

  function open(value = true) {
    opened = value; panel.hidden = !value;
    document.body.classList.toggle('exploring-locations', value);
    $('locations').setAttribute('aria-expanded', String(value));
    if (!value) stopPicking();
    refresh(true);
  }
  function setMode(value) {
    mode = value;
    for (const name of ['object', 'occupants', 'describe']) {
      $(`location-${name}`).hidden = name !== mode;
      $(`tab-${name}`).setAttribute('aria-selected', String(name === mode));
      $(`tab-${name}`).tabIndex = name === mode ? 0 : -1;
    }
    $('location-error').textContent = ''; candidates = []; $('location-candidates').replaceChildren();
    if (mode === 'object') query = {type: 'object', id: $('location-entity').value};
    if (mode === 'occupants') {
      query = {type: 'point', position: activeLocation?.position || stateProvider().package.pickup, name: 'Selected location'};
      fillCoordinates(query.position);
    }
    refresh(true);
  }
  function fillCoordinates(position) {
    const transformed = toFrame(stateProvider(), position, reference);
    $('location-x').value = Number(transformed.x.toFixed(5)); $('location-z').value = Number(transformed.z.toFixed(5));
  }
  function numberInput(id) {
    const input = $(id);
    if (input.value.trim() === '' || !Number.isFinite(input.valueAsNumber)) throw new Error('Enter finite coordinates and a nonnegative radius.');
    return input.valueAsNumber;
  }
  function currentResult() {
    if (query.type === 'unresolved') return null;
    if (query.type === 'object') return objectLocation(stateProvider(), query.id);
    if (query.result?.id && ['R-01', 'PKG-001'].includes(query.result.id)) return objectLocation(stateProvider(), query.result.id);
    return query.result || {kind: 'point', name: query.name || 'Selected location', position: query.position};
  }
  function refresh(force = false) {
    if (!opened) {worldProvider()?.highlightLocation(null); return;}
    const state = stateProvider(), result = currentResult();
    panel.querySelector('.location-result').hidden = !result;
    if (!result) {worldProvider()?.highlightLocation(null); return;}
    activeLocation = result;
    const transformed = toFrame(state, result.position, reference), context = segmentsAt(state, result.position);
    const occupants = mode === 'occupants' ? occupantsAt(state, result.position, radius) : [];
    const output = JSON.stringify([result, transformed, reference, mode, occupants, context.map(s => s.id)]);
    if (force || output !== lastOutput) {
      lastOutput = output;
      $('location-result-label').textContent = result.name.toUpperCase();
      $('location-human').textContent = result.kind === 'segment' ? `${result.name} · entire ${result.length.toFixed(1)} m path` : describePosition(state, result.position);
      $('location-coordinate-label').textContent = result.kind === 'segment' ? 'Midpoint anchor' : reference === 'world' ? 'World position' : 'From pickup';
      $('location-coordinate').textContent = format(transformed);
      $('location-world-row').hidden = reference === 'world'; $('location-world-coordinate').textContent = format(result.position);
      $('location-context').textContent = result.kind === 'segment' ?
        `Start ${format(toFrame(state, result.start, reference))} → end ${format(toFrame(state, result.end, reference))}. Marker shows midpoint; the highlighted line shows the extent.` :
        context.length ? `Path context: ${context.map(s => s.name).join(' + ')}` : 'Outside the delivery route.';
      $('location-relation').textContent = result.relation ? `${result.relation}${result.status ? ` · ${result.status}` : ''}` : '';
      $('location-occupant-results').innerHTML = mode !== 'occupants' ? '' : `<div class="occupancy-heading">${occupants.length} occupant${occupants.length === 1 ? '' : 's'} within ${radius} m</div>` +
        (occupants.length ? occupants.map(item => `<button class="occupant-result" data-object="${escape(item.id)}"><strong>${escape(item.name)}</strong><span>${escape(item.relation)} · ${item.distance.toFixed(2)} m away</span></button>`).join('') : '<p class="empty-location">No robot or package occupies this search area.</p>');
    }
    worldProvider()?.highlightLocation({...result, radius: mode === 'occupants' ? radius : 0.65});
    const screen = worldProvider()?.projectPosition(result.position);
    $('location-screen').textContent = !screen ? '3D view unavailable' : screen.visible ? `(${Math.round(screen.x)}, ${Math.round(screen.y)}) px` : 'Outside viewport';
  }
  function resolve(text) {
    const result = resolveDescription(stateProvider(), text);
    candidates = []; $('location-candidates').replaceChildren(); $('location-error').textContent = '';
    if (result.kind === 'error' || result.kind === 'candidates') {
      $('location-error').textContent = result.message;
      if (result.kind === 'candidates') {
        candidates = result.candidates;
        $('location-candidates').innerHTML = candidates.map((item, index) => `<button data-candidate="${index}">${escape(item.name)}<small>${item.kind === 'segment' ? 'Path extent' : 'Named point'}</small></button>`).join('');
      }
      query = {type: 'unresolved'}; refresh(true);
      return;
    }
    query = {type: 'resolved', result}; refresh(true);
  }
  function stopPicking() {
    picking = false; banner.hidden = true; document.body.classList.remove('picking-location');
  }
  function pick(selection) {
    if (!opened && selection.kind !== 'object') return;
    if (!opened) open();
    if (picking || mode === 'occupants') {
      setMode('occupants');
      const position = selection.kind === 'object' ? objectLocation(stateProvider(), selection.id).position : selection.position;
      query = {type: 'point', position: {...position}, name: 'Map selection'};
      fillCoordinates(position); $('location-landmark').value = ''; stopPicking(); refresh(true); return;
    }
    if (selection.kind === 'object') {
      setMode('object'); $('location-entity').value = selection.id; query = {type: 'object', id: selection.id};
    } else {
      setMode('occupants'); query = {type: 'point', position: selection.position, name: 'Map selection'}; fillCoordinates(selection.position);
    }
    refresh(true);
  }
  $('locations').onclick = () => open(!opened); $('location-close').onclick = () => {open(false); $('locations').focus();};
  for (const name of ['object', 'occupants', 'describe']) $(`tab-${name}`).onclick = () => setMode(name);
  panel.querySelector('.location-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const modes = ['object', 'occupants', 'describe'];
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (modes.indexOf(mode) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
    setMode(modes[index]); $(`tab-${modes[index]}`).focus();
  });
  $('location-entity').onchange = () => {query = {type: 'object', id: $('location-entity').value}; refresh(true);};
  $('location-frame').onchange = () => {
    reference = $('location-frame').value;
    $('location-axis').textContent = reference === 'world' ? 'Origin: world (0, 0). +x east · +z south.' : 'Origin: pickup (−12, 8) in world. +x east · +z south.';
    if (activeLocation) fillCoordinates(activeLocation.position); refresh(true);
  };
  $('location-coordinate-form').onsubmit = event => {
    event.preventDefault(); try {
      const position = fromFrame(stateProvider(), {x: numberInput('location-x'), z: numberInput('location-z')}, reference);
      const nextRadius = numberInput('location-radius'); occupantsAt(stateProvider(), position, nextRadius);
      radius = nextRadius; query = {type: 'point', position, name: 'Coordinate query'};
      $('location-landmark').value = ''; $('location-error').textContent = ''; refresh(true);
    } catch (error) {$('location-error').textContent = error.message;}
  };
  $('location-landmark').onchange = () => {
    const place = getLandmarks(stateProvider()).find(item => item.id === $('location-landmark').value);
    if (!place) return; query = {type: 'point', position: place.position, name: place.name};
    fillCoordinates(place.position); $('location-error').textContent = ''; refresh(true);
  };
  $('location-description-form').onsubmit = event => {event.preventDefault(); resolve($('location-description').value);};
  panel.querySelector('.location-examples').onclick = event => {const button = event.target.closest('[data-description]'); if (button) {$('location-description').value = button.dataset.description; resolve(button.dataset.description);}};
  $('location-candidates').onclick = event => {
    const button = event.target.closest('[data-candidate]'); if (!button) return;
    query = {type: 'resolved', result: candidates[Number(button.dataset.candidate)]};
    $('location-error').textContent = ''; $('location-candidates').replaceChildren(); refresh(true);
  };
  $('location-occupant-results').onclick = event => {const button = event.target.closest('[data-object]'); if (button) {setMode('object'); $('location-entity').value = button.dataset.object; query = {type: 'object', id: button.dataset.object}; refresh(true);}};
  $('location-map-pick').onclick = () => {picking = true; banner.hidden = false; document.body.classList.add('picking-location');};
  $('location-cancel-pick').onclick = stopPicking;
  document.addEventListener('keydown', event => {if (event.key === 'Escape' && opened) {if (picking) stopPicking(); else open(false);}});
  function animate(now) {
    if (opened && (now - lastRefresh > 80)) {refresh(); lastRefresh = now;}
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  return {pick, isOpen: () => opened, refresh, reset: () => {stopPicking(); query = {type: 'object', id: 'R-01'}; $('location-entity').value = 'R-01'; setMode('object');}, close: () => open(false)};
}
