// 📄 ไฟล์นี้ทำหน้าที่: controller ของระบบสมัคร/เข้าสู่ระบบและโปรไฟล์ผู้ใช้ — สมัครสมาชิก/เจ้าของหอพัก
// ล็อกอิน (ปกติ + Google) ดู/แก้ไขโปรไฟล์ อัปโหลดรูป ลืม/เปลี่ยนรหัสผ่าน และออก Firebase Token สำหรับแชท
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { BrevoClient } from '@getbrevo/brevo';
import type {} from 'multer';
import { JWT_SECRET } from '../config/jwt';
import { BACKEND_PUBLIC_URL, BREVO_API_KEY, BREVO_SENDER_EMAIL } from '../config/env';
import { getFirebaseAuth, getStorageBucket, isFirebaseAdminConfigured } from '../config/firebase-admin';
import { sanitizeImageInput, toImageProxyRef } from '../utils/image-proxy';

const brevo = new BrevoClient({ apiKey: BREVO_API_KEY });

// 🚀 สร้าง Username อัตโนมัติจากส่วนหน้าอีเมล (ก่อน @) ถ้าซ้ำจะต่อเลขท้ายให้จนกว่าจะไม่ซ้ำ
async function generateUniqueUsername(
  email: string,
  isTaken: (username: string) => Promise<boolean>
): Promise<string> {
  const base =
    email.split('@')[0].replace(/[^a-zA-Z0-9_.]/g, '') ||
    `user_${Date.now().toString().slice(-6)}`;
  let candidate = base;
  let suffix = 0;
  while (await isTaken(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

// ข้อความแจ้งสถานะคำร้องขอเป็นเจ้าของหอพัก (ใช้ตอนเจ้าของหอพักพยายามเข้าสู่ระบบ)
function ownerStatusMessage(status: string, adminNote?: string | null): string {
  if (status === 'Rejected') {
    return adminNote
      ? `คำร้องขอเป็นเจ้าของหอพักของคุณถูกปฏิเสธ: ${adminNote}`
      : 'คำร้องขอเป็นเจ้าของหอพักของคุณถูกปฏิเสธ กรุณาติดต่อแอดมิน';
  }
  return 'บัญชีเจ้าของหอพักของคุณกำลังรอแอดมินตรวจสอบ กรุณารอการอนุมัติก่อนเข้าสู่ระบบ';
}

// [POST] API: สมัครสมาชิก (Member) หรือ ยื่นคำร้องเป็นเจ้าของหอพัก (Owner)
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      username,
      email,
      password,
      firstName,
      lastName,
      nickname,
      phone,
      gender,
      birthdate,
      userRole,
      idCardNo,
      profileImage,
      idCardImage
    } = req.body;

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // ---------- สมัครเป็นเจ้าของหอพัก (D2_Owners) ----------
    if (userRole === 'Owner') {
      if (!idCardNo || !idCardImage) {
        res.status(400).json({ message: "กรุณากรอกเลขบัตรประชาชนและอัปโหลดรูปบัตรประชาชน" });
        return;
      }

      const existingOwner = await prisma.d2_Owners.findFirst({
        where: { OR: [{ Email: email }, { Username: username }] }
      });
      if (existingOwner) {
        res.status(400).json({ message: "อีเมลหรือชื่อผู้ใช้นี้ถูกใช้งานแล้ว" });
        return;
      }

      const newOwner = await prisma.d2_Owners.create({
        data: {
          Username: username,
          Email: email,
          Password: hashedPassword,
          First_Name: firstName,
          Last_Name: lastName,
          Phone: phone,
          Profile_Image: sanitizeImageInput(profileImage),
          ID_Card_No: idCardNo,
          ID_Card_Image: sanitizeImageInput(idCardImage),
          Status: "Pending",
        }
      });

      const { Password, ...ownerWithoutPassword } = newOwner;

      res.status(201).json({
        message: "ส่งคำร้องขอเป็นเจ้าของหอพักสำเร็จ กรุณารอแอดมินตรวจสอบ",
        data: ownerWithoutPassword
      });
      return;
    }

    // ---------- สมัครสมาชิกทั่วไป (D1_Members) ----------
    const existingUser = await prisma.d1_Members.findFirst({
      where: {
        OR: [
          { Email: email },
          { Username: username }
        ]
      }
    });

    if (existingUser) {
      res.status(400).json({ message: "อีเมลหรือชื่อผู้ใช้นี้ถูกใช้งานแล้ว" });
      return;
    }

    const newUser = await prisma.d1_Members.create({
      data: {
        Username: username,
        Email: email,
        Password: hashedPassword,
        First_Name: firstName,
        Last_Name: lastName,
        Nickname: nickname,
        Phone: phone,
        Gender: gender,
        Birthdate: birthdate ? new Date(birthdate) : null,
        User_Role: 'Member',
        Profile_Image: sanitizeImageInput(profileImage),
        Is_Profile_Completed: true,
      }
    });

    const { Password, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: "สมัครสมาชิกสำเร็จ",
      data: userWithoutPassword
    });

  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการสมัครสมาชิก" });
  }
};

