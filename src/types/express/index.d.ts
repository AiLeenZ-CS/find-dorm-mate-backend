// 📄 ไฟล์นี้ทำหน้าที่: ไฟล์ type declaration เสริม (ambient types) ขยาย type ของ Express Request
// ให้มี req.user ใช้ร่วมกับ auth.middleware.ts และ controller ที่อ่าน req.user
// 🚀 เพิ่ม req.user ให้ Express Request รู้จัก (ใส่ค่าโดย verifyToken middleware)
export {};

declare global {
  namespace Express {
    export interface Request {
      user?: {
        id: number;
        role: string;
      };
    }
  }
}
