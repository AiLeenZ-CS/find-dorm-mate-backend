import { Router } from 'express';
import { getPublicProxiedImage } from '../controllers/image-proxy.controller';

const router = Router();

// 🚀 ไม่มี verifyToken โดยตั้งใจ — ใช้โชว์รูปหอพัก/ห้องพัก/โปรไฟล์ในหน้า Feed ที่เป็น public
// endpoint อยู่แล้ว (ดู image-proxy.controller.ts สำหรับเหตุผลและขอบเขตที่จำกัดไว้)
router.get('/proxy', getPublicProxiedImage);

export default router;
