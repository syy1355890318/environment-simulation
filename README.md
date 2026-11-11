# Parcel

A build-free single-page application written in vanilla JavaScript with a full-window Three.js city. The city is 96 × 72 m: eight streets and four alleys between blocks of buildings, a plaza, a park, five exhibits, two chargers, a depot, and three patches of roadworks. Agents explore it with limited sight, map it, and leave landmarks. People and cones can be placed on it, and their positions and movement are detected and shown.

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

## The town

The setting is a small harbor town holding an open-air art walk. Visitors come to see five outdoor exhibits and couriers carry parcels around town. The town is an island: the sea surrounds it, with boats on every side and the lighthouse at the end of a pier to the north. Roofs are drawn in black lines only, and every tree is blue.

| District | Where | Buildings |
|---|---|---|
| Harbor | North | Warehouses with sawtooth and gable roofs |
| Market | Center and east | Shop-houses of two to four floors with awnings, around the plaza and its fountain |
| Homes | West | One- and two-floor houses with pitched, patterned roofs, chimneys, and gardens, beside the park |
| Works | South | Workshops and the parcel depot |

Buildings stand at their real, varied heights, so they can hide what is behind them. Two things keep agents in view: a person or agent hidden by a building shows through it as a flat blue shape, and when an agent is selected the buildings in front of it are reduced to their outlines. The overhead view button shows everything on the ground.

Blocks sit on a grid of columns and rows, and streets are the gaps between them. Main streets are 6 m wide (three cells); alleys are 2 m wide (one cell). Mill Lane and Baker Yard run to the edge of the map and stop, and each has a charger. The plaza and park are open ground. `dist/city.js` is the single source for blocks, streets, and places; `dist/town.js` only decides how they look, so it never changes where anything can walk.

## Explorers: spatial agents

The **Explorers** scene opens by default. Two kinds of agent enter at the ends of the main streets, knowing nothing about the city.

| | Visitor | Courier |
|---|---|---|
| Goal | See all five exhibits, then return to its own gate | Carry parcels from the depot to exhibits |
| Performance criterion | Each tour in 300 s or less | As little energy as possible; recharge when the battery is low |
| Speed | 2 m/s | 3 m/s |
| Slow ground | Costs time, so it is crossed if the detour is long | Costs three times the energy, so it is avoided harder |

How each requirement is met:

- **Limited knowledge.** Each agent has its own memory, empty at the start. Planning and decisions read only that memory; `perception.js` is the one module that reads the true city, and a test checks that the thinking modules never import it.
- **Cone of vision.** An agent sees 10 m ahead within 100°, plus 1.6 m all around. Buildings block the view. It discovers obstacles (buildings), hindrances (roadworks and cones), and affordances (exhibits, chargers, the depot).
- **Avoiding others.** Agents steer away from others they see, keep right, slow when one is close ahead, and slide along walls. A stuck agent turns aside and replans.
- **Mapping.** Every seen cell is recorded on a 1 m grid. With nowhere known to go, an agent walks to the nearest edge of what it has looked at.
- **Landmarks.** Seeing a place or slow ground leaves a landmark holding what it is, where, when it was found, and the walked distance to other landmarks.
- **Using landmarks.** On later trips an agent goes straight to its landmarks. Turn off **Use landmarks** and each new trip forgets where things are, though not where the walls are, so it must search again. In the tests a visitor's second tour takes about 210 s with landmarks, against about 390 s for its first and about 330 s without them.
- **One agent's knowledge.** Click an agent, or type its name such as `V-1` in the search box. Ground it has not seen is veiled, buildings and places it does not know are hidden, what it sees now is blue, and its landmarks and planned path are drawn. Its card shows its goal, performance, and trips.
- **Many agents.** The slider sets 2 to 10 agents; new ones enter without restarting the others.
- **What they have in common.** The layer menu shows **All paths** (how often each cell was walked), **Landmark heatmap** (how many agents hold each landmark), and **Shared knowledge** (how many agents know each cell).

Play or pause, and step the speed through 1×, 4×, and 16×. **＋** adds a cone, which slows the cell it stands on. Runs are repeatable: the same settings give the same run. The page must be visible for the simulation to run at full speed.

## Find

The search box takes a place such as `Fountain`, a street such as `Market Street`, coordinates such as `20, 2`, or an occupant such as `P-1`. The map centers on the result. Partial names that match several things list the candidates; unknown names do not invent a location. East is `+x` and north is `−z`.

A place card lists who is within the search radius (default 0.5 m, boundary included), which can be changed under **Options**.

With `?delivery`, search also takes `pickup`, `destination`, `halfway along Garden Passage`, `50% along S2`, and `robot`, and the bar at the bottom shows the next delivery step: **Pick up**, **Move**, **Deliver**, or **Start over**. Keys 1–4 are pick up, move, wait, and deliver. A segment must be unblocked and strictly wider than the robot, or the robot waits in place.

## Position and movement

Choose a scene from the menu at the top: **Explorers**, **City** (empty), **Relations**, or **Movement**. With `?delivery` there are also **Street**, **Crowd**, and **Warning**. Indicators appear on the map as conditions are met.

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
- `dist/nav.js` is the 1 m navigation grid. `dist/agent-world.js` is the true city and `dist/perception.js` the only reader of it. `dist/agent-memory.js`, `dist/planner.js`, and `dist/agent.js` are what an agent knows, plans, and does. `dist/agent-sim.js` runs them in fixed 0.1 s steps; `dist/agent-overlay.js` and `dist/agent-ui.js` draw them.
- `dist/projection.js` shares the world-to-screen and screen-to-ground transforms.
- `dist/town.js` builds the town's look: lots, roofs, drawn textures, landmarks, sea, and trees. `dist/silhouette.js` lets figures show through buildings.
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
