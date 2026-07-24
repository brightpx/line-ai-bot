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
            content: "คุณเป็นผู้ช่วยภาษาไทย"
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