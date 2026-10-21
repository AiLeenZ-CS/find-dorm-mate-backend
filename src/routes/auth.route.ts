// 📄 ไฟล์นี้ทำหน้าที่: ผูก endpoint กลุ่ม /api/auth (สมัคร/ล็อกอิน, จัดการโปรไฟล์, ลืม/เปลี่ยนรหัสผ่าน,
// login ด้วย Google, ออก Firebase token) เข้ากับ auth.controller.ts
import { Router } from 'express';
import multer from 'multer';
import { register, login, getMemberProfile, getOwnerProfile, updateMemberProfile, updateOwnerProfile, uploadProfileAvatar, forgotPassword, resetPassword, resetRedirect, changePassword, googleLogin, completeProfile, getFirebaseToken } from '../controllers/auth.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/register', register);
router.post('/login', login);
router.get('/profile/:id', verifyToken, requireRole('Member', 'Admin', 'Master_Admin'), getMemberProfile);
router.get('/owner-profile/:id', verifyToken, requireRole('Owner'), getOwnerProfile);
router.patch('/profile', verifyToken, requireRole('Member', 'Admin', 'Master_Admin'), updateMemberProfile);
router.post(
  '/profile/avatar',
  verifyToken,
  requireRole('Member', 'Admin', 'Master_Admin'),
  avatarUpload.single('image'),
  uploadProfileAvatar,
);
router.patch('/owner-profile', verifyToken, requireRole('Owner'), updateOwnerProfile);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/reset-redirect/:id/:token', resetRedirect);
router.post('/change-password', verifyToken, changePassword);
router.post('/google-login', googleLogin);
router.post('/complete-profile', completeProfile);
router.post('/firebase-token', verifyToken, requireRole('Member'), getFirebaseToken);

export default router;