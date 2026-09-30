# Horizon

An approachable browser flight-simulator prototype over real US terrain, flying
Oʻahu, Kauaʻi, the Grand Canyon, Lake Tahoe, the Tetons, Canyonlands and
Mount Rainier.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Controls

- `W` / `S`: pitch
- `A` / `D`: roll
- `Q` / `E`: rudder
- `↑` / `↓`: throttle
- `F` / `V`: extend or retract flaps
- `G`: landing gear
- `B`: speedbrake in the air, wheel brakes on the ground
- `C`: cockpit/chase camera
- Drag: look around (chase orbits the aircraft, cockpit turns your head)
- `P` or `Esc`: pause
- `R`: rewind five seconds

### Touch

On a touch device the keyboard legend is replaced by on-screen controls: a pitch
and roll pad on the left, and throttle, flaps, gear and brakes on the right.
Rudder has no button of its own; on the ground the roll input also steers the
nosewheel, which is what it is needed for.

**Tilt device** swaps the left-hand pad for the device's own orientation sensor.
The angle you are holding the device at when you enable it becomes level, so it
works lying flat on a table or propped up on your lap; **Set level** re-zeroes it
from wherever you are now, and rotating the device re-zeroes it automatically.
Tilting roughly 28° from neutral in either axis is full deflection. iOS asks for
motion-sensor permission the first time, which is why the button has to be
tapped rather than gyro being on by default.

## Current scope

The playable prototype includes five aircraft, from a Cessna 172 to an F-35A,
six flyable areas — Hawaiʻi, the Grand Canyon, Lake Tahoe, Grand Teton, Moab
and Mount Rainier — with seventeen airfields between them and every paved runway
selectable
as a departure, runway and airborne starts, selectable fuel loads with
per-aircraft capacities and consumption, simplified assisted flight physics,
graded landings and crashes, cockpit and chase views, live telemetry, pause,
rewind, and runway reset.

The simulation uses a consistent physical scale of one Three.js world unit per ten metres. Terrain dimensions, elevations, aircraft, runways, movement speed, cameras, ground clearance, and altitude telemetry all use this convention.

The world code deliberately has no Cesium dependency.

### Areas

Setup starts with the area, and the rest of the form — departure, aircraft,
fuel — follows from it. All six areas on the list are flyable. The machinery for
an area that is not still exists — it swaps the copy and the preview, disables
the departure picker, and washes the preview out rather than leaving it circling
Oʻahu under someone else's name — because the next one added will need it before
its scenery is baked.

**Each area is its own world.** The Colorado Plateau is four thousand kilometres
from Oʻahu, far enough that a shared frame would spend the precision a float32
position attribute has to spare, and there is nothing to fly between them
anyway. So every area is centred on its own origin and only one is resident at a
time: choosing one tears down the previous area's terrain, imagery, airfields
and navigation map before building the new set. That is also what lets an area
decide whether it has a sea at all.

Every area on the list is inside the coverage of the same public-domain USGS
sources the Hawaiʻi pipeline already uses, so adding one is a data job rather
than a plumbing job: bake its DEM, orthoimagery and airfields with the scripts
in `scripts/`, then fill in `terrains`, `airports`, `airfields`, an `orbit` for
the setup camera and an `air` palette on its entry in `REGIONS`, and set
`built: true`.

#### Areas without a coast

Hawaiʻi ends at a coastline and the ocean shader takes over. The Grand Canyon
ends in mid-desert, and from the runway at Tusayan the southern edge of the
survey is only ten kilometres away — close enough to watch the world stop. Three
things differ for an area with `sea: false`:

- The ocean plane, the shore-distance field and the shore apron are all skipped.
- **A second, coarser terrain mesh carries the ground to the horizon.** The
  first attempt was a skirt — the boundary ring scaled outward at unchanged
  heights — and every version of it looked like what it was. Real ground is both
  simpler and better: a 220 × 220 km mesh at 500 m samples, reaching a hundred
  and ten kilometres out, which the haze closes over long before it ends. It
  costs under a megabyte, because the 3DEP image service resamples on request
  rather than making you download sixteen more one-degree tiles. Areas tagged
  `far: true` are drawn but never flown: the navigation map ignores them, and
  `sampleTerrain` prefers the fine mesh wherever it has an opinion.
- Sky, haze and cumulus base come from the area. Cloud altitude matters more
  than it sounds: the field is tuned for a sea-level island, and left alone it
  sits *inside* a canyon whose rim is already two kilometres up.

#### Mosaic seams

NAIP is flown per state, so an area straddling a state line gets two exposures
butted together. Lake Tahoe and Grand Teton both do: the California/Nevada line
runs down the middle of one, the Wyoming/Idaho line eight kilometres in from the
edge of the other. Moab and Mount Rainier need none of it — their boxes sit
wholly inside one state, so each mosaic is a single exposure and the area simply
declares no seam.

