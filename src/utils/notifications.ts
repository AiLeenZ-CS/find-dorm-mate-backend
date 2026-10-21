// 📄 ไฟล์นี้ทำหน้าที่: รวมฟังก์ชันสร้างการแจ้งเตือนกลางของระบบ — บันทึกแจ้งเตือนลง MySQL
// และยิง Push Notification ผ่าน Firebase Cloud Messaging ไปยังทุกอุปกรณ์ของผู้รับ ให้ controller
// อื่นเรียกใช้หลังทำ action หลักสำเร็จ
import { prisma } from '../lib/prisma';
import { getMessaging, isFirebaseAdminConfigured } from '../config/firebase-admin';

// 🚀 ผู้รับแจ้งเตือนเป็นได้ 2 แบบ (polymorphic) — Member กับ Owner เป็นคนละ sequence กัน
// (เลขชนกันได้) จึงต้องระบุ Recipient_Type คู่กับ Recipient_ID เสมอ ห้ามเช็คแค่ ID อย่างเดียว
export type NotificationRecipientType = 'Member' | 'Owner';

// 🚀 role จาก JWT ('Member'/'Owner') ตรงกับ Recipient_Type อยู่แล้วพอดี — ย้ายมาไว้ที่นี่
// (เดิมเป็น private function ซ้ำอยู่แค่ใน notification.controller.ts) ให้ controller อื่นที่
// ต้องแปลง role เป็น Recipient_Type ด้วย (เช่น saveDeviceToken) เรียกใช้ตัวเดียวกันได้
export function recipientTypeFromRole(role: string): NotificationRecipientType {
  return role === 'Owner' ? 'Owner' : 'Member';
}

interface CreateNotificationInput {
  recipientType: NotificationRecipientType;
  recipientId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  // 🚀 ข้อมูลเพิ่มเติมแนบไปกับ push เท่านั้น (ไม่ได้บันทึกลง DB) — ฝั่ง Flutter อ่านจาก
  // RemoteMessage.data ใช้ทำ deep-link ตอนกดแจ้งเตือนได้ นอกเหนือจาก link หลัก
  data?: Record<string, string>;
}

// 🚀 แจ้งเตือนแบบเต็มรูปแบบ: บันทึกลง MySQL (In-app เหมือนเดิม) + ยิง Push ผ่าน Firebase Cloud
// Messaging ไปทุกเครื่องที่ผู้รับคนนี้เคยล็อกอินไว้พร้อมกัน (รองรับหลายอุปกรณ์ต่อ 1 บัญชี)
// เรียกจาก controller อื่นหลังทำ action หลักสำเร็จแล้วเท่านั้น ไม่ throw ออกไปเด็ดขาด เพราะ
// แจ้งเตือนเป็นฟีเจอร์เสริม ถ้าเขียน DB หรือยิง push ไม่ผ่าน (เช่น DB ชั่วคราวมีปัญหา, ยังไม่ได้
// ตั้งค่า Firebase Admin SDK, device token หมดอายุ) ไม่ควรทำให้ action หลัก (อนุมัติคำขอจอง/
// จับคู่ ฯลฯ) ล้มเหลวไปด้วย
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    await prisma.d11_Notifications.create({
      data: {
        Recipient_Type: input.recipientType,
        Recipient_ID: input.recipientId,
        Type: input.type,
        Title: input.title,
        Body: input.body ?? null,
        Link: input.link ?? null,
      },
    });
  } catch (error) {
    console.error('Create Notification Error:', error);
  }

  await pushToDevices(input);
}

// 🚀 ยิง Push ไปทุก Device Token ของผู้รับ — แยกฟังก์ชันออกมาเพื่อให้ createNotification
// อ่านง่าย และกันข้อผิดพลาดจากฝั่ง push ไม่ให้ไปกระทบการบันทึก DB ด้านบน (คนละ try/catch กัน)
async function pushToDevices(input: CreateNotificationInput): Promise<void> {
  if (!isFirebaseAdminConfigured()) return;

  try {
    const devices = await prisma.d12_Device_Tokens.findMany({
      where: { Recipient_Type: input.recipientType, Recipient_ID: input.recipientId },
      select: { FCM_Token: true },
    });
    if (devices.length === 0) return;

    const messaging = getMessaging();
    const deadTokens: string[] = [];

    // 🚀 ยิงทีละ Token ด้วย admin.messaging().send() — ไม่ใช้ sendEachForMulticast เพราะ
    // ต้องการรู้ผลลัพธ์รายเครื่องชัดเจนเพื่อลบ Token ที่ตายแล้วทิ้งเป็นรายตัว
    await Promise.all(
      devices.map(async ({ FCM_Token }) => {
        try {
          await messaging.send({
            token: FCM_Token,
            notification: { title: input.title, body: input.body ?? '' },
            // 🚀 data ต้องเป็น string ล้วน (ข้อจำกัดของ FCM) — แนบ type/link ไว้เสมอให้ฝั่ง
            // Flutter ใช้ deep-link ตอนกดแจ้งเตือนได้ ไม่ต้องพึ่ง notification payload อย่างเดียว
            data: {
              type: input.type,
              link: input.link ?? '',
              ...(input.data ?? {}),
            },
          });
        } catch (error: any) {
          // 🚀 Token ที่ตายแล้ว (ถอนแอป/ล้างข้อมูล/หมดอายุ) ลบทิ้งจาก DB เลย กันยิง push
          // เข้าเครื่องที่ไม่มีอยู่จริงซ้ำๆ ทุกครั้งที่มีแจ้งเตือนใหม่ในอนาคต
          const code = error?.errorInfo?.code || error?.code;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            deadTokens.push(FCM_Token);
          } else {
            console.error('Send Push Notification Error:', error);
          }
        }
      })
    );

    if (deadTokens.length > 0) {
      await prisma.d12_Device_Tokens.deleteMany({ where: { FCM_Token: { in: deadTokens } } });
    }
  } catch (error) {
    console.error('Push To Devices Error:', error);
  }
}
