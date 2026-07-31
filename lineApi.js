const axios = require("axios");

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!CHANNEL_ACCESS_TOKEN) {
  throw new Error("LINE_CHANNEL_ACCESS_TOKEN environment variable is required");
}

function createHeaders() {
  return {
    Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    "Content-Type": "application/json"
  };
}

async function replyText(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [
        {
          type: "text",
          text
        }
      ]
    },
    {
      headers: createHeaders()
    }
  );
}

async function pushText(to, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    {
      to,
      messages: [
        {
          type: "text",
          text: text.substring(0, 4000)
        }
      ]
    },
    {
      headers: createHeaders()
    }
  );
}

module.exports = {
  replyText,
  pushText
};
