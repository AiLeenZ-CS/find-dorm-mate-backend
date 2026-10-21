// 📄 ไฟล์นี้ทำหน้าที่: controller ของระบบแจ้งเตือนในแอป — ดึงรายการ/จำนวนที่ยังไม่อ่าน มาร์กอ่านแล้ว
// และจัดการ FCM Device Token สำหรับยิง push notification
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { recipientTypeFromRole } from '../utils/notifications';

// [GET] API: ดึงแจ้งเตือนของฉัน (เรียงใหม่สุดก่อน จำกัด 50 รายการล่าสุด)
export const getMyNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const recipientType = recipientTypeFromRole(req.user!.role);
    const recipientId = req.user!.id;

    const notifications = await prisma.d11_Notifications.findMany({
      where: { Recipient_Type: recipientType, Recipient_ID: recipientId },
      orderBy: { Created_At: 'desc' },
      take: 50,
    });

    res.status(200).json({ message: "ดึงแจ้งเตือนสำเร็จ", data: notifications });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงแจ้งเตือน" });
  }
};

// [GET] API: จำนวนแจ้งเตือนที่ยังไม่อ่าน (ใช้โชว์ badge ที่ไอคอนกระดิ่ง)
export const getUnreadCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const recipientType = recipientTypeFromRole(req.user!.role);
    const recipientId = req.user!.id;

    const count = await prisma.d11_Notifications.count({
      where: { Recipient_Type: recipientType, Recipient_ID: recipientId, Is_Read: false },
    });

    res.status(200).json({ message: "ดึงจำนวนแจ้งเตือนที่ยังไม่อ่านสำเร็จ", data: { count } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงจำนวนแจ้งเตือน" });
  }
};

// [PATCH] API: มาร์กแจ้งเตือนรายการเดียวว่าอ่านแล้ว
export const markAsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const notificationId = Number(req.params.id);
    if (isNaN(notificationId)) {
      res.status(400).json({ message: "ID แจ้งเตือนไม่ถูกต้อง" });
      return;
    }

    const recipientType = recipientTypeFromRole(req.user!.role);
    const recipientId = req.user!.id;

    // 🛡️ เช็คความเป็นเจ้าของผ่าน where ตรงๆ ในคำสั่ง update เลย (ไม่ใช่ findUnique แล้วเช็คทีหลัง)
    // ถ้าไม่ใช่ของตัวเอง updateMany จะได้ count = 0 เงียบๆ ไม่ error — กันคนอื่นมาร์กแจ้งเตือนคนอื่น
    await prisma.d11_Notifications.updateMany({
      where: { Notification_ID: notificationId, Recipient_Type: recipientType, Recipient_ID: recipientId },
      data: { Is_Read: true },
    });

    res.status(200).json({ message: "มาร์กแจ้งเตือนว่าอ่านแล้วสำเร็จ" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการมาร์กแจ้งเตือน" });
  }
};

// [PATCH] API: มาร์กแจ้งเตือนทั้งหมดของฉันว่าอ่านแล้ว
export const markAllAsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const recipientType = recipientTypeFromRole(req.user!.role);
    const recipientId = req.user!.id;

    await prisma.d11_Notifications.updateMany({
      where: { Recipient_Type: recipientType, Recipient_ID: recipientId, Is_Read: false },
      data: { Is_Read: true },
    });

    res.status(200).json({ message: "มาร์กแจ้งเตือนทั้งหมดว่าอ่านแล้วสำเร็จ" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการมาร์กแจ้งเตือนทั้งหมด" });
  }
};

// [POST] API: บันทึก/อัปเดต FCM Device Token ของเครื่องนี้ — ฝั่ง Flutter เรียกทันทีหลัง login
// สำเร็จ (ดู AuthRepository._saveSession) และทุกครั้งที่เปิดแอปขึ้นมาแล้วมี session เดิมอยู่
// (ดู main.dart) เพื่อให้ backend มี Token ล่าสุดไว้ยิง push เสมอ (Token หมดอายุ/เปลี่ยนได้)
//
// 🚀 ใช้ upsert คีย์ด้วย FCM_Token เอง (ไม่ใช่คู่ Recipient+Token) เพราะเครื่องเดียวกันอาจเคย
// ผูกกับอีกบัญชีมาก่อน (แชร์เครื่อง/ล็อกเอาท์แล้วเข้าบัญชีอื่น) ต้อง "ย้ายเจ้าของ" Token มาเป็น
// บัญชีที่ login ล่าสุดเสมอ ไม่งั้น push จะหลุดไปเข้าบัญชีเก่าที่ไม่ได้ใช้เครื่องนี้แล้ว
export const saveDeviceToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fcmToken, platform } = req.body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      res.status(400).json({ message: "ต้องการ fcmToken" });
      return;
    }

    const recipientType = recipientTypeFromRole(req.user!.role);
    const recipientId = req.user!.id;

    await prisma.d12_Device_Tokens.upsert({
      where: { FCM_Token: fcmToken },
      update: {
        Recipient_Type: recipientType,
        Recipient_ID: recipientId,
        Platform: platform ?? null,
      },
      create: {
        Recipient_Type: recipientType,
        Recipient_ID: recipientId,
        FCM_Token: fcmToken,
        Platform: platform ?? null,
      },
    });

    res.status(200).json({ message: "บันทึก Device Token สำเร็จ" });
  } catch (error) {
    console.error('Save Device Token Error:', error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการบันทึก Device Token" });
  }
};

// [DELETE] API: ลบ FCM Device Token ของเครื่องนี้ — เรียกตอน logout เพื่อไม่ให้เครื่องที่
// ออกจากระบบไปแล้วยังได้รับ push ของบัญชีเดิมอยู่ (ไม่ critical ถ้าเรียกไม่สำเร็จ เพราะ
// ครั้งถัดไปที่มีคน login เครื่องนี้ด้วยบัญชีอื่น Token จะถูก "ย้ายเจ้าของ" ผ่าน saveDeviceToken
// อยู่ดี แต่ลบทันทีตอน logout ให้ช่วงว่างระหว่างนั้นสะอาดกว่า)
export const deleteDeviceToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken || typeof fcmToken !== 'string') {
      res.status(400).json({ message: "ต้องการ fcmToken" });
      return;
    }

    await prisma.d12_Device_Tokens.deleteMany({ where: { FCM_Token: fcmToken } });

    res.status(200).json({ message: "ลบ Device Token สำเร็จ" });
  } catch (error) {
    console.error('Delete Device Token Error:', error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบ Device Token" });
  }
};
