// 📄 ไฟล์นี้ทำหน้าที่: เก็บและ export JWT_SECRET กลางที่เดียวของระบบ ใช้เซ็น token ตอน login
// (auth.controller.ts) และตรวจสอบ token ใน auth.middleware.ts
// 🚀 Secret กลางที่เดียวสำหรับเซ็น/ตรวจสอบ JWT ทั้งระบบ
// (ก่อนหน้านี้มีการ hardcode คนละค่ากันในแต่ละฟังก์ชัน ทำให้ token ที่ออกจากคนละจุด
// ตรวจสอบข้ามกันไม่ได้ - รวมมาไว้ที่เดียวเพื่อให้ middleware ตรวจสอบได้ถูกต้องเสมอ)
// ห้ามมี fallback secret ฝังในซอร์ส — ถ้าไม่ตั้งค่าใน .env ให้ล้มตั้งแต่ตอน start แทนที่จะรันด้วย secret ที่เดาได้
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET ไม่ถูกตั้งค่าใน .env — กรุณาตั้งค่าก่อนรัน backend');
}

export const JWT_SECRET = process.env.JWT_SECRET;
