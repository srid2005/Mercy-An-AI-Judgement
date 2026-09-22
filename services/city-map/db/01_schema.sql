-- city-map -- MERCY's model of the city, as one PostgreSQL database.
-- The city is fictional ("Meridian"), but every geometry is real WGS84
-- latitude/longitude (degrees) stored as JSONB arrays of [lat, lng] pairs,
-- so nothing here needs PostGIS. Elevations are metres above sea level;
-- the plateau the city sits on is at 900 m.

CREATE TABLE app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE districts (
    id          SERIAL PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,                 -- civic | cbd | tech | heritage | industrial | residential | suburb | village
    center_lat  DOUBLE PRECISION NOT NULL,
    center_lng  DOUBLE PRECISION NOT NULL,
    polygon     JSONB NOT NULL                 -- [[lat,lng], ...]
);

CREATE TABLE roads (
    id      SERIAL PRIMARY KEY,
    name    TEXT NOT NULL,
    class   TEXT NOT NULL,                     -- highway | arterial | street | bus_route | footpath
    path    JSONB NOT NULL                     -- [[lat,lng], ...]
);

CREATE TABLE water (
    id      SERIAL PRIMARY KEY,
    name    TEXT NOT NULL,
    kind    TEXT NOT NULL,                     -- lake | pond
    polygon JSONB NOT NULL
);

CREATE TABLE parks (
    id      SERIAL PRIMARY KEY,
    name    TEXT NOT NULL,
    kind    TEXT NOT NULL,                     -- park | forest | plaza | eco
    polygon JSONB NOT NULL
);

-- The mountains ringing the city border. Terrain elevation anywhere on the
-- map is base + sum of Gaussian peaks:  h = 900 + SUM height_m * exp(-(d/radius_m)^2)
CREATE TABLE mountains (
    id          SERIAL PRIMARY KEY,
    range_name  TEXT NOT NULL,
    peak_name   TEXT,
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL,
    height_m    DOUBLE PRECISION NOT NULL,     -- rise above the plateau
    radius_m    DOUBLE PRECISION NOT NULL      -- footprint radius
);

