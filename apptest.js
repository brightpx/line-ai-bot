const response = await axios.post(
  "http://localhost:11434/api/generate",
  {
    model: "llama3",
    prompt: userText,
    stream: false
  }
);

const answer = response.data.response;