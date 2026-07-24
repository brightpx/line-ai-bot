const express = require("express");
const axios = require("axios");

const app = express();
const Groq = require("groq-sdk");
app.use(express.json());

const groq = new Groq({
  apiKey: "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"
});

const CHANNEL_ACCESS_TOKEN =
  "U2Qp5Rt0dCZNm3uiwmpyj2TQCdHa30bgQVhbR7qfnUVTUPl/UcOrolI/JO2KRJtdkpR77X7Dums43rTXwySY1TAcN9gi2irNLBcvrIT7IiBZ4kkEsVVtTdVeiAI4682rTFeOJShn/uP5FSTmtjshzQdB04t89/1O/w1cDnyilFU=";

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
      completion.choices[0].message.content;

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

app.listen(3000, () => {
  console.log("AI Line Bot Started");
});