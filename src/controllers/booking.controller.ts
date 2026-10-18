import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { createNotification } from '../utils/notifications';
import { toImageProxyRef, toImageProxyRefListJson } from '../utils/image-proxy';

const BOOKING_HOLD_HOURS = 72; // 3 วัน

// 🚀 ปล่อยห้องคืนสต๊อก (+1) และปรับ Room_Status กลับเป็น Available ถ้าจำเป็น
// ใช้ร่วมกันทั้งตอนยกเลิก/ปฏิเสธ/หมดอายุอัตโนมัติ — ต้องเรียกภายใน $transaction เสมอ
const releaseRoomStock = async (tx: any, roomTypeId: number) => {
    const roomType = await tx.d4_Room_Types.update({
        where: { Room_Type_ID: roomTypeId },
        data: { Remaining_Rooms: { increment: 1 } },
    });

    if (roomType.Room_Status === 'Full' && (roomType.Remaining_Rooms ?? 0) > 0) {
        await tx.d4_Room_Types.update({
            where: { Room_Type_ID: roomTypeId },
            data: { Room_Status: 'Available' },
        });
    }
};

// ==========================================
// 🚀 API: จองห้องพัก (สร้างใบจองสถานะ Pending + ตัดสต๊อกทันที)
// ==========================================
export const createBooking = async (req: Request, res: Response): Promise<void> => {
    try {
        const { roomTypeId, expectedMoveIn, noteToOwner } = req.body;
        // 🚀 ใช้ memberId จาก token ที่ login ไว้เท่านั้น ห้ามเชื่อค่าที่ client ส่งมาเอง
        const memberId = req.user!.id;

        if (!roomTypeId) {
            res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน (ต้องการ roomTypeId)" });
            return;
        }

        // --- 🛡️ ห้ามมีใบจอง Pending ซ้ำสำหรับห้องประเภทเดิม ---
        const existingBooking = await prisma.d8_Bookings.findFirst({
            where: {
                Member_ID: Number(memberId),
                Room_Type_ID: Number(roomTypeId),
                Booking_Status: 'Pending',
            },
        });

        if (existingBooking) {
            res.status(400).json({ message: "คุณมีใบจองที่รอดำเนินการสำหรับห้องพักประเภทนี้อยู่แล้ว" });
            return;
        }

        const newBooking = await prisma.$transaction(async (tx) => {
            const roomType = await tx.d4_Room_Types.findUnique({
                where: { Room_Type_ID: Number(roomTypeId) },
            });

            if (!roomType) {
                throw new Error("ไม่พบห้องพักประเภทนี้ในระบบ");
            }

            // --- 🛡️ ตัดสต๊อกแบบ Atomic เพื่อกัน Race Condition (กดจองพร้อมกันหลายคน) ---
            // ใช้ updateMany + เงื่อนไข Remaining_Rooms > 0 ในคำสั่ง UPDATE เดียว
            // แทนที่จะ "อ่านค่าก่อนแล้วค่อยลด" ซึ่งมีช่องว่างให้สองคนอ่านค่าเดิมพร้อมกันได้
            const stockResult = await tx.d4_Room_Types.updateMany({
                where: {
                    Room_Type_ID: Number(roomTypeId),
                    Remaining_Rooms: { gt: 0 },
                },
                data: { Remaining_Rooms: { decrement: 1 } },
            });

            if (stockResult.count === 0) {
                throw new Error("ห้องพักประเภทนี้เต็มแล้ว ไม่สามารถจองได้");
            }

            // ห้องเต็มพอดีหลังตัดสต๊อกรอบนี้ -> ปรับสถานะห้องเป็น Full
            const updatedRoomType = await tx.d4_Room_Types.findUnique({
                where: { Room_Type_ID: Number(roomTypeId) },
            });
            if ((updatedRoomType?.Remaining_Rooms ?? 0) <= 0) {
                await tx.d4_Room_Types.update({
                    where: { Room_Type_ID: Number(roomTypeId) },
                    data: { Room_Status: 'Full' },
                });
            }

            const now = new Date();
            const expiresAt = new Date(now.getTime() + BOOKING_HOLD_HOURS * 60 * 60 * 1000);

            return tx.d8_Bookings.create({
                data: {
                    Member_ID: Number(memberId),
                    Dorm_ID: roomType.Dorm_ID,
                    Room_Type_ID: Number(roomTypeId),
                    Booking_Status: 'Pending',
                    Expected_Move_In: expectedMoveIn ? new Date(expectedMoveIn) : null,
                    Note_To_Owner: noteToOwner || null,
                    Requested_At: now,
                    Expires_At: expiresAt,
                },
            });
        });

        // 🚀 แจ้งเตือนเจ้าของหอว่ามีคำขอจองใหม่เข้ามา (นอก transaction เพราะแค่ query อ่าน
        // ข้อมูลที่ commit ไปแล้ว ไม่กระทบความถูกต้องของการตัดสต๊อก)
        if (newBooking.Dorm_ID) {
            const dorm = await prisma.d3_Dormitories.findUnique({
                where: { Dorm_ID: newBooking.Dorm_ID },
                select: { Owner_ID: true, Dorm_Name: true },
            });
            if (dorm?.Owner_ID) {
                await createNotification({
                    recipientType: 'Owner',
                    recipientId: dorm.Owner_ID,
                    type: 'Booking_Created',
                    title: 'มีคำขอจองห้องพักใหม่',
                    body: `มีคำขอจองห้องพักใหม่ที่ "${dorm.Dorm_Name}" รอการยืนยันภายใน 3 วัน`,
                    link: '/owner-bookings',
                });
            }
        }

        res.status(201).json({ message: "จองห้องพักสำเร็จ! รอเจ้าของหอยืนยันภายใน 3 วัน", data: newBooking });
    } catch (error: any) {
        console.error("Create Booking Error:", error);
        const message = error?.message?.includes('เต็มแล้ว') || error?.message?.includes('ไม่พบห้องพัก')
            ? error.message
            : "เกิดข้อผิดพลาดในการจองห้องพัก";
        res.status(400).json({ message });
    }
};

