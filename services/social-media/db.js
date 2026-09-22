const { Pool } = require('pg');
const tenant = require('./tenant');

// One raw pool; two ways to use it. server.js takes `pool`, the tenant proxy,
// so every query runs on the participant's schema (then `template`) without
// naming it. `rawPool` is for tenant.mount alone: provisioning creates the
// schemas and must not be steered onto one of them.
const rawPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = { pool: tenant.wrap(rawPool), rawPool };
