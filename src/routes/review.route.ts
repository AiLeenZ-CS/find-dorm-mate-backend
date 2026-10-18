import { Router } from 'express';
import {
    createReview,
    getDormReviews,
    getMyReviews,
    updateReview,
    deleteReview,
} from '../controllers/review.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// 🚀 ดูรีวิวของหอพักหนึ่งๆ ได้แบบ public ไม่ต้อง login (ใช้โชว์ในหน้ารายละเอียดหอพัก)
router.get('/dorm/:dormId', getDormReviews);

// 🚀 เส้นทางฝั่งสมาชิก — เขียน/ดู/แก้ไข/ลบรีวิวของตัวเอง
router.post('/', verifyToken, requireRole('Member'), createReview);
router.get('/my', verifyToken, requireRole('Member'), getMyReviews);
router.patch('/:id', verifyToken, requireRole('Member'), updateReview);
router.delete('/:id', verifyToken, requireRole('Member'), deleteReview);

export default router;