// ==========================================
// 🚀 API: ดึงใบจองของฉัน (ฝั่งสมาชิก)
// ==========================================
export const getMyBookings = async (req: Request, res: Response): Promise<void> => {
    try {
        const memberId = req.user!.id;

        const bookings = await prisma.d8_Bookings.findMany({
            where: { Member_ID: Number(memberId) },
            include: {
                Room_Type: {
                    select: {
                        Room_Type_ID: true,
                        Room_Type_Name: true,
                        Room_Type: true,
                        Price_Per_Month: true,
                        Room_Images: true,
                    },
                },
                Dorm: {
                    select: { Dorm_ID: true, Dorm_Name: true },
                },
                // 🚀 เอาไว้เช็คฝั่ง Flutter ว่าใบจองนี้รีวิวไปแล้วหรือยัง
                Reviews: { select: { Review_ID: true } },
            },
            orderBy: { Requested_At: 'desc' },
        });

        const data = bookings.map((b) => ({
            ...b,
            Room_Type: b.Room_Type && {
                ...b.Room_Type,
                Room_Images: toImageProxyRefListJson(b.Room_Type.Room_Images),
            },
        }));

        res.status(200).json({ message: "ดึงข้อมูลใบจองสำเร็จ", data });
    } catch (error) {
        console.error("Get My Bookings Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลใบจอง" });
    }
};

// ==========================================
// 🚀 API: ยกเลิกใบจอง (ฝั่งสมาชิก) — คืนสต๊อกห้องทันที
// ==========================================
export const cancelBooking = async (req: Request, res: Response): Promise<void> => {
    try {
        const bookingId = Number(req.params.id);
        const memberId = req.user!.id;

        const booking = await prisma.d8_Bookings.findUnique({ where: { Booking_ID: bookingId } });

        if (!booking) {
            res.status(404).json({ message: "ไม่พบใบจองนี้ในระบบ" });
            return;
        }
        if (booking.Member_ID !== Number(memberId)) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ยกเลิกใบจองนี้" });
            return;
        }
        if (booking.Booking_Status !== 'Pending') {
            res.status(400).json({ message: "ใบจองนี้ไม่อยู่ในสถานะที่ยกเลิกได้แล้ว" });
            return;
        }

        await prisma.$transaction(async (tx) => {
            // เช็คซ้ำแบบ Atomic ว่ายังเป็น Pending อยู่จริง กันชนกับ Cron Job ที่อาจปรับเป็น Expired พอดี
            const result = await tx.d8_Bookings.updateMany({
                where: { Booking_ID: bookingId, Booking_Status: 'Pending' },
                data: { Booking_Status: 'Cancelled', Response_At: new Date() },
            });

            if (result.count === 0) {
                throw new Error("ใบจองนี้ถูกดำเนินการไปแล้ว กรุณารีเฟรชหน้าจอ");
            }
            if (booking.Room_Type_ID) {
                await releaseRoomStock(tx, booking.Room_Type_ID);
            }
        });

        res.status(200).json({ message: "ยกเลิกใบจองสำเร็จ คืนสต๊อกห้องเรียบร้อยแล้ว" });
    } catch (error: any) {
        console.error("Cancel Booking Error:", error);
        res.status(400).json({ message: error?.message || "เกิดข้อผิดพลาดในการยกเลิกใบจอง" });
    }
};

