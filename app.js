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
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>LINE AI Bot</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-WZ/paXb5+X0Vv9qG8em7P6H/1v7Rd0G8m0NQ5Sj72D8O+3yP3o5G3Nj6fJ4F6BzK" crossorigin="anonymous">
      </head>
      <body class="bg-light">
        <div class="container py-5">
          <div class="card shadow-sm">
            <div class="card-body">
              <h1 class="card-title">LINE AI Bot</h1>
              <p class="card-text">ระบบทำงานเรียบร้อย</p>
              <div class="list-group">
                <a href="/dashboard" class="list-group-item list-group-item-action">Dashboard ตารางเวร</a>
                <a href="/ping" class="list-group-item list-group-item-action">Ping</a>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.get("/dashboard", async (req, res) => {
  try {
    const schedule = await getAllWorkSchedule();
    const items = schedule.map(item => ({
      date: item.work_date.toISOString().slice(0, 10),
      shift: item.shift,
      category: getShiftCategory(item.shift),
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

    const chartLabels = ["เช้า", "บ่าย", "เย็น", "กลางคืน", "พัก/หยุด", "อื่น ๆ"];
    const chartData = [counts.morning, counts.afternoon, counts.evening, counts.night, counts.off, counts.other];

    res.send(`
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Dashboard ตารางเวร</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-WZ/paXb5+X0Vv9qG8em7P6H/1v7Rd0G8m0NQ5Sj72D8O+3yP3o5G3Nj6fJ4F6BzK" crossorigin="anonymous">
          <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
          <style>
            body { background: #f8f9fa; }
            .chart-card { min-height: 380px; }
          </style>
        </head>
        <body>
          <div class="container py-5">
            <div class="d-flex justify-content-between align-items-center mb-4">
              <div>
                <h1 class="h3">Dashboard ตารางเวร</h1>
                <p class="text-muted mb-0">ดูสรุปเวรพร้อมกราฟและตารางข้อมูล</p>
              </div>
              <a href="/" class="btn btn-outline-secondary">กลับหน้าแรก</a>
            </div>

            <div class="row g-4 mb-4">
              <div class="col-lg-4">
                <div class="card shadow-sm">
                  <div class="card-body">
                    <h5 class="card-title">รายการทั้งหมด</h5>
                    <p class="display-6 mb-0">${items.length}</p>
                  </div>
                </div>
              </div>
              <div class="col-lg-8">
                <div class="card shadow-sm chart-card">
                  <div class="card-body">
                    <h5 class="card-title">สัดส่วนประเภทเวร</h5>
                    <canvas id="shiftChart"></canvas>
                  </div>
                </div>
              </div>
            </div>

            <div class="card shadow-sm">
              <div class="card-body">
                <h5 class="card-title mb-3">ตารางเวร</h5>
                <div class="table-responsive">
                  <table class="table table-striped table-hover align-middle">
                    <thead class="table-light">
                      <tr>
                        <th>วันที่</th>
                        <th>เวร</th>
                        <th>ประเภท</th>
                        <th>บันทึกเมื่อ</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${items.length === 0 ? `
                        <tr><td colspan="4" class="text-center py-4">ยังไม่มีตารางเวร</td></tr>
                      ` : items.map(item => `
                        <tr>
                          <td>${item.date}</td>
                          <td>${item.shift}</td>
                          <td>${item.category === "morning" ? "เช้า" : item.category === "afternoon" ? "บ่าย" : item.category === "evening" ? "เย็น" : item.category === "night" ? "กลางคืน" : item.category === "off" ? "พัก/หยุด" : "อื่น ๆ"}</td>
                          <td>${item.createdAt}</td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <script>
            const chartData = ${JSON.stringify(chartData)};
            const chartLabels = ${JSON.stringify(chartLabels)};
            const ctx = document.getElementById('shiftChart');
            new Chart(ctx, {
              type: 'doughnut',
              data: {
                labels: chartLabels,
                datasets: [{
                  data: chartData,
                  backgroundColor: ['#0d6efd', '#ffc107', '#6610f2', '#0d6efd80', '#198754', '#6c757d'],
                  borderColor: '#fff',
                  borderWidth: 2
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  legend: {
                    position: 'bottom'
                  },
                  tooltip: {
                    callbacks: {
                      label: context => context.label + ': ' + context.parsed
                    }
                  }
                }
              }
            });
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send("ไม่สามารถแสดง dashboard ได้");
  }
});

function getShiftCategory(shift) {
  const value = shift.toLowerCase();
  if (value.includes("เช้า") || value.includes("morning")) return "morning";
  if (value.includes("บ่าย") || value.includes("afternoon")) return "afternoon";
  if (value.includes("เย็น") || value.includes("evening")) return "evening";
  if (value.includes("กลางคืน") || value.includes("ดึก") || value.includes("night")) return "night";
  if (value.includes("พัก") || value.includes("หยุด") || value.includes("off")) return "off";
  return "other";
}

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