Nothing about the step can be assumed. Nevada is *brighter* than California;
Idaho is *darker* than Wyoming. Nor can it be taken from block means, because
the land genuinely differs across a border — measuring Tahoe in 2.6 km blocks
reports anything from 25 to 70 levels depending on where the blocks fall, most
of it the Carson Range rather than the camera. So the runtime reads it as a
discontinuity instead: for each row of the mosaic, the median of a short run
either side of the line, then the median of those differences. Short runs keep
the land comparable and the medians reject the rows where it is not. An area
declares only *where* its line is; `measureSeamOffset` reads *how big* off the
photograph at load, which is a few hundred thousand pixels of one canvas.

Two things about the correction. It is a **subtraction, not a gain**: the two
sides differ in mean by thirty-odd levels while their standard deviations match
within ten percent, so the exposure is offset rather than scaled, and a gain
matching the means would flatten one side's contrast by a third. And **both
sides move**, each in proportion to how much of the frame the other covers. A
seam near the middle splits the correction roughly evenly; Grand Teton's, with
86% of the box on the Wyoming side, brightens Idaho most of the way and barely
touches Wyoming. Correcting only one side would have dragged the whole scene to
whichever exposure happened to be on the smaller side of the line.

It is applied in the shader, feathered over 600 m, in gamma space because that
is where the offset was measured — and to the airfield insets too, which lie
wholly on one side and so have no step of their own to read.

What is left afterwards at Grand Teton is not an error: farmland in Teton Valley
stops at the state line because land use does, and no exposure correction should
remove that.

Not handled: horizontal seams. The Grand Canyon's far mosaic has one at the Utah
line along its northern edge, which sits beyond the fog.

An inland area can still have water. Lake Tahoe is not a sea — it sits at
1,897 m — so it gets no ocean plane, and it is not photographed either: NAIP is
flown per state and per swath, and the lake arrives as vertical scan banding, a
hard exposure step down the California/Nevada line through the middle of it, and
a scatter of glare blooms, all draped on a perfectly flat surface with nothing to
distract from any of it. The survey is what identifies the water instead — a lake
is the one part of a mountain DEM that is exactly level — so fragments within a
couple of metres of `waterLevelM` are shaded as a calm alpine surface rather than
textured. Grand Teton gets the same treatment for Jackson Lake.

Take that elevation from the survey and not from the map. 3DEP reports Tahoe at
1897.89 m across sixty-five thousand samples, and being one metre out is enough
to put the shallow-water ramp across the whole lake. Jackson Lake is worse: the
map says 2064 m at full pool, the survey says a dead-flat 2055.5 m over
seventy-six square kilometres, because the reservoir was drawn down when it was
flown. Eight and a half metres out would have missed the lake entirely.

Two grids meeting need care in both directions. Triangles of the coarse mesh
whose corners all fall inside the fine one are dropped, which leaves the survivors
overlapping by up to a cell rather than leaving a half-kilometre crack of open
sky; a polygon offset settles which is drawn in the overlap. And because a 500 m
sample cannot follow the Kaibab escarpment, the two disagreed about the ground by
up to three hundred metres at the boundary, so the overlap floated above the fine
mesh as a grey shelf. Coarse vertices inside the fine mesh's box therefore take
the fine mesh's height, which puts the seam on one surface.

## Scenery data

All three datasets are built offline into `public/` and loaded as static files at
runtime. Each build script is independent and safe to re-run.

| Command | Source | Licence | Output |
| --- | --- | --- | --- |
| `npm run terrain:build` | USGS 3DEP seamless 1/3 arc-second DEM | Public domain | `public/terrain/` |
| `npm run terrain:grandcanyon` | USGS 3DEP seamless 1/3 arc-second DEM | Public domain | `public/terrain/` |
| `npm run terrain:area <id>` | USGS 3DEP elevation image service | Public domain | `public/terrain/` |
| `npm run airports:build` | OurAirports runways · OpenStreetMap structures | Public domain · ODbL 1.0 | `public/airports/` |
| `npm run imagery:build` | USGS NAIP Plus orthoimagery via The National Map | Public domain | `public/imagery/` |

`terrain:build` needs four source GeoTIFFs in `data/raw/`: two for Oʻahu and two
for Kauaʻi, which crosses 22° N. `terrain:grandcanyon` needs two more, either
side of 36° N. Raw elevation tiles are ignored by git and can be downloaded
directly from the official USGS staged products:

```bash
curl -L https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n22w158/USGS_13_n22w158.tif -o data/raw/usgs-n22w158.tif
curl -L https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n22w159/USGS_13_n22w159.tif -o data/raw/usgs-n22w159.tif
curl -L https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n22w160/USGS_13_n22w160.tif -o data/raw/usgs-n22w160.tif
curl -L https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n23w160/USGS_13_n23w160.tif -o data/raw/usgs-n23w160.tif
curl -L https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n36w113/USGS_13_n36w113.tif -o data/raw/usgs-n36w113.tif
curl -L https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n37w113/USGS_13_n37w113.tif -o data/raw/usgs-n37w113.tif
```

