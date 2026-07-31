const Groq = require("groq-sdk");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY environment variable is required");
}

const groq = new Groq({ apiKey: GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b";

async function createMorningSummary({ shift, tomorrowShift }) {
  const currentShift = shift || "ไม่มีข้อมูลเวร";
  const nextShift = tomorrowShift || "ไม่มีข้อมูลเวร";

  return groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `
          คุณคือพี่เลี้ยงริริญ

          สรุปข้อมูลประจำวันแบบ กระชับ อ่านง่าย
          เหมาะสำหรับส่งให้ครอบครัวตอนเช้า
          บทบาท:
            - ตอบภาษาไทยเสมอ
            - ลงท้ายด้วย "ค่ะ"
            - ใช้น้ำเสียงอบอุ่น อ่อนโยน สุภาพ
            - ให้ความสำคัญกับความปลอดภัย สุขภาพ และพัฒนาการของริริญ
        `
      },
      {
        role: "user",
        content: `
          ข้อมูลวันนี้

          เวรแม่มุกเลิกงาน:
          ${currentShift}

          ข้อมูลวันพรุ่งนี้

          เวรแม่มุก:
          ${nextShift}

          ช่วยสรุปเป็นข้อความตอนเช้า โดยมีรายละเอียดดังนี้

          - สรุปเวรของวันนี้
          - แจ้งข้อมูลล่วงหน้าของวันพรุ่งนี้

          กฎ:
          - เมื่อกล่าวถึงเวรหรือวันหยุดของแม่มุก ให้รายงานตามข้อมูลในตารางเท่านั้น
          - ห้ามใช้คำว่า "ไม่ต้องมางาน", "ไม่ต้องเข้าเวร", "ไม่ต้องไปทำงาน"
          - ห้ามตีความหรือเพิ่มเติมข้อมูลนอกเหนือจากที่มีในตารางเวร
        `
      }
    ]
  });
}

async function createArayaResponse({ userText, memoryText, scheduleText }) {
  const memorySection = memoryText
    ? `\n\nข้อมูลที่บันทึกเพิ่มเติมจากครอบครัว\n\n${memoryText}`
    : "";

  const scheduleSection = scheduleText
    ? `\n\nตารางเวรของแม่มุก\n\n${scheduleText}`
    : "";

  return groq.chat.completions.create({
    model: MODEL,
    temperature: 0.7,
    max_completion_tokens: 4096,
    top_p: 0.9,
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
          ${memorySection}
        `
      },
      {
        role: "system",
        content: `
          ${scheduleSection}
        `
      },
      {
        role: "user",
        content: userText
      }
    ]
  });
}

module.exports = {
  createMorningSummary,
  createArayaResponse
};
