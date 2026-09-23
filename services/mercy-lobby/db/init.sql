-- mercy-lobby -- the event's register, as one small PostgreSQL database.
-- One row per participant (the Zinnia ID is the ticket; there is no
-- password) and one row per thing the admin did or the engine reported.
-- Unlike the game services this database is NOT split into a schema per
-- participant: the whole event shares it. Everything is IF NOT EXISTS so
-- server.js can replay this file at boot against a volume that predates it.

CREATE TABLE IF NOT EXISTS players (
    zinnia_id        TEXT PRIMARY KEY,            -- ZIN26-0158, upper-case
    name             TEXT NOT NULL,               -- shown on the leaderboard; public at the event
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    provisioned_at   TIMESTAMPTZ,                 -- first login: their schema exists in every service
    started_at       TIMESTAMPTZ,                 -- "Accept & continue": the engine started the clock
    deadline         TIMESTAMPTZ,                 -- started_at + GAME_MINUTES, as the engine set it
    ended_at         TIMESTAMPTZ,                 -- when the outcome came in
    outcome          TEXT,                        -- solved | timeout | left; NULL while the file is open
    final_guilt      NUMERIC(4,1),                -- the standing at the end, 0.0 .. 100.0
    checkpoints_hit  INT,
    elapsed_s        INT,                         -- start to outcome, as the engine measured it
    points           INT NOT NULL DEFAULT 100,    -- the hint budget the engine used to report; nothing reads or
                                                  -- writes it since hint_cost, and it is never dropped
    hint_cost        INT NOT NULL DEFAULT 0,      -- what their hints cost, as the engine reported it at the end;
                                                  -- 0 until it does, and the board's key under 'solved', lowest first
    restarts         INT NOT NULL DEFAULT 0,      -- how often the admin rebuilt their game
    notes            TEXT
);

CREATE TABLE IF NOT EXISTS admin_events (
    id      SERIAL PRIMARY KEY,
    at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind    TEXT NOT NULL,                        -- login | start | outcome | players_added | restart | delete | prepare | reset_event | restart_services | ...
    detail  TEXT
);