The Colorado Plateau tiles are around 400 MB each, against 40–60 MB for the
Hawaiʻi ones: an island tile is mostly ocean, and ocean compresses to nothing.

Four of the six areas come from `terrain:area`, which needs nothing in
`data/raw/`; new ones belong there rather than in a tile reader — it holds one config block per area and builds both that
area's meshes. Four one-degree tiles for a box like Tahoe's would be 1.6 GB of
download, every byte of it resampled straight back down to eighty metres; the
3DEP *image service* does that resampling server-side, so the same ground — both
the detail mesh and its far mesh — arrives in two requests totalling about
thirty megabytes. The catch is the same one the imagery builder hit: the request
has to be made on a pixel grid whose aspect matches the box measured in degrees,
or the service quietly widens the box until it fits. Both builders now ask for
the response metadata first and fail if the extent came back rewritten.

The airport and imagery builders take an optional area id — `node
scripts/build-airports.mjs grand-canyon` — to rebuild one area without touching
the others' committed data.

Within Hawaiʻi, Oʻahu is the projection origin and Kauaʻi is a separate mesh
centred 175.2 km northwest of it, so both islands retain roughly 140 m terrain
samples without filling the inter-island ocean with a million-vertex rectangle.
The Grand Canyon is a 70 × 62 km mesh on its own origin at roughly 91 m samples
— finer than the islands, because a canyon is all edges and the rims go to mush
at 140 m. It is also read three times finer than that and box averaged down,
since a straight bilinear decimation point-samples those edges into a staircase.
`terrain:grandcanyon` writes a second, coarse mesh alongside it: see *Areas
without a coast* for why, and note it comes from the 3DEP image service rather
than the raw tiles, so that step needs the network. The airport and imagery builders fetch their source data over the
network.

### Airports

Runway geometry comes from surveyed threshold coordinates, so the paved runways
at PHNL, PHJR, PHDH, PHLI, PHPA, KGCN, KTVL, KTRK, KMEV, KCXP, KJAC, KDIJ, KCNY,
UT53, KPLU, 55S and 39P sit at their true positions, lengths, widths, and
headings. A runway OurAirports carries
without any threshold coordinates — usually an unpaved glider strip, such as
Minden's 12G/30G — is dropped rather than placed at a guess: projecting a
missing coordinate puts it a thousand kilometres off the airfield, which then
drags the imagery inset's bounding box out with it. Each surface is painted at build time
into a single canvas texture at two pixels per metre — threshold bars,
designation numerals, centreline, aiming points, touchdown-zone groups, side
stripes, displaced-threshold arrows, and rubber deposits — following FAA advisory
circular 150/5340-1. Edge, centreline, threshold, PAPI, and approach lighting are
drawn as one point cloud per field. Terminals, hangars, the control tower, and
the apron and taxiway network are extruded from OpenStreetMap footprints.

Airfields are graded onto a flat pad at their published elevation. The mask is
rasterised once per field and sampled by both the terrain mesh and the flight
model, so the ground you see and the ground you roll on cannot disagree. This is
what puts PHNL's Reef Runway on a causeway: the 1/3 arc-second DEM samples that
coral platform as open ocean, which previously left the runway half underwater.

### Flight model

Longitudinal motion is a point-mass model rather than a throttle-to-speed
mapping. Speed comes from thrust, drag and the component of gravity along the
flight path; the flight path angle is curved by whatever lift is left over after
holding the aircraft's weight. Two consequences matter in the cockpit: closing
the throttle is a **glide**, not a car coasting to a stop, and pointing the nose
down **descends and builds speed** instead of mushing along at altitude.

Each aircraft's constants are derived from the numbers already quoted for it, so
handling stays tied to the published figures — the lift constant from the stall
speed (at the takeoff speed with the wing at maximum lift it can just hold
itself up), drag from the top speed (at full throttle in level flight, thrust
and drag balance there). Angle of attack is the difference between where the
nose points and where the aircraft is actually going, which is what makes the
wing stop working when it is dragged too far off the flight path.

Two deliberate concessions to it being an assisted sim: part of the extra lift a
real pilot would pull in through a bank is added for you (steep banks still
descend), and the load factor is capped so an abrupt pull cannot generate
absurd g.

### Fuel

Fuel is selected before departure as a percentage of the aircraft's published
capacity. The setup screen translates that percentage into the aircraft's native
quantity and shows a cruise-power endurance estimate. In flight, consumption
follows throttle position from idle flow to maximum-power flow. At zero usable
fuel, thrust and powered propeller/jet effects stop and the aircraft continues as
a glide.

