function getShiftCategory(shift) {
  const value = String(shift).toLowerCase();
  if (value.includes("เช้า") || value.includes("morning")) return "morning";
  if (value.includes("บ่าย") || value.includes("afternoon") || value.includes("บ่ายสี่")) return "afternoon";
  if (value.includes("สองทุ่ม") || value.includes("เย็น") || value.includes("evening")) return "evening";
  if (value.includes("กลางคืน") || value.includes("ดึก") || value.includes("night")) return "night";
  if (value.includes("พัก") || value.includes("หยุด") || value.includes("off")) return "off";
  return "other";
}

module.exports = getShiftCategory;
