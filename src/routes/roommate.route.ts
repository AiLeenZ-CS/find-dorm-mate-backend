import { Router } from 'express';
import {
    bookFromPost,
    cancelMatchRequest,
    createPost,
    deletePost,
    getAllPosts,
    getMyMatchedPosts,
    getMyMatchRequests,
    getMyPosts,
    getMyRequestStatusForPost,
    getPostMatchRequests,
    getPostMembers,
    openPreMatchChat,
    respondToMatchRequest,
    sendMatchRequest,
    unmatchRequest,
    updatePost,
} from '../controllers/roommate.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// GET /api/roommates -> ดึงประกาศทั้งหมด (ต้อง login ก่อนถึงจะดูได้)
router.get('/', verifyToken, getAllPosts);

// POST /api/roommates -> สร้างประกาศใหม่ (ต้อง login เป็น Member)
router.post('/', verifyToken, requireRole('Member'), createPost);

// 🆕 DELETE /api/roommates/:postId -> เจ้าของประกาศลบประกาศของตัวเอง (ทำได้เฉพาะยังไม่ได้คู่)
router.delete('/:postId', verifyToken, requireRole('Member'), deletePost);

// 🆕 PATCH /api/roommates/:postId -> เจ้าของประกาศแก้ไขเงื่อนไขรูมเมทที่ต้องการ
router.patch('/:postId', verifyToken, requireRole('Member'), updatePost);

// 🆕 ประกาศของฉัน (ทุกสถานะ) + ประกาศที่ฉันจับคู่สำเร็จ — ให้ตามดูได้แม้ถูกปิดจากหน้ารวมแล้ว
router.get('/my-posts', verifyToken, requireRole('Member'), getMyPosts);
router.get('/my-matched-posts', verifyToken, requireRole('Member'), getMyMatchedPosts);

// 🆕 รายการคำขอจับคู่ทั้งหมดที่ฉันเกี่ยวข้อง (ส่งไปเอง + ส่งมาที่ประกาศของฉัน) — ใช้ทำแท็บ
// "แชทเดี่ยว" ในหน้า "แชทของฉัน" แยกจากแชทกลุ่มของรูมเมทที่ Matched แล้ว
router.get('/my-match-requests', verifyToken, requireRole('Member'), getMyMatchRequests);

// 🆕 ระบบจับคู่รูมเมท (ต้อง login เป็น Member ทั้งหมด)
// ผู้ขอ: ส่งคำขอจับคู่ + เช็คสถานะคำขอของตัวเอง + ยกเลิกคำขอก่อนเจ้าของประกาศตอบรับ
router.post('/:postId/matches', verifyToken, requireRole('Member'), sendMatchRequest);
router.get('/:postId/my-request-status', verifyToken, requireRole('Member'), getMyRequestStatusForPost);
router.patch('/matches/:matchId/cancel', verifyToken, requireRole('Member'), cancelMatchRequest);

// เจ้าของประกาศ: ดูรายการคำขอ (พร้อมโปรไฟล์ผู้ขอ) + อนุมัติ/ปฏิเสธ
router.get('/:postId/matches', verifyToken, requireRole('Member'), getPostMatchRequests);
router.patch('/matches/:matchId', verifyToken, requireRole('Member'), respondToMatchRequest);

// 🆕 เปิดแชท 1:1 คุยกันก่อนตอบรับ (เจ้าของประกาศ หรือผู้ขอ เปิดได้ทั้งคู่) + เจ้าของประกาศ
// ยกเลิกการจับคู่ (Unmatch) หลังจับคู่แล้ว
router.post('/matches/:matchId/chat', verifyToken, requireRole('Member'), openPreMatchChat);
router.patch('/matches/:matchId/unmatch', verifyToken, requireRole('Member'), unmatchRequest);

// 🆕 รายชื่อสมาชิกที่จับคู่แล้วในประกาศนี้ — เข้าถึงได้ทั้งเจ้าของและสมาชิกที่จับคู่ด้วย
router.get('/:postId/members', verifyToken, requireRole('Member'), getPostMembers);

// 🆕 เจ้าของประกาศ: จองห้องพักจากประกาศที่จับคู่รูมเมทครบแล้ว (Post_Status = 'Found')
router.post('/:postId/book', verifyToken, requireRole('Member'), bookFromPost);

export default router;
