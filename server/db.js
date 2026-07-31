const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW(),
      content TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_schedule (
      id SERIAL PRIMARY KEY,
      work_date DATE NOT NULL,
      shift TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function loadMemory(limit = 100) {
  const result = await pool.query(`
    SELECT *
    FROM memories
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

async function saveMemory(text) {
  await pool.query(
    `
    INSERT INTO memories(content)
    VALUES($1)
    `,
    [text]
  );
}

async function deleteAllMemories() {
  await pool.query("DELETE FROM memories");
}

async function deleteMemoriesByKeyword(keyword) {
  await pool.query(
    `
    DELETE FROM memories
    WHERE content ILIKE $1
    `,
    [`%${keyword}%`]
  );
}

async function upsertWorkScheduleEntry(workDate, shift) {
  const existing = await pool.query(
    `
      SELECT id
      FROM work_schedule
      WHERE work_date = $1
    `,
    [workDate]
  );

  if (existing.rows.length > 0) {
    await pool.query(
      `
        UPDATE work_schedule
        SET shift = $2
        WHERE work_date = $1
      `,
      [workDate, shift]
    );
  } else {
    await pool.query(
      `
        INSERT INTO work_schedule (work_date, shift)
        VALUES ($1, $2)
      `,
      [workDate, shift]
    );
  }
}

async function getAllWorkSchedule(limit = 70) {
  const result = await pool.query(
    `
      SELECT *
      FROM work_schedule
      ORDER BY work_date
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function getTodayShift() {
  const result = await pool.query(
    `
      SELECT shift
      FROM work_schedule
      WHERE work_date = CURRENT_DATE
    `
  );

  return result.rows.length > 0 ? result.rows[0].shift : null;
}

async function getTomorrowShift() {
  const result = await pool.query(
    `
      SELECT shift
      FROM work_schedule
      WHERE work_date = CURRENT_DATE + INTERVAL '1 day'
    `
  );

  return result.rows.length > 0 ? result.rows[0].shift : null;
}

async function getCurrentMonthWorkSchedule(year, month) {
  if (typeof year !== 'number' || typeof month !== 'number' || month < 1 || month > 12) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const result = await pool.query(
    `
      SELECT *
      FROM work_schedule
      WHERE work_date >= $1
        AND work_date < ($1::date + INTERVAL '1 month')
      ORDER BY work_date
    `,
    [startDate]
  );

  return result.rows;
}

module.exports = {
  initDb,
  loadMemory,
  saveMemory,
  deleteAllMemories,
  deleteMemoriesByKeyword,
  upsertWorkScheduleEntry,
  getAllWorkSchedule,
  getCurrentMonthWorkSchedule,
  getTodayShift,
  getTomorrowShift
};