// [POST] API: เข้าสู่ระบบ (Login) - เช็คทั้งตาราง Member และ Owner
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const member = await prisma.d1_Members.findUnique({ where: { Email: email } });
    if (member) {
      const isPasswordValid = await bcrypt.compare(password, member.Password);
      if (!isPasswordValid) {
        res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
        return;
      }

      if (member.Account_Status === 'Suspended') {
        res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อแอดมิน" });
        return;
      }

      const token = jwt.sign(
        { id: member.Member_ID, role: member.User_Role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(200).json({
        message: "เข้าสู่ระบบสำเร็จ",
        token,
        user: {
          Member_ID: member.Member_ID,
          email: member.Email,
          role: member.User_Role,
          username: member.Username
        }
      });
      return;
    }

    const owner = await prisma.d2_Owners.findUnique({ where: { Email: email } });
    if (owner) {
      const isPasswordValid = await bcrypt.compare(password, owner.Password);
      if (!isPasswordValid) {
        res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
        return;
      }

      if (owner.Account_Status === 'Suspended') {
        res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อแอดมิน" });
        return;
      }

      // 🚀 เจ้าของหอพักต้องรอแอดมินอนุมัติคำร้องก่อนถึงจะเข้าสู่ระบบได้
      if (owner.Status !== 'Approved') {
        res.status(403).json({
          message: ownerStatusMessage(owner.Status, owner.Admin_Note),
          status: owner.Status,
        });
        return;
      }

      const token = jwt.sign(
        { id: owner.Owner_ID, role: 'Owner' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(200).json({
        message: "เข้าสู่ระบบสำเร็จ",
        token,
        user: {
          Member_ID: owner.Owner_ID,
          email: owner.Email,
          role: 'Owner',
          username: owner.Username,
          status: owner.Status,
        }
      });
      return;
    }

    res.status(404).json({ message: "ไม่พบผู้ใช้งานนี้" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์" });
  }
};

// 🚀 ฟังก์ชันสำหรับ Google Login (เช็คทั้ง Member และ Owner)
// ผู้ใช้ใหม่เอี่ยม (ไม่เคยมีบัญชีในตารางไหนเลย) จะยังไม่ถูกสร้างแถวใน DB ทันที
// แต่จะส่งข้อมูลจาก Google กลับไปให้กรอกโปรไฟล์ให้ครบก่อนที่หน้า complete-profile
// แล้วค่อยสร้างบัญชีจริงใน completeProfile() (เพราะตอนนี้ยังไม่รู้ว่าจะเป็น Member หรือ Owner)
export const googleLogin = async (req: Request, res: Response) => {
  try {
    const { email, googleId, photoUrl } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'ไม่พบข้อมูลอีเมลจาก Google' });
    }

    // 1. เช็คฝั่ง Member ก่อน
    let member = await prisma.d1_Members.findUnique({ where: { Email: email } });
    if (member) {
      if (member.Account_Status === 'Suspended') {
        res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อแอดมิน" });
        return;
      }

      if (!member.Google_ID) {
        member = await prisma.d1_Members.update({
          where: { Email: email },
          data: {
            Google_ID: googleId,
            Profile_Image: member.Profile_Image || sanitizeImageInput(photoUrl),
          },
        });
      }

      const token = jwt.sign(
        { id: member.Member_ID, email: member.Email, role: member.User_Role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(200).json({
        message: 'เข้าสู่ระบบด้วย Google สำเร็จ',
        token,
        isNewUser: false,
        user: {
          Member_ID: member.Member_ID,
          email: member.Email,
          username: member.Username,
          role: member.User_Role,
          Is_Profile_Completed: member.Is_Profile_Completed,
        },
      });
      return;
    }

    // 2. เช็คฝั่ง Owner
    let owner = await prisma.d2_Owners.findUnique({ where: { Email: email } });
    if (owner) {
      if (owner.Account_Status === 'Suspended') {
        res.status(403).json({ message: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อแอดมิน" });
        return;
      }

      if (!owner.Google_ID) {
        owner = await prisma.d2_Owners.update({
          where: { Email: email },
          data: {
            Google_ID: googleId,
            Profile_Image: owner.Profile_Image || sanitizeImageInput(photoUrl),
          },
        });
      }

      // 🚀 เจ้าของหอพักต้องรอแอดมินอนุมัติคำร้องก่อนถึงจะเข้าสู่ระบบได้
      if (owner.Status !== 'Approved') {
        res.status(403).json({
          message: ownerStatusMessage(owner.Status, owner.Admin_Note),
          status: owner.Status,
        });
        return;
      }

      const token = jwt.sign(
        { id: owner.Owner_ID, email: owner.Email, role: 'Owner' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(200).json({
        message: 'เข้าสู่ระบบด้วย Google สำเร็จ',
        token,
        isNewUser: false,
        user: {
          Member_ID: owner.Owner_ID,
          email: owner.Email,
          username: owner.Username,
          role: 'Owner',
          Is_Profile_Completed: true, // Owner ไม่มีสถานะโปรไฟล์ไม่ครบ เพราะสร้างพร้อมข้อมูลครบตั้งแต่แรก
          status: owner.Status,
        },
      });
      return;
    }

    // 3. ผู้ใช้ใหม่เอี่ยม -> ยังไม่สร้างแถวใน DB จนกว่าจะรู้ว่าจะเป็น Member หรือ Owner
    res.status(200).json({
      message: 'ยังไม่เคยมีบัญชี กรุณากรอกข้อมูลให้ครบก่อนใช้งาน',
      isNewUser: true,
      googleProfile: { email, googleId, photoUrl: photoUrl || '' },
    });

  } catch (error) {
    console.error('Google Login Error:', error);
    res.status(500).json({ message: 'ระบบขัดข้อง ไม่สามารถเข้าสู่ระบบด้วย Google ได้' });
  }
};

// 🚀 ฟังก์ชันสำหรับกรอกข้อมูลให้ครบหลังล็อกอินด้วย Google ครั้งแรก
// รองรับ 2 กรณี:
//   (a) memberId ถูกส่งมา -> อัปเดตบัญชี Member เดิมที่ยังกรอกข้อมูลไม่ครบ (ของเก่าก่อนแยกตาราง)
//   (b) ไม่มี memberId แต่มี email/googleId -> สร้างบัญชีใหม่ตาม userRole ที่เลือก (Member หรือ Owner)
export const completeProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      memberId,
      email,
      googleId,
      photoUrl,
      username,
      firstName,
      lastName,
      nickname,
      phone,
      gender,
      birthdate,
      userRole,
      idCardNo,
      idCardImage,
    } = req.body;

    // ---------- กรณี (b): สร้างบัญชีใหม่ (ไม่มี memberId) ----------
    if (!memberId) {
      if (!email) {
        res.status(400).json({ message: "ไม่พบข้อมูลอีเมลจาก Google กรุณาเข้าสู่ระบบใหม่" });
        return;
      }

      const dummyPassword = await bcrypt.hash(`google_${googleId}_${Date.now()}`, 10);

      if (userRole === 'Owner') {
        if (!idCardNo || !idCardImage) {
          res.status(400).json({ message: "กรุณากรอกเลขบัตรประชาชนและอัปโหลดรูปบัตรประชาชน" });
          return;
        }

        const finalUsername = username
          ? username
          : await generateUniqueUsername(email, async (u) => {
              const taken = await prisma.d2_Owners.findUnique({ where: { Username: u } });
              return !!taken;
            });

        const newOwner = await prisma.d2_Owners.create({
          data: {
            Email: email,
            Google_ID: googleId,
            Username: finalUsername,
            Password: dummyPassword,
            First_Name: firstName,
            Last_Name: lastName,
            Phone: phone,
            Profile_Image: sanitizeImageInput(photoUrl),
            ID_Card_No: idCardNo,
            ID_Card_Image: sanitizeImageInput(idCardImage),
            Status: "Pending",
          },
        });

        // 🚀 ไม่ออก Token ให้ตอนนี้ เพราะ Owner ใหม่ยังเป็นสถานะ Pending
        // ต้องรอแอดมินอนุมัติก่อนถึงจะเข้าสู่ระบบได้ (ล็อกอินซ้ำอีกทีทีหลัง)
        res.status(201).json({
          message: "ส่งคำร้องขอเป็นเจ้าของหอพักสำเร็จ กรุณารอแอดมินตรวจสอบก่อนเข้าสู่ระบบ",
          user: {
            Member_ID: newOwner.Owner_ID,
            email: newOwner.Email,
            username: newOwner.Username,
            role: 'Owner',
            Is_Profile_Completed: true,
            status: newOwner.Status,
          },
        });
        return;
      }

      // Member ผ่าน Google
      const finalUsername = username
        ? username
        : await generateUniqueUsername(email, async (u) => {
            const taken = await prisma.d1_Members.findUnique({ where: { Username: u } });
            return !!taken;
          });

      const newMember = await prisma.d1_Members.create({
        data: {
          Email: email,
          Google_ID: googleId,
          Username: finalUsername,
          Password: dummyPassword,
          First_Name: firstName,
          Last_Name: lastName,
          Nickname: nickname,
          Phone: phone,
          Gender: gender,
          Birthdate: birthdate ? new Date(birthdate) : null,
          Profile_Image: sanitizeImageInput(photoUrl),
          User_Role: 'Member',
          Is_Profile_Completed: true,
        },
      });

      const token = jwt.sign(
        { id: newMember.Member_ID, email: newMember.Email, role: newMember.User_Role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        message: "บันทึกข้อมูลสำเร็จ",
        token,
        user: {
          Member_ID: newMember.Member_ID,
          email: newMember.Email,
          username: newMember.Username,
          role: newMember.User_Role,
          Is_Profile_Completed: true,
        },
      });
      return;
    }

    // ---------- กรณี (a): อัปเดตบัญชี Member เดิมที่ยังกรอกข้อมูลไม่ครบ ----------
    const id = Number(memberId);
    if (!id || isNaN(id)) {
      res.status(400).json({ message: "ไม่พบข้อมูลผู้ใช้" });
      return;
    }

    const existingUser = await prisma.d1_Members.findUnique({ where: { Member_ID: id } });
    if (!existingUser) {
      res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้งาน" });
      return;
    }

    if (userRole === 'Owner') {
      res.status(400).json({
        message: "ไม่สามารถเปลี่ยนบัญชีนี้เป็นเจ้าของหอพักได้ กรุณาออกจากระบบแล้วสมัครเป็นเจ้าของหอพักใหม่อีกครั้ง"
      });
      return;
    }

    if (username && username !== existingUser.Username) {
      const usernameTaken = await prisma.d1_Members.findFirst({
        where: { Username: username, NOT: { Member_ID: id } },
      });
      if (usernameTaken) {
        res.status(400).json({ message: "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว" });
        return;
      }
    }

    if (phone && phone !== existingUser.Phone) {
      const phoneTaken = await prisma.d1_Members.findFirst({
        where: { Phone: phone, NOT: { Member_ID: id } },
      });
      if (phoneTaken) {
        res.status(400).json({ message: "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว" });
        return;
      }
    }

    const updatedUser = await prisma.d1_Members.update({
      where: { Member_ID: id },
      data: {
        ...(username && { Username: username }),
        First_Name: firstName,
        Last_Name: lastName,
        Nickname: nickname,
        Phone: phone,
        Gender: gender,
        Birthdate: birthdate ? new Date(birthdate) : undefined,
        Is_Profile_Completed: true,
      },
    });

    res.status(200).json({
      message: "อัปเดตข้อมูลโปรไฟล์สำเร็จ",
      user: {
        Member_ID: updatedUser.Member_ID,
        email: updatedUser.Email,
        username: updatedUser.Username,
        role: updatedUser.User_Role,
        Is_Profile_Completed: updatedUser.Is_Profile_Completed,
      },
    });
  } catch (error) {
    console.error("Complete Profile Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตโปรไฟล์" });
  }
};

export const getMemberProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const memberId = Number(req.params.id);

    if (isNaN(memberId)) {
      res.status(400).json({ message: "ID ผู้ใช้ไม่ถูกต้อง" });
      return;
    }

    if (req.user!.id !== memberId) {
      res.status(403).json({ message: "คุณไม่มีสิทธิ์ดูข้อมูลนี้" });
      return;
    }

    const member = await prisma.d1_Members.findUnique({
      where: { Member_ID: memberId },
      select: {
        Member_ID: true,
        First_Name: true,
        Last_Name: true,
        Nickname: true,
        Birthdate: true,
        Email: true,
        Phone: true,
        User_Role: true,
        Gender: true,
        Profile_Image: true, // ถ้ามีฟิลด์รูปภาพ
        // ❌ ไม่ใส่ Password ในนี้เด็ดขาด
      }
    });

    if (!member) {
      res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้งานระบบ" });
      return;
    }

    res.status(200).json({
      message: "ดึงข้อมูลโปรไฟล์สำเร็จ",
      data: { ...member, Profile_Image: toImageProxyRef(member.Profile_Image) },
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลโปรไฟล์" });
  }
};

// 🚀 โปรไฟล์ของเจ้าของหอพัก (D2_Owners แยกตารางจาก Member)
export const getOwnerProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = Number(req.params.id);

    if (isNaN(ownerId)) {
      res.status(400).json({ message: "ID ผู้ใช้ไม่ถูกต้อง" });
      return;
    }

    // 🚀 ดูได้เฉพาะโปรไฟล์ของตัวเอง (กัน enumerate ID ดึงอีเมล/เบอร์โทรคนอื่น)
    if (req.user!.id !== ownerId) {
      res.status(403).json({ message: "คุณไม่มีสิทธิ์ดูข้อมูลนี้" });
      return;
    }

    const owner = await prisma.d2_Owners.findUnique({
      where: { Owner_ID: ownerId },
      select: {
        Owner_ID: true,
        First_Name: true,
        Last_Name: true,
        Email: true,
        Phone: true,
        Profile_Image: true,
        Status: true,
        Admin_Note: true,
        Submitted_Date: true,
        Approved_Date: true,
        // ❌ ไม่ใส่ Password / ID_Card_No / ID_Card_Image ในนี้
      }
    });

    if (!owner) {
      res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้งานระบบ" });
      return;
    }

    res.status(200).json({
      message: "ดึงข้อมูลโปรไฟล์สำเร็จ",
      data: {
        ...owner,
        Profile_Image: toImageProxyRef(owner.Profile_Image),
        Member_ID: owner.Owner_ID,
        User_Role: 'Owner',
      },
    });
  } catch (error) {
    console.error("Error fetching owner profile:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลโปรไฟล์" });
  }
};

