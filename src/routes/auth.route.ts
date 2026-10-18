import { Router } from 'express';
import multer from 'multer';
import { register, login, getMemberProfile, getOwnerProfile, updateMemberProfile, updateOwnerProfile, uploadProfileAvatar, forgotPassword, resetPassword, resetRedirect, changePassword, googleLogin, completeProfile, getFirebaseToken } from '../controllers/auth.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// 🚀 เก็บไฟล์ไว้ใน memory เฉยๆ (ไม่เขียนลง disk ของ server) แล้วส่งต่อ buffer ให้ Firebase
// Storage ทันที — จำกัด 5MB กันคนอัปโหลดไฟล์ใหญ่เกินจำเป็น
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/register', register);
router.post('/login', login);
// 🚀 ต้อง login ก่อนถึงจะดูโปรไฟล์ได้ (กันคนอื่น enumerate ID ดึงอีเมล/เบอร์โทรของคนอื่น)
// 🚨 requireRole ตรงนี้สำคัญมาก: Member_ID กับ Owner_ID เป็นคนละ sequence กัน เผื่อเลขชนกัน
// (เช่น Member_ID=5 กับ Owner_ID=5 เป็นคนละคน) ถ้าไม่เช็ค role จะมีช่องให้ข้าม table ไปดู/แก้
// ข้อมูลของอีกฝั่งได้ทั้งที่ req.user.id ตรงกับพารามิเตอร์โดยบังเอิญ
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

// 🆕 ออก Firebase Custom Token ผูกกับ Member_ID จริง (ระบบแชทรูมเมท) — เฉพาะ Member เท่านั้น
router.post('/firebase-token', verifyToken, requireRole('Member'), getFirebaseToken);

export default router;