const express = require("express");
const path = require("path");

const { initDb, loadMemory, saveMemory, deleteAllMemories, deleteMemoriesByKeyword, upsertWorkScheduleEntry, getAllWorkSchedule, getCurrentMonthWorkSchedule, getTodayShift, getTomorrowShift, deleteWorkScheduleEntry, getMemoriesPaged, deleteMemoryById, updateMemory, getWorkSchedulePaged } = require("./db");
const { replyText, pushText } = require("./lineApi");
const { createMorningSummary, createArayaResponse } = require("./ai");
const getShiftCategory = require("../shared/shiftCategory");
const Holidays = require("date-holidays");

const hd = new Holidays("TH");
hd.setLanguages(["th", "en"]);

function getThaiHolidayLabel(type) {
  return type === "bank" ? "วันหยุดธนาคาร" : type === "public" ? "วันหยุดนักขัตฤกษ์" : type;
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
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "web", "admin.html"));
});

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

app.get("/api/schedule", async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const schedule = await getCurrentMonthWorkSchedule(year, month);
    const items = schedule.map(item => ({
      date: item.work_date.toISOString().slice(0, 10),
      shift: item.shift,
      category: getShiftCategory(item.shift),
      categoryLabel: getShiftCategory(item.shift) === "morning" ? "เช้า" : getShiftCategory(item.shift) === "afternoon" ? "บ่าย" : getShiftCategory(item.shift) === "evening" ? "เย็น" : getShiftCategory(item.shift) === "night" ? "กลางคืน" : getShiftCategory(item.shift) === "off" ? "พัก/หยุด" : "อื่น ๆ",
      createdAt: new Date(item.created_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })
    }));

    const counts = items.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {
      morning: 0,
      afternoon: 0,
      evening: 0,
      night: 0,
      off: 0,
      other: 0
    });

    const holidays = getThaiHolidays(year, month);

    res.json({ items, counts, holidays });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "ไม่สามารถดึงข้อมูลตารางเวรได้" });
  }
});

app.get("/dashboard", (req, res) => {
  res.redirect("/");
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
    const completion = await createMorningSummary({ shift, tomorrowShift });
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
      const rows = userText.replace("/เวร", "").trim().split("\n").filter(x => x.trim());
      let count = 0;

      for (const row of rows) {
        const parts = row.trim().split(" ");
        if (parts.length < 2) continue;
        const workDate = parts[0];
        const shift = parts.slice(1).join(" ");
        await upsertWorkScheduleEntry(workDate, shift);
        count++;
      }

      await replyText(event.replyToken, `บันทึกตารางเวรเรียบร้อย ${count} รายการค่ะ`);
      continue;
    }

    if (userText === "/ตารางเวร") {
      const result = await getAllWorkSchedule();
      const answer = result.length === 0
        ? "ยังไม่มีตารางเวรค่ะ"
        : result.map(x => `${x.work_date.toISOString().slice(0, 10)} : ${x.shift}`).join("\n");
      await replyText(event.replyToken, answer);
      continue;
    }

    if (userText === "/เช้า") {
      try {
        const shift = await getTodayShift();
        const tomorrowShift = await getTomorrowShift();
        const completion = await createMorningSummary({ shift, tomorrowShift });
        const summary = completion?.choices?.[0]?.message?.content || "ขออภัยค่ะ ยังไม่สามารถสร้างรายงานเช้าได้ในขณะนี้";
        await replyText(event.replyToken, summary);
      } catch (err) {
        console.error(err);
        await replyText(event.replyToken, "ขออภัยค่ะ เกิดข้อผิดพลาดขณะสร้างรายงานเช้า");
      }
      continue;
    }

    if (!userText.startsWith("อารายา") && !userText.startsWith("อารยา")) {
      continue;
    }

    const prompt = userText.replace(/^อารายา\s*/i, "").replace(/^อารยา\s*/i, "").trim();
    if (!prompt) {
      await replyText(event.replyToken, "มีอะไรให้อารายาช่วยไหมคะ 💕");
      continue;
    }

    try {
      const memories = await loadMemory();
      const memoryText = memories.map(x => `- ${x.content}`).join("\n");
      const scheduleResult = await getAllWorkSchedule();
      const scheduleText = scheduleResult.map(x => `${x.work_date.toISOString().slice(0, 10)} : ${x.shift}`).join("\n");
      const completion = await createArayaResponse({ userText: prompt, memoryText, scheduleText });
      const answer = completion?.choices?.[0]?.message?.content?.trim() || "ขออภัยค่ะ อารายายังไม่สามารถตอบได้ในขณะนี้";
      await replyText(event.replyToken, answer);
    } catch (err) {
      console.error(err);
      await replyText(event.replyToken, "ขออภัยค่ะ เกิดข้อผิดพลาดในการตอบกลับ");
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server started on ${PORT}`);
    });
  })
  .catch(err => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