// ==========================================
// 🚀 API: ดึงใบจองของหอพักที่ตัวเองเป็นเจ้าของ (ฝั่งเจ้าของหอ)
// ==========================================
export const getOwnerBookings = async (req: Request, res: Response): Promise<void> => {
    try {
        const ownerId = req.user!.id;

        const bookings = await prisma.d8_Bookings.findMany({
            where: { Dorm: { Owner_ID: Number(ownerId) } },
            include: {
                Member: {
                    select: { Member_ID: true, Username: true, First_Name: true, Last_Name: true, Phone: true, Profile_Image: true, Gender: true },
                },
                Room_Type: {
                    select: { Room_Type_ID: true, Room_Type_Name: true, Room_Type: true, Price_Per_Month: true },
                },
                Dorm: {
                    select: { Dorm_ID: true, Dorm_Name: true },
                },
                // 🚀 เอาไว้เช็คฝั่ง Flutter ว่าใบจองนี้เจ้าของหอรายงานผู้ใช้ไปแล้วหรือยัง
                // (ไม่ต้องกรองด้วย ownerId ซ้ำ เพราะใบจองนี้ผูกกับหอของเจ้าของคนนี้อยู่แล้ว)
                Reports: { select: { Report_ID: true } },
            },
            orderBy: { Requested_At: 'desc' },
        });

        const data = bookings.map((b) => ({
            ...b,
            Member: b.Member && { ...b.Member, Profile_Image: toImageProxyRef(b.Member.Profile_Image) },
        }));

        res.status(200).json({ message: "ดึงข้อมูลใบจองสำเร็จ", data });
    } catch (error) {
        console.error("Get Owner Bookings Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลใบจอง" });
    }
};

// ==========================================
// 🚀 API: เจ้าของหอยืนยันใบจอง (ไม่คืนสต๊อก — ห้องถูกจองสำเร็จแล้ว)
// ==========================================
export const confirmBooking = async (req: Request, res: Response): Promise<void> => {
    try {
        const bookingId = Number(req.params.id);
        const ownerId = req.user!.id;

        const booking = await prisma.d8_Bookings.findUnique({
            where: { Booking_ID: bookingId },
            include: { Dorm: { select: { Owner_ID: true } } },
        });

        if (!booking) {
            res.status(404).json({ message: "ไม่พบใบจองนี้ในระบบ" });
            return;
        }
        if (booking.Dorm?.Owner_ID !== Number(ownerId)) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ดำเนินการกับใบจองนี้" });
            return;
        }
        if (booking.Booking_Status !== 'Pending') {
            res.status(400).json({ message: "ใบจองนี้ไม่อยู่ในสถานะที่ยืนยันได้แล้ว" });
            return;
        }

        // 🛡️ ถ้าเจ้าของหอรายงานผู้จองคนนี้ไปแล้ว (รายงานได้ตั้งแต่ยังเป็น Pending) ห้ามยืนยันใบจองนี้อีก
        const existingReport = await prisma.d10_User_Reports.findFirst({
            where: { Booking_ID: bookingId },
        });
        if (existingReport) {
            res.status(400).json({ message: "ไม่สามารถยืนยันใบจองนี้ได้ เนื่องจากมีการรายงานผู้จองนี้ไปแล้ว" });
            return;
        }

        const result = await prisma.d8_Bookings.updateMany({
            where: { Booking_ID: bookingId, Booking_Status: 'Pending' },
            data: { Booking_Status: 'Confirmed', Response_At: new Date() },
        });

        if (result.count === 0) {
            res.status(400).json({ message: "ใบจองนี้ถูกดำเนินการไปแล้ว กรุณารีเฟรชหน้าจอ" });
            return;
        }

        if (booking.Member_ID) {
            await createNotification({
                recipientType: 'Member',
                recipientId: booking.Member_ID,
                type: 'Booking_Confirmed',
                title: 'การจองของคุณได้รับการยืนยันแล้ว',
                body: 'เจ้าของหอยืนยันใบจองของคุณแล้ว ยินดีด้วย! 🎉',
                link: '/my-bookings',
            });
        }

        res.status(200).json({ message: "ยืนยันใบจองสำเร็จ" });
    } catch (error) {
        console.error("Confirm Booking Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการยืนยันใบจอง" });
    }
};

