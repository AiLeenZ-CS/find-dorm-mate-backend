// 📄 ไฟล์นี้ทำหน้าที่: ผูก endpoint กลุ่ม /api/notifications (ดู/อ่านแจ้งเตือน, จัดการ Device Token
// สำหรับ FCM) เข้ากับ notification.controller.ts ใช้ได้เฉพาะ Member/Owner
import { Router } from 'express';
import {
  deleteDeviceToken,
  getMyNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  saveDeviceToken,
} from '../controllers/notification.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// 🚀 แจ้งเตือนในแอปมีแค่ฝั่ง Member กับ Owner เท่านั้น (ดู utils/notifications.ts)
router.get('/', verifyToken, requireRole('Member', 'Owner'), getMyNotifications);
router.get('/unread-count', verifyToken, requireRole('Member', 'Owner'), getUnreadCount);
router.patch('/read-all', verifyToken, requireRole('Member', 'Owner'), markAllAsRead);
router.patch('/:id/read', verifyToken, requireRole('Member', 'Owner'), markAsRead);

// 🆕 Push Notification (FCM) — บันทึก/ลบ Device Token ของเครื่องนี้
router.post('/save-token', verifyToken, requireRole('Member', 'Owner'), saveDeviceToken);
router.delete('/device-token', verifyToken, requireRole('Member', 'Owner'), deleteDeviceToken);

export default router;
