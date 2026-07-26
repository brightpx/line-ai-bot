const express = require("express");
const axios = require("axios");

const app = express();
const Groq = require("groq-sdk");
const fs = require("fs");

const MEMORY_FILE = "memory.json";

function loadMemory() {
  if (!fs.existsSync(MEMORY_FILE)) {
    return [];
  }

  return JSON.parse(
    fs.readFileSync(MEMORY_FILE, "utf8")
  );
}

function saveMemory(data) {
  fs.writeFileSync(
    MEMORY_FILE,
    JSON.stringify(data, null, 2)
  );
}
app.use(express.json());

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN;

app.get("/", (req, res) => {
res.send("LINE AI Bot is running");
});

app.post("/webhook", async (req, res) => {

  const events = req.body.events || [];

  for (const event of events) {

    if (event.type !== "message") continue;
    if (event.message.type !== "text") continue;

    const userText = event.message.text;
    if (userText.startsWith("/จำ ")) {

      const memoryText =
        userText.replace("/จำ ", "").trim();

      const memories = loadMemory();

      memories.push({
        createdAt: new Date().toISOString(),
        text: memoryText
      });

      saveMemory(memories);

      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: "บันทึกข้อมูลเรียบร้อยค่ะ 💕"
            }
          ]
        },
        {
          headers: {
            Authorization:
              `Bearer ${CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      continue;
    }
    if (userText === "/ข้อมูล") {

      const memories = loadMemory();

      const answer =
        memories.length === 0
          ? "ยังไม่มีข้อมูลที่บันทึกไว้ค่ะ"
          : memories.map(x => `• ${x.text}`).join("\n");

      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: answer.substring(0, 4000)
            }
          ]
        },
        {
          headers: {
            Authorization:
              `Bearer ${CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      continue;
    }
    try {
      const memories = loadMemory();

      const memoryText =
        memories
          .map(x => `- ${x.text}`)
          .join("\n");
      const completion =
      await groq.chat.completions.create({
     messages: [
    {
      role: "system",
      content: `
      คุณคือ "พี่เลี้ยงริริญ"

      ข้อมูลครอบครัว:
      - ริริญ เกิดวันที่ 12 มีนาคม 2027
      - ริริญ เป็นลูกสาวคนเดียวของครอบครัว
      - พ่อชื่อ ไบรท์
      - แม่ชื่อ มุก
      - พี่เลี้ยงชื่อ แม่แอน
      - แม่แอนมาที่บ้านประมาณ 08:00 น. และบางวันค้างคืน
      - ริริญเป็นเด็กดี น่ารัก ร่าเริง อ่อนโยน และเป็นที่รักของพ่อไบรท์ แม่มุก ย่า ยาย และแม่แอน

      บทบาท:
      - ตอบในฐานะพี่เลี้ยงที่ดูแลริริญ
      - ตอบภาษาไทยเสมอ
      - ลงท้ายด้วย "ค่ะ"
      - ใช้น้ำเสียงอบอุ่น อ่อนโยน สุภาพ
      - ให้ความสำคัญกับความปลอดภัย สุขภาพ และพัฒนาการของริริญ

      กฎ:
      - เรียกพ่อว่า "พ่อไบรท์"
      - เรียกแม่ว่า "แม่มุก"
      - เรียกพี่เลี้ยงว่า "แม่แอน"
      - ห้ามสร้างข้อมูลครอบครัวที่ไม่มีอยู่จริง
      - หากไม่มีข้อมูลเพียงพอให้บอกตามตรง
      - หากเป็นคำถามทั่วไปให้ตอบได้ในฐานะผู้ช่วย AI

      ข้อเท็จจริงสำคัญ:
      - ริริญเป็นดวงใจของครอบครัว
      - ทุกคนรักและเอ็นดูริริญมาก
      - ครอบครัวให้ความสำคัญกับความรัก ความอบอุ่น การศึกษา และความปลอดภัย
      `
      },
      {
        role: "system",
        content: `
    ข้อมูลที่บันทึกเพิ่มเติมจากครอบครัว

    ${memoryText}
    `
      },
      {
        role: "user",
        content: userText
      }
    ],
        model: "openai/gpt-oss-120b",
        temperature: 0.7,
        max_completion_tokens: 1024,
        top_p: 0.9

      });

   const answer =
      completion.choices[0].message.content.substring(0, 4000);

      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: answer
            }
          ]
        },
        {
          headers: {
            Authorization:
              `Bearer ${CHANNEL_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

    } catch (err) {
      console.error(err);
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`);
});