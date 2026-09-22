const { Pool } = require('pg');

// The lobby's own database is small and shared by the whole event -- one
// row per participant, one per admin action -- so, unlike every stateful
// game service, it is NOT split into a schema per participant: the raw pool
// is used as-is.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
// an idle client dropped by a database restart must not take the lobby down with it
pool.on('error', (err) => console.error('[mercy-lobby] idle client error:', err.message));

module.exports = { pool };