| Aircraft | Modelled capacity |
| --- | ---: |
| Cessna 172S | 53 US gal usable |
| Daher TBM 930 | 291 US gal usable |
| ICON A5 | 20 US gal usable |
| Airbus A380 | 320,000 L maximum |
| F-35A | 18,498 lb internal |

Fuel is included in rewind snapshots. Resetting to the runway restores the fuel
load chosen for that departure rather than filling the tanks automatically.

### On the ground

`A` / `D` steer rather than bank once the wheels are down. The undercarriage
holds the aircraft level, so commanding roll on the runway used to dig a wingtip
into the tarmac and write the aircraft off; now the ailerons still deflect with
the stick but the aircraft yaws instead. Steering is modelled as a wheel held at
an angle carving a fixed radius, so yaw rate follows ground speed — slow but
tight while taxiing — and the deflection washes out with speed, because a tiller
that stayed fully authoritative at rotation speed would simply swerve the
aircraft off the runway.

Two things have to be true for that to work, and both were bugs:

- **Resting contact counts as contact.** An aircraft parked exactly on its
  wheels has zero penetration, and a strict "is it penetrating" test called that
  airborne — which handed lateral input straight back to the ailerons.
- **Wheels follow the surface down as well as up.** Pavement is drawn proud of
  the earth around it, so an aircraft that could only ever be lifted climbed off
  the runway edge and was again reported as flying. It now settles too — but
  only while descending or level, so a climbing aircraft is never pulled back
  and can still fly off the runway.

### Looking around

Dragging works in both views, but they are not the same gesture. In chase you
swing the camera around the aircraft, and it drifts back behind the tail five
seconds after you let go. In the cockpit you turn your head: the line of sight
is rotated about the eye in **body axes**, so "left" means the left window
whatever attitude the aircraft is in, and the horizon stays level as you look.
Pitch is applied about the lateral axis before yaw about the vertical — the same
order a head turns — and both are clamped short of vertical, where `lookAt`
would gimbal.

The cockpit view is **held** where you leave it rather than recentred on a
timer. On final you want your eyes on the runway through the side window, and
having the view swing forward again on its own is the opposite of useful. It
returns to centre when you change camera or aircraft.

### Undercarriage

The gear swings rather than popping, and the retraction geometry is derived from
the model rather than authored per aircraft: each unit pivots about the top of
its own leg, the forward-most unit folds forward and the rest fold inboard,
which is what nearly every retractable aircraft does. That means a new aircraft
gets a working animation for free. Cycle times are per type — 6 s for the F-35,
7 s for the TBM, 14 s for the A380 — and the HUD reads `Transit` in between.

The belly contact point rides up as the gear stows, so a gear-up arrival strikes
the fuselage rather than a wheel that is no longer hanging there.

Flaps run out the same way. `F` and `V` select a detent; the panels travel to it
at a fixed rate — 5 s across the range for the F-35, 18 s for the A380's very
large flaps — and both the geometry and the aerodynamics follow where the panels
actually are, not what was selected. Lift and drag therefore arrive as the flaps
extend rather than the instant a key is pressed, and the HUD shows the deflection
sweeping toward the detent. The F-35's leading-edge flaps track the trailing
edge, as they do on the aircraft.

Two heights have to agree for the wheels to sit on the ground rather than in it.
Airfield pavement is **drawn** 0.3 m above the graded earth to keep it out of
the depth buffer, so the flight model has to add that back — otherwise an
aircraft rolls buried to the axles in a runway it is visibly sitting on. The
aircraft is then placed on its own tyres at start rather than at a fixed
clearance, since an A380's undercarriage holds it four times higher off the
tarmac than a light aircraft's.

### Slowing down

Closing the throttle is not how an aircraft loses speed — a clean airframe just
keeps what it has, and pointing the nose down to descend trades altitude
straight back into speed. Speed is shed with **drag**, so gear, flaps and the
speedbrake each add a parasite term on top of the clean figure the published top
speed already calibrates. Measured, holding level with the throttle closed, from
450 kt to 180 kt:

| | Clean | Speedbrake | Gear + full flap + speedbrake |
| --- | --- | --- | --- |
| F-35A | 124 s | 78 s | **53 s** |
| A380 | 44 s | — | **17 s** |

The F-35 is the slowest to slow: it is a clean, low-drag airframe, and that is
the correct behaviour rather than a missing brake. The A380 is draggier at any
given speed, which is why it bleeds energy so much faster.

On the ground the wheels take over — rolling resistance always, brakes on
demand. An A380 touching down at 140 kt stops in 581 m with the brakes and rolls
4 255 m without them.

