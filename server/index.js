const express = require("express");
const path = require("path");

const { initDb, loadMemory, saveMemory, deleteAllMemories, deleteMemoriesByKeyword, upsertWorkScheduleEntry, getAllWorkSchedule, getCurrentMonthWorkSchedule, getTodayShift, getTomorrowShift, deleteWorkScheduleEntry, upsertCaregiverHoliday, deleteCaregiverHolidayByDate, getCaregiverHolidaysPaged, getCaregiverHolidaysByMonth, getMemoriesPaged, deleteMemoryById, updateMemory, getWorkSchedulePaged, saveChatMessage, getChatHistory, clearChatHistory, deleteOldChatMessages } = require("./db");
const { replyText, pushText } = require("./lineApi");
const { createMorningSummary, createArayaResponse, createDailyRoutineGuide } = require("./ai");
const getShiftCategory = require("../shared/shiftCategory");
const getShiftCategoryLabel = getShiftCategory.getShiftCategoryLabel || ((c) => ({
  shift_8_16: "8:00-16:00",
  shift_8_20: "8:00-20:00",
  shift_6_14: "6:00-14:00",
  shift_8_22: "8:00-22:00",
  night: "กลางคืน",
  off: "หยุด",
  other: "อื่นๆ",
}[c] || "อื่นๆ"));
const Holidays = require("date-holidays");

const hd = new Holidays("TH");
hd.setLanguages(["th", "en"]);

// Simple admin auth (Basic). Default password is '111111' but can be overridden by ADMIN_PASS env var.
const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS;
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Basic') {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Invalid authentication');
  }
  const creds = Buffer.from(parts[1], 'base64').toString('utf8');
  const [user, pass] = creds.split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="Admin"');
  return res.status(401).send('Unauthorized');
}

// แปลงค่า DATE จากฐานข้อมูลเป็น "YYYY-MM-DD"
// ห้ามใช้ toISOString() เพราะจะเลื่อนวันได้ 1 วันเมื่อเซิร์ฟเวอร์ไม่ได้อยู่เขตเวลา UTC
function toDateKey(value) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function getThaiHolidayLabel(type) {
  return type === "bank" ? "วันหยุดธนาคาร" : type === "public" ? "วันหยุดนักขัตฤกษ์" : type;
}

