// 📄 ไฟล์นี้ทำหน้าที่: รวมค่าตั้งค่าระดับระบบที่อ่านจาก environment variables (.env) เช่น PORT,
// CORS origins, และข้อมูลสำหรับส่งอีเมล ให้ไฟล์อื่นทั่วโปรเจกต์ import ไปใช้แทนการเรียก process.env ตรงๆ
// 🚀 ค่าตั้งค่าที่อ่านจาก .env สำหรับ mail sender และ public URL ของ backend
// (ก่อนหน้านี้ค่าพวกนี้ถูก hardcode ไว้ในซอร์สโดยตรง ทำให้ credential รั่วไหลได้ถ้ามีคนเห็นซอร์ส)

export const PORT = Number(process.env.PORT) || 3000;

export const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || 'http://10.0.2.2:3000';

// 🚀 ALLOWED_ORIGINS ใน .env (คั่นด้วย comma เช่น "https://admin.yourdomain.com,https://app.yourdomain.com")
// — ถ้าไม่ตั้งค่าไว้เลย (ตอน dev) จะอนุญาตทุก origin เหมือนเดิมทุกประการ ไม่กระทบการใช้งานปัจจุบัน
// ต้องตั้งค่านี้ก่อน deploy production จริง เพื่อไม่ให้เว็บไซต์อื่นเรียก API นี้ได้ตามใจชอบ
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : null;

// 🚨 เลิกใช้ SMTP (nodemailer) แล้ว เปลี่ยนมาใช้ HTTPS email API แทน เพราะ PaaS ฟรี/ราคาถูก
// แทบทุกเจ้า (ทั้ง Railway และ Render ที่เคยลองมา) บล็อก outbound SMTP port (465/587) เป็น
// policy กันสแปม ทำให้ nodemailer ต่อไม่ติดเงียบๆ จนกว่าจะ timeout ทุกครั้ง — ส่งผ่าน port 443
// (HTTPS) แทนไม่มี PaaS ไหนบล็อก
// 🚨 เลือกใช้ Brevo แทน Resend เพราะ Resend บังคับ verify ทั้งโดเมนก่อนถึงจะส่งไปอีเมลอื่นนอกจาก
// อีเมลเจ้าของบัญชีได้ (sandbox mode จำกัดผู้รับ) — Brevo แค่ verify sender email เดียวที่มีอยู่
// แล้ว (ไม่ต้องมีโดเมนของตัวเอง) ก็ส่งไปผู้รับไหนก็ได้ไม่จำกัดทันที เหมาะกับโปรเจกต์นี้ที่ไม่มีโดเมน
export const BREVO_API_KEY = process.env.BREVO_API_KEY;
export const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;

if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
  console.warn(
    '⚠️  ไม่พบ BREVO_API_KEY/BREVO_SENDER_EMAIL ใน .env — ฟีเจอร์ลืมรหัสผ่าน (ส่งอีเมล) จะใช้งานไม่ได้จนกว่าจะตั้งค่า'
  );
}