Turn rate is not a tuned number — it falls out of the model, and measures within
2% of the coordinated-turn relation ω = g·tan φ / V at every speed and bank
tested. The practical consequence is that **speed, not control input, is what
governs how fast an aircraft comes round**: an A380 needs 75 seconds for a
180° turn at 467 kt and 29 seconds for the same turn at 179 kt. That is the real
aircraft's behaviour, not a limitation of the sim. What each aircraft can bank
to is a per-aircraft limit, and it is the only real lever on turn rate:

| Aircraft | Max bank | Reasoning |
| --- | --- | --- |
| C172 · TBM · A5 | 41° | A standard steep turn |
| A380 | 46° | 1.4 g against a 2.5 g airframe; autopilots hold 25-30°, hand-flown goes further |
| F-35A | 77° | About 4.5 g, the sustained turn it is actually flown at |

### Attitude

An aircraft's attitude is yaw, then pitch, then roll, each about the body axes
left by the one before — Euler order **YXZ**. Three's default is XYZ, which
applies pitch about the *world* X axis instead. Pointing north the two agree, so
the mistake hides; on any other heading pulling back rolls the aircraft as much
as it pitches it. Measured against the wing line with the old order: on 045°,
twenty degrees nose-up induced 14° of bank, and nose-down induced 14° the other
way; on 090° it was a full 20°. PHNL's runway 08L points 080°, so almost every
flight started in the worst of it. The order is now set once on the airframe,
where the three places that write attitude cannot miss it.

### Aircraft

The C172, TBM 930, F-35A and A380-800 are modelled in detail; the A5 is still a
placeholder. The three newest are built in metres with `modelScale` converting
straight to world units, so their dimensions can be read against the published
airframe and checked in-sim.

All four fly as downloaded models rather than built geometry, which buys a
far better airframe and a genuinely good interior than hand-extruded primitives
ever would. The built versions stay in the tree and fly until the download
lands.

The **C172S Skyhawk** was the first: a G1000 panel with legible displays, a full
radio stack and standby instruments.