// 🚀 แก้ไขข้อมูลส่วนตัว (Member) — อ่านตัวตนจาก JWT เท่านั้น แก้ได้เฉพาะของตัวเอง
export const updateMemberProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const memberId = req.user!.id;
    const { firstName, lastName, nickname, phone, gender, birthdate, profileImage } = req.body;

    const existing = await prisma.d1_Members.findUnique({ where: { Member_ID: memberId } });
    if (!existing) {
      res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้งาน" });
      return;
    }

    if (phone && phone !== existing.Phone) {
      const phoneTaken = await prisma.d1_Members.findFirst({
        where: { Phone: phone, NOT: { Member_ID: memberId } },
      });
      if (phoneTaken) {
        res.status(400).json({ message: "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว" });
        return;
      }
    }

    const updated = await prisma.d1_Members.update({
      where: { Member_ID: memberId },
      data: {
        First_Name: firstName !== undefined ? firstName : undefined,
        Last_Name: lastName !== undefined ? lastName : undefined,
        Nickname: nickname !== undefined ? nickname : undefined,
        Phone: phone !== undefined ? phone : undefined,
        Gender: gender !== undefined ? gender : undefined,
        Birthdate: birthdate !== undefined ? (birthdate ? new Date(birthdate) : null) : undefined,
        Profile_Image: profileImage !== undefined ? sanitizeImageInput(profileImage) : undefined,
      },
      select: {
        Member_ID: true,
        First_Name: true,
        Last_Name: true,
        Nickname: true,
        Birthdate: true,
        Email: true,
        Phone: true,
        User_Role: true,
        Gender: true,
        Profile_Image: true,
      },
    });

    res.status(200).json({
      message: "แก้ไขข้อมูลส่วนตัวสำเร็จ",
      data: { ...updated, Profile_Image: toImageProxyRef(updated.Profile_Image) },
    });
  } catch (error) {
    console.error("Update Member Profile Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูลส่วนตัว" });
  }
};

