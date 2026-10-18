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
