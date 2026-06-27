require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max:                     15,
    idleTimeoutMillis:       30000,
    connectionTimeoutMillis: 4000,
});

module.exports = pool;