const AVATAR_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// 🚀 อัปโหลดรูปโปรไฟล์ผ่าน backend (ไม่ให้ฝั่งเว็บ Admin ต้องมี Firebase client SDK เป็นของตัวเอง
// เหมือน Flutter) — รับไฟล์ผ่าน multer (memory storage) แล้วส่งต่อให้ Firebase Admin SDK เขียน
// ลง Storage ตรงๆ คืนแค่ storage path เปล่าๆ (ไม่มี token) ให้ไปใส่ในฟิลด์ profileImage ตอน
// เรียก PATCH /profile ต่อ — ใช้ sanitizeImageInput/toImageProxyRef ชุดเดิมได้ทันทีเพราะ path
// ขึ้นต้นด้วย "profiles/" ตรงตาม ALLOWED_IMAGE_PREFIXES อยู่แล้ว
export const uploadProfileAvatar = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ message: "ไม่พบไฟล์รูปภาพ" });
      return;
    }

    const ext = AVATAR_MIME_TO_EXT[file.mimetype];
    if (!ext) {
      res.status(400).json({ message: "รองรับเฉพาะไฟล์รูปภาพ JPEG, PNG หรือ WEBP เท่านั้น" });
      return;
    }

    if (!isFirebaseAdminConfigured()) {
      res.status(503).json({
        message: "ระบบอัปโหลดรูปภาพยังไม่ได้ตั้งค่า Firebase Admin SDK บน backend กรุณาติดต่อผู้ดูแลระบบ",
      });
      return;
    }

    const storagePath = `profiles/${req.user!.id}_${Date.now()}.${ext}`;
    const bucket = getStorageBucket();
    await bucket.file(storagePath).save(file.buffer, {
      metadata: { contentType: file.mimetype },
    });

    res.status(200).json({
      message: "อัปโหลดรูปโปรไฟล์สำเร็จ",
      data: { path: storagePath, previewUrl: toImageProxyRef(storagePath) },
    });
  } catch (error) {
    console.error("Upload Profile Avatar Error:", error);
    res.status(500).json({ message: "อัปโหลดรูปภาพไม่สำเร็จ" });
  }
};

