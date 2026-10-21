// 📄 ไฟล์นี้ทำหน้าที่: ผูก endpoint กลุ่ม /api/bookings ทั้งฝั่งสมาชิก (จอง/ดู/ยกเลิก)
// และฝั่งเจ้าของหอ (ดู/ยืนยัน/ปฏิเสธ/รายงาน) เข้ากับ booking.controller.ts
import { Router } from 'express';
import {
    cancelBooking,
    confirmBooking,
    createBooking,
    getMyBookings,
    getOwnerBookings,
    rejectBooking,
    reportBooking,
} from '../controllers/booking.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// 🚀 เส้นทางฝั่งสมาชิก — จอง/ดู/ยกเลิกใบจองของตัวเอง
router.post('/', verifyToken, requireRole('Member'), createBooking);
router.get('/my-bookings', verifyToken, requireRole('Member'), getMyBookings);
router.patch('/:id/cancel', verifyToken, requireRole('Member'), cancelBooking);

// 🚀 เส้นทางฝั่งเจ้าของหอ — ดู/ยืนยัน/ปฏิเสธใบจองที่เข้ามาที่หอของตัวเอง
router.get('/owner', verifyToken, requireRole('Owner'), getOwnerBookings);
router.patch('/:id/confirm', verifyToken, requireRole('Owner'), confirmBooking);
router.patch('/:id/reject', verifyToken, requireRole('Owner'), rejectBooking);
router.post('/:id/report', verifyToken, requireRole('Owner'), reportBooking);

export default router;
