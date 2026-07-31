const express = require("express");

const { initDb, loadMemory, saveMemory, deleteAllMemories, deleteMemoriesByKeyword, upsertWorkScheduleEntry, getAllWorkSchedule, getTodayShift, getTomorrowShift } = require("./db");
const { replyText, pushText } = require("./lineApi");
const { createMorningSummary, createArayaResponse } = require("./ai");

const app = express();

const LINE_GROUP_ID = process.env.LINE_GROUP_ID;
if (!LINE_GROUP_ID) {
  console.warn("Warning: LINE_GROUP_ID is not set. /morning-report will fail without it.");
}

app.use(express.json());

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <meta charset="utf-8" />
        <title>LINE AI Bot</title>
      </head>
      <body>
        <h1>LINE AI Bot</h1>
        <p>ระบบทำงานเรียบร้อย</p>
        <ul>
          <li><a href="/dashboard">Dashboard ตารางเวร</a></li>
          <li><a href="/ping">Ping</a></li>
        </ul>
      </body>
    </html>
  `);
});

app.get("/dashboard", async (req, res) => {
  try {
    const schedule = await getAllWorkSchedule();

    const getRowClass = shift => {
      const value = shift.toLowerCase();
      if (value.includes("เช้า") || value.includes("morning") || value.includes("day")) return "shift-morning";
      if (value.includes("บ่าย") || value.includes("afternoon")) return "shift-afternoon";
      if (value.includes("สองทุ่ม") || value.includes("evening")) return "shift-evening";
      if (value.includes("กลางคืน") || value.includes("ดึก") || value.includes("night")) return "shift-night";
      if (value.includes("พัก") || value.includes("หยุด") || value.includes("off")) return "shift-off";
      return "shift-default";
    };

    const rows = schedule
      .map(item => {
        const rowClass = getRowClass(item.shift);
        return `
        <tr class="${rowClass}">
          <td>${item.work_date.toISOString().slice(0, 10)}</td>
          <td>${item.shift}</td>
          <td>${new Date(item.created_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td>
        </tr>
      `;
      })
      .join("");

    res.send(`
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Dashboard ตารางเวร</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
            th { background: #f4f4f4; }
            caption { font-size: 1.4em; margin-bottom: 12px; }
            .shift-morning { background: #e6f7ff; }
            .shift-afternoon { background: #fff7e6; }
            .shift-evening { background: #f9e6ff; }
            .shift-night { background: #e6e8ff; }
            .shift-off { background: #e8f5e9; }
            .shift-default { background: #f7f7f7; }
          </style>
        </head>
        <body>
          <a href="/">← กลับ</a>
          <table>
            <caption>ตารางเวร</caption>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>เวร</th>
                <th>บันทึกเมื่อ</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="3">ยังไม่มีตารางเวร</td></tr>`}
            </tbody>
          </table>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send("ไม่สามารถแสดง dashboard ได้");
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
