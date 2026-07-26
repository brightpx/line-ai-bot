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
  await pool.query(`
  CREATE TABLE IF NOT EXISTS work_schedule (
    id SERIAL PRIMARY KEY,
    work_date DATE NOT NULL,
    shift TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
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
  const prefixed = `${text}`;
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

    const userText = event.message.text.trim();
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
    if (userText.startsWith("/เวร")) {

      const rows = userText
        .replace("/เวร", "")
        .trim()
        .split("\n")
        .filter(x => x.trim());

      let count = 0;

      for (const row of rows) {

        const parts = row.trim().split(" ");

        if (parts.length < 2) {
          continue;
        }

        const workDate = parts[0];
        const shift = parts.slice(1).join(" ");

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
          INSERT INTO work_schedule (
            work_date,
            shift
          )
          VALUES ($1, $2)
          `,
            [workDate, shift]
          );

        }

        count++;
      }

      await replyText(
        event.replyToken,
        `บันทึกตารางเวรเรียบร้อย ${count} รายการค่ะ`
      );

      continue;
    }
    if (userText === "/ตารางเวร") {

      const result =
        await pool.query(`
          SELECT *
          FROM work_schedule
          ORDER BY work_date
          LIMIT 30
        `);

      const answer =
        result.rows.length === 0
          ? "ยังไม่มีตารางเวรค่ะ"
          : result.rows
            .map(
              x =>
                `${x.work_date.toISOString().slice(0, 10)} : ${x.shift}`
            )
            .join("\n");

      await replyText(
        event.replyToken,
        answer
      );

      continue;
    }
    if (userText === "/เช้า") {

      const workResult = await pool.query(
        `
        SELECT shift
        FROM work_schedule
        WHERE work_date = CURRENT_DATE
        `
      );

     const memoryResult = await pool.query(
        `
        SELECT content
        FROM memories
        ORDER BY id DESC
        LIMIT 20
        `
      );

      const shift =
        workResult.rows.length > 0
          ? workResult.rows[0].shift
          : "ไม่มีข้อมูลเวร";

      const memoryText =
        memoryResult.rows
          .map(x => `- ${x.content}`)
          .join("\n");

      const completion =
        await groq.chat.completions.create({
          model: "openai/gpt-oss-120b",
          messages: [
            {
              role: "system",
              content: `
              คุณคือพี่เลี้ยงริริญ

              ช่วยสรุปข้อมูลประจำวันแบบ
              กระชับ อ่านง่าย
              และเหมาะสำหรับส่งตอนเช้า
              `
            },
            {
              role: "user",
              content: `
              ข้อมูลวันนี้

              เวรแม่มุกเลิกงาน:
              ${shift}

              ช่วยสรุปข้อมูลตอนเช้า
`
            }
          ]
        });

      await replyText(
        event.replyToken,
        completion.choices[0].message.content
      );

      continue;
    }
    // ตอบเฉพาะเมื่อเรียกชื่อ อารายา
    if (
      !userText.startsWith("อารายา") &&
      !userText.startsWith("อารยา")
    ) {
      continue;
    }

    const prompt = userText
      .replace(/^อารายา\s*/i, "")
      .replace(/^อารยา\s*/i, "")
      .trim();

    if (!prompt) {
      await replyText(
        event.replyToken,
        "มีอะไรให้อารายาช่วยไหมคะ 💕"
      );

      continue;
    }
    try {
      const memories = await loadMemory();

      const memoryText =
        memories
          .map(x => `- ${x.content}`)
          .join("\n");

      const scheduleResult =
        await pool.query(`
    SELECT *
    FROM work_schedule
    ORDER BY work_date
    LIMIT 30
  `);

      const scheduleText =
        scheduleResult.rows
          .map(
            x =>
              `${x.work_date.toISOString().slice(0, 10)} : ${x.shift}`
          )
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
              role: "system",
              content: `
              ตารางเวรของแม่มุก

              ${scheduleText}
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