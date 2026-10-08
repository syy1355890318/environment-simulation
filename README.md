# Parcel — Robot Delivery Lab

A build-free single-page application written in vanilla JavaScript with a full-window Three.js urban scene. One robot carries one package along a fixed, directed four-segment route totaling 40 meters.

## Run

```sh
python3 -m http.server 4174 --directory dist
```

Open http://localhost:4174. Use HTTP rather than opening the HTML directly; the app uses JavaScript modules. Three.js 0.170.0 is vendored locally under its MIT license.

## GitHub Pages

In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. Merge the app pull request into `main`. The included `.github/workflows/pages.yml` uploads `dist` and deploys it at https://syy1355890318.github.io/environment-simulation/.

Wait for **Deploy Robot Delivery to GitHub Pages** to finish in the **Actions** tab, then open that URL. If the app was merged before Pages was enabled, select the workflow and use **Run workflow** on `main`. All app assets use relative paths, so the repository URL prefix is supported.

## Operate

1. **Pick up** the waiting package at the pickup position.
2. **Move** through the next connected segment. Positions update continuously and actions remain unavailable during traversal.
3. **Wait** at the current position while retaining any package.
4. After the final segment, press **Deliver** to complete the handoff. Arrival does not automatically deliver.

Keyboard shortcuts 1–4 correspond to the four actions. Drag to orbit, scroll to zoom, and use the view controls to reset the camera or switch to overhead view.

Select a path segment in the inspector or 3D scene. While stationary, change its blocked flag or clear width. Blocked and too-narrow movement attempts leave the robot in place and waiting. Clear width must be **strictly greater** than robot width; equal widths do not permit passage. Restore the passage, then press Move to retry. The robot never automatically chooses another route.

Package weight, robot width, and payload capacity are editable before pickup. Weight equal to capacity is valid. Values must be finite and greater than zero; segment clear width must be nonnegative. On compact screens, select a path row to edit conditions, or open **Robot & package details** for specifications.

**Reset simulation** begins a new cycle while stationary. The model’s original delivery cycle never permits a delivered package to be picked up again. State is in memory and resets when the page reloads. Decorative city geometry and entity markers are illustrative; the displayed numeric attributes govern passage rules.

## Location Explorer

Open **Location Explorer** in the toolbar. It offers two representations of the same ground-plane position: numeric `(x, z)` coordinates in meters and a named-place or route description. East is `+x`; north is `−z`.

- **Object:** locate the robot, package, or any path segment. Robot and package queries follow movement live. Paths retain their complete start/end extent; their point marker is explicitly the midpoint.
- **Occupants:** choose a landmark, enter coordinates, or use **Pick a location on the map**. Query robot and package within a nonnegative search radius (default 0.5 m, boundary included with 1e-7 m numerical tolerance). Both can occupy a point; co-location never implies carrying. Path context is listed separately.
- **Describe:** resolve `pickup`, `destination`, named junctions, whole path names, `halfway along Garden Passage`, `50% along S2`, or `6 m along Garden Passage`. The Garden midpoint is `(-2, 2)` m. Ambiguous terms such as `junction` show explicit candidates; unknown descriptions do not invent a location.
- **Reference frame:** switch between World and Relative to pickup. World `(-2, -4)` becomes `(10, -12)` relative to pickup, meaning 10 m east and 12 m north of pickup. Changing frames converts the same selected point rather than moving an entity.

The blue marker and path highlights identify query results. Screen anchors are camera-derived CSS pixel coordinates relative to the page viewport and update during orbit, zoom, and resize. Map picking uses the same ground-plane transform. Querying locations never changes delivery state. Uncarried packages share their semantic x/z anchor with their scene position; vertical separation makes colocated entities visible and is illustrative.

## Implementation

- `dist/model.js` owns the robot, package, route, bidirectional carrying relationship, traversal, and action validation.
- `dist/locations.js` derives landmarks, descriptions, occupancy, reference frames, and description resolution from model state.
- `dist/location-ui.js` and `dist/locations.css` provide the responsive Location Explorer.
- `dist/projection.js` shares the world-to-screen and screen-to-ground transforms.
- `dist/scene.js` renders geometry, moving entities, route states, and camera controls.
- `dist/app.js` connects the toolbar, live entity inspectors, activity log, responsive dialogs, and optional WebMCP browser actions to the same model.
- `dist/index.html` and `dist/style.css` define the accessible interface.

Coordinates use the horizontal x and z axes, in meters. Movement only starts at a segment’s exact start, interpolates to its end, and clears traversal on arrival. The package is in transit exactly while carried, including during waits.

## Test

```sh
node --test tests/*.test.js
```

Nineteen tests cover the nine original delivery-rule cases plus location frames, co-location and ownership, occupancy boundaries, landmark/segment distinctions, ambiguous descriptions, and camera/viewport projection round trips.

The optional WebMCP tools expose read, pickup, move, wait, deliver, and stationary passage editing in supporting browsers. All use the visible interface’s shared model.
