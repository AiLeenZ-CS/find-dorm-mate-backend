// 📄 ไฟล์นี้ทำหน้าที่: controller ของระบบรีวิวหอพัก — สมาชิกเขียน/แก้ไข/ลบรีวิวจากใบจองที่ยืนยันแล้ว
// และดึงรีวิวของหอพัก (public) พร้อมคะแนนเฉลี่ย
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { parsePagination, buildMeta } from '../utils/pagination';
import { toImageProxyRef } from '../utils/image-proxy';

// ==========================================
// 🚀 API: สมาชิกเขียนรีวิวหอพัก — ต้องมีใบจองที่ยืนยันแล้ว (Confirmed) ของหอนั้นๆ
// และรีวิวได้แค่ 1 ครั้งต่อใบจอง (กันสแปม/รีวิวซ้ำ)
// ==========================================
export const createReview = async (req: Request, res: Response): Promise<void> => {
    try {
        const memberId = req.user!.id;
        const { bookingId, rating, comment } = req.body;

        const ratingNum = Number(rating);
        if (!bookingId || !Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน (ต้องการ bookingId และ rating 1-5)" });
            return;
        }

        const booking = await prisma.d8_Bookings.findUnique({ where: { Booking_ID: Number(bookingId) } });

        if (!booking) {
            res.status(404).json({ message: "ไม่พบใบจองนี้ในระบบ" });
            return;
        }
        if (booking.Member_ID !== Number(memberId)) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์รีวิวใบจองนี้" });
            return;
        }
        if (booking.Booking_Status !== 'Confirmed') {
            res.status(400).json({ message: "รีวิวได้เฉพาะใบจองที่ยืนยันแล้วเท่านั้น" });
            return;
        }

        const existingReview = await prisma.d9_Reviews.findFirst({
            where: { Booking_ID: Number(bookingId) },
        });
        if (existingReview) {
            res.status(400).json({ message: "คุณรีวิวใบจองนี้ไปแล้ว" });
            return;
        }

        const review = await prisma.d9_Reviews.create({
            data: {
                Booking_ID: Number(bookingId),
                Member_ID: Number(memberId),
                Dorm_ID: booking.Dorm_ID,
                Rating: ratingNum,
                Comment: typeof comment === 'string' && comment.trim() ? comment.trim() : null,
            },
        });

        res.status(201).json({ message: "ส่งรีวิวสำเร็จ ขอบคุณสำหรับความคิดเห็น!", data: review });
    } catch (error) {
        console.error("Create Review Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการส่งรีวิว" });
    }
};

// ==========================================
// 🚀 API: รีวิวของหอพักหนึ่งๆ (public) — คืนค่าเฉลี่ย + จำนวนรีวิวมาด้วย
// ==========================================
export const getDormReviews = async (req: Request, res: Response): Promise<void> => {
    try {
        const dormId = Number(req.params.dormId);
        if (isNaN(dormId)) {
            res.status(400).json({ message: "ID ไม่ถูกต้อง" });
            return;
        }

        const pagination = parsePagination(req);

        const [reviews, total, aggregate] = await Promise.all([
            prisma.d9_Reviews.findMany({
                where: { Dorm_ID: dormId },
                include: {
                    Member: { select: { Member_ID: true, Username: true, Profile_Image: true } },
                },
                orderBy: { Reviewed_At: 'desc' },
                ...(pagination && { skip: pagination.skip, take: pagination.take }),
            }),
            prisma.d9_Reviews.count({ where: { Dorm_ID: dormId } }),
            prisma.d9_Reviews.aggregate({
                where: { Dorm_ID: dormId },
                _avg: { Rating: true },
            }),
        ]);

        res.status(200).json({
            message: "ดึงข้อมูลรีวิวสำเร็จ",
            data: reviews.map((r) => ({
                ...r,
                Member: r.Member && { ...r.Member, Profile_Image: toImageProxyRef(r.Member.Profile_Image) },
            })),
            meta: buildMeta(pagination, total),
            averageRating: aggregate._avg.Rating ?? null,
            reviewCount: total,
        });
    } catch (error) {
        console.error("Get Dorm Reviews Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลรีวิว" });
    }
};

// ==========================================
// 🚀 API: รีวิวของฉันเอง (ฝั่งสมาชิก) — ใช้เช็คว่าใบจองไหนรีวิวไปแล้วบ้าง
// ==========================================
export const getMyReviews = async (req: Request, res: Response): Promise<void> => {
    try {
        const memberId = req.user!.id;

        const reviews = await prisma.d9_Reviews.findMany({
            where: { Member_ID: Number(memberId) },
            include: {
                Dorm: { select: { Dorm_ID: true, Dorm_Name: true } },
            },
            orderBy: { Reviewed_At: 'desc' },
        });

        res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data: reviews });
    } catch (error) {
        console.error("Get My Reviews Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลรีวิว" });
    }
};

// ==========================================
// 🚀 API: แก้ไขรีวิวของตัวเอง
// ==========================================
export const updateReview = async (req: Request, res: Response): Promise<void> => {
    try {
        const reviewId = Number(req.params.id);
        const memberId = req.user!.id;
        const { rating, comment } = req.body;

        const review = await prisma.d9_Reviews.findUnique({ where: { Review_ID: reviewId } });

        if (!review) {
            res.status(404).json({ message: "ไม่พบรีวิวนี้ในระบบ" });
            return;
        }
        if (review.Member_ID !== Number(memberId)) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์แก้ไขรีวิวนี้" });
            return;
        }

        const data: { Rating?: number; Comment?: string | null } = {};
        if (rating !== undefined) {
            const ratingNum = Number(rating);
            if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
                res.status(400).json({ message: "คะแนนต้องอยู่ระหว่าง 1-5" });
                return;
            }
            data.Rating = ratingNum;
        }
        if (comment !== undefined) {
            data.Comment = typeof comment === 'string' && comment.trim() ? comment.trim() : null;
        }

        const updated = await prisma.d9_Reviews.update({ where: { Review_ID: reviewId }, data });

        res.status(200).json({ message: "แก้ไขรีวิวสำเร็จ", data: updated });
    } catch (error) {
        console.error("Update Review Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขรีวิว" });
    }
};

// ==========================================
// 🚀 API: ลบรีวิวของตัวเอง
// ==========================================
export const deleteReview = async (req: Request, res: Response): Promise<void> => {
    try {
        const reviewId = Number(req.params.id);
        const memberId = req.user!.id;

        const review = await prisma.d9_Reviews.findUnique({ where: { Review_ID: reviewId } });

        if (!review) {
            res.status(404).json({ message: "ไม่พบรีวิวนี้ในระบบ" });
            return;
        }
        if (review.Member_ID !== Number(memberId)) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ลบรีวิวนี้" });
            return;
        }

        await prisma.d9_Reviews.delete({ where: { Review_ID: reviewId } });

        res.status(200).json({ message: "ลบรีวิวสำเร็จ" });
    } catch (error) {
        console.error("Delete Review Error:", error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบรีวิว" });
    }
};