// 🚀 แก้ไขข้อมูลส่วนตัว (Owner) — D2_Owners แยกตารางจาก Member จึงไม่มี Nickname/Gender/Birthdate
export const updateOwnerProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = req.user!.id;
    const { firstName, lastName, phone, profileImage } = req.body;

    const existing = await prisma.d2_Owners.findUnique({ where: { Owner_ID: ownerId } });
    if (!existing) {
      res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้งาน" });
      return;
    }

    if (phone && phone !== existing.Phone) {
      const phoneTaken = await prisma.d2_Owners.findFirst({
        where: { Phone: phone, NOT: { Owner_ID: ownerId } },
      });
      if (phoneTaken) {
        res.status(400).json({ message: "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว" });
        return;
      }
    }

    const updated = await prisma.d2_Owners.update({
      where: { Owner_ID: ownerId },
      data: {
        First_Name: firstName !== undefined ? firstName : undefined,
        Last_Name: lastName !== undefined ? lastName : undefined,
        Phone: phone !== undefined ? phone : undefined,
        Profile_Image: profileImage !== undefined ? sanitizeImageInput(profileImage) : undefined,
      },
      select: {
        Owner_ID: true,
        First_Name: true,
        Last_Name: true,
        Email: true,
        Phone: true,
        Profile_Image: true,
        Status: true,
      },
    });

    res.status(200).json({
      message: "แก้ไขข้อมูลส่วนตัวสำเร็จ",
      data: {
        ...updated,
        Profile_Image: toImageProxyRef(updated.Profile_Image),
        Member_ID: updated.Owner_ID,
        User_Role: 'Owner',
      },
    });
  } catch (error) {
    console.error("Update Owner Profile Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูลส่วนตัว" });
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    // ค้นหาผู้ใช้จาก Email ทั้งฝั่ง Member และ Owner
    const member = await prisma.d1_Members.findFirst({ where: { Email: email } });
    const owner = member ? null : await prisma.d2_Owners.findFirst({ where: { Email: email } });
    const user = member ?? owner;
    const idField = member ? 'member' : 'owner';

    if (!user) {
      res.status(404).json({ message: "ไม่พบอีเมลนี้ในระบบ" });
      return;
    }

    const userId = member ? member.Member_ID : (owner as NonNullable<typeof owner>).Owner_ID;

    // สร้าง Secret เฉพาะตัว = คีย์เซิร์ฟเวอร์ + รหัสผ่านปัจจุบันของผู้ใช้
    const secret = JWT_SECRET + user.Password;

    // สร้าง Token อายุ 15 นาที
    const payload = { email: user.Email, id: userId, type: idField };
    const token = jwt.sign(payload, secret, { expiresIn: '15m' });
    const resetLink = `${BACKEND_PUBLIC_URL}/api/auth/reset-redirect/${userId}/${token}`;

    // 🚀 ส่งผ่าน Brevo (HTTPS API) แทน SMTP ตรงๆ — ไม่มี PaaS ไหนบล็อก port 443 เหมือนที่เจอ
    // ปัญหา SMTP ถูกบล็อกมาแล้วทั้งบน Railway และ Render (ดูที่มาเพิ่มเติมใน config/env.ts)
    // ใช้อีเมลผู้ส่งที่ verify ไว้กับ Brevo แล้ว (BREVO_SENDER_EMAIL) — Brevo ต่างจาก Resend
    // ตรงที่แค่ verify sender email เดียว (ไม่ต้องมีโดเมนของตัวเอง) ก็ส่งไปผู้รับไหนก็ได้ทันที
    await brevo.transactionalEmails.sendTransacEmail({
      sender: { email: BREVO_SENDER_EMAIL!, name: 'Find Dorm Mate' },
      to: [{ email: user.Email! }],
      subject: 'รีเซ็ตรหัสผ่านแอป Find a Dorm Mate',
      htmlContent: `
              <h3>สวัสดีครับ,</h3>
              <p>คุณได้ทำการร้องขอเปลี่ยนรหัสผ่าน คลิกลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์มีอายุ 15 นาที)</p>
              <a href="${resetLink}" style="padding: 10px 20px; background-color: #673AB7; color: white; text-decoration: none; border-radius: 5px;">ตั้งรหัสผ่านใหม่</a>
              <p>หากคุณไม่ได้ทำรายการนี้ กรุณาละเว้นอีเมลฉบับนี้</p>
            `
    });

    res.status(200).json({ message: "ส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลแล้ว กรุณาเช็คกล่องจดหมาย" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการส่งอีเมล" });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, token, newPassword } = req.body;
    const userId = Number(id);

    // เช็คทั้งฝั่ง Member และ Owner (ไม่รู้ตอนนี้ว่า id นี้เป็นของตารางไหน)
    const member = await prisma.d1_Members.findUnique({ where: { Member_ID: userId } });
    const owner = await prisma.d2_Owners.findUnique({ where: { Owner_ID: userId } });

    const tryReset = async (
      user: { Password: string } | null,
      updatePassword: (hashed: string) => Promise<unknown>
    ): Promise<boolean> => {
      if (!user) return false;
      const secret = JWT_SECRET + user.Password;
      try {
        jwt.verify(token, secret);
      } catch {
        return false;
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await updatePassword(hashedPassword);
      return true;
    };

    const memberOk = await tryReset(member, (hashed) =>
      prisma.d1_Members.update({ where: { Member_ID: userId }, data: { Password: hashed } })
    );
    const ownerOk =
      !memberOk &&
      (await tryReset(owner, (hashed) =>
        prisma.d2_Owners.update({ where: { Owner_ID: userId }, data: { Password: hashed } })
      ));

    if (!memberOk && !ownerOk) {
      res.status(400).json({ message: "ลิงก์รีเซ็ตรหัสผ่านหมดอายุหรือไม่ถูกต้อง" });
      return;
    }

    res.status(200).json({ message: "เปลี่ยนรหัสผ่านสำเร็จ สามารถเข้าสู่ระบบได้เลย" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาด" });
  }
};

export const resetRedirect = (req: Request, res: Response) => {
  const { id, token } = req.params;
  const appLink = `finddormmate://app/reset-password/${id}/${token}`;
  res.send(`
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>กำลังเปลี่ยนรหัสผ่าน...</title>
            <style>
                body { font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #f4f4f9; }
                .card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); display: inline-block; }
                .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #673AB7; color: white; text-decoration: none; border-radius: 5px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2 style="color: #673AB7;">กำลังเปิดแอป Find Dorm Mate...</h2>
                <p>หากแอปไม่เปิดอัตโนมัติ กรุณากดปุ่มด้านล่าง</p>
                <a href="${appLink}" class="btn">เปิดแอปเพื่อตั้งรหัสใหม่</a>
            </div>

            <script>
                // สั่งให้เบราว์เซอร์เด้งเข้าแอปทันทีที่โหลดหน้าเว็บเสร็จ
                window.onload = function() {
                    window.location.href = "${appLink}";
                };
            </script>
        </body>
        </html>
    `);
};

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    // 🚀 ใช้ id/role จาก token ที่ login ไว้เท่านั้น ห้ามเชื่อค่าที่ client ส่งมาเอง
    const id = req.user!.id;
    const isOwner = req.user!.role === 'Owner';

    if (isOwner) {
      const owner = await prisma.d2_Owners.findUnique({ where: { Owner_ID: id } });
      if (!owner) {
        res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้งาน" });
        return;
      }

      const isMatch = await bcrypt.compare(oldPassword, owner.Password);
      if (!isMatch) {
        res.status(400).json({ message: "รหัสผ่านเดิมไม่ถูกต้อง" });
        return;
      }

      const hashedNewPassword = await bcrypt.hash(newPassword, 10);
      await prisma.d2_Owners.update({
        where: { Owner_ID: id },
        data: { Password: hashedNewPassword }
      });

      res.status(200).json({ message: "เปลี่ยนรหัสผ่านสำเร็จ" });
      return;
    }

    const user = await prisma.d1_Members.findUnique({ where: { Member_ID: id } });
    if (!user) {
      res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้งาน" });
      return;
    }

    const isMatch = await bcrypt.compare(oldPassword, user.Password);
    if (!isMatch) {
      res.status(400).json({ message: "รหัสผ่านเดิมไม่ถูกต้อง" });
      return;
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await prisma.d1_Members.update({
      where: { Member_ID: user.Member_ID },
      data: { Password: hashedNewPassword }
    });

    res.status(200).json({ message: "เปลี่ยนรหัสผ่านสำเร็จ" });
  } catch (error) {
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน" });
  }
};

// [POST] API: ออก Firebase Custom Token ผูกกับ Member_ID จริง (ใช้กับระบบแชทรูมเมท)
// ให้ Flutter เอา token นี้ไป FirebaseAuth.signInWithCustomToken(token) แทนการเข้าใช้งาน
// แบบ Anonymous — ทำให้ request.auth.uid ฝั่ง Firestore Security Rules อ้างอิงถึง
// Member_ID ตัวจริงได้ (ใช้ prefix "member_" กันชนกับ Owner_ID ที่เป็นคนละ sequence กัน)
export const getFirebaseToken = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isFirebaseAdminConfigured()) {
      res.status(503).json({
        message: 'ระบบแชทยังไม่ได้ตั้งค่า Firebase Admin SDK บน backend กรุณาติดต่อผู้ดูแลระบบ',
      });
      return;
    }

    const memberId = req.user!.id;
    const uid = `member_${memberId}`;

    const customToken = await getFirebaseAuth().createCustomToken(uid, {
      memberId,
    });

    res.status(200).json({ message: 'ออก Firebase Token สำเร็จ', token: customToken });
  } catch (error) {
    console.error('Get Firebase Token Error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการออก Firebase Token' });
  }
};
