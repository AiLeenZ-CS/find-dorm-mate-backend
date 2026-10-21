// 📄 ไฟล์นี้ทำหน้าที่: ผูก endpoint กลุ่ม /api/admin (จัดการสมาชิก, เจ้าของหอ, หอพัก, รายงาน,
// บัญชี Admin, สิ่งอำนวยความสะดวก) เข้ากับ admin.controller.ts ทุก route ต้อง login เป็น Admin/Master_Admin
import { Router } from 'express';
import {
  listMembers,
  getMemberDetail,
  suspendMember,
  listOwners,
  getOwnerDetail,
  approveOwnerVerification,
  rejectOwnerVerification,
  suspendOwner,
  listDormitories,
  getDormitoryDetail,
  approveDormitory,
  rejectDormitory,
  listReports,
  getReportDetail,
  updateReportStatus,
  listAdmins,
  getAdminDetail,
  createAdmin,
  updateAdminStatus,
  listFacilities,
  createFacility,
  deleteFacility,
} from '../controllers/admin.controller';
import { getProxiedImage } from '../controllers/image-proxy.controller';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// 🚀 ทุก route ใต้ /api/admin ต้องล็อกอินและเป็น Admin หรือ Master Admin เท่านั้น
router.use(verifyToken, requireRole('Admin', 'Master_Admin'));

// 🚀 สตรีมรูปภาพผ่าน Firebase Admin SDK แทนการส่ง URL ที่มี token ยาวๆ ออกไปตรงๆ
router.get('/image-proxy', getProxiedImage);

// สมาชิกทั่วไป
router.get('/members', listMembers);
router.get('/members/:id', getMemberDetail);
router.patch('/members/:id/status', suspendMember);

// เจ้าของหอพัก
router.get('/owners', listOwners);
router.get('/owners/:id', getOwnerDetail);
router.patch('/owners/:id/approve', approveOwnerVerification);
router.patch('/owners/:id/reject', rejectOwnerVerification);
router.patch('/owners/:id/status', suspendOwner);

// หอพัก
router.get('/dormitories', listDormitories);
router.get('/dormitories/:id', getDormitoryDetail);
router.patch('/dormitories/:id/approve', approveDormitory);
router.patch('/dormitories/:id/reject', rejectDormitory);

// รายงานผู้ใช้
router.get('/reports', listReports);
router.get('/reports/:id', getReportDetail);
router.patch('/reports/:id/status', updateReportStatus);

// สิ่งอำนวยความสะดวกกลาง (หอพัก/ห้องพัก) — Admin ทุกคนจัดการได้
router.get('/facilities', listFacilities);
router.post('/facilities', createFacility);
router.delete('/facilities/:id', deleteFacility);

// 🚀 จัดการบัญชี Admin - เฉพาะ Master Admin เท่านั้น (เข้มกว่า route ด้านบน)
router.get('/admins', requireRole('Master_Admin'), listAdmins);
router.get('/admins/:id', requireRole('Master_Admin'), getAdminDetail);
router.post('/admins', requireRole('Master_Admin'), createAdmin);
router.patch('/admins/:id', requireRole('Master_Admin'), updateAdminStatus);

export default router;
