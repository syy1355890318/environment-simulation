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
4. After the final segment, press **Deliver** to complete the handoff. Arrival does not automatically deliver unless a recipient is adjacent; see [Spatial Lab](#spatial-lab-position--movement).

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

## Spatial Lab: Position + Movement

Open **Spatial Lab** in the toolbar. Drag people and cones on the ground, type their coordinates, or load a scene: **Street**, **Relations**, **Crowd**, **Warning**, or **Movement**. Indicators appear in the 3D view and are listed in the panel. Drag empty ground to orbit.

The ground is a grid of 2 m cells centered on even coordinates. A cell is occupiable unless it is off the map or inside a building. Moving objects are judged by the cell they currently occupy. A package being carried is not a separate object.

| Position | Condition | Indicator |
|---|---|---|
| **Adjacent** | Distinct cells with no occupiable cell between them. An occupied cell still counts as occupiable; a building cell does not, so two objects on either side of a building are adjacent. | Green bar and tinted cells, thicker across a building |
| **Between** | The middle object's cell is on the straight line joining two others, within 14 m. | Blue line and a diamond on the middle object |
| **Among** | Strictly inside the outline of at least three other objects, in distinct cells, within 6 m. | Purple outline and a ring on the center |

| Movement | Condition | Indicator |
|---|---|---|
| **Toward / Away** | Distance to a referent shrinks or grows by at least 0.25 m/s. The nearest referent is shown. | Colored arrow, dotted trail, and label |
| **Past** | Came within 4 m, reached the far side of the referent, and is receding. Turning back does not count. | Pin at the closest point with its distance |
| **Into / Out of** | Crosses the boundary of the 3 m pickup or destination zone. | Zone ring pulses and a label |

| Behavior | Trigger | Response |
|---|---|---|
| **Crowd** (placement) | Three or more people linked within two cells | A circle is drawn. If it covers the next segment, Move makes the robot wait. It does not reroute or retry on its own. |
| **Occupied path** (placement) | An occupant stands on the next segment | Move makes the robot wait until the path is clear. |
| **Warn** (capability) | A cone is adjacent to the robot | Pulsing ring, and the robot moves at 40% speed. |
| **Receive** (capability) | A recipient is adjacent to the carrying robot at the destination | Automatic handoff. With no adjacent recipient, press **Deliver** as usual. |

## Implementation

- `dist/model.js` owns the robot, package, route, bidirectional carrying relationship, traversal, and action validation.
- `dist/locations.js` derives landmarks, descriptions, occupancy, reference frames, and description resolution from model state.
- `dist/location-ui.js` and `dist/locations.css` provide the responsive Location Explorer.
- `dist/spatial.js` defines the occupiable grid and building footprints; `dist/relations.js` detects position relations and crowds; `dist/movement.js` reads movement from position history.
- `dist/behaviors.js` holds occupants, scenes, and the responses to placement. `dist/spatial-overlay.js`, `dist/spatial-ui.js`, and `dist/spatial.css` draw the figures, indicators, and panel.
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
