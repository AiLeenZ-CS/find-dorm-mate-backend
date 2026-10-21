// 📄 ไฟล์นี้ทำหน้าที่: ตั้ง cron job ที่รันทุก 5 นาที ตรวจหาใบจองที่หมดอายุ (Pending เกิน 3 วัน)
// แล้วปรับสถานะเป็น Expired พร้อมคืนสต๊อกห้องและแจ้งเตือนสมาชิกอัตโนมัติ ถูกเรียกเริ่มทำงานจาก server.ts
import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { createNotification } from '../utils/notifications';

// 🚀 ตรวจสอบใบจองที่หมดอายุ (Pending เกิน 3 วัน) ทุกๆ 5 นาที
// แล้วปรับสถานะเป็น Expired พร้อมคืนสต๊อกห้อง (+1) ให้อัตโนมัติ
export const startBookingCronJob = () => {
    cron.schedule('*/5 * * * *', async () => {
        try {
            const now = new Date();

            const expiredBookings = await prisma.d8_Bookings.findMany({
                where: {
                    Booking_Status: 'Pending',
                    Expires_At: { lt: now },
                },
            });

            if (expiredBookings.length === 0) return;

            console.log(`⏳ [Booking Cron] พบใบจองหมดอายุ ${expiredBookings.length} รายการ กำลังคืนสต๊อกห้อง...`);

            for (const booking of expiredBookings) {
                try {
                    const didExpire = await prisma.$transaction(async (tx) => {
                        // เช็คแบบ Atomic กันชนกับ cancelBooking/confirmBooking ที่อาจถูกกดพร้อมกันพอดี
                        const result = await tx.d8_Bookings.updateMany({
                            where: { Booking_ID: booking.Booking_ID, Booking_Status: 'Pending' },
                            data: { Booking_Status: 'Expired', Response_At: now },
                        });

                        if (result.count === 0 || !booking.Room_Type_ID) return false;

                        const roomType = await tx.d4_Room_Types.update({
                            where: { Room_Type_ID: booking.Room_Type_ID },
                            data: { Remaining_Rooms: { increment: 1 } },
                        });

                        if (roomType.Room_Status === 'Full' && (roomType.Remaining_Rooms ?? 0) > 0) {
                            await tx.d4_Room_Types.update({
                                where: { Room_Type_ID: booking.Room_Type_ID },
                                data: { Room_Status: 'Available' },
                            });
                        }
                        return true;
                    });

                    if (didExpire && booking.Member_ID) {
                        await createNotification({
                            recipientType: 'Member',
                            recipientId: booking.Member_ID,
                            type: 'Booking_Expired',
                            title: 'ใบจองของคุณหมดเวลาแล้ว',
                            body: 'เจ้าของหอไม่ได้ตอบรับภายใน 3 วัน ระบบคืนสต๊อกห้องให้ผู้อื่นแล้ว',
                            link: '/my-bookings',
                        });
                    }
                } catch (innerError) {
                    console.error(`❌ คืนสต๊อกให้ Booking_ID ${booking.Booking_ID} ไม่สำเร็จ:`, innerError);
                }
            }
        } catch (error) {
            console.error('❌ เกิดข้อผิดพลาดใน Booking Cron Job:', error);
        }
    });
};
