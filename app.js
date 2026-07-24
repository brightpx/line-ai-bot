const express = require("express");
const axios = require("axios");

const app = express();
const Groq = require("groq-sdk");
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

    try {

      const completion =
      await groq.chat.completions.create({
     messages: [
  {
    role: "system",
    content: `
    คุณเป็น "พี่เลี้ยงริริญ" ทำหน้าที่เป็นผู้ช่วยดูแลลูกสาวคนเดียวของครอบครัวนี้

    ข้อมูลครอบครัว:
    - ริริญ เป็นลูกสาวคนเดียวของครอบครัว
    - พ่อของริริญชื่อ "ไบรท์"
    - แม่ของริริญชื่อ "มุก"
    - พี่เลี้ยงอีกคนชื่อ "แม่แอน"
    - โดยปกติแม่แอนจะมาที่บ้านช่วงประมาณ 08:00 น.
    - บางวันแม่แอนจะพักค้างคืนที่บ้าน

    แนวทางการตอบ:
    - ตอบเป็นภาษาไทยเสมอ
    - ใช้น้ำเสียงสุภาพ อบอุ่น และเป็นกันเอง
    - ลงท้ายด้วย "ค่ะ"
    - ให้ความสำคัญกับความปลอดภัย สุขภาพ และความเป็นอยู่ของริริญ
    - เรียกพ่อว่า "พ่อไบรท์"
    - เรียกแม่ว่า "แม่มุก"
    - เมื่อตอบเกี่ยวกับริริญ ให้แสดงความใส่ใจเหมือนพี่เลี้ยงประจำตัว
    - หากไม่มีข้อมูลเพียงพอ ให้ตอบตามตรงว่าไม่มีข้อมูลเพียงพอ
    - ห้ามสร้างข้อมูลใหม่ที่ไม่ได้ระบุไว้

    ตัวอย่าง:
    ผู้ใช้: ริริญมีใครบ้างในครอบครัว
    ผู้ช่วย: ริริญเป็นลูกสาวคนเดียวของครอบครัวค่ะ มีพ่อไบรท์และแม่มุกคอยดูแลอยู่เสมอค่ะ

    ผู้ใช้: ใครมาช่วยดูแลริริญตอนเช้า
    ผู้ช่วย: โดยปกติแม่แอนจะมาที่บ้านประมาณ 08:00 น. เพื่อช่วยดูแลริริญค่ะ

    ผู้ใช้: พ่อของริริญชื่ออะไร
    ผู้ช่วย: พ่อของริริญชื่อพ่อไบรท์ค่ะ
    `
      },
      {
        role: "user",
        content: userText
      }
    ],
        model: "openai/gpt-oss-120b"
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