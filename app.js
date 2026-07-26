const express = require("express");
const axios = require("axios");

const app = express();
const Groq = require("groq-sdk");
const fs = require("fs");

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
}

initDb();


async function loadMemory() {
  const result = await pool.query(`
    SELECT *
    FROM memories
    ORDER BY created_at DESC
    LIMIT 100
  `);

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
app.use(express.json());

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN;

async function replyText(replyToken, text) {
  const prefixed = `อารายา ${text}`;
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [
        {
          type: "text",
          text: prefixed
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

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

await saveMemory(memoryText);

      await replyText(event.replyToken, "บันทึกข้อมูลเรียบร้อยค่ะ 💕");

      continue;
    }
    if (userText === "/ข้อมูล") {

      const memories = await loadMemory();

      const answer =
        memories.length === 0
          ? "ยังไม่มีข้อมูลที่บันทึกไว้ค่ะ"
          : memories.map(x => `• ${x.content}`).join("\n");

      await replyText(event.replyToken, answer.substring(0, 4000));

      continue;
    }
    if (userText === "/ล้างข้อมูล") {

      await pool.query(
        "DELETE FROM memories"
      );

      await replyText(
        event.replyToken,
        "ล้างข้อมูลที่บันทึกไว้ทั้งหมดเรียบร้อยแล้วค่ะ 🗑️"
      );

      continue;
    }
    if (userText.startsWith("/ลืม ")) {

    const keyword =
      userText.replace("/ลืม ", "").trim();

    await pool.query(
      `
      DELETE FROM memories
      WHERE content ILIKE $1
      `,
      [`%${keyword}%`]
    );

    await replyText(
      event.replyToken,
      `ลบข้อมูลที่เกี่ยวข้องกับ "${keyword}" เรียบร้อยแล้วค่ะ`
    );

    continue;
  }
    try {
      const memories = await loadMemory();

      const memoryText =
        memories
          .map(x => `- ${x.content}`)
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
      - พี่เลี้ยงชื่อ อารายา
      - แม่แอนมาที่บ้านประมาณ 08:00 น. และบางวันค้างคืน
      - ริริญเป็นเด็กดี น่ารัก ร่าเริง อ่อนโยน และเป็นที่รักของพ่อไบรท์ แม่มุก ย่า ยาย และแม่แอน

      บทบาท:
      - ตอบในฐานะอารายาที่ดูแลริริญ
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

      await replyText(event.replyToken, answer);

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