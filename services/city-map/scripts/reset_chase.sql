-- city-map: start the vehicle chase over on a running game. Forgets every
-- drone search at a car's stop (Nikhil's and anyone else's), so the car is
-- picked up on Harrow Road again and waits at each stop for the drones, and
-- redraws which of his six stops Meera is at. The cave trace, the SOS sweeps
-- and the rest of the search log are kept, so tracking stays unlocked.
--   docker compose exec -T city-map-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < services/city-map/scripts/reset_chase.sql
-- (MERCY's own memory of MAP-FOUND lives in mercy-engine; a whole new game is
-- `docker compose down -v` then `docker compose up --build -d`.)
BEGIN;
DELETE FROM searches WHERE spot_slug LIKE 'stop-%';
DELETE FROM app_config WHERE key = 'truth_stop';
INSERT INTO app_config (key, value)
SELECT 'truth_stop', id::text FROM vehicle_stops WHERE vehicle = 'nikhil' ORDER BY random() LIMIT 1;
COMMIT;
