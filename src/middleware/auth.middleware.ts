import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/jwt';

// 🚀 ตรวจสอบ JWT จาก header "Authorization: Bearer <token>"
// (ก่อนหน้านี้ทั้งระบบออก Token ให้แต่ไม่เคยมีที่ไหน verify เลย - endpoint ไหนที่ต้องการ
// login ก่อนถึงจะเรียกได้ ต้องใส่ middleware นี้ไว้ก่อนเสมอ)
export const verifyToken = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ message: 'ไม่พบ Token กรุณาเข้าสู่ระบบ' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: number; role: string };
    req.user = { id: decoded.id, role: decoded.role };
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
};

// 🚀 ต้องใช้ต่อจาก verifyToken เสมอ (พึ่งพา req.user ที่ verifyToken ใส่ไว้ให้)
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' });
      return;
    }
    next();
  };
};
