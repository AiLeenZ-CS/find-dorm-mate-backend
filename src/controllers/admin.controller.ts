import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { toImageProxyRef, toImageProxyRefListJson } from '../utils/image-proxy';
import { parsePagination, buildMeta } from '../utils/pagination';
import { createNotification } from '../utils/notifications';


const ADMIN_SAFE_SELECT = {
  Member_ID: true,
  Username: true,
  Email: true,
  First_Name: true,
  Last_Name: true,
  Profile_Image: true,
  User_Role: true,
  Account_Status: true,
  Created_At: true,
} as const;

const MEMBER_SAFE_SELECT = {
  Member_ID: true,
  Username: true,
  Email: true,
  First_Name: true,
  Last_Name: true,
  Phone: true,
  Profile_Image: true,
  Gender: true,
  User_Role: true,
  Account_Status: true,
  Created_At: true,
} as const;

const OWNER_SAFE_SELECT = {
  Owner_ID: true,
  Username: true,
  Email: true,
  First_Name: true,
  Last_Name: true,
  Phone: true,
  Profile_Image: true,
  ID_Card_No: true,
  ID_Card_Image: true,
  Submitted_Date: true,
  Approved_Date: true,
  Admin_Note: true,
  Status: true,
  Account_Status: true,
} as const;

// 🚀 select แบบละเอียดสำหรับหน้า Detail (มีฟิลด์เพิ่มจากฝั่ง List ที่ตั้งใจไม่โชว์ในตารางเพื่อให้ตารางดูโล่งๆ)
const MEMBER_DETAIL_SELECT = {
  ...MEMBER_SAFE_SELECT,
  Nickname: true,
  Birthdate: true,
  Is_Profile_Completed: true,
  Updated_At: true,
} as const;

// 🚀 select แบบย่อสำหรับตารางรายชื่อเจ้าของหอพัก (รายละเอียดเต็มอยู่ที่ OWNER_SAFE_SELECT/OWNER_DETAIL_SELECT)
const OWNER_LIST_SELECT = {
  Owner_ID: true,
  Username: true,
  Email: true,
  First_Name: true,
  Last_Name: true,
  Profile_Image: true,
  Submitted_Date: true,
  Status: true,
  Account_Status: true,
} as const;

const OWNER_DETAIL_SELECT = {
  ...OWNER_SAFE_SELECT,
  Google_ID: true,
} as const;

const DORMITORY_LIST_SELECT = {
  Dorm_ID: true,
  Dorm_Name: true,
  Address: true,
  Dorm_Type: true,
  Dorm_Images: true,
  Approval_Status: true,
  Dorm_Status: true,
  Created_At: true,
  Owner: {
    select: { Owner_ID: true, Username: true },
  },
} as const;

const DORMITORY_DETAIL_SELECT = {
  Dorm_ID: true,
  Dorm_Name: true,
  Address: true,
  Ownership_Proof_Image: true,
  Approval_Status: true,
  Admin_Note: true,
  Latitude: true,
  Longitude: true,
  Dorm_Type: true,
  Dorm_Images: true,
  Deposit_Fee: true,
  Insurance_Fee: true,
  Contract_Duration: true,
  Is_Pet_Friendly: true,
  Is_Smoking_Allowed: true,
  Contact_Info: true,
  Dorm_Status: true,
  Water_Rate: true,
  Electric_Rate: true,
  Created_At: true,
  Updated_At: true,
  Owner: {
    select: { Owner_ID: true, Username: true, Email: true, Phone: true },
  },
  Facilities: {
    select: { Facility_ID: true, Facility_Name: true },
  },
  Room_Types: {
    select: {
      Room_Type_ID: true,
      Room_Type_Name: true,
      Room_Type: true,
      Price_Per_Month: true,
      Total_Rooms: true,
      Remaining_Rooms: true,
      Room_Status: true,
    },
  },
} as const;

// ---------------------------------------------------------
// จัดการสมาชิกทั่วไป (D1_Members)
// ---------------------------------------------------------