// วันที่ปัจจุบันตามเวลาไทย — ส่งให้ AI ทุกครั้ง เพราะโมเดลไม่มีนาฬิกาเอง
// ถ้าไม่ส่ง โมเดลจะเดาวันที่เองแล้วตอบ "วันนี้/พรุ่งนี้" ผิดไป 1 วัน
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Bangkok";
function getThaiDateContext(now = new Date()) {
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = todayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + 1);
  const tomorrowKey = utc.toISOString().slice(0, 10);
  const todayLabel = new Intl.DateTimeFormat("th-TH", {
    timeZone: APP_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const tomorrowLabel = new Intl.DateTimeFormat("th-TH", {
    timeZone: APP_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${tomorrowKey}T12:00:00+07:00`));
  return { todayKey, tomorrowKey, todayLabel, tomorrowLabel };
}

// ---------- /เวร แบบพิมพ์ง่าย ----------
function toAsciiDigits(s) {
  return String(s || "").replace(/[๐-๙]/g, (ch) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(ch)));
}
function pad2(n) { return String(n).padStart(2, "0"); }
function toKey(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
function isValidKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
function addDaysKey(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// รหัสเวร: D9=8:00-16:00, D9A12=8:00-20:00, M1=6:00-14:00,
// D9A30=8:00-22:00, X=หยุด, กลางคืน, อื่นๆ
function parseShiftEasy(raw) {
  const t = toAsciiDigits(raw).trim();
  if (!t) return null;
  const v = t.toLowerCase().replace(/[\s\u00a0]+/g, "");
  const code = v.replace(/[^a-z0-9]/g, "");
  if (code === "d9") return "8:00-16:00";
  if (code === "d9a12" || code === "a12") return "8:00-20:00";
  if (code === "m1") return "6:00-14:00";
  if (code === "d9a30" || code === "a30") return "8:00-22:00";
  if (code === "x") return "หยุด";
  if (v.includes("หยุด") || v.includes("พัก") || v === "ห" || v === "off") return "หยุด";
  if (v.includes("กลางคืน") || v.includes("ดึก") || v === "ด" || v.includes("night")) return "กลางคืน";
  if (v.includes("อื่น")) return "อื่นๆ";
  const range = v.match(/(\d{1,2})(?::?\d{2})?\D+(\d{1,2})(?::?\d{2})?/);
  if (range) {
    const s = Number(range[1]), e = Number(range[2]);
    if (s === 8 && e === 16) return "8:00-16:00";
    if (s === 8 && e === 20) return "8:00-20:00";
    if (s === 6 && e === 14) return "6:00-14:00";
    if (s === 8 && e === 22) return "8:00-22:00";
  }
  if (v.includes("เช้า") || v.includes("morning")) return "6:00-14:00";
  if (v.includes("บ่าย") || v.includes("สี่โมง") || v.includes("4โมง") || v.includes("afternoon")) return "8:00-16:00";
  if (v.includes("เย็น") || v.includes("สองทุ่ม") || v.includes("evening")) return "8:00-22:00";
  return t;
}

// รับ "2026-09-30", "30/9/68", "30/9", "30", "วันนี้", "พรุ่งนี้", "มะรืน", "เมื่อวาน"
function parseSingleDateEasy(token, baseKey) {
  const t = toAsciiDigits(token).trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  const [by, bm] = baseKey.split("-").map(Number);
  if (t === "วันนี้" || t === "today") return baseKey;
  if (t === "พรุ่งนี้" || t === "พรุ่ง" || t === "tomorrow") return addDaysKey(baseKey, 1);
  if (t.startsWith("มะรืน")) return addDaysKey(baseKey, 2);
  if (t === "เมื่อวาน" || t === "yesterday") return addDaysKey(baseKey, -1);
  let m;
  if ((m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(t))) {
    const key = toKey(Number(m[1]), Number(m[2]), Number(m[3]));
    return isValidKey(key) ? key : null;
  }
  if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(t))) {
    let d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (y > 2400) y -= 543; // พ.ศ. → ค.ศ.
    else if (y < 100) {
      const be = 2500 + y, ce = be - 543;
      y = ce < 2000 ? 2000 + y : ce;
    }
    const key = toKey(y, mo, d);
    return isValidKey(key) ? key : null;
  }
  if ((m = /^(\d{1,2})[\/\-.](\d{1,2})$/.exec(t))) {
    const key = toKey(by, Number(m[2]), Number(m[1]));
    return isValidKey(key) ? key : null;
  }
  if ((m = /^(\d{1,2})$/.exec(t))) {
    const key = toKey(by, bm, Number(m[1]));
    return isValidKey(key) ? key : null;
  }
  return null;
}

// รับ "30", "30/9", "30,31", "30/9-2/10" → รายชื่อ YYYY-MM-DD
function expandDateExpr(expr, baseKey) {
  const clean = toAsciiDigits(expr).trim().replace(/[、，]/g, ",").replace(/～|~|—|–|ถึง/g, "-");
  if (!clean) return null;
  const items = clean.split(",").map((s) => s.trim()).filter(Boolean);
  if (!items.length) return null;
  const out = [];
  for (const item of items) {
    const single = parseSingleDateEasy(item.replace(/\s+/g, ""), baseKey);
    if (single) { out.push(single); continue; }
    const noSpace = item.replace(/\s+/g, "");
    const segs = noSpace.split("-").filter((s) => s !== "");
    if (segs.length === 2) {
      const a = parseSingleDateEasy(segs[0], baseKey);
      if (!a) return null;
      let b = parseSingleDateEasy(segs[1], a);
      if (!b) return null;
      if (b <= a) {
        if (/^\d{1,2}$/.test(segs[1])) {
          let [y, mo] = a.split("-").map(Number);
          mo += 1; if (mo > 12) { mo = 1; y += 1; }
          b = toKey(y, mo, Number(segs[1]));
          if (!isValidKey(b) || b <= a) return null;
        } else if (/^\d{1,2}[\/\-.]\d{1,2}$/.test(segs[1])) {
          const [d, mo] = segs[1].split(/[\/\-.]/).map(Number);
          b = toKey(Number(a.slice(0, 4)) + 1, mo, d);
          if (!isValidKey(b) || b <= a) return null;
        } else return null;
      }
      let cur = a, guard = 0;
      while (cur <= b && guard < 62) { out.push(cur); cur = addDaysKey(cur, 1); guard++; }
      continue;
    }
    return null;
  }
  return out.length ? out : null;
}

function getThaiHolidays(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const holidays = hd.getHolidays(year) || [];
  return holidays
    .filter(h => {
      const date = h.date.slice(0, 10);
      const [y, m] = date.split('-').map(Number);
      return y === year && m === month && (h.type === 'public' || h.type === 'bank');
    })
    .map(h => ({
      date: h.date.slice(0, 10),
      name: h.name,
      type: h.type,
      typeLabel: getThaiHolidayLabel(h.type),
      note: h.note || '',
      substitute: Boolean(h.substitute)
    }));
}

const app = express();

const LINE_GROUP_ID = process.env.LINE_GROUP_ID;
if (!LINE_GROUP_ID) {
  console.warn("Warning: LINE_GROUP_ID is not set. /morning-report will fail without it.");
}

app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "web")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "web", "dashboard.html"));
});

// Admin UI
app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "web", "admin.html"));
});

// Protect admin APIs
app.use('/api/admin', requireAdmin);

// Admin APIs for memories
app.get('/api/admin/memories', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(req.query.pageSize) || 20));
    const result = await getMemoriesPaged(page, pageSize);
    res.json({ rows: result.rows, total: result.total, page, pageSize });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load memories' });
  }
});

app.post('/api/admin/memories', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    await saveMemory(content);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save memory' });
  }
});
app.put('/api/admin/memories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { content } = req.body;
    if (!id || !content) return res.status(400).json({ error: 'id and content are required' });
    await updateMemory(id, content);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

app.delete('/api/admin/memories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'id is required' });
    await deleteMemoryById(id);
    res.json({ deleted: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

app.delete('/api/admin/memories', async (req, res) => {
  try {
    const keyword = req.query.keyword;
    if (keyword) {
      await deleteMemoriesByKeyword(keyword);
      return res.json({ deletedByKeyword: keyword });
    }
    await deleteAllMemories();
    res.json({ deletedAll: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete memories' });
  }
});

// Admin APIs for work_schedule
app.get('/api/admin/schedule', async (req, res) => {
  try {
    const { year, month, page, pageSize, limit } = req.query;
    if (year && month) {
      const rows = await getCurrentMonthWorkSchedule(Number(year), Number(month));
      return res.json({ rows, total: rows.length, page: 1, pageSize: rows.length });
    }
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.max(1, Math.min(500, Number(pageSize) || 20));
    const result = await getWorkSchedulePaged(p, ps);
    res.json({ rows: result.rows, total: result.total, page: p, pageSize: ps });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

app.post('/api/admin/schedule', async (req, res) => {
  try {
    const { work_date, shift } = req.body;
    if (!work_date || !shift) return res.status(400).json({ error: 'work_date and shift are required' });
    await upsertWorkScheduleEntry(work_date, shift);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upsert schedule' });
  }
});

app.delete('/api/admin/schedule', async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: 'date query param is required' });
    await deleteWorkScheduleEntry(date);
    res.json({ deleted: date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete schedule entry' });
  }
});

// Admin APIs for caregiver holidays
app.get('/api/admin/caregiver-holidays', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(req.query.pageSize) || 20));
    const result = await getCaregiverHolidaysPaged(page, pageSize);
    res.json({ rows: result.rows, total: result.total, page, pageSize });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load caregiver holidays' });
  }
});

app.post('/api/admin/caregiver-holidays', async (req, res) => {
  try {
    const { holiday_date, description } = req.body;
    if (!holiday_date || !description) return res.status(400).json({ error: 'holiday_date and description are required' });
    await upsertCaregiverHoliday(holiday_date, description);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upsert caregiver holiday' });
  }
});

app.delete('/api/admin/caregiver-holidays', async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: 'date query param is required' });
    await deleteCaregiverHolidayByDate(date);
    res.json({ deleted: date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete caregiver holiday' });
  }
});

app.get("/api/schedule", async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const schedule = await getCurrentMonthWorkSchedule(year, month);
    const items = schedule.map(item => ({
      date: toDateKey(item.work_date),
      shift: item.shift,
      category: getShiftCategory(item.shift),
      categoryLabel: getShiftCategoryLabel(getShiftCategory(item.shift)),
      createdAt: new Date(item.created_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })
    }));

    const counts = items.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {
      shift_8_16: 0,
      shift_8_20: 0,
      shift_6_14: 0,
      shift_8_22: 0,
      night: 0,
      off: 0,
      other: 0
    });

    const holidays = getThaiHolidays(year, month);
    const caregiverHolidays = await getCaregiverHolidaysByMonth(year, month);
    const caregiverHolidayItems = caregiverHolidays.map(h => ({
      date: toDateKey(h.holiday_date),
      description: h.description,
      type: 'caregiver',
      typeLabel: 'วันหยุดพี่เลี้ยง'
    }));

    res.json({ items, counts, holidays, caregiverHolidays: caregiverHolidayItems });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ไม่สามารถดึงข้อมูลตารางเวรได้" });
  }
});

function getChatSessionId(value, fallback) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().substring(0, 64);
  }
  return fallback;
}

app.get('/api/chat', async (req, res) => {
  try {
    const sessionId = getChatSessionId(req.query.sessionId, 'dashboard');
    const messages = await getChatHistory(sessionId, 50);
    res.json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load chat history' });
  }
});

app.delete('/api/chat', async (req, res) => {
  try {
    const sessionId = getChatSessionId(req.query.sessionId, 'dashboard');
    await clearChatHistory(sessionId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const sessionId = getChatSessionId(req.body.sessionId, 'dashboard');
    const memories = await loadMemory();
    const memoryText = memories.map(x => `- ${x.content}`).join("\n");
    const scheduleResult = await getAllWorkSchedule();
    const scheduleText = scheduleResult.map(x => `${toDateKey(x.work_date)} : ${x.shift}`).join("\n");
    const history = await getChatHistory(sessionId, 20);
    const { todayKey, tomorrowKey, todayLabel } = getThaiDateContext();
    const completion = await createArayaResponse({ userText: message, memoryText, scheduleText, history, todayKey, tomorrowKey, todayLabel });
    const answer = completion?.choices?.[0]?.message?.content?.trim() || "ขออภัยค่ะ อารายายังไม่สามารถตอบได้ในขณะนี้";

    await saveChatMessage(sessionId, 'user', message);
    await saveChatMessage(sessionId, 'assistant', answer);

    res.json({ reply: answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate AI response' });
  }
});

app.get("/dashboard", (req, res) => {
  res.redirect("/");
});

// วันเกิดริริญ (12 มี.ค. 2026) — ใช้เวลาไทยในการคำนวณอายุ
const RIRIN_BIRTH_ISO = "2026-03-12";
let routineGuideCache = { ageInMonths: -1, text: null, createdAt: 0 };

app.get("/api/routine-guide", async (req, res) => {
  try {
    // คำนวณอายุเป็นเดือนตามเวลาไทย (เอาเวลาไทยมาลบวันเกิดแล้วหารประมาณเป็นเดือน)
    const nowTh = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
    const birth = new Date(`${RIRIN_BIRTH_ISO}T00:00:00`);

    let ageInMonths = (nowTh.getFullYear() - birth.getFullYear()) * 12 + (nowTh.getMonth() - birth.getMonth());
    if (nowTh.getDate() < birth.getDate()) ageInMonths -= 1;
    if (ageInMonths < 0) ageInMonths = 0;

    // cache ตามอายุ (เดือน) ไม่เกิน 12 ชม. — ไม่ต้องเสีย quota AI ทุกครั้งที่เปิดหน้า
    // (?refresh=1 = บังคับสร้างใหม่จากปุ่ม "สร้างใหม่")
    const forceRefresh = req.query.refresh === "1";
    const cacheValid =
      !forceRefresh &&
      routineGuideCache.text &&
      routineGuideCache.ageInMonths === ageInMonths &&
      Date.now() - routineGuideCache.createdAt < 12 * 60 * 60 * 1000;

    if (cacheValid) {
      return res.json({ ageInMonths, guide: routineGuideCache.text, cached: true });
    }

    const completion = await createDailyRoutineGuide({ ageInMonths });
    const guide = completion?.choices?.[0]?.message?.content?.trim() || "";

    if (guide) {
      routineGuideCache = { ageInMonths, text: guide, createdAt: Date.now() };
    }

    res.json({ ageInMonths, guide, cached: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate routine guide" });
  }
});

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

app.get("/morning-report", async (req, res) => {
  if (!LINE_GROUP_ID) {
    return res.status(500).send("LINE_GROUP_ID environment variable is required");
  }

  try {
    const shift = await getTodayShift();
    const tomorrowShift = await getTomorrowShift();
    const { todayKey, tomorrowKey, todayLabel, tomorrowLabel } = getThaiDateContext();
    const completion = await createMorningSummary({ shift, tomorrowShift, todayKey, tomorrowKey, todayLabel, tomorrowLabel });
    const summary = completion?.choices?.[0]?.message?.content || "ไม่สามารถสร้างรายงานเช้าได้ขณะนี้";

    await pushText(LINE_GROUP_ID, summary);
    res.send("Morning report sent");
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.post("/webhook", async (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== "message") continue;
    if (event.message.type !== "text") continue;

    const userText = event.message.text.trim();

    if (userText.startsWith("/จำ ")) {
      const memoryText = userText.replace("/จำ ", "").trim();
      await saveMemory(memoryText);
      await replyText(event.replyToken, "บันทึกข้อมูลเรียบร้อยค่ะ 💕");
      continue;
    }

    if (userText === "/ข้อมูล") {
      const memories = await loadMemory();
      const answer = memories.length === 0 ? "ยังไม่มีข้อมูลที่บันทึกไว้ค่ะ" : memories.map(x => `• ${x.content}`).join("\n");
      await replyText(event.replyToken, answer.substring(0, 4000));
      continue;
    }

    if (userText === "/ล้างข้อมูล") {
      await deleteAllMemories();
      await replyText(event.replyToken, "ล้างข้อมูลที่บันทึกไว้ทั้งหมดเรียบร้อยแล้วค่ะ 🗑️");
      continue;
    }

    if (userText.startsWith("/ลืม ")) {
      const keyword = userText.replace("/ลืม ", "").trim();
      await deleteMemoriesByKeyword(keyword);
      await replyText(event.replyToken, `ลบข้อมูลที่เกี่ยวข้องกับ "${keyword}" เรียบร้อยแล้วค่ะ`);
      continue;
    }

    if (userText.startsWith("/เวร")) {
      const body = userText.replace(/^\/เวร/, "").trim();
      if (!body) {
        await replyText(event.replyToken, "พิมพ์แบบง่ายได้ค่ะ เช่น\n/เวร\n2026-10-1 D9\n30/9-2/10 X\nพรุ่งนี้ D9A12\n\nรหัสเวร: D9=8:00-16:00, D9A12=8:00-20:00, M1=6:00-14:00, D9A30=8:00-22:00, X=หยุด, กลางคืน, อื่นๆ (พิมพ์ A12/A30 สั้นๆ แทน D9A12/D9A30 ก็ได้)");
        continue;
      }
      const { todayKey } = getThaiDateContext();
      const rows = body.split("\n").map((x) => x.trim()).filter((x) => x);
      const saved = [];
      const failed = [];

      for (const row of rows) {
        const tokens = row.split(/\s+/);
        let dates = null;
        let shiftRaw = null;
        for (let k = tokens.length - 1; k >= 1; k--) {
          const cand = expandDateExpr(tokens.slice(0, k).join(" "), todayKey);
          if (cand && cand.length > 0 && cand.length <= 62) {
            dates = cand;
            shiftRaw = tokens.slice(k).join(" ");
            break;
          }
        }
        if (!dates) { failed.push(row); continue; }
        const shift = parseShiftEasy(shiftRaw || "");
        if (!shift) { failed.push(row); continue; }
        for (const d of dates) {
          await upsertWorkScheduleEntry(d, shift);
          saved.push(`${d} : ${shift}`);
        }
      }

      let msg = saved.length
        ? `บันทึกเวรเรียบร้อย ${saved.length} วันค่ะ\n${saved.slice(0, 30).join("\n")}`
        : "ยังไม่ได้บันทึกค่ะ รูปแบบไม่ถูก";
      if (saved.length > 30) msg += `\n…และอีก ${saved.length - 30} วัน`;
      if (failed.length) {
        msg += `\n\nข้าม ${failed.length} บรรทัด:\n${failed.slice(0, 10).join("\n")}\n\nตัวอย่าง:\n2026-10-1 D9\n30/9-2/10 X\nพรุ่งนี้ 8-16`;
      }
      await replyText(event.replyToken, msg.substring(0, 4000));
      continue;
    }

    if (userText.startsWith("/วันหยุด")) {
      const rows = userText.replace("/วันหยุด", "").trim().split("\n").filter(x => x.trim());
      let count = 0;

      for (const row of rows) {
        const parts = row.trim().split(" ");
        if (parts.length < 2) continue;
        const holidayDate = parts[0];
        const description = parts.slice(1).join(" ");
        await upsertCaregiverHoliday(holidayDate, description);
        count++;
      }

      if (count === 0) {
        await replyText(event.replyToken, "รูปแบบคำสั่งไม่ถูกต้อง กรุณาใช้ /วันหยุด YYYY-MM-DD คำอธิบาย");
      } else {
        await replyText(event.replyToken, `บันทึกวันหยุดพี่เลี้ยงเรียบร้อย ${count} รายการค่ะ`);
      }
      continue;
    }

    if (userText.startsWith("/ลบวันหยุด")) {
      const holidayDate = userText.replace("/ลบวันหยุด", "").trim();
      if (!holidayDate) {
        await replyText(event.replyToken, "กรุณาระบุวันที่ที่ต้องการลบ เช่น /ลบวันหยุด 2026-08-01");
        continue;
      }

      await deleteCaregiverHolidayByDate(holidayDate);
      await replyText(event.replyToken, `ลบวันหยุดพี่เลี้ยงวันที่ ${holidayDate} เรียบร้อยแล้วค่ะ`);
      continue;
    }

    if (userText === "/ตารางเวร") {
      const result = await getAllWorkSchedule();
      const answer = result.length === 0
        ? "ยังไม่มีตารางเวรค่ะ"
        : result.map(x => `${toDateKey(x.work_date)} : ${x.shift}`).join("\n");
      await replyText(event.replyToken, answer);
      continue;
    }

    if (userText === "/เช้า") {
      try {
        const shift = await getTodayShift();
        const tomorrowShift = await getTomorrowShift();
        const { todayKey, tomorrowKey, todayLabel, tomorrowLabel } = getThaiDateContext();
        const completion = await createMorningSummary({ shift, tomorrowShift, todayKey, tomorrowKey, todayLabel, tomorrowLabel });
        const summary = completion?.choices?.[0]?.message?.content || "ขออภัยค่ะ ยังไม่สามารถสร้างรายงานเช้าได้ในขณะนี้";
        await replyText(event.replyToken, summary);
      } catch (err) {
        console.error(err);
        await replyText(event.replyToken, "ขออภัยค่ะ เกิดข้อผิดพลาดขณะสร้างรายงานเช้า");
      }
      continue;
    }

    // รองรับการเรียกบอทด้วย @ เช่น "@อารายา สวัสดี" หรือพิมพ์ชื่อตรง ๆ เช่น "อารายา สวัสดี"
    const mentionMatch = userText.match(/^@?(อารายา|อารยา)\s*/i);
    if (!mentionMatch) {
      continue;
    }

    const prompt = userText.slice(mentionMatch[0].length).trim();
    if (!prompt) {
      await replyText(event.replyToken, "มีอะไรให้อารายาช่วยไหมคะ 💕");
      continue;
    }

    try {
      // จำบทสนทนาแยกตามกลุ่ม/ผู้ใช้ใน LINE
      const lineSessionId = (event.source && (event.source.groupId || event.source.userId)) || 'line';
      const memories = await loadMemory();
      const memoryText = memories.map(x => `- ${x.content}`).join("\n");
      const scheduleResult = await getAllWorkSchedule();
      const scheduleText = scheduleResult.map(x => `${toDateKey(x.work_date)} : ${x.shift}`).join("\n");
      const history = await getChatHistory(lineSessionId, 20);
      const { todayKey, tomorrowKey, todayLabel } = getThaiDateContext();
      const completion = await createArayaResponse({ userText: prompt, memoryText, scheduleText, history, todayKey, tomorrowKey, todayLabel });
      const answer = completion?.choices?.[0]?.message?.content?.trim() || "ขออภัยค่ะ อารายายังไม่สามารถตอบได้ในขณะนี้";

      await saveChatMessage(lineSessionId, 'user', prompt);
      await saveChatMessage(lineSessionId, 'assistant', answer);

      await replyText(event.replyToken, answer);
    } catch (err) {
      console.error(err);
      await replyText(event.replyToken, "ขออภัยค่ะ เกิดข้อผิดพลาดในการตอบกลับ");
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

// Start HTTP server ทันที เพื่อไม่ให้ /ping คืน 503 ขณะ DB ยังไม่พร้อม
// (เดิม: ถ้า initDb ล้มเหลว process จะ exit ทันที ทำให้ Render ตอบ 503 ทั้ง service)
let dbReady = false;

app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`);
});

// init ฐานข้อมูลแบบ retry ไม่จำกัดจำนวนครั้ง เผื่อ DB ยังไม่พร้อมตอน boot
let chatCleanupTimer = null;

(async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      await initDb();
      dbReady = true;
      console.log("Database initialized successfully");
      break;
    } catch (err) {
      console.error(`Database init failed (attempt ${attempt}):`, err.message);
      // รอเพิ่มขึ้นเรื่อยๆ แต่ไม่เกิน 30 วินาที แล้วลองใหม่
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, 5000 * attempt)));
    }
  }

  // ล้างประวัติแชทเก่ากว่า 30 วัน วันละครั้ง (เริ่มรอบแรกหลัง initDb สำเร็จ)
  const CHAT_RETENTION_DAYS = 30;
  const runChatCleanup = async () => {
    try {
      const deleted = await deleteOldChatMessages(CHAT_RETENTION_DAYS);
      if (deleted > 0) console.log(`Chat cleanup: deleted ${deleted} old messages (> ${CHAT_RETENTION_DAYS} days)`);
    } catch (err) {
      console.error("Chat cleanup failed:", err.message);
    }
  };

  await runChatCleanup();
  chatCleanupTimer = setInterval(runChatCleanup, 24 * 60 * 60 * 1000);
  chatCleanupTimer.unref?.(); // ไม่ให้ timer ขวางการ shutdown ของ process
})();

// Endpoint ไว้เช็คสถานะ DB (นอกเหนือจาก /ping ที่ตอบ 200 เสมอ)
app.get("/health", (req, res) => {
  res.json({ ok: true, db: dbReady ? "connected" : "not_ready" });
});
