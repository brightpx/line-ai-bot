function getShiftCategory(shift) {
  const value = String(shift).toLowerCase();
  if (value.includes("เช้า") || value.includes("morning")) return "morning";
  // "สี่โมง" (16:00) นับเป็นเวรบ่าย — รองรับทั้ง "สี่โมง", "4 โมง", "4โมง"
  if (value.includes("บ่าย") || value.includes("afternoon") || value.includes("สี่โมง") || value.includes("4 โมง") || value.includes("4โมง")) return "afternoon";
  if (value.includes("สองทุ่ม") || value.includes("เย็น") || value.includes("evening")) return "evening";
  if (value.includes("กลางคืน") || value.includes("ดึก") || value.includes("night")) return "night";
  if (value.includes("พัก") || value.includes("หยุด") || value.includes("off")) return "off";
  return "other";
}

module.exports = getShiftCategory;