CREATE TABLE landmarks (
    id           SERIAL PRIMARY KEY,
    slug         TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,                -- police | civic | station | bus_stop | cave | hill | lake | park | hospital | office | tech | industrial
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    elevation_m  DOUBLE PRECISION NOT NULL,
    description  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE buildings (
    id           SERIAL PRIMARY KEY,
    district_id  INTEGER REFERENCES districts(id),
    name         TEXT,                         -- only the named ones
    kind         TEXT NOT NULL,                -- police | civic | station | residential | commercial | office | tech | industrial | hospital | utility | school | church | theatre | stadium | temple | university | market | fire_station | library
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    rotation_deg DOUBLE PRECISION NOT NULL DEFAULT 0,
    width_m      DOUBLE PRECISION NOT NULL,
    depth_m      DOUBLE PRECISION NOT NULL,
    height_m     DOUBLE PRECISION NOT NULL,
    floors       INTEGER NOT NULL
);
CREATE INDEX buildings_latlng ON buildings (lat, lng);

-- Infrastructure that is not a building: pylons, masts, water towers,
-- radio relays, substations.
CREATE TABLE towers (
    id          SERIAL PRIMARY KEY,
    kind        TEXT NOT NULL,                 -- pylon | cell | water | radio | substation
    name        TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL,
    height_m    DOUBLE PRECISION NOT NULL
);

-- High-voltage lines strung between pylons, in order.
CREATE TABLE power_lines (
    id      SERIAL PRIMARY KEY,
    name    TEXT NOT NULL,
    path    JSONB NOT NULL                     -- [[lat,lng], ...] -- the pylons it runs through
);

-- The city's CCTV cameras: where they are, which way they look, how far.
CREATE TABLE cctv_cameras (
    id           SERIAL PRIMARY KEY,
    code         TEXT UNIQUE NOT NULL,         -- CCTV-01 ...
    name         TEXT NOT NULL,
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    heading_deg  DOUBLE PRECISION NOT NULL,    -- clockwise from north
    fov_deg      DOUBLE PRECISION NOT NULL,
    range_m      DOUBLE PRECISION NOT NULL,
    status       TEXT NOT NULL DEFAULT 'online'
);


-- Trees: parks, forests, avenue rows, garden scatter. Drawn as wire canopies.
CREATE TABLE trees (
    id        SERIAL PRIMARY KEY,
    kind      TEXT NOT NULL,                   -- broadleaf | conifer | bush
    lat       DOUBLE PRECISION NOT NULL,
    lng       DOUBLE PRECISION NOT NULL,
    height_m  DOUBLE PRECISION NOT NULL
);

-- Street furniture and other small props: lamps, parked cars, boats, cranes,
-- the plaza fountain, bus shelters.
CREATE TABLE props (
    id           SERIAL PRIMARY KEY,
    kind         TEXT NOT NULL,                -- lamp | car | boat | crane | fountain | shelter | turbine | solar | lookout
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    rotation_deg DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- Every drone search the player has launched. The id is evidence identity
-- (mercy-engine files each row as MAP-<id>), so the sequence is never reset.
-- outcome: clear (nothing) | clue (a story spot on the SOS trail) |
--          trace (the cave: jacket + band + recording, nobody there) |
--          found (Meera located -- only ever at app_config.truth_stop)
CREATE TABLE searches (
    id           SERIAL PRIMARY KEY,
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    source       TEXT NOT NULL,                -- coords | building | sos
    building_id  INTEGER REFERENCES buildings(id),
    found        BOOLEAN NOT NULL,
    result       TEXT NOT NULL,
    searched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    outcome      TEXT NOT NULL DEFAULT 'clear' CHECK (outcome IN ('clear', 'clue', 'trace', 'found')),
    spot_slug    TEXT,                         -- story_spots.slug or 'stop-<seq>' when the sweep hit one
    evidence_ids TEXT[] NOT NULL DEFAULT '{}', -- evidence the sweep surfaces (the cave returns SW-06)
    items        JSONB                         -- what the drones picked up, for the card
);

-- The SOS trail: places whose sweep returns a written clue instead of the
-- generic "No trace" text. Matched by priority, first spot whose circle
-- (radius_m around lat/lng) contains the search point. A spot with
-- requires_spots answers with the row named by sealed_slug until every
-- listed spot has a searches row (the cave stays sealed until sos-1..sos-4
-- have been swept). Seeded by 03_story.sql.
CREATE TABLE story_spots (
    slug            TEXT PRIMARY KEY,
    priority        INT NOT NULL,
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    radius_m        INT NOT NULL,
    outcome         TEXT NOT NULL,             -- clear | clue | trace
    result          TEXT NOT NULL,
    items           JSONB,
    evidence_ids    TEXT[] NOT NULL DEFAULT '{}',
    requires_spots  TEXT[] NOT NULL DEFAULT '{}',
    sealed_slug     TEXT
);

-- Vehicles the model can track once tracking is unlocked (a 'trace' row in
-- searches). mode says how the car behaves once it is followed: 'chase' --
-- it drives to its next unsearched stop and waits there until the drones
-- have searched it (Nikhil); 'loop' -- it drives its stops round and round,
-- dwelling at each (everyone else); 'parked' -- it never moves. lat/lng is
-- where the car is first drawn: on the road for a chase, its stop 1 for a
-- loop, its bay for a parked car.
CREATE TABLE vehicles (
    slug    TEXT PRIMARY KEY,
    owner   TEXT,
    plate   TEXT,
    model   TEXT,
    note    TEXT,
    mode    TEXT NOT NULL DEFAULT 'loop',
    lat     DOUBLE PRECISION,
    lng     DOUBLE PRECISION
);

-- The stops a tracked vehicle drives to, in seq order. Every stop is a named
-- building. result_clear / result_found are the sweep texts for a search at
-- the stop; which stop is the true one lives ONLY in app_config.truth_stop
-- (drawn at seed time by 03_story.sql) -- there is no is_truth column, and
-- the server never sends result_* to the browser. A search at a stop is
-- logged with spot_slug 'stop-<seq>' (Nikhil) or 'stop-<vehicle>-<seq>'
-- (anyone else), which is how GET /api/vehicles/:slug knows what has been
-- searched -- and, for a chase, which stop the car goes to next.
CREATE TABLE vehicle_stops (
    id            SERIAL PRIMARY KEY,
    vehicle       TEXT REFERENCES vehicles(slug),
    seq           INT,
    name          TEXT,
    note          TEXT,
    lat           DOUBLE PRECISION,
    lng           DOUBLE PRECISION,
    building_id   INT REFERENCES buildings(id),
    dwell_s       INT DEFAULT 40,
    logged_label  TEXT,                        -- ANPR read time shown on the card
    cctv_code     TEXT,                        -- the camera that read the plate
    result_clear  TEXT,
    result_found  TEXT,
    UNIQUE (vehicle, seq)
);