// ==========================================
// 🚀 API: เจ้าของหอปฏิเสธใบจอง — คืนสต๊อกห้อง
// ==========================================
export const rejectBooking = async (req: Request, res: Response): Promise<void> => {
    try {
        const bookingId = Number(req.params.id);
        const ownerId = req.user!.id;
        const { reason } = req.body;

        const booking = await prisma.d8_Bookings.findUnique({
            where: { Booking_ID: bookingId },
            include: { Dorm: { select: { Owner_ID: true } } },
        });

        if (!booking) {
            res.status(404).json({ message: "ไม่พบใบจองนี้ในระบบ" });
            return;
        }
        if (booking.Dorm?.Owner_ID !== Number(ownerId)) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ดำเนินการกับใบจองนี้" });
            return;
        }
        if (booking.Booking_Status !== 'Pending') {
            res.status(400).json({ message: "ใบจองนี้ไม่อยู่ในสถานะที่ปฏิเสธได้แล้ว" });
            return;
        }

        await prisma.$transaction(async (tx) => {
            const result = await tx.d8_Bookings.updateMany({
                where: { Booking_ID: bookingId, Booking_Status: 'Pending' },
                data: { Booking_Status: 'Rejected', Reject_Reason: reason || null, Response_At: new Date() },
            });

            if (result.count === 0) {
                throw new Error("ใบจองนี้ถูกดำเนินการไปแล้ว กรุณารีเฟรชหน้าจอ");
            }
            if (booking.Room_Type_ID) {
                await releaseRoomStock(tx, booking.Room_Type_ID);
            }
        });

        if (booking.Member_ID) {
            await createNotification({
                recipientType: 'Member',
                recipientId: booking.Member_ID,
                type: 'Booking_Rejected',
                title: 'การจองของคุณถูกปฏิเสธ',
                body: reason ? `เหตุผล: ${reason}` : 'เจ้าของหอปฏิเสธใบจองนี้ ระบบคืนสต๊อกห้องให้แล้ว',
                link: '/my-bookings',
            });
        }

        res.status(200).json({ message: "ปฏิเสธใบจองสำเร็จ คืนสต๊อกห้องเรียบร้อยแล้ว" });
    } catch (error: any) {
        console.error("Reject Booking Error:", error);
        res.status(400).json({ message: error?.message || "เกิดข้อผิดพลาดในการปฏิเสธใบจอง" });
    }
};

// ==========================================
// 🚀 API: เจ้าของหอรายงานผู้ใช้
// รายงานได้ทั้งใบจองที่ยังรอตอบรับ (Pending — เช่น พฤติกรรมไม่เหมาะสมตั้งแต่ก่อนตอบรับ)
// และใบจองที่ยืนยันแล้ว (Confirmed — เช่น จองแล้วไม่มารับห้อง/ไม่จ่ายเงิน)
// 🛡️ ใบจองที่ถูกรายงานไปแล้วตอน Pending จะยืนยัน (Confirm) ไม่ได้อีก ดู confirmBooking
// ==========================================
const NO_SHOW_REASON = 'จองห้องพักแล้วไม่มารับห้อง/ไม่ชำระเงินตามที่ตกลง';
const PRE_CONFIRM_REPORT_REASON = 'รายงานผู้จองก่อนตอบรับคำขอจอง (พฤติกรรมไม่เหมาะสม)';

export const reportBooking = async (req: Request, res: Response): Promise<void> => {
    try {
        const bookingId = Number(req.params.id);
        const ownerId = req.user!.id;
        const { note } = req.body;

        const booking = await prisma.d8_Bookings.findUnique({
            where: { Booking_ID: bookingId },
            include: { Dorm: { select: { Owner_ID: true } } },
        });

        if (!booking) {
            res.status(404).json({ message: "ไม่พบใบจองนี้ในระบบ" });
            return;
        }
        if (booking.Dorm?.Owner_ID !== Number(ownerId)) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์รายงานใบจองนี้" });
            return;
        }
        if (!['Pending', 'Confirmed'].includes(booking.Booking_Status)) {
            res.status(400).json({ message: "รายงานได้เฉพาะใบจองที่ยังรอตอบรับหรือยืนยันแล้วเท่านั้น" });
            return;
        }
        if (!booking.Member_ID) {
            res.status(400).json({ message: "ใบจองนี้ไม่มีข้อมูลผู้จอง" });
            return;
        }

        const existingReport = await prisma.d10_User_Reports.findFirst({
            where: { Booking_ID: bookingId, Reporter_Type: 'Owner', Reporter_ID: Number(ownerId) },
        });

        if (existingReport) {
            res.status(400).json({ message: "คุณรายงานใบจองนี้ไปแล้ว" });
            return;
        }

        const baseReason = booking.Booking_Status === 'Confirmed' ? NO_SHOW_REASON : PRE_CONFIRM_REPORT_REASON;
        const noteText = typeof note === 'string' ? note.trim() : '';
        const reason = noteText ? `${baseReason} (${noteText})` : baseReason;

        await prisma.d10_User_Reports.create({
            data: {
                Reported_User_ID: booking.Member_ID,
                Booking_ID: bookingId,
                Reporter_Type: 'Owner',
                Reporter_ID: Number(ownerId),
                Reason: reason,
            },
        });

        res.status(201).json({ message: "ส่งรายงานผู้ใช้สำเร็จ ทีมงานจะตรวจสอบต่อไป" });
    } catch (error: any) {
        console.error("Report Booking Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการส่งรายงาน" });
    }
};
