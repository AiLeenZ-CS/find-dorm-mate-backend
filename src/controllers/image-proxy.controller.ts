// 📄 ไฟล์นี้ทำหน้าที่: controller สำหรับสตรีมรูปภาพจาก Firebase Storage ผ่าน backend — แยกเส้นทาง
// เอกสารอ่อนไหว (ต้องผ่านสิทธิ์ Admin) กับรูปทั่วไปที่เข้าถึงได้แบบ public
import { Request, Response } from 'express';
import { getStorageBucket, isFirebaseAdminConfigured } from '../config/firebase-admin';
import { isAllowedImagePath, isPublicImagePath } from '../utils/image-proxy';

// 🚀 สตรีมรูปภาพจาก Firebase Storage ผ่าน Firebase Admin SDK โดยตรง แทนการเปิด URL ที่มี
// download token ติดมาด้วย — ใช้ร่วมกันทั้งเส้นทาง admin (เอกสารอ่อนไหว) และ public (รูปทั่วไป)
async function streamImageFromStorage(storagePath: string, res: Response): Promise<void> {
  if (!isFirebaseAdminConfigured()) {
    res.status(503).json({
      message: 'ระบบแสดงรูปภาพยังไม่ได้ตั้งค่า Firebase Admin SDK บน backend กรุณาติดต่อผู้ดูแลระบบ',
    });
    return;
  }

  const bucket = getStorageBucket();
  const file = bucket.file(storagePath);

  const [exists] = await file.exists();
  if (!exists) {
    res.status(404).json({ message: 'ไม่พบรูปภาพ' });
    return;
  }

  const [metadata] = await file.getMetadata();

  res.setHeader('Content-Type', metadata.contentType || 'image/jpeg');

  file
    .createReadStream()
    .on('error', (err) => {
      console.error('Image proxy stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการโหลดรูปภาพ' });
      }
    })
    .pipe(res);
}

// [GET] API: /api/admin/image-proxy?path=... — เอกสารอ่อนไหว (บัตรประชาชน/เอกสารสิทธิ์ครอบครอง)
// รวม + รูปทั่วไปด้วยถ้า Admin ต้องดู — ต้องผ่าน verifyToken + requireRole ที่ระดับ router มาก่อนแล้ว
// (ดู admin.route.ts) ดังนั้นมีแค่ Admin/Master Admin ที่ล็อกอินแล้วเท่านั้นที่เรียกได้
export const getProxiedImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawPath = req.query.path;
    if (!rawPath || typeof rawPath !== 'string') {
      res.status(400).json({ message: 'ไม่พบ path ของรูปภาพ' });
      return;
    }

    if (!isAllowedImagePath(rawPath)) {
      res.status(400).json({ message: 'path ของรูปภาพไม่ถูกต้อง' });
      return;
    }

    res.setHeader('Cache-Control', 'private, max-age=3600');
    await streamImageFromStorage(rawPath, res);
  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการโหลดรูปภาพ' });
  }
};

// [GET] API: /api/images/proxy?path=... — รูปทั่วไป (หอพัก/ห้องพัก/โปรไฟล์) เท่านั้น
// 🚀 ไม่มี verifyToken โดยตั้งใจ เพราะหน้า Feed หอพัก (GET /api/dorms) เป็น public endpoint
// ที่ไม่ต้อง login ก็ดูได้ — แต่ห้ามใช้เส้นทางนี้โหลดเอกสารอ่อนไหวเด็ดขาด (เช็คด้วย isPublicImagePath)
export const getPublicProxiedImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawPath = req.query.path;
    if (!rawPath || typeof rawPath !== 'string') {
      res.status(400).json({ message: 'ไม่พบ path ของรูปภาพ' });
      return;
    }

    if (!isPublicImagePath(rawPath)) {
      res.status(400).json({ message: 'path ของรูปภาพไม่ถูกต้อง' });
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=86400');
    await streamImageFromStorage(rawPath, res);
  } catch (error) {
    console.error('Public image proxy error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการโหลดรูปภาพ' });
  }
};
