# Parcel

A build-free single-page application written in vanilla JavaScript with a full-window Three.js city. The city is 96 × 72 m: eight streets and four alleys between blocks of buildings, a plaza, a park, five exhibits, and two chargers. People and cones can be placed on it, and their positions and movement are detected and shown.

The original robot delivery is **switched off for now**. Its code and tests are kept; open the page with `?delivery` at the end of the address to bring it back.

## Run

```sh
python3 -m http.server 4174 --directory dist
```

Open http://localhost:4174. Use HTTP rather than opening the HTML directly; the app uses JavaScript modules. Three.js 0.170.0 is vendored locally under its MIT license.

## GitHub Pages

In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. Merge the app pull request into `main`. The included `.github/workflows/pages.yml` uploads `dist` and deploys it at https://syy1355890318.github.io/environment-simulation/.

Wait for **Deploy Robot Delivery to GitHub Pages** to finish in the **Actions** tab, then open that URL. If the app was merged before Pages was enabled, select the workflow and use **Run workflow** on `main`. All app assets use relative paths, so the repository URL prefix is supported.

## Operate

Drag the map to move around and scroll or pinch to zoom. Hold Shift or the right mouse button and drag to turn the view; on a touch screen, twist with two fingers. The buttons at the top right zoom, switch to an overhead view, and reset the camera.

Add a person, recipient, or cone with **＋**, then drag it. Click one to place it by coordinates or remove it. Click the ground to see what is there, and click the ground again or press Escape to close the card. State is in memory and resets on reload. **Reset** and the activity log are in the ⋯ menu.

## The city

Blocks sit on a grid of columns and rows, and streets are the gaps between them. Main streets are 6 m wide (three cells); alleys are 2 m wide (one cell). Mill Lane and Baker Yard run to the edge of the map and stop, and each has a charger. The plaza and park are open ground. Everything else inside a block is building. `dist/city.js` is the single source for blocks, streets, and places.

## Find

The search box takes a place such as `Fountain`, a street such as `Market Street`, coordinates such as `20, 2`, or an occupant such as `P-1`. The map centers on the result. Partial names that match several things list the candidates; unknown names do not invent a location. East is `+x` and north is `−z`.

A place card lists who is within the search radius (default 0.5 m, boundary included), which can be changed under **Options**.

With `?delivery`, search also takes `pickup`, `destination`, `halfway along Garden Passage`, `50% along S2`, and `robot`, and the bar at the bottom shows the next delivery step: **Pick up**, **Move**, **Deliver**, or **Start over**. Keys 1–4 are pick up, move, wait, and deliver. A segment must be unblocked and strictly wider than the robot, or the robot waits in place.

## Position and movement

Choose a scene from the menu at the top: **City** (empty), **Relations**, or **Movement**. With `?delivery` there are also **Street**, **Crowd**, and **Warning**. Indicators appear on the map as conditions are met.

The ground is a grid of 2 m cells centered on even coordinates. A cell is occupiable unless it is off the map or inside a building; the grid is drawn only where something can stand. Moving objects are judged by the cell they currently occupy. A package being carried is not a separate object.

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
- `dist/city.js` defines the blocks, streets, and places. `dist/spatial.js` defines the occupiable grid; `dist/relations.js` detects position relations and crowds; `dist/movement.js` reads movement from position history.
- `dist/behaviors.js` holds occupants, scenes, and the responses to placement. `dist/spatial-overlay.js` draws the figures and indicators.
- `dist/projection.js` shares the world-to-screen and screen-to-ground transforms.
- `dist/scene.js` renders the city and handles panning, zooming, turning, and picking. `dist/delivery-layer.js` draws the robot, package, and route when delivery is on.
- `dist/app.js` connects the top bar, next-step bar, menus, dialogs, and optional WebMCP browser actions to the same model.
- `dist/index.html` and `dist/style.css` define the accessible interface.

Coordinates use the horizontal x and z axes, in meters. Movement only starts at a segment’s exact start, interpolates to its end, and clears traversal on arrival. The package is in transit exactly while carried, including during waits.

## Test

```sh
node --test tests/*.test.js
```

The tests cover the city plan, position relations, movement, behaviors, and the nine original delivery-rule cases plus location frames, co-location and ownership, occupancy boundaries, landmark/segment distinctions, ambiguous descriptions, and camera/viewport projection round trips.

The optional WebMCP tools expose read, pickup, move, wait, deliver, and stationary passage editing in supporting browsers. All use the visible interface’s shared model.
