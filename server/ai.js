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

          กฏ:
            - ห้ามใช้คำว่า "ไม่ต้องมางาน", "ไม่ต้องเข้าเวร", "ไม่ต้องไปทำงาน"
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
          - link: https://line-ai-bot-t27n.onrender.com/
          กฎ:
          - เมื่อกล่าวถึงเวรหรือวันหยุดของแม่มุก ให้รายงานตามข้อมูลในตารางเท่านั้น
          - ห้ามใช้คำว่า "ไม่ต้องมางาน", "ไม่ต้องเข้าเวร", "ไม่ต้องไปทำงาน"
          - ห้ามตีความหรือเพิ่มเติมข้อมูลนอกเหนือจากที่มีในตารางเวร
        `
      }
    ]
  });
}

async function createArayaResponse({ userText, memoryText, scheduleText, history }) {
  const memorySection = memoryText
    ? `\n\nข้อมูลที่บันทึกเพิ่มเติมจากครอบครัว\n\n${memoryText}`
    : "";

  // ประวัติบทสนทนาก่อนหน้า (จำกัดจำนวนข้อความและความยาว เพื่อไม่ให้ context ยาวเกินไป)
  const historyMessages = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map(m => ({
      role: m.role,
      content: m.content.trim().substring(0, 2000)
    }));

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
          - ริริญ เกิดวันที่ 12 มีนาคม 2026
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
      ...historyMessages,
      {
        role: "user",
        content: userText
      }
    ]
  });
}

// สร้างคำแนะนำกิจกรรมรายชั่วโมงสำหรับเด็กตามอายุ (เดือน)
async function createDailyRoutineGuide({ ageInMonths }) {
  const months = Math.max(0, Math.min(72, Number(ageInMonths) || 0));

  return groq.chat.completions.create({
    model: MODEL,
    temperature: 0.6,
    max_completion_tokens: 4096,
    messages: [
      {
        role: "system",
        content: `
          คุณคือผู้เชี่ยวชาญด้านพัฒนาการเด็กและผู้ช่วยดูแลเด็กที่อบอุ่น

          หน้าที่:
          - สร้างตารางกิจกรรมรายชั่วโมงตัวอย่างสำหรับเด็กอายุตามที่กำหนด (หน่วย: เดือน)
          - ตอบเป็นภาษาไทยเสมอ ใช้น้ำเสียงอบอุ่น เข้าใจง่าย

          ข้อกำหนดรูปแบบ (สำคัญมาก):
          - เริ่มด้วยบรรทัดแรก: "ริริญอายุ X เดือน — ตารางกิจกรรมตัวอย่าง 1 วัน" (แทน X ด้วยเลขอายุ)
          - จัดเป็นช่วงเวลาตั้งแต่ 06:00 ถึง 21:00 โดยแต่ละช่วงให้เป็นบรรทัดแยกกัน
          - แต่ละบรรทัดใช้รูปแบบ: "HH:MM–HH:MM | ชื่อกิจกรรม | รายละเอียดสั้น ๆ 1 ประโยค"
          - ครอบคลุม: นอน/ตื่น ให้นม/อาหารเสริมตามวัย อาบน้ำ เล่น/กระตุ้นพัฒนาการตามวัย อ่านนิทาน เดินเล่น งีบ
          - จำนวนงีบและเวลานอนต้องเหมาะกับอายุ (เช่น ทารก <6 เดือนงีบ 3-4 ครั้ง, 6-12 เดือนงีบ 2 ครั้ง, >18 เดือนงีบ 1 ครั้ง)
          - อาหารเสริมต้องเหมาะกับอายุ (ต่ำกว่า 6 เดือนห้ามแนะนำอาหารเสริม — ให้นมอย่างเดียว)
          - กิจกรรมกระตุ้นพัฒนาการต้องตรงวัย เช่น ทารกเล็ก = คุยลอยๆ ท้องนอน tummy time, เด็กโต = เกมจับคู่ เดิน เล่นบล็อก
          - ปิดท้ายด้วยหัวข้อ "หมายเหตุสำคัญ" พร้อมข้อควรระวังด้านความปลอดภัย 2-3 ข้อที่เกี่ยวกับวัยนี้
          - ห้ามใช้ markdown หรือสัญลักษณ์พิเศษอื่น นอกจากขีด | ตามรูปแบบที่กำหนด
        `
      },
      {
        role: "user",
        content: `ริริญอายุ ${months} เดือน กรุณาสร้างตารางกิจกรรมรายชั่วโมงตัวอย่าง 1 วัน`
      }
    ]
  });
}

module.exports = {
  createMorningSummary,
  createArayaResponse,
  createDailyRoutineGuide,
  createDailyRoutineGuide
};
