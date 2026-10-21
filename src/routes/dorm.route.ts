// 📄 ไฟล์นี้ทำหน้าที่: ผูก endpoint กลุ่ม /api/dorms (ดูข้อมูลหอพัก/ห้องพัก/สิ่งอำนวยความสะดวก
// แบบ public และสร้าง/แก้ไขข้อมูลหอพักฝั่ง Owner) เข้ากับ dorm.controller.ts
import { Router } from 'express';
import { createDorm, createRoomType, getAllDorms, getDormById, getDormFacilities, getDormsByOwnerId, getRoomFacilities, getRoomTypeById, updateDorm, updateRoomType } from '../controllers/dorm.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// 🚀 เส้นทางสาธารณะ - ดูหอพัก/ห้อง/สิ่งอำนวยความสะดวกได้โดยไม่ต้อง login
router.get('/', getAllDorms);
router.get('/room/:id', getRoomTypeById); // ✅ ต้องอยู่บรรทัดนี้ (ก่อน /:id)
router.get('/:id', getDormById);          // ⚠️ ต้องอยู่ล่างสุด
router.get('/facilities/dormitory', getDormFacilities);
router.get('/facilities/room', getRoomFacilities);

// 🚀 เส้นทางที่ต้อง login เป็น Owner เท่านั้น (สร้าง/แก้ไขข้อมูลหอพักของตัวเอง)
router.post('/', verifyToken, requireRole('Owner'), createDorm);
router.get('/owner/:ownerId', verifyToken, requireRole('Owner'), getDormsByOwnerId);
router.post('/room-types', verifyToken, requireRole('Owner'), createRoomType);
router.patch('/room-types/:id', verifyToken, requireRole('Owner'), updateRoomType);
router.patch('/:id', verifyToken, requireRole('Owner'), updateDorm);

export default router;