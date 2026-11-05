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

The bar at the bottom always shows the next step and one button: **Pick up**, **Move**, **Deliver**, or **Start over**. The pause button waits in place. Keys 1–4 are pick up, move, wait, and deliver.

Click anything on the map to open its card: the robot and package for their specifications, a path to change its clear width or block it, a person or cone to place or remove it, or empty ground to see what is there. Click empty ground or press Escape to close the card. Drag people and cones to move them, and drag the ground to orbit.

Blocked and too-narrow moves leave the robot waiting in place. Clear width must be **strictly greater** than robot width. Restore the passage, then press Move again; the robot never reroutes itself. Package weight, robot width, and capacity are editable before pickup. State is in memory and resets on reload. **Reset** and the activity log are in the ⋯ menu.

## Find

The search box takes `pickup`, `destination`, a junction, a path name, `halfway along Garden Passage`, `50% along S2`, `6 m along Garden Passage`, coordinates such as `-2, 2`, or an object such as `robot`, `PKG-001`, or `P-1`. Ambiguous terms list their candidates; unknown descriptions do not invent a location. East is `+x` and north is `−z`.

A place card lists who is within the search radius (default 0.5 m, boundary included). Under **Options**, measure from World or Pickup, and change the radius. World `(-2, -4)` is `(10, -12)` from pickup. Finding things never changes delivery state.

## Position and movement

Choose a scene from the menu at the top: **Street**, **Relations**, **Crowd**, **Warning**, or **Movement**. Add people, recipients, and cones with **＋**. Indicators appear on the map as conditions are met.

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
- `dist/inspector.js` renders the selection card and resolves searches. `dist/next-step.js` decides the single next step.
- `dist/spatial.js` defines the occupiable grid and building footprints; `dist/relations.js` detects position relations and crowds; `dist/movement.js` reads movement from position history.
- `dist/behaviors.js` holds occupants, scenes, and the responses to placement. `dist/spatial-overlay.js` draws the figures and indicators.
- `dist/projection.js` shares the world-to-screen and screen-to-ground transforms.
- `dist/scene.js` renders geometry, moving entities, route states, and camera controls.
- `dist/app.js` connects the top bar, next-step bar, menus, dialogs, and optional WebMCP browser actions to the same model.
- `dist/index.html` and `dist/style.css` define the accessible interface.

Coordinates use the horizontal x and z axes, in meters. Movement only starts at a segment’s exact start, interpolates to its end, and clears traversal on arrival. The package is in transit exactly while carried, including during waits.

## Test

```sh
node --test tests/*.test.js
```

Nineteen tests cover the nine original delivery-rule cases plus location frames, co-location and ownership, occupancy boundaries, landmark/segment distinctions, ambiguous descriptions, and camera/viewport projection round trips.

The optional WebMCP tools expose read, pickup, move, wait, deliver, and stationary passage editing in supporting browsers. All use the visible interface’s shared model.