> "FREE Cessna 172SP" ([skfb.ly/pwATP](https://skfb.ly/pwATP)) by NLM is
> licensed under [Creative Commons Attribution](http://creativecommons.org/licenses/by/4.0/).

Making it flyable took a little work, in `src/c172-glb.js`. Sketchfab's glTF
conversion strips object names — every mesh arrives as `Object_44` — and the
author worked with Blender's defaults, so the `.blend` is no better. Parts are
therefore identified by geometry: triangle count as a fingerprint, checked
against where the part sits in the airframe, since counts collide. A file that
does not match fails loudly rather than silently animating the wrong mesh.

Four things then have to be corrected:

- The model ships parked, with red tie-down straps running to concrete weights.
  Those come off by material.
- The glazing is authored fully metallic mid-grey, which mirrors rather than
  transmits — from the cockpit the whole world arrives dimmed and blue. It is
  retuned to behave like glass.
- Removing the straps leaves their hardware behind: the eyelets and shackles
  under each wing, plus a rod spanning the main gear track at axle height. All
  share the `Metal` material with parts worth keeping, so they come off by
  fingerprint through `PRUNE` rather than by material. The centroid half of the
  fingerprint earns its place here — one of them has two identically-sized twins
  down by the gear that have to survive.
- The propeller's painted tip stripes are a separate layer from the blades. Left
  as the file has them they hang in the air while the propeller turns
  underneath, so they are attached to the same pivot — and faded with the blades
  in the cockpit view, which needs the fade to accept a list rather than one
  mesh.
- **The model has one wing lift strut, on the left.** Every other asymmetric
  part comes as a mirrored pair; this one does not. Rather than build a
  replacement, the left strut is mirrored across the centreline, which matches
  its section, material and fittings exactly. Negating x reverses triangle
  winding, so the index is flipped to keep the faces pointing outwards.

Flaps, ailerons and elevator arrive as one object each spanning both wings, so
each is split down the centreline and hinged separately — ailerons in particular
have to deflect in opposite directions. The airframe is turned 180° to face the
sim's nose-along-−z, which would reverse every rotation applied inside it, so
each hinge hangs off a frame carrying the opposite turn. Its axes then line up
with the aircraft's and the rest of the sim drives it exactly as it drives a
hand-built airframe. The file resolves to 2.981 m per unit, giving 11.00 m span
and 8.61 m length against a real 11.0 by 8.28.

The hand-built exterior in `src/c172-exterior.js` remains as the fallback while
the model downloads.

The **A380-800** is a downloaded model too, in `src/a380-glb.js`, and it is a
different kind of problem. It came through Sketchfab's OBJ pipeline, which
merged the geometry by material: each of its 32 meshes is a material group
spanning the whole airframe rather than a part, so the C172's triangle-count
fingerprints have nothing to bite on. The material names did survive, and they
are descriptive, so parts are matched by material and checked against where the
group sits.

The file is titled "full interior hd" and means it: two decks of seats, bins and
linings running the length of the tube, 43k of its 127k triangles, none of which
is ever visible from the flight deck or from outside. Six material groups come
out, each checked against a box drawn inside the fuselage skin first — a group
that reaches outside it is left alone and warned about, so a replacement file
laid out differently cannot quietly take the roof off. `?keepcabin=1` puts the
seats back to check what a material covers before trusting it. What stays is the
flight deck, which is the reason to fly this model: eight display units, the
pedestal, the side sticks, all photographed rather than drawn.

The merge decides what can move. Wing skin, ailerons, flaps and spoilers share
one group, so the control surfaces stay where the file put them. The
undercarriage does come apart, because the legs stand clear of everything around
them: five units — nose, and a wing and a body unit each side — are carved out
by the box each stands in, splitting on triangle centres so nothing tears, and
hung on trunnions taken from the top of each leg. The wing units fold inboard
and the nose and body units fold forward, as the real ones do, and `prepareGear`
now leaves a hinge alone when the model brought its own. The whole airframe is
scaled from its span, giving 79.75 m by 72.4 m against a real 79.75 by 72.7, and
centred on the fuselage rather than the bounding box — the fin would otherwise
put the point it pitches about four metres up in the air.

The flight deck's own floor sits well above the seat pan, so the cockpit eye is
placed against the glazing instead: the windscreen runs a 71 cm band, and an eye
outside it looks at the roof lining or at the glareshield. Half a metre left of
the centreline puts the captain's displays ahead and the pedestal to the right.
`?inspect=a380` walks around this one the way `?inspect=1` walks around the
C172.

Since the parts have no names, finding the next one to fix means pointing at it.
`?inspect=1` parks the aircraft and hands the camera to a model viewer — drag to
orbit, scroll to zoom, hover to highlight, click to hide, shift-click to put
everything back. The panel lists what you have hidden as loader fingerprints,
and the copy button emits a `PRUNE` block ready to paste in. `?keepkit=1` is the
companion, leaving the ground equipment in place so a material can be checked
before it is trusted.

It earned its keep immediately. The strut had first been misidentified as an
open cabin door and swung 90° on a guessed hinge, which threw it out ahead of
the propeller — and, because it was no longer sitting where a strut sits, led to
the confident and wrong conclusion that the model had none, and to a pair of
built replacements. Clicking the offending mesh is what unpicked all of it.

The cockpit view sits 6° below level. Level put the panel off the bottom of the
frame; this is roughly the sight picture over a real glareshield, with the
instruments along the bottom edge and the horizon in the upper third.

The **TBM 930** is a downloaded model as well, in `src/tbm930-glb.js`.

> "Daher TBM 930" ([Sketchfab](https://sketchfab.com/3d-models/daher-tbm-930-ba21567b779040038081f084fc528a44))
> by helijah is licensed under [Creative Commons Attribution](http://creativecommons.org/licenses/by/4.0/).

Sketchfab's GLB for it merges every part that shares a material, which fuses
the flaps, gear legs, wheels and doors into two airframe-sized meshes. The
download also carries the author's original OBJ, which keeps all 155 parts as
named objects, so `scripts/build-tbm-model.mjs` converts that instead: one glTF
node per object, names intact. The names are French — `voletG`/`voletD` are the
left and right flaps, `profondeur` the elevators, `direction` the rudder,
`axe`/`roue`/`porte` the gear legs, wheels and doors — and the loader addresses
parts by name, so there is no fingerprinting.

No surface on this airframe hinges about a model axis: the wing has about 7° of
dihedral and some sweep, and the tailplane and fin more. Each hinge line is
measured from the forward edge of its surface at both ends, and the part hangs
from a frame turned onto that line whose other axes are the sim's, so the sim
drives it with the same `rotation.x` it uses on a hand-built flap.

The undercarriage is driven through `setGearPosition`. The mains fold inboard,
each wheel into the round bay the model has cut into the wing root, with the
fairing door on the leg closing the slot the leg drops through. The wing is only
20 cm deep there and the door stands 20 cm outboard of the leg, so the leg tops
do not work as trunnions — swung about them, either the tyre breaks through the
upper skin or the door stows well below the lower. The trunnion and angle were
found by searching both against the wing's surfaces, sampled from the model:
83°, about an axis just inside the wing. The nose leg folds aft into its bay,
and its two doors close under it in the last quarter of the cycle — and open
first on the way down. The whole airframe is scaled from its 10.74 m length;
the winglets make the span read half a metre wide.

The built TBM in `src/tbm930.js` stays as the fallback while the model
downloads, drawn at its own `builtModelScale`.

The **built A380-800** in `src/a380.js`, which flies until the download lands,
measures 73.3 m by 79.4 m against a real 72.7 by 79.75. What
identifies it is the cross-section rather than the planform, so the fuselage is
lofted from a double-bubble ovoid — the outer envelope of two overlapping deck
circles, the lower one wider and set low, which is what makes the aircraft look
bottom-heavy head on. Both passenger decks carry their own window line, drawn
into the skin texture: its axes run nose-to-tail and around the section, so a
deck's windows are a straight row of marks rather than something that has to be
placed one mesh at a time. Under it are all twenty-two wheels in the right
arrangement — a two-wheel nose unit, a four-wheel bogie under each wing and a
six-wheel bogie under the fuselage each side — plus flap track fairings, wingtip
fences, and four Trent-class nacelles with the inboard pair further forward on
the swept wing. Its flight deck is Airbus: eight display units, side sticks
rather than yokes, and four thrust levers on the centre pedestal.

The **F-35A** is 15.7 m long, 10.7 m span, 34° wing sweep, tails canted 25°. The shapes that make
it recognisable are modelled rather than approximated: the chine from radome to
wing root, the diverterless inlets with their compression bumps in place of
splitter plates, the sawtooth panel edges, and the gold indium-tin-oxide canopy.
Its cockpit has the panoramic display that replaces a conventional instrument
panel, a right-hand side stick, and no head-up display — on this aircraft that
job belongs to the helmet.

Handling limits are per-aircraft rather than hardcoded: load factor, roll
authority, control rate, and a ground pitch limit. That last one is
tail-strike protection. With an eight-metre tail arm, full nose-up authority on
the runway drags the tail before the wing ever flies, and full authority is
earned with airspeed rather than handed over the instant the wheels leave —
commanding thirty degrees at rotation speed is a departure, not a climb. Real
fly-by-wire limits rotation for the same reason.

Measured for the F-35A: rotation around 200 kt, through 20 000 ft inside 80
seconds, 976 kt in level acceleration against a 1 000 kt limit, and a sustained
turn of 16°/s at 300 kt for a 540 m radius. The A380 rests with its flight deck
7.7 m up, rotates around 220 kt and is through 9 600 ft in ninety seconds.

Aircraft are placed on the runway by their wheels rather than at a fixed
clearance, since an A380's undercarriage holds it four times higher off the
tarmac than a light aircraft's.

### Impacts

Arrivals are judged in `src/crash.js` from **closing speed along the surface
normal**, not from rate of descent. A level run into rising ground or into the
side of a terminal is then scored as the impact it actually is, rather than as a
gentle arrival that happens to have no vertical speed. Bank, pitch, gear
position and what is being landed on all feed in, giving four outcomes:

| Outcome | Roughly | Result |
| --- | --- | --- |
| Firm | under 1.8 m/s (350 ft/min) | normal touchdown |
| Hard | 1.8–4.2 m/s | jolt and a callout, flight continues |
| Wrecked | 4.2–9 m/s, or banked past 22°, or gear up | airframe written off, pilot walks away |
| Destroyed | past 9 m/s, wing or nose first, or a structure | breakup and fuel fire |

A wrecked airframe stays in one piece: the gear collapses and it grinds to a
halt on its belly throwing sparks and dirt. A destroyed one comes apart — the
model is split into nose, wings, tail and fuselage sections using
`Object3D.attach`, which preserves world transforms, so the wing that
cartwheels away is the same geometry that was on the aircraft a moment earlier.
Each section is then a rigid body with gravity, drag, tumbling and ground
bounce. Ditching is handled separately: water gives way, so it is survivable a
good deal faster, and throws spray rather than fire.

Contact is tested at the airframe's extremities — wingtips, nose, tail and belly
— not at its centre, so a banked arrival touches down on a wingtip and the fire
starts there. The aircraft is then lifted by however far the lowest part went
under, which is also what lets a raised nose rotate off the runway without the
tail staying pinned to it.

Fire, smoke and embers are GPU-driven instanced particles — the CPU writes a
particle's launch state once and the vertex shader positions it from its age,
one draw call per pool. The pools and their textures are built at start-up and
reused: generating three canvas textures and compiling three shader programs
costs hundreds of milliseconds, and doing that on the impact frame stalls the
renderer exactly when the explosion is meant to appear. Smoke from the initial
fireball is emitted with a short delay so the fire reads before its own smoke
buries it, and the pool fire stays seated at the impact point rather than on
debris still in the air, which would draw a string of separate fires across the
sky.

Airport structures get collision from a height grid rasterised from the same
OpenStreetMap footprints that are drawn, sampled nearest-neighbour so a terminal
has a wall rather than a ramp an aircraft can ride up.

### Ocean

The sea is a single plane with a custom shader rather than a lit material,
because a uniformly lit plane reads as sheet plastic from the air. Three cues do
the work: colour graded from turquoise reef to deep blue by distance to the
nearest land, a sun-glitter path from four rotating swell layers whose
perturbation fades with view distance to avoid moire, and surf breaking along
the shoreline. Each distance-to-land field is a chamfer transform over its
elevation grid and is uploaded once as a single-channel texture; at one sample
per 140 m it sets how narrow the reef and surf bands can usefully be, so the
shader dithers the edge rather than trusting it exactly.

Where the draped photograph meets the rendered sea, the join depends entirely on
how the coast is graded. The elevation model carries no bathymetry — open water
is recorded as exactly zero or a nodata fill — so the sea bed is drawn as a
shallow grade just far enough under the water plane to stay hidden. Dropping it
onto a deep flat skirt instead makes every coastal sample a two-hundred-metre
cliff, and at one sample per 140 m those cliffs are what read as stepped
rectangular walls along a shoreline.

Note that custom shaders in this scene must include Three's `logdepthbuf`
chunks. The renderer uses a logarithmic depth buffer, and a shader that skips
them writes depth on a different scale from everything else, which shows up as
geometry punching through from behind.

### Shoreline

The survey resolves a sample every 140 m and the photograph a pixel every 18 m,
so the two never agree on exactly where the shore is, and every disagreement is
visible: a cell the survey calls land carrying a photograph of open water shows
as a navy patch stranded above the rendered sea, and a cell it calls water
carrying a photograph of beach is sliced off by the water plane. Three things
keep the join clean.

The first is getting the photograph onto the right ground at all. The exports
are requested in EPSG:4326, where a pixel is a fixed number of degrees, so the
requested pixel grid has to match the bounding box's aspect *in degrees*. Sizing
it by the world aspect instead — which carries the cos(latitude) factor that
turns degrees into metres — leaves the two 7% apart, and the service quietly
widens the bounding box about its centre until it fits, without saying so. That
put the Oʻahu mosaic a kilometre and a half north of the terrain along the south
shore, which is where the worst of the dark patches came from. The builder now
sizes each export from the box in degrees and asks for the response metadata
first, so an extent the service has rewritten fails the build instead of
shipping.

The second is deciding per fragment, from the photograph, what is water. Open
sea is the one thing in a NAIP frame that is both dark and strongly blue-led:
water absorbs red first and green second, while foliage in shadow is dark but
green-led and wet sand or cloud shadow is dark but grey. Bright reef turquoise is
deliberately kept — it reads far better than anything the water shader can
invent at that scale. Colour alone is not enough, though: a shaded windward
valley is nearly as dark and nearly as blue as deep water, and a purely
photometric test eats the whole Koʻolau range, so the test only ever fires below
about ten metres of surveyed elevation and fades out entirely by thirty. Because
the terrain samples its own mipmapped photograph, the dissolve softens with view
distance on its own.

The third is making sure the mesh is never the thing that cuts the coast. Sea
bed within two samples of dry land is held at the waterline rather than following
the grade down, so the water plane always intersects the terrain a cell or two
*outside* the photographed shore. The visible waterline is then the photograph's
alpha edge, which is eight times finer than the grid, and the apron itself is
never seen because it only ever carries photographed sea. The same apron is
applied inside the height lookup, so the airfield insets drape onto the surface
that was actually drawn and the aircraft floats at the height it looks like it
should.

### Sky

Trade-wind cumulus are built at runtime, not baked. Each cloud is a set of
lobed clusters of camera-facing billboards drawn from a four-cell puff atlas
generated on a canvas. Puffs overlap heavily so the silhouette merges into one
mass, are lifted by their own half-height near the bottom so the cloud sits on a
flat base, and are tinted per puff by height within the cloud and by how each
faces the sun — which is what separates a cumulus from a cluster of white
spheres. The whole field is one instanced draw call and drifts downwind, wrapping
per cloud rather than per puff.

### Imagery, and why not Google Earth

Google Earth and Google Maps imagery cannot be used here. Their terms permit it
only inside Google's own renderers and APIs, which rules out drawing it onto a
custom Three.js mesh, and it cannot be redistributed in a repository.

USGS NAIP is the better answer for Hawai‘i anyway: it is US federal work in the
public domain, so it can be baked, committed, and shipped freely, and at roughly
two metres per pixel it is sharper over the airfields than any global basemap.
Each island is exported as one mosaic with a high-resolution inset per airfield.
Insets are draped over the same height function as the terrain and faded out over
open water, so the simulated sea shows through instead of the near-black water a
colour-infrared orthophoto records.

Other viable sources, if wider coverage is ever needed: Esri World Imagery and
Bing Maps Aerial (free tiers, attribution required), Mapbox or MapTiler satellite
(API key), and Sentinel-2 (open, but only ten metres per pixel).

## Next steps

Land-cover-driven vegetation, roads and city buildings away from the airfields,
higher-detail streamed terrain tiles, and a ground detail texture blended into
the orthoimagery so surfaces hold up at low level.
