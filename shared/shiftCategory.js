function normalizeShift(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/ถึง/g, "-")
    .replace(/to/g, "-");
}

// ประเภทเวรปัจจุบัน (7 แบบ):
// 1. 8:00-16:00, 2. 8:00-20:00, 3. 6:00-14:00, 4. 8:00-22:00,
// 5. หยุด, 6. กลางคืน, 7. อื่นๆ
function getShiftCategory(shift) {
  const raw = String(shift || "");
  const value = normalizeShift(raw);

  // 5. หยุด — เช็กก่อน เพราะไม่มีเวลา
  if (value.includes("หยุด") || value.includes("พัก") || value.includes("off")) return "off";
  // 6. กลางคืน
  if (value.includes("กลางคืน") || value.includes("ดึก") || value.includes("night")) return "night";

  // 1-4. จับคู่ช่วงเวลา รองรับ "8:00-16:00", "08.00-16.00", "8-16", "6:00-14:00" ฯลฯ
  const range = value.match(/(\d{1,2})(?::?\d{2})?\D+(\d{1,2})(?::?\d{2})?/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start === 8 && end === 16) return "shift_8_16";
    if (start === 8 && end === 20) return "shift_8_20";
    if (start === 6 && end === 14) return "shift_6_14";
    if (start === 8 && end === 22) return "shift_8_22";
  }

  // รองรับข้อมูลเก่า (เช้า/บ่าย/เย็น) — map ไปเวรใหม่ที่ใกล้เคียงที่สุด
  if (value.includes("เช้า") || value.includes("morning")) return "shift_6_14";
  if (value.includes("บ่าย") || value.includes("afternoon") || value.includes("สี่โมง") || value.includes("4โมง")) return "shift_8_16";
  if (value.includes("สองทุ่ม") || value.includes("เย็น") || value.includes("evening")) return "shift_8_22";

  // 7. อื่นๆ
  return "other";
}

function getShiftCategoryLabel(category) {
  return {
    shift_8_16: "8:00-16:00",
    shift_8_20: "8:00-20:00",
    shift_6_14: "6:00-14:00",
    shift_8_22: "8:00-22:00",
    night: "กลางคืน",
    off: "หยุด",
    other: "อื่นๆ",
  }[category] || "อื่นๆ";
}

module.exports = getShiftCategory;
module.exports.getShiftCategoryLabel = getShiftCategoryLabel;