// [GET] API: รายชื่อสมาชิกทั้งหมด (เฉพาะ Role='Member') - ค้นหาด้วย Username/Email และฟิวเตอร์ตาม Account_Status ได้
export const listMembers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, status } = req.query;

    const where: Prisma.D1_MembersWhereInput = { User_Role: 'Member' };

    if (search && typeof search === 'string' && search.trim()) {
      where.OR = [
        { Username: { contains: search.trim() } },
        { Email: { contains: search.trim() } },
      ];
    }

    if (status && typeof status === 'string' && status !== 'All') {
      where.Account_Status = status;
    }

    // 🚀 รองรับ ?page=&limit= (ไม่บังคับ — ถ้าไม่ส่งมาจะดึงมาทั้งหมดเหมือนเดิม เพื่อไม่ให้ frontend เดิมพัง)
    const pagination = parsePagination(req);

    const [members, total] = await Promise.all([
      prisma.d1_Members.findMany({
        where,
        orderBy: { Created_At: 'desc' },
        select: MEMBER_SAFE_SELECT,
        ...(pagination && { skip: pagination.skip, take: pagination.take }),
      }),
      prisma.d1_Members.count({ where }),
    ]);

    const data = members.map((m) => ({ ...m, Profile_Image: toImageProxyRef(m.Profile_Image) }));

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data, meta: buildMeta(pagination, total) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [GET] API: รายละเอียดสมาชิกรายคน (ข้อมูลครบทุกฟิลด์ ยกเว้นรหัสผ่าน)
export const getMemberDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const memberId = Number(req.params.id);
    if (isNaN(memberId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const member = await prisma.d1_Members.findUnique({
      where: { Member_ID: memberId },
      select: MEMBER_DETAIL_SELECT,
    });

    if (!member) {
      res.status(404).json({ message: "ไม่พบข้อมูลสมาชิก" });
      return;
    }

    const data = { ...member, Profile_Image: toImageProxyRef(member.Profile_Image) };

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [PATCH] API: ระงับ/เปิดใช้งานบัญชีสมาชิก (เฉพาะ Role='Member' - Admin/Master Admin ใช้หน้าจัดการ Admin แทน)
export const suspendMember = async (req: Request, res: Response): Promise<void> => {
  try {
    const memberId = Number(req.params.id);
    if (isNaN(memberId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const target = await prisma.d1_Members.findUnique({ where: { Member_ID: memberId } });
    if (!target) {
      res.status(404).json({ message: "ไม่พบข้อมูลสมาชิก" });
      return;
    }

    if (target.User_Role !== 'Member') {
      res.status(400).json({ message: "บัญชีนี้เป็น Admin กรุณาใช้หน้าจัดการ Admin แทน" });
      return;
    }

    const { accountStatus } = req.body; // 'Active' | 'Suspended'
    const updated = await prisma.d1_Members.update({
      where: { Member_ID: memberId },
      data: { Account_Status: accountStatus === 'Suspended' ? 'Suspended' : 'Active' },
      select: MEMBER_SAFE_SELECT,
    });

    res.status(200).json({ message: "อัปเดตสถานะสมาชิกสำเร็จ", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ" });
  }
};

// ---------------------------------------------------------
// จัดการเจ้าของหอพัก (D2_Owners)
// ---------------------------------------------------------

// [GET] API: รายชื่อเจ้าของหอพัก - ค้นหาด้วย Username/Email และฟิวเตอร์ตามสถานะคำร้องได้
// (default Status=Pending ถ้าไม่ระบุ query มา ตรงกับ requirement ของหน้า "เจ้าของหอพักทั้งหมด")
export const listOwners = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, status } = req.query;

    const where: Prisma.D2_OwnersWhereInput = {};

    if (search && typeof search === 'string' && search.trim()) {
      where.OR = [
        { Username: { contains: search.trim() } },
        { Email: { contains: search.trim() } },
      ];
    }

    const statusFilter = typeof status === 'string' ? status : 'Pending';
    if (statusFilter !== 'All') {
      where.Status = statusFilter;
    }

    const pagination = parsePagination(req);

    const [owners, total] = await Promise.all([
      prisma.d2_Owners.findMany({
        where,
        orderBy: { Submitted_Date: 'desc' },
        select: OWNER_LIST_SELECT,
        ...(pagination && { skip: pagination.skip, take: pagination.take }),
      }),
      prisma.d2_Owners.count({ where }),
    ]);

    const data = owners.map((o) => ({ ...o, Profile_Image: toImageProxyRef(o.Profile_Image) }));

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data, meta: buildMeta(pagination, total) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [GET] API: รายละเอียดเจ้าของหอพักรายคน (ข้อมูลครบทุกฟิลด์ ยกเว้นรหัสผ่าน)
export const getOwnerDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = Number(req.params.id);
    if (isNaN(ownerId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const owner = await prisma.d2_Owners.findUnique({
      where: { Owner_ID: ownerId },
      select: OWNER_DETAIL_SELECT,
    });

    if (!owner) {
      res.status(404).json({ message: "ไม่พบข้อมูลเจ้าของหอพัก" });
      return;
    }

    const data = {
      ...owner,
      Profile_Image: toImageProxyRef(owner.Profile_Image),
      ID_Card_Image: toImageProxyRef(owner.ID_Card_Image),
    };

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [PATCH] API: แอดมินกดอนุมัติคำร้องขอเป็นเจ้าของหอพัก
export const approveOwnerVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = Number(req.params.id);
    if (isNaN(ownerId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const owner = await prisma.d2_Owners.findUnique({ where: { Owner_ID: ownerId } });
    if (!owner) {
      res.status(404).json({ message: "ไม่พบข้อมูลคำร้องขอเป็นเจ้าของหอพัก" });
      return;
    }

    const updatedOwner = await prisma.d2_Owners.update({
      where: { Owner_ID: ownerId },
      data: {
        Status: 'Approved',
        Approved_Date: new Date(),
      },
    });

    await createNotification({
      recipientType: 'Owner',
      recipientId: ownerId,
      type: 'Owner_Approved',
      title: 'บัญชีเจ้าของหอพักได้รับการอนุมัติแล้ว',
      body: 'คุณสามารถลงประกาศหอพักและห้องพักได้แล้วตอนนี้',
      link: '/owner-dashboard',
    });

    res.status(200).json({
      message: "อนุมัติคำร้องขอเป็นเจ้าของหอพักสำเร็จ",
      status: updatedOwner.Status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอนุมัติ" });
  }
};

// [PATCH] API: แอดมินกดปฏิเสธคำร้องขอเป็นเจ้าของหอพัก
export const rejectOwnerVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = Number(req.params.id);
    if (isNaN(ownerId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const { adminNote } = req.body;
    if (!adminNote || !String(adminNote).trim()) {
      res.status(400).json({ message: "กรุณาระบุเหตุผลที่ปฏิเสธ" });
      return;
    }

    const owner = await prisma.d2_Owners.findUnique({ where: { Owner_ID: ownerId } });
    if (!owner) {
      res.status(404).json({ message: "ไม่พบข้อมูลคำร้องขอเป็นเจ้าของหอพัก" });
      return;
    }

    const updatedOwner = await prisma.d2_Owners.update({
      where: { Owner_ID: ownerId },
      data: {
        Status: 'Rejected',
        Admin_Note: adminNote,
      },
    });

    await createNotification({
      recipientType: 'Owner',
      recipientId: ownerId,
      type: 'Owner_Rejected',
      title: 'คำร้องขอเป็นเจ้าของหอพักถูกปฏิเสธ',
      body: adminNote,
      link: '/owner-dashboard',
    });

    res.status(200).json({
      message: "ปฏิเสธคำร้องขอเป็นเจ้าของหอพักแล้ว",
      status: updatedOwner.Status,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการปฏิเสธคำร้อง" });
  }
};

// [PATCH] API: ระงับ/เปิดใช้งานบัญชีเจ้าของหอพัก (แยกจากสถานะคำร้อง Status)
export const suspendOwner = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = Number(req.params.id);
    if (isNaN(ownerId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const owner = await prisma.d2_Owners.findUnique({ where: { Owner_ID: ownerId } });
    if (!owner) {
      res.status(404).json({ message: "ไม่พบข้อมูลเจ้าของหอพัก" });
      return;
    }

    const { accountStatus } = req.body; // 'Active' | 'Suspended'
    const updated = await prisma.d2_Owners.update({
      where: { Owner_ID: ownerId },
      data: { Account_Status: accountStatus === 'Suspended' ? 'Suspended' : 'Active' },
      select: OWNER_SAFE_SELECT,
    });

    res.status(200).json({ message: "อัปเดตสถานะบัญชีสำเร็จ", data: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ" });
  }
};

// ---------------------------------------------------------
// จัดการหอพัก (D3_Dormitories.Approval_Status)
// ---------------------------------------------------------

// [GET] API: รายชื่อหอพักทั้งหมด - ฟิวเตอร์ตามสถานะการอนุมัติได้ (default Pending)
export const listDormitories = async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, status } = req.query;

    const where: Prisma.D3_DormitoriesWhereInput = {};

    if (search && typeof search === 'string' && search.trim()) {
      where.Dorm_Name = { contains: search.trim() };
    }

    const statusFilter = typeof status === 'string' ? status : 'Pending';
    if (statusFilter !== 'All') {
      where.Approval_Status = statusFilter;
    }

    const pagination = parsePagination(req);

    const [dorms, total] = await Promise.all([
      prisma.d3_Dormitories.findMany({
        where,
        orderBy: { Created_At: 'desc' },
        select: DORMITORY_LIST_SELECT,
        ...(pagination && { skip: pagination.skip, take: pagination.take }),
      }),
      prisma.d3_Dormitories.count({ where }),
    ]);

    const data = dorms.map((d) => ({
      ...d,
      Dorm_Images: toImageProxyRefListJson(d.Dorm_Images),
    }));

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data, meta: buildMeta(pagination, total) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [GET] API: รายละเอียดหอพักรายหลัง (ข้อมูลครบทุกฟิลด์ + สิ่งอำนวยความสะดวก + ประเภทห้องพัก)
export const getDormitoryDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const dormId = Number(req.params.id);
    if (isNaN(dormId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const dorm = await prisma.d3_Dormitories.findUnique({
      where: { Dorm_ID: dormId },
      select: DORMITORY_DETAIL_SELECT,
    });

    if (!dorm) {
      res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
      return;
    }

    const data = {
      ...dorm,
      Dorm_Images: toImageProxyRefListJson(dorm.Dorm_Images),
      Ownership_Proof_Image: toImageProxyRef(dorm.Ownership_Proof_Image),
    };

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [PATCH] API: แอดมินกดอนุมัติหอพัก
export const approveDormitory = async (req: Request, res: Response): Promise<void> => {
  try {
    const dormId = Number(req.params.id);
    if (isNaN(dormId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const dorm = await prisma.d3_Dormitories.findUnique({ where: { Dorm_ID: dormId } });
    if (!dorm) {
      res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
      return;
    }

    const updated = await prisma.d3_Dormitories.update({
      where: { Dorm_ID: dormId },
      data: { Approval_Status: 'Approved', Admin_Note: null },
    });

    if (dorm.Owner_ID) {
      await createNotification({
        recipientType: 'Owner',
        recipientId: dorm.Owner_ID,
        type: 'Dorm_Approved',
        title: 'หอพักของคุณได้รับการอนุมัติแล้ว',
        body: `หอพัก "${dorm.Dorm_Name}" พร้อมแสดงให้ผู้เช่าเห็นแล้ว`,
        link: `/dorm/${dormId}`,
      });
    }

    res.status(200).json({ message: "อนุมัติหอพักสำเร็จ", data: { status: updated.Approval_Status } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอนุมัติ" });
  }
};

// [PATCH] API: แอดมินกดปฏิเสธหอพัก (ต้องระบุเหตุผล)
export const rejectDormitory = async (req: Request, res: Response): Promise<void> => {
  try {
    const dormId = Number(req.params.id);
    if (isNaN(dormId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const { adminNote } = req.body;
    if (!adminNote || !String(adminNote).trim()) {
      res.status(400).json({ message: "กรุณาระบุเหตุผลที่ปฏิเสธ" });
      return;
    }

    const dorm = await prisma.d3_Dormitories.findUnique({ where: { Dorm_ID: dormId } });
    if (!dorm) {
      res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
      return;
    }

    const updated = await prisma.d3_Dormitories.update({
      where: { Dorm_ID: dormId },
      data: { Approval_Status: 'Rejected', Admin_Note: adminNote },
    });

    if (dorm.Owner_ID) {
      await createNotification({
        recipientType: 'Owner',
        recipientId: dorm.Owner_ID,
        type: 'Dorm_Rejected',
        title: 'หอพักของคุณถูกปฏิเสธ',
        body: `หอพัก "${dorm.Dorm_Name}": ${adminNote}`,
        link: `/dorm/${dormId}`,
      });
    }

    res.status(200).json({ message: "ปฏิเสธหอพักแล้ว", data: { status: updated.Approval_Status } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการปฏิเสธ" });
  }
};

// ---------------------------------------------------------
// รายงานผู้ใช้ (D10_User_Reports) - ดูอย่างเดียว + ฟิวเตอร์ Status
// ---------------------------------------------------------

const REPORT_INCLUDE = {
  Reported_User: { select: { Member_ID: true, Username: true, Email: true } },
  Booking: {
    select: {
      Booking_ID: true,
      Dorm: { select: { Dorm_Name: true } },
      Room_Type: { select: { Room_Type_Name: true } },
    },
  },
} as const;

// 🚀 Reporter_Type/Reporter_ID เป็น polymorphic field ธรรมดา (ไม่ใช่ Prisma relation) เพราะ
// ผู้รายงานอาจเป็น Owner (ตอนนี้มีแค่กรณีนี้) ซึ่งอยู่คนละตารางกับ Member — ต้องมา resolve
// ชื่อ/อีเมลเองแยกเป็นอีก query แทนที่จะ include ตรงๆ แบบ Member relation เดิม
const attachReporters = async <T extends { Reporter_Type: string | null; Reporter_ID: number | null }>(
  reports: T[]
): Promise<(T & { Reporter: { Owner_ID: number; Username: string; Email: string } | null })[]> => {
  const ownerIds = [...new Set(
    reports.filter((r) => r.Reporter_Type === 'Owner' && r.Reporter_ID != null).map((r) => r.Reporter_ID as number)
  )];

  const owners = ownerIds.length
    ? await prisma.d2_Owners.findMany({
        where: { Owner_ID: { in: ownerIds } },
        select: { Owner_ID: true, Username: true, Email: true },
      })
    : [];
  const ownerMap = new Map(owners.map((o) => [o.Owner_ID, o]));

  return reports.map((r) => ({
    ...r,
    Reporter: r.Reporter_Type === 'Owner' && r.Reporter_ID != null ? ownerMap.get(r.Reporter_ID) ?? null : null,
  }));
};

// [GET] API: รายการรายงานผู้ใช้ทั้งหมด - ฟิวเตอร์ตามสถานะได้
export const listReports = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.query;

    const where: Prisma.D10_User_ReportsWhereInput = {};
    if (status && typeof status === 'string' && status !== 'All') {
      where.Status = status;
    }

    const pagination = parsePagination(req);

    const [reports, total] = await Promise.all([
      prisma.d10_User_Reports.findMany({
        where,
        orderBy: { Reported_At: 'desc' },
        include: REPORT_INCLUDE,
        ...(pagination && { skip: pagination.skip, take: pagination.take }),
      }),
      prisma.d10_User_Reports.count({ where }),
    ]);

    const data = await attachReporters(reports);

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data, meta: buildMeta(pagination, total) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [GET] API: รายละเอียดรายงานผู้ใช้รายการเดียว
export const getReportDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const reportId = Number(req.params.id);
    if (isNaN(reportId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const report = await prisma.d10_User_Reports.findUnique({
      where: { Report_ID: reportId },
      include: REPORT_INCLUDE,
    });

    if (!report) {
      res.status(404).json({ message: "ไม่พบข้อมูลรายงาน" });
      return;
    }

    const [data] = await attachReporters([report]);

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [PATCH] API: ปิดเรื่อง/เปิดเรื่องใหม่สำหรับรายงานผู้ใช้ — ตั้ง Closed_At ให้สอดคล้องกับสถานะ
export const updateReportStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const reportId = Number(req.params.id);
    const { status } = req.body;

    if (isNaN(reportId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }
    if (status !== 'Pending' && status !== 'Resolved') {
      res.status(400).json({ message: "สถานะไม่ถูกต้อง (ต้องเป็น Pending หรือ Resolved)" });
      return;
    }

    const report = await prisma.d10_User_Reports.findUnique({ where: { Report_ID: reportId } });
    if (!report) {
      res.status(404).json({ message: "ไม่พบข้อมูลรายงาน" });
      return;
    }

    const updated = await prisma.d10_User_Reports.update({
      where: { Report_ID: reportId },
      data: {
        Status: status,
        Closed_At: status === 'Resolved' ? new Date() : null,
      },
    });

    res.status(200).json({
      message: status === 'Resolved' ? "ปิดเรื่องสำเร็จ" : "เปิดเรื่องใหม่สำเร็จ",
      data: updated,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ" });
  }
};

// ---------------------------------------------------------
// จัดการบัญชี Admin (เฉพาะ Master Admin เท่านั้น - คุมสิทธิ์ที่ระดับ route)
// ---------------------------------------------------------

// [GET] API: รายชื่อ Admin ทั้งหมด (ไม่รวม Member ทั่วไป)
export const listAdmins = async (req: Request, res: Response): Promise<void> => {
  try {
    const admins = await prisma.d1_Members.findMany({
      where: { User_Role: { in: ['Admin', 'Master_Admin'] } },
      orderBy: { Created_At: 'asc' },
      select: ADMIN_SAFE_SELECT,
    });

    const data = admins.map((a) => ({ ...a, Profile_Image: toImageProxyRef(a.Profile_Image) }));

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [GET] API: รายละเอียด Admin คนเดียว (สำหรับหน้าดูโปรไฟล์)
export const getAdminDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = Number(req.params.id);
    if (isNaN(adminId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const admin = await prisma.d1_Members.findUnique({
      where: { Member_ID: adminId },
      select: ADMIN_SAFE_SELECT,
    });

    if (!admin || !['Admin', 'Master_Admin'].includes(admin.User_Role)) {
      res.status(404).json({ message: "ไม่พบบัญชี Admin นี้" });
      return;
    }

    res.status(200).json({
      message: "ดึงข้อมูลสำเร็จ",
      data: { ...admin, Profile_Image: toImageProxyRef(admin.Profile_Image) },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [POST] API: Master Admin เพิ่ม Admin ใหม่
// 🚀 ตั้งใจไม่รับค่า role จาก client - สร้างได้แค่ 'Admin' เท่านั้น ป้องกันไม่ให้ผ่าน API
// นี้เพิ่มบัญชี Master Admin คนใหม่ได้ตามใจชอบ (ต้องมาจาก seed script เท่านั้น)
export const createAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password, firstName, lastName } = req.body;

    if (!username || !email || !password) {
      res.status(400).json({ message: "กรุณากรอกชื่อผู้ใช้ อีเมล และรหัสผ่าน" });
      return;
    }

    const existing = await prisma.d1_Members.findFirst({
      where: { OR: [{ Email: email }, { Username: username }] }
    });
    if (existing) {
      res.status(400).json({ message: "อีเมลหรือชื่อผู้ใช้นี้ถูกใช้งานแล้ว" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = await prisma.d1_Members.create({
      data: {
        Username: username,
        Email: email,
        Password: hashedPassword,
        First_Name: firstName || null,
        Last_Name: lastName || null,
        User_Role: 'Admin',
        Is_Profile_Completed: true,
      },
      select: ADMIN_SAFE_SELECT,
    });

    res.status(201).json({
      message: "เพิ่ม Admin สำเร็จ",
      data: { ...newAdmin, Profile_Image: toImageProxyRef(newAdmin.Profile_Image) },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการเพิ่ม Admin" });
  }
};

// [PATCH] API: ระงับ/เปิดใช้งานบัญชี Admin (ห้ามแก้บัญชีตัวเอง หรือบัญชี Master Admin คนอื่น)
export const updateAdminStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = Number(req.params.id);
    if (isNaN(adminId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    if (req.user?.id === adminId) {
      res.status(400).json({ message: "ไม่สามารถแก้ไขบัญชีของตัวเองผ่านช่องทางนี้ได้" });
      return;
    }

    const target = await prisma.d1_Members.findUnique({ where: { Member_ID: adminId } });
    if (!target || !['Admin', 'Master_Admin'].includes(target.User_Role)) {
      res.status(404).json({ message: "ไม่พบบัญชี Admin นี้" });
      return;
    }

    if (target.User_Role === 'Master_Admin') {
      res.status(403).json({ message: "ไม่สามารถแก้ไขบัญชี Master Admin ได้" });
      return;
    }

    const { accountStatus } = req.body; // 'Active' | 'Suspended'
    const updated = await prisma.d1_Members.update({
      where: { Member_ID: adminId },
      data: { Account_Status: accountStatus === 'Suspended' ? 'Suspended' : 'Active' },
      select: ADMIN_SAFE_SELECT,
    });

    res.status(200).json({
      message: "อัปเดตสถานะ Admin สำเร็จ",
      data: { ...updated, Profile_Image: toImageProxyRef(updated.Profile_Image) },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะ" });
  }
};

// 🚀 จัดการ Master Facilities (D5) — รายการสิ่งอำนวยความสะดวกกลางที่เจ้าของหอพักเลือกติ๊กใช้
// ตอนลงข้อมูลหอพัก/ห้องพัก (ดู dorm.controller.ts: getDormFacilities / getRoomFacilities ที่
// อ่านจากตารางเดียวกันนี้) — หน้านี้ให้ Admin เพิ่ม/ลบรายการกลางได้ทั้งสองประเภท

// [GET] API: รายการสิ่งอำนวยความสะดวกทั้งหมด (ทั้งของหอพักและห้องพัก)
export const listFacilities = async (req: Request, res: Response): Promise<void> => {
  try {
    const facilities = await prisma.d5_Facilities.findMany({
      orderBy: [{ Facility_Type: 'asc' }, { Facility_Name: 'asc' }],
    });

    res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data: facilities });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// [POST] API: เพิ่มสิ่งอำนวยความสะดวกใหม่
export const createFacility = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, type } = req.body;
    const facilityName = typeof name === 'string' ? name.trim() : '';

    if (!facilityName) {
      res.status(400).json({ message: "กรุณากรอกชื่อสิ่งอำนวยความสะดวก" });
      return;
    }
    if (type !== 'Dormitory' && type !== 'Room') {
      res.status(400).json({ message: "ประเภทต้องเป็น 'Dormitory' หรือ 'Room' เท่านั้น" });
      return;
    }

    const existing = await prisma.d5_Facilities.findFirst({
      where: { Facility_Name: facilityName, Facility_Type: type },
    });
    if (existing) {
      res.status(400).json({ message: "มีสิ่งอำนวยความสะดวกนี้อยู่แล้ว" });
      return;
    }

    const facility = await prisma.d5_Facilities.create({
      data: { Facility_Name: facilityName, Facility_Type: type },
    });

    res.status(201).json({ message: "เพิ่มสิ่งอำนวยความสะดวกสำเร็จ", data: facility });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการเพิ่มสิ่งอำนวยความสะดวก" });
  }
};

// [DELETE] API: ลบสิ่งอำนวยความสะดวก — ลบแล้วจะหลุดออกจากหอพัก/ห้องพักที่เคยติ๊กเลือกไว้ด้วย
// โดยอัตโนมัติ (ความสัมพันธ์ many-to-many ของ Prisma) ไม่กระทบข้อมูลฟิลด์อื่นของหอพัก/ห้องพักนั้น
export const deleteFacility = async (req: Request, res: Response): Promise<void> => {
  try {
    const facilityId = Number(req.params.id);
    if (isNaN(facilityId)) {
      res.status(400).json({ message: "ID ไม่ถูกต้อง" });
      return;
    }

    const existing = await prisma.d5_Facilities.findUnique({
      where: { Facility_ID: facilityId },
    });
    if (!existing) {
      res.status(404).json({ message: "ไม่พบสิ่งอำนวยความสะดวกนี้" });
      return;
    }

    await prisma.d5_Facilities.delete({ where: { Facility_ID: facilityId } });

    res.status(200).json({ message: "ลบสิ่งอำนวยความสะดวกสำเร็จ", data: { Facility_ID: facilityId } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบสิ่งอำนวยความสะดวก" });
  }
};
