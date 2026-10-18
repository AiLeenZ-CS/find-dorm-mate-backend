import { Request, Response } from 'express';
import admin from 'firebase-admin';
import { prisma } from '../lib/prisma';
import { parsePagination, buildMeta } from '../utils/pagination';
import { getFirestoreDb, isFirebaseAdminConfigured } from '../config/firebase-admin';
import { createNotification } from '../utils/notifications';
import { toImageProxyRef } from '../utils/image-proxy';

// 🚀 ใส่ proxy ref ให้ Profile_Image ก่อนส่ง response ออกไปเสมอ ไม่ส่ง path/URL ดิบจาก DB ตรงๆ
function withMemberImageRef<T extends { Profile_Image?: string | null } | null>(member: T): T {
    if (!member) return member;
    return { ...member, Profile_Image: toImageProxyRef(member.Profile_Image) };
}

function withPostMemberImageRef<T extends { Member?: { Profile_Image?: string | null } | null }>(
    post: T
): T {
    return { ...post, Member: withMemberImageRef(post.Member ?? null) };
}

// 🚀 sync รายชื่อ participant ของห้องแชท Firestore ตอนอนุมัติคำขอจับคู่สำเร็จ — ไม่ critical
// พอจะทำให้การอนุมัติคำขอ (ข้อมูลหลักอยู่ใน MySQL) ล้มเหลวไปด้วยถ้า Firestore เขียนไม่ผ่าน
// แค่ log ไว้เฉยๆ ผู้ใช้ยังกดอนุมัติสำเร็จตามปกติ แค่แชทอาจจะยังไม่เปิดให้ทันที
// 🚨 ต้องเรียกจาก backend เท่านั้น (Admin SDK เขียนข้าม Security Rules ได้) ห้ามให้ Flutter
// เขียน participantIds เอง ไม่งั้นใครก็ใส่ตัวเองเข้าห้องแชทของคนอื่นได้
async function syncChatParticipants(postId: number, ownerId: number, matchedMemberId: number) {
    if (!isFirebaseAdminConfigured()) return;
    try {
        const db = getFirestoreDb();
        const chatRef = db.collection('roommate_chats').doc(`post_${postId}`);
        await chatRef.set(
            {
                postId,
                participantIds: admin.firestore.FieldValue.arrayUnion(
                    `member_${ownerId}`,
                    `member_${matchedMemberId}`,
                ),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    } catch (error) {
        console.error('Sync Chat Participants Error:', error);
    }
}

// 🚀 ตัดสิทธิ์สมาชิกที่ถูก Unmatch ออกจากห้องแชทกลุ่มของประกาศนี้ — ไม่ critical เหมือนกัน
// (ดู syncChatParticipants) ถ้าห้องแชทไม่มีอยู่จริงหรือ Firestore ไม่พร้อม แค่ log ไว้เฉยๆ
async function removeChatParticipant(postId: number, memberId: number) {
    if (!isFirebaseAdminConfigured()) return;
    try {
        const db = getFirestoreDb();
        const chatRef = db.collection('roommate_chats').doc(`post_${postId}`);
        await chatRef.update({
            participantIds: admin.firestore.FieldValue.arrayRemove(`member_${memberId}`),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (error) {
        console.error('Remove Chat Participant Error:', error);
    }
}

// 🚀 เปิด/sync ห้องแชท 1:1 "ก่อนตอบรับ" ระหว่างเจ้าของประกาศ + ผู้ขอรายนี้เท่านั้น — แยกจาก
// roommate_chats/post_{postId} (ห้องแชทกลุ่มของคนที่ Matched แล้วทุกคน) โดยสิ้นเชิง เพราะคำขอ
// นี้ยังไม่ได้รับการตอบรับ จะเอาไปปนกับคนที่ Matched แล้วคนอื่นในกลุ่มไม่ได้ — 1 ห้องต่อ 1
// คำขอ (Match_ID) เจ้าของกดทักแชทได้กี่ผู้ขอก็ได้ แต่ละคนจะได้ห้องแชทของตัวเองแยกกัน
async function syncPreChatParticipants(matchId: number, ownerId: number, applicantId: number) {
    if (!isFirebaseAdminConfigured()) return;
    try {
        const db = getFirestoreDb();
        const chatRef = db.collection('roommate_pre_chats').doc(`match_${matchId}`);
        await chatRef.set(
            {
                matchId,
                participantIds: [`member_${ownerId}`, `member_${applicantId}`],
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    } catch (error) {
        console.error('Sync Pre-Match Chat Participants Error:', error);
    }
}

// 🚀 include กลางที่ใช้ร่วมกันทุกจุดที่ต้องส่งประกาศแบบเต็ม (พร้อมข้อมูล Member/Dorm/Room_Type)
// กลับไปให้ Flutter — กันไม่ให้แต่ละ endpoint พิมพ์ select ซ้ำแล้วเผลอไม่ตรงกัน
const ROOMMATE_POST_INCLUDE = {
    Member: { select: { First_Name: true, Last_Name: true, Nickname: true, Gender: true, Profile_Image: true } },
    // 🚀 แนบ Latitude/Longitude ของหอพักมาด้วย — ใช้คำนวณระยะทาง "ใกล้ฉัน" ที่หน้า Feed
    // รูมเมท (ดู RoommateSortOption.nearest ใน roommate_feed_screen.dart ฝั่ง Flutter)
    Dorm: { select: { Dorm_Name: true, Dorm_Type: true, Latitude: true, Longitude: true } },
    Room_Type: { select: { Room_Type_Name: true, Room_Type: true, Price_Per_Month: true } },
} as const;

// [POST] API: สร้างประกาศหารูมเมทใหม่
export const createPost = async (req: Request, res: Response): Promise<void> => {
    try {
        // 🚀 แก้ไข: รับค่าตัวแปรให้ตรงกับ key ที่ Flutter ส่งมา (เป็นตัวพิมพ์ใหญ่)
        const {
            Req_Persons, Req_Gender, Req_Age_Range, Sleep_Time, Smoking_Allowed, Pet_Allowed,
            Cleanliness, Additional_Notes, Dorm_ID, Room_Type_ID, Booking_ID
        } = req.body;

        let dormId = Number(Dorm_ID);
        let roomTypeId = Number(Room_Type_ID);
        let bookingId: number | null = null;

        // 🛡️ กติกา: สมาชิก 1 คนเปิดประกาศหารูมเมทที่ยัง "กำลังหา" ได้แค่ 1 ประกาศเท่านั้น
        // ต้องปิด/ลบประกาศเดิมก่อนถึงจะสร้างใหม่ได้ (กันโพสต์สแปมหลายห้องพร้อมกัน)
        const activePost = await prisma.d6_Roommate_Posts.findFirst({
            where: { Member_ID: req.user!.id, Post_Status: 'Searching' },
        });
        if (activePost) {
            res.status(400).json({ message: "คุณมีประกาศหารูมเมทที่เปิดอยู่แล้ว กรุณาปิดหรือลบประกาศเดิมก่อนสร้างใหม่" });
            return;
        }

        // 🚀 มาจากปุ่ม "ประกาศหารูมเมท" บนใบจองที่ยืนยันแล้ว — ยึดข้อมูลหอ/ห้องจากใบจองจริง
        // เสมอ (ไม่เชื่อ Dorm_ID/Room_Type_ID ที่ client ส่งมาคู่กัน) กันการปลอมแปลงข้อมูล
        if (Booking_ID !== undefined && Booking_ID !== null) {
            bookingId = Number(Booking_ID);
            if (isNaN(bookingId)) {
                res.status(400).json({ message: "Booking_ID ไม่ถูกต้อง" });
                return;
            }

            const booking = await prisma.d8_Bookings.findUnique({ where: { Booking_ID: bookingId } });
            if (!booking) {
                res.status(404).json({ message: "ไม่พบใบจองนี้ในระบบ" });
                return;
            }
            if (booking.Member_ID !== req.user!.id) {
                res.status(403).json({ message: "คุณไม่มีสิทธิ์ใช้ใบจองนี้" });
                return;
            }
            if (booking.Booking_Status !== 'Confirmed') {
                res.status(400).json({ message: "ใบจองนี้ยังไม่ได้รับการยืนยัน จึงยังประกาศหารูมเมทไม่ได้" });
                return;
            }

            dormId = booking.Dorm_ID ?? NaN;
            roomTypeId = booking.Room_Type_ID ?? NaN;
        }

        if (isNaN(dormId) || isNaN(roomTypeId)) {
            res.status(400).json({ message: "กรุณาระบุ Dorm_ID และ Room_Type_ID ให้ถูกต้อง" });
            return;
        }

        const newPost = await prisma.d6_Roommate_Posts.create({
            data: {
                Req_Persons: Req_Persons ? Number(Req_Persons) : 1,
                Req_Gender: Req_Gender,
                Req_Age_Range: Req_Age_Range,
                Sleep_Time: Sleep_Time,
                Smoking_Allowed: Smoking_Allowed,
                Pet_Allowed: Pet_Allowed,
                Cleanliness: Cleanliness,
                Additional_Notes: Additional_Notes,
                Post_Status: 'Searching',

                // 🚀 ใช้ Member_ID จาก token ที่ login ไว้เท่านั้น ห้ามเชื่อค่าที่ client ส่งมาเอง
                Member_ID: req.user!.id,
                Dorm_ID: dormId,
                Room_Type_ID: roomTypeId,
                Booking_ID: bookingId,
            }
        });

        res.status(201).json({ message: "สร้างประกาศหารูมเมทสำเร็จ", data: newPost });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์" });
    }
};

// [DELETE] API: เจ้าของประกาศลบประกาศของตัวเอง — ทำได้เฉพาะตอนที่ยังไม่ได้คู่รูมเมทเลย
// (ถ้าอนุมัติคำขอไปแล้วอย่างน้อย 1 คน จะลบไม่ได้ ต้องคุยกับคนที่จับคู่แล้วเอง)
export const deletePost = async (req: Request, res: Response): Promise<void> => {
    try {
        const postId = Number(req.params.postId);
        const memberId = req.user!.id;

        if (isNaN(postId)) {
            res.status(400).json({ message: "ID ประกาศไม่ถูกต้อง" });
            return;
        }

        const post = await prisma.d6_Roommate_Posts.findUnique({ where: { Post_ID: postId } });
        if (!post) {
            res.status(404).json({ message: "ไม่พบประกาศนี้ในระบบ" });
            return;
        }
        if (post.Member_ID !== memberId) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ลบประกาศนี้" });
            return;
        }

        const matchedCount = await prisma.d7_Roommate_Matches.count({
            where: { Post_ID: postId, Match_Status: 'Matched' },
        });
        if (matchedCount > 0) {
            res.status(400).json({ message: "ไม่สามารถลบประกาศที่จับคู่กับรูมเมทแล้วได้" });
            return;
        }

        await prisma.d6_Roommate_Posts.delete({ where: { Post_ID: postId } });

        res.status(200).json({ message: "ลบประกาศสำเร็จ" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบประกาศ" });
    }
};

// [PATCH] API: เจ้าของประกาศแก้ไขเงื่อนไขรูมเมทที่ต้องการ (ไม่แก้ Dorm/Room/Booking —
// ผูกกับห้องจริงตายตัว) ทำได้เฉพาะตอนที่ประกาศยัง "กำลังหา" อยู่ (ยังไม่ปิด/จับคู่ครบ)
export const updatePost = async (req: Request, res: Response): Promise<void> => {
    try {
        const postId = Number(req.params.postId);
        const memberId = req.user!.id;
        const {
            Req_Persons, Req_Gender, Req_Age_Range, Sleep_Time, Smoking_Allowed, Pet_Allowed,
            Cleanliness, Additional_Notes,
        } = req.body;

        if (isNaN(postId)) {
            res.status(400).json({ message: "ID ประกาศไม่ถูกต้อง" });
            return;
        }

        const post = await prisma.d6_Roommate_Posts.findUnique({ where: { Post_ID: postId } });
        if (!post) {
            res.status(404).json({ message: "ไม่พบประกาศนี้ในระบบ" });
            return;
        }
        if (post.Member_ID !== memberId) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์แก้ไขประกาศนี้" });
            return;
        }
        if (post.Post_Status !== 'Searching') {
            res.status(400).json({ message: "ไม่สามารถแก้ไขประกาศที่ปิดไปแล้วได้" });
            return;
        }

        // 🛡️ แก้ไขเงื่อนไขไม่ได้แล้วถ้ามีคนขอจับคู่เข้ามา (ไม่ว่าจะตอบรับไปแล้วหรือยังรออยู่
        // ก็ตาม) เพราะผู้ขอตัดสินใจส่งคำขอมาโดยอิงจากเงื่อนไขเดิม เปลี่ยนตอนนี้จะไม่แฟร์กับผู้ขอ
        const activeRequestCount = await prisma.d7_Roommate_Matches.count({
            where: { Post_ID: postId, Match_Status: { in: ['Pending', 'Matched'] } },
        });
        if (activeRequestCount > 0) {
            res.status(400).json({ message: "ไม่สามารถแก้ไขประกาศนี้ได้ เนื่องจากมีคนขอจับคู่เข้ามาแล้ว" });
            return;
        }

        // 🚀 ไม่ต้องเช็คจำนวนคนที่จับคู่แล้วอีกชั้นตรงนี้ — activeRequestCount ด้านบนบล็อก
        // การแก้ไขไปแล้วตั้งแต่มีคำขอ (Pending/Matched) อย่างน้อย 1 คำขอ ซึ่งครอบคลุมกรณีนี้
        // อยู่แล้วเสมอ (ถ้ามีคนจับคู่แล้ว ก็ต้องมีคำขอ Matched อยู่ด้วยแน่นอน)
        let reqPersons = post.Req_Persons;
        if (Req_Persons !== undefined) {
            reqPersons = Number(Req_Persons);
            if (isNaN(reqPersons) || reqPersons < 1) {
                res.status(400).json({ message: "จำนวนคนที่หาเพิ่มไม่ถูกต้อง" });
                return;
            }
        }

        const updated = await prisma.d6_Roommate_Posts.update({
            where: { Post_ID: postId },
            data: {
                Req_Persons: reqPersons,
                Req_Gender: Req_Gender ?? post.Req_Gender,
                Req_Age_Range: Req_Age_Range ?? post.Req_Age_Range,
                Sleep_Time: Sleep_Time ?? post.Sleep_Time,
                Smoking_Allowed: Smoking_Allowed ?? post.Smoking_Allowed,
                Pet_Allowed: Pet_Allowed ?? post.Pet_Allowed,
                Cleanliness: Cleanliness ?? post.Cleanliness,
                Additional_Notes: Additional_Notes !== undefined ? Additional_Notes : post.Additional_Notes,
            },
        });

        res.status(200).json({ message: "แก้ไขประกาศสำเร็จ", data: updated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขประกาศ" });
    }
};

// [GET] API: ดึงประกาศหารูมเมททั้งหมด (รองรับการค้นหาตามหอพัก)
export const getAllPosts = async (req: Request, res: Response): Promise<void> => {
    try {
        // รับค่า dormId จาก URL Query (ถ้ามี)
        const dormId = req.query.dormId ? Number(req.query.dormId) : undefined;

        // กำหนดเงื่อนไขการดึงข้อมูล
        const whereClause: any = { Post_Status: 'Searching' };
        if (dormId && !isNaN(dormId)) {
            whereClause.Dorm_ID = dormId; // ถ้ามีการส่ง dormId มา ให้หาเฉพาะหอนั้น
        }

        // 🚀 รองรับ ?page=&limit= (ไม่บังคับ — ถ้าไม่ส่งมาจะดึงมาทั้งหมดเหมือนเดิม เพื่อไม่ให้แอปเดิมพัง)
        const pagination = parsePagination(req);

        const [posts, total] = await Promise.all([
            prisma.d6_Roommate_Posts.findMany({
                where: whereClause,
                orderBy: { Created_At: 'desc' },
                include: ROOMMATE_POST_INCLUDE,
                ...(pagination && { skip: pagination.skip, take: pagination.take }),
            }),
            prisma.d6_Roommate_Posts.count({ where: whereClause }),
        ]);

        res.status(200).json({
            message: "ดึงข้อมูลประกาศสำเร็จ",
            data: posts.map((p) => withPostMemberImageRef(p)),
            meta: buildMeta(pagination, total),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์" });
    }
};

// [GET] API: ประกาศทั้งหมดที่ฉันสร้าง (ทุกสถานะ รวมที่จับคู่ครบแล้ว) — ให้เจ้าของ
// ตามดูประกาศของตัวเองได้เสมอ ถึงจะถูกปิดจากหน้ารวมไปแล้วก็ตาม
// 🚀 แนบ Matched_Count ต่อประกาศมาด้วย ให้หน้า "รูมเมทของฉัน" กรองประกาศที่จับคู่ได้
// อย่างน้อย 1 คนแล้วมาแสดง (เพื่อกดส่งคำขอจองห้องต่อได้) โดยไม่ต้องยิง API แยกทีละประกาศ
export const getMyPosts = async (req: Request, res: Response): Promise<void> => {
    try {
        const memberId = req.user!.id;

        const posts = await prisma.d6_Roommate_Posts.findMany({
            where: { Member_ID: memberId },
            orderBy: { Created_At: 'desc' },
            include: ROOMMATE_POST_INCLUDE,
        });

        const postIds = posts.map((p) => p.Post_ID);
        const matchedGroups = postIds.length > 0
            ? await prisma.d7_Roommate_Matches.groupBy({
                by: ['Post_ID'],
                where: { Post_ID: { in: postIds }, Match_Status: 'Matched' },
                _count: { Post_ID: true },
            })
            : [];
        const matchedCountMap = new Map(
            matchedGroups.map((g) => [g.Post_ID, g._count.Post_ID]),
        );

        const postsWithCount = posts.map((p) => ({
            ...withPostMemberImageRef(p),
            Matched_Count: matchedCountMap.get(p.Post_ID) ?? 0,
        }));

        res.status(200).json({ message: "ดึงประกาศของฉันสำเร็จ", data: postsWithCount });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงประกาศของฉัน" });
    }
};

// [GET] API: ประกาศที่ฉันจับคู่สำเร็จ (ในฐานะผู้ขอ) — ให้ตามดูประกาศที่จับคู่ด้วยได้
// แม้ประกาศนั้นจะถูกปิดจากหน้ารวมไปแล้วก็ตาม
// 🚀 แนบ Matched_Count มาด้วยเหมือน getMyPosts เพื่อให้แท็บ "จับคู่แล้ว" ฝั่ง Flutter
// โชว์ความคืบหน้าได้แบบเดียวกัน ไม่ว่าผู้ดูจะเป็นเจ้าของประกาศหรือสมาชิกที่จับคู่ด้วย
const ALL_MATCH_STATUSES = ['Pending', 'Matched', 'Rejected', 'Unmatched', 'Cancelled'];

export const getMyMatchedPosts = async (req: Request, res: Response): Promise<void> => {
    try {
        const memberId = req.user!.id;

        // 🚀 ไม่ส่ง ?status= มา = ค่าเริ่มต้นเดิมเป๊ะๆ (Matched เท่านั้น) ไม่กระทบพฤติกรรมเดิมของ
        // แท็บ "จับคู่แล้ว" ที่เรียก endpoint นี้โดยไม่ระบุ status — ส่ง status=All เพื่อดู
        // ประวัติคำขอทุกสถานะ (ใช้ที่แท็บ "ที่ฉันจับคู่ด้วย") หรือระบุสถานะเจาะจงก็ได้
        const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
        const statusFilter = !statusParam || statusParam === 'Matched'
            ? 'Matched'
            : statusParam === 'All'
                ? { in: ALL_MATCH_STATUSES }
                : ALL_MATCH_STATUSES.includes(statusParam)
                    ? statusParam
                    : 'Matched';

        const matches = await prisma.d7_Roommate_Matches.findMany({
            where: { Member_ID: memberId, Match_Status: statusFilter },
            orderBy: { Requested_At: 'desc' },
            include: { Post: { include: ROOMMATE_POST_INCLUDE } },
        });

        const matchesWithPost = matches.filter((m) => m.Post !== null);
        const postIds = matchesWithPost.map((m) => m.Post!.Post_ID);
        const matchedGroups = postIds.length > 0
            ? await prisma.d7_Roommate_Matches.groupBy({
                by: ['Post_ID'],
                where: { Post_ID: { in: postIds }, Match_Status: 'Matched' },
                _count: { Post_ID: true },
            })
            : [];
        const matchedCountMap = new Map(
            matchedGroups.map((g) => [g.Post_ID, g._count.Post_ID]),
        );

        const postsWithCount = matchesWithPost.map((m) => ({
            ...withPostMemberImageRef(m.Post!),
            Matched_Count: matchedCountMap.get(m.Post!.Post_ID) ?? 0,
            // 🚀 สถานะคำขอจับคู่ "ของฉัน" กับประกาศนี้โดยเฉพาะ (ต่างจาก Post_Status ที่เป็น
            // สถานะของประกาศเอง) ใช้โชว์ badge/filter ที่แท็บ "ที่ฉันจับคู่ด้วย"
            My_Match_Status: m.Match_Status,
        }));

        res.status(200).json({ message: "ดึงประกาศที่จับคู่สำเร็จ", data: postsWithCount });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงประกาศที่จับคู่" });
    }
};

// ==========================================
// 🚀 ระบบจับคู่รูมเมท (D7_Roommate_Matches)
// ==========================================

// [POST] API: ผู้ขอส่งคำขอจับคู่ไปยังประกาศ
export const sendMatchRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const postId = Number(req.params.postId);
        const memberId = req.user!.id;
        const { message } = req.body;

        if (isNaN(postId)) {
            res.status(400).json({ message: "ID ประกาศไม่ถูกต้อง" });
            return;
        }

        const post = await prisma.d6_Roommate_Posts.findUnique({ where: { Post_ID: postId } });
        if (!post) {
            res.status(404).json({ message: "ไม่พบประกาศนี้ในระบบ" });
            return;
        }
        if (post.Member_ID === memberId) {
            res.status(400).json({ message: "ไม่สามารถส่งคำขอจับคู่ประกาศของตัวเองได้" });
            return;
        }
        if (post.Post_Status !== 'Searching') {
            res.status(400).json({ message: "ประกาศนี้ปิดรับคำขอจับคู่แล้ว" });
            return;
        }

        // 🛡️ จำกัดให้มีคำขอจับคู่ที่ยัง "ค้างอยู่" (Pending หรือ Matched แล้ว) ได้แค่ 1 คำขอ
        // ต่อคน ทั่วทั้งระบบ ไม่ใช่แค่ต่อประกาศเดียว — ต้องยกเลิก/ถูกจับคู่เสร็จแล้วปิดจบไป
        // (Rejected/Unmatched/Cancelled) ก่อนถึงจะส่งคำขอใหม่ไปที่ประกาศอื่นได้ กันกดสมัครเรี่ยราด
        // หลายประกาศพร้อมกันจนไม่รู้ว่าจะไปอยู่ห้องไหนกันแน่
        const existing = await prisma.d7_Roommate_Matches.findFirst({
            where: {
                Member_ID: memberId,
                Match_Status: { in: ['Pending', 'Matched'] },
            },
        });
        if (existing) {
            res.status(400).json({
                message: existing.Post_ID === postId
                    ? "คุณส่งคำขอจับคู่ประกาศนี้ไปแล้ว"
                    : "คุณมีคำขอจับคู่ที่ยังค้างอยู่แล้ว กรุณายกเลิกคำขอเดิมก่อนส่งคำขอใหม่",
            });
            return;
        }

        const match = await prisma.d7_Roommate_Matches.create({
            data: {
                Post_ID: postId,
                Member_ID: memberId,
                Message_To_Owner: message || null,
                Match_Status: 'Pending',
            },
        });

        if (post.Member_ID) {
            await createNotification({
                recipientType: 'Member',
                recipientId: post.Member_ID,
                type: 'Match_Request_Received',
                title: 'มีคำขอจับคู่รูมเมทใหม่',
                body: 'มีคนส่งคำขอจับคู่มาที่ประกาศของคุณ กดดูรายละเอียดได้เลย',
                link: `/roommate-post/${postId}/requests`,
            });
        }

        res.status(201).json({ message: "ส่งคำขอจับคู่สำเร็จ", data: match });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการส่งคำขอจับคู่" });
    }
};

// [GET] API: ผู้ขอเช็คสถานะคำขอของตัวเองสำหรับประกาศนี้ (ล่าสุด)
export const getMyRequestStatusForPost = async (req: Request, res: Response): Promise<void> => {
    try {
        const postId = Number(req.params.postId);
        const memberId = req.user!.id;

        if (isNaN(postId)) {
            res.status(400).json({ message: "ID ประกาศไม่ถูกต้อง" });
            return;
        }

        const match = await prisma.d7_Roommate_Matches.findFirst({
            where: { Post_ID: postId, Member_ID: memberId },
            orderBy: { Requested_At: 'desc' },
        });

        res.status(200).json({ message: "ดึงสถานะคำขอสำเร็จ", data: match });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงสถานะคำขอ" });
    }
};

// [GET] API: เจ้าของประกาศดูรายการคำขอจับคู่ที่ส่งเข้ามา (พร้อมโปรไฟล์ผู้ขอ)
export const getPostMatchRequests = async (req: Request, res: Response): Promise<void> => {
    try {
        const postId = Number(req.params.postId);
        const memberId = req.user!.id;

        if (isNaN(postId)) {
            res.status(400).json({ message: "ID ประกาศไม่ถูกต้อง" });
            return;
        }

        const post = await prisma.d6_Roommate_Posts.findUnique({ where: { Post_ID: postId } });
        if (!post) {
            res.status(404).json({ message: "ไม่พบประกาศนี้ในระบบ" });
            return;
        }
        if (post.Member_ID !== memberId) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ดูคำขอจับคู่ของประกาศนี้" });
            return;
        }

        const [matches, matchedCount] = await Promise.all([
            prisma.d7_Roommate_Matches.findMany({
                where: { Post_ID: postId },
                include: {
                    // 🚨 เลือกเฉพาะฟิลด์ที่จำเป็นสำหรับแสดงโปรไฟล์ผู้ขอ ห้ามดึงรหัสผ่าน/อีเมล/เบอร์โทรออกมา
                    Member: {
                        select: {
                            Member_ID: true,
                            First_Name: true,
                            Last_Name: true,
                            Nickname: true,
                            Gender: true,
                            Profile_Image: true,
                            Birthdate: true,
                        },
                    },
                },
                orderBy: { Requested_At: 'desc' },
            }),
            prisma.d7_Roommate_Matches.count({
                where: { Post_ID: postId, Match_Status: 'Matched' },
            }),
        ]);

        res.status(200).json({
            message: "ดึงคำขอจับคู่สำเร็จ",
            data: matches.map((m) => ({ ...m, Member: withMemberImageRef(m.Member) })),
            // 🚀 ให้หน้า Flutter โชว์ความคืบหน้า/สถานะปิดประกาศได้โดยไม่ต้องยิง API แยก
            post: {
                Post_Status: post.Post_Status,
                Req_Persons: post.Req_Persons,
                Matched_Count: matchedCount,
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงคำขอจับคู่" });
    }
};

// [GET] API: ดูรายชื่อสมาชิกทั้งหมดที่อยู่ในประกาศนี้ (เจ้าของ + คนที่จับคู่/Matched แล้ว)
// ต่างจาก getPostMatchRequests ตรงที่เข้าถึงได้ทั้งเจ้าของประกาศและสมาชิกที่จับคู่ด้วย
// (ไม่ใช่เจ้าของอย่างเดียว) แต่คืนแค่โปรไฟล์คนที่ Matched แล้วเท่านั้น ไม่รวมคน Pending/Rejected
// เพื่อไม่ให้สมาชิกในกลุ่มเห็นข้อมูลผู้สมัครคนอื่นที่ยังไม่ได้รับ/ถูกปฏิเสธไป
export const getPostMembers = async (req: Request, res: Response): Promise<void> => {
    try {
        const postId = Number(req.params.postId);
        const memberId = req.user!.id;

        if (isNaN(postId)) {
            res.status(400).json({ message: "ID ประกาศไม่ถูกต้อง" });
            return;
        }

        const MEMBER_SELECT = {
            Member_ID: true,
            First_Name: true,
            Last_Name: true,
            Nickname: true,
            Gender: true,
            Profile_Image: true,
        } as const;

        const post = await prisma.d6_Roommate_Posts.findUnique({
            where: { Post_ID: postId },
            include: { Member: { select: MEMBER_SELECT } },
        });
        if (!post) {
            res.status(404).json({ message: "ไม่พบประกาศนี้ในระบบ" });
            return;
        }

        const isOwner = post.Member_ID === memberId;
        if (!isOwner) {
            const isMatchedMember = await prisma.d7_Roommate_Matches.findFirst({
                where: { Post_ID: postId, Member_ID: memberId, Match_Status: 'Matched' },
            });
            if (!isMatchedMember) {
                res.status(403).json({ message: "คุณไม่มีสิทธิ์ดูรายชื่อสมาชิกของประกาศนี้" });
                return;
            }
        }

        const matchedMembers = await prisma.d7_Roommate_Matches.findMany({
            where: { Post_ID: postId, Match_Status: 'Matched' },
            include: { Member: { select: MEMBER_SELECT } },
            orderBy: { Response_Date: 'asc' },
        });

        res.status(200).json({
            message: "ดึงรายชื่อสมาชิกสำเร็จ",
            data: {
                owner: withMemberImageRef(post.Member),
                members: matchedMembers.map((m) => withMemberImageRef(m.Member)),
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงรายชื่อสมาชิก" });
    }
};

// [PATCH] API: เจ้าของประกาศอนุมัติ/ปฏิเสธคำขอจับคู่
export const respondToMatchRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const matchId = Number(req.params.matchId);
        const memberId = req.user!.id;
        const { status } = req.body;

        if (isNaN(matchId)) {
            res.status(400).json({ message: "ID คำขอไม่ถูกต้อง" });
            return;
        }
        if (status !== 'Matched' && status !== 'Rejected') {
            res.status(400).json({ message: "สถานะไม่ถูกต้อง (ต้องเป็น Matched หรือ Rejected)" });
            return;
        }

        const match = await prisma.d7_Roommate_Matches.findUnique({
            where: { Match_ID: matchId },
            include: { Post: { select: { Member_ID: true, Req_Persons: true } } },
        });

        if (!match) {
            res.status(404).json({ message: "ไม่พบคำขอนี้ในระบบ" });
            return;
        }
        if (match.Post?.Member_ID !== memberId) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ตอบรับคำขอนี้" });
            return;
        }
        if (match.Match_Status !== 'Pending') {
            res.status(400).json({ message: "คำขอนี้ถูกดำเนินการไปแล้ว" });
            return;
        }

        const postClosed = await prisma.$transaction(async (tx) => {
            // 🛡️ เช็คซ้ำแบบ Atomic กันชนกับการกดพร้อมกันหลายครั้ง/หลายแท็บ
            const result = await tx.d7_Roommate_Matches.updateMany({
                where: { Match_ID: matchId, Match_Status: 'Pending' },
                data: { Match_Status: status, Response_Date: new Date() },
            });

            if (result.count === 0) {
                throw new Error("คำขอนี้ถูกดำเนินการไปแล้ว กรุณารีเฟรชหน้าจอ");
            }

            if (status !== 'Matched' || !match.Post_ID) return false;

            // 🚀 ได้คู่จับคู่ครบตามจำนวนที่ต้องการ (Req_Persons) แล้ว -> ปิดประกาศอัตโนมัติ
            // ('Found' ไม่ใช่ 'Searching' แล้ว จึงไม่โผล่ในหน้า Feed อีกต่อไป เพราะ getAllPosts
            // กรองเฉพาะ Post_Status = 'Searching')
            const matchedCount = await tx.d7_Roommate_Matches.count({
                where: { Post_ID: match.Post_ID, Match_Status: 'Matched' },
            });
            const reqPersons = match.Post?.Req_Persons ?? 1;
            if (matchedCount < reqPersons) return false;

            await tx.d6_Roommate_Posts.update({
                where: { Post_ID: match.Post_ID },
                data: { Post_Status: 'Found' },
            });
            return true;
        });

        // 🚀 เปิดห้องแชท Firestore ให้เจ้าของประกาศ + สมาชิกที่เพิ่งอนุมัติ (นอก transaction
        // ของ MySQL เพราะ Firestore ไม่ได้อยู่ใน transaction เดียวกัน — ทำหลังอนุมัติสำเร็จแล้ว
        // เท่านั้น ไม่งั้นถ้า MySQL rollback แต่ Firestore เขียนไปแล้วจะข้อมูลไม่ตรงกัน)
        if (status === 'Matched' && match.Post_ID && match.Post?.Member_ID && match.Member_ID) {
            await syncChatParticipants(match.Post_ID, match.Post.Member_ID, match.Member_ID);
        }

        // 🚀 แจ้งเตือนผู้ขอว่าคำขอได้รับการตอบรับ/ปฏิเสธแล้ว + แจ้งเจ้าของประกาศแยกอีกครั้ง
        // ถ้าจับคู่ครบจำนวนพอดีจนปิดประกาศไปแล้ว (พร้อมกดจองห้องได้เลย)
        if (match.Member_ID) {
            await createNotification({
                recipientType: 'Member',
                recipientId: match.Member_ID,
                type: status === 'Matched' ? 'Match_Approved' : 'Match_Rejected',
                title: status === 'Matched' ? 'คำขอจับคู่ของคุณได้รับการอนุมัติ! 🎉' : 'คำขอจับคู่ของคุณถูกปฏิเสธ',
                body: status === 'Matched'
                    ? 'เจ้าของประกาศอนุมัติคำขอจับคู่ของคุณแล้ว เริ่มแชทคุยรายละเอียดกันได้เลย'
                    : 'เจ้าของประกาศปฏิเสธคำขอจับคู่นี้ ลองหาประกาศอื่นดูได้นะ',
                link: '/my-roommate-matches',
            });
        }
        if (postClosed && match.Post?.Member_ID) {
            await createNotification({
                recipientType: 'Member',
                recipientId: match.Post.Member_ID,
                type: 'Post_Fully_Matched',
                title: 'จับคู่รูมเมทครบแล้ว พร้อมจองห้องได้เลย!',
                body: 'ประกาศของคุณได้รูมเมทครบตามจำนวนที่ต้องการแล้ว กดจองห้องได้ที่หน้ารูมเมทของฉัน',
                link: '/my-roommate-matches',
            });
        }

        res.status(200).json({
            message: postClosed
                ? 'อนุมัติคำขอจับคู่สำเร็จ ได้ครบจำนวนคนแล้ว ปิดประกาศอัตโนมัติ'
                : status === 'Matched' ? 'อนุมัติคำขอจับคู่สำเร็จ' : 'ปฏิเสธคำขอจับคู่สำเร็จ',
            postClosed,
        });
    } catch (error: any) {
        console.error(error);
        res.status(400).json({ message: error?.message || "เกิดข้อผิดพลาดในการตอบรับคำขอจับคู่" });
    }
};

// [POST] API: เปิดห้องแชท 1:1 คุยกันก่อนตัดสินใจอนุมัติ/ปฏิเสธ ("ทักแชท") — เปิดได้ทั้งเจ้าของ
// ประกาศ (ฝั่งเดียวที่กดจากหน้าคำขอจับคู่) และผู้ขอเอง (ฝั่งที่กดจากหน้า "แชทของฉัน" เพื่อ
// ทักก่อนได้เหมือนกัน) แต่ใช้ได้เฉพาะคำขอที่ยังเป็น 'Pending' (รอตอบรับ) เท่านั้น — พอตอบรับ/
// ปฏิเสธ/ยกเลิกไปแล้ว ไม่ให้เปิดห้องนี้คุยต่อ (ตอบรับแล้วมีแชทกลุ่มหลักของรูมเมทที่ Matched
// แล้วรองรับอยู่แทน — ดู roommate_chats/post_{postId} และ syncChatParticipants)
export const openPreMatchChat = async (req: Request, res: Response): Promise<void> => {
    try {
        const matchId = Number(req.params.matchId);
        const callerId = req.user!.id;

        if (isNaN(matchId)) {
            res.status(400).json({ message: "ID คำขอไม่ถูกต้อง" });
            return;
        }

        const match = await prisma.d7_Roommate_Matches.findUnique({
            where: { Match_ID: matchId },
            include: { Post: { select: { Member_ID: true } } },
        });

        if (!match) {
            res.status(404).json({ message: "ไม่พบคำขอนี้ในระบบ" });
            return;
        }

        const ownerId = match.Post?.Member_ID;
        const applicantId = match.Member_ID;
        if (!ownerId || !applicantId) {
            res.status(400).json({ message: "ข้อมูลคำขอไม่ครบถ้วน" });
            return;
        }
        if (callerId !== ownerId && callerId !== applicantId) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์เปิดแชทสำหรับคำขอนี้" });
            return;
        }
        if (match.Match_Status !== 'Pending') {
            res.status(400).json({ message: "แชทนี้คุยได้เฉพาะตอนที่คำขอยังรอตอบรับเท่านั้น" });
            return;
        }

        await syncPreChatParticipants(matchId, ownerId, applicantId);

        res.status(200).json({ message: "เปิดห้องแชทสำเร็จ", data: { matchId } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการเปิดแชท" });
    }
};

// [PATCH] API: ผู้ขอยกเลิกคำขอจับคู่ของตัวเอง — ทำได้เฉพาะตอนที่เจ้าของประกาศยังไม่ตอบรับ/
// ปฏิเสธ (ยังเป็น 'Pending' อยู่เท่านั้น) เปลี่ยนเป็น 'Cancelled' ให้ส่งคำขอใหม่ได้อีกถ้าเปลี่ยนใจ
export const cancelMatchRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const matchId = Number(req.params.matchId);
        const memberId = req.user!.id;

        if (isNaN(matchId)) {
            res.status(400).json({ message: "ID คำขอไม่ถูกต้อง" });
            return;
        }

        const match = await prisma.d7_Roommate_Matches.findUnique({
            where: { Match_ID: matchId },
            include: { Post: { select: { Member_ID: true, Post_ID: true } } },
        });

        if (!match) {
            res.status(404).json({ message: "ไม่พบคำขอนี้ในระบบ" });
            return;
        }
        if (match.Member_ID !== memberId) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ยกเลิกคำขอนี้" });
            return;
        }
        if (match.Match_Status !== 'Pending') {
            res.status(400).json({ message: "ยกเลิกได้เฉพาะคำขอที่ยังรอตอบรับเท่านั้น" });
            return;
        }

        const result = await prisma.d7_Roommate_Matches.updateMany({
            where: { Match_ID: matchId, Match_Status: 'Pending' },
            data: { Match_Status: 'Cancelled', Response_Date: new Date() },
        });

        if (result.count === 0) {
            res.status(400).json({ message: "คำขอนี้ถูกดำเนินการไปแล้ว กรุณารีเฟรชหน้าจอ" });
            return;
        }

        if (match.Post?.Member_ID) {
            await createNotification({
                recipientType: 'Member',
                recipientId: match.Post.Member_ID,
                type: 'Match_Cancelled',
                title: 'ผู้ขอยกเลิกคำขอจับคู่',
                body: 'มีผู้ขอยกเลิกคำขอจับคู่รูมเมทที่ส่งมาที่ประกาศของคุณ',
                link: `/roommate-post/${match.Post.Post_ID}/requests`,
            });
        }

        res.status(200).json({ message: "ยกเลิกคำขอจับคู่สำเร็จ" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการยกเลิกคำขอ" });
    }
};

// [GET] API: รายการคำขอจับคู่ทั้งหมดที่ฉันเกี่ยวข้อง (ทั้งที่ฉันส่งไปเองและที่ส่งมาที่ประกาศ
// ของฉัน) ใช้ทำแท็บ "แชทเดี่ยว" ในหน้า "แชทของฉัน" — แยกจากแชทกลุ่มของรูมเมทที่ Matched แล้ว
export const getMyMatchRequests = async (req: Request, res: Response): Promise<void> => {
    try {
        const memberId = req.user!.id;

        const MEMBER_SELECT = {
            Member_ID: true,
            First_Name: true,
            Last_Name: true,
            Nickname: true,
            Gender: true,
            Profile_Image: true,
        } as const;

        const matches = await prisma.d7_Roommate_Matches.findMany({
            where: {
                OR: [{ Member_ID: memberId }, { Post: { Member_ID: memberId } }],
            },
            include: {
                Post: {
                    select: {
                        Post_ID: true,
                        Member_ID: true,
                        Dorm: { select: { Dorm_Name: true } },
                        Room_Type: { select: { Room_Type_Name: true, Room_Type: true } },
                        Member: { select: MEMBER_SELECT },
                    },
                },
                Member: { select: MEMBER_SELECT },
            },
            orderBy: { Requested_At: 'desc' },
        });

        const data = matches.map((m) => {
            const isOwner = m.Post?.Member_ID === memberId;
            const otherParty = isOwner ? m.Member : m.Post?.Member;
            return {
                Match_ID: m.Match_ID,
                Match_Status: m.Match_Status,
                Requested_At: m.Requested_At,
                Response_Date: m.Response_Date,
                Post_ID: m.Post_ID,
                Dorm_Name: m.Post?.Dorm?.Dorm_Name ?? null,
                Room_Type_Name: m.Post?.Room_Type?.Room_Type_Name ?? m.Post?.Room_Type?.Room_Type ?? null,
                Is_Owner: isOwner,
                Other_Party: otherParty ? withMemberImageRef(otherParty) : null,
            };
        });

        res.status(200).json({ message: "ดึงรายการแชทเดี่ยวสำเร็จ", data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงรายการแชท" });
    }
};

// [PATCH] API: เจ้าของประกาศยกเลิกการจับคู่ (Unmatch) กับสมาชิกที่ Matched แล้ว — ใช้ตอนคุยกัน
// แล้วไม่ลงรอย เปลี่ยนคำขอเป็น 'Unmatched' และเปิดประกาศกลับเป็น 'Searching' เสมอ (ให้คนอื่น
// ส่งคำขอใหม่ได้ และถ้าไม่มีคนจับคู่เหลือแล้ว เจ้าของจะลบประกาศได้ตามปกติ — ดู deletePost)
export const unmatchRequest = async (req: Request, res: Response): Promise<void> => {
    try {
        const matchId = Number(req.params.matchId);
        const ownerId = req.user!.id;

        if (isNaN(matchId)) {
            res.status(400).json({ message: "ID คำขอไม่ถูกต้อง" });
            return;
        }

        const match = await prisma.d7_Roommate_Matches.findUnique({
            where: { Match_ID: matchId },
            include: { Post: { select: { Member_ID: true } } },
        });

        if (!match) {
            res.status(404).json({ message: "ไม่พบคำขอนี้ในระบบ" });
            return;
        }
        if (match.Post?.Member_ID !== ownerId) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ยกเลิกการจับคู่นี้" });
            return;
        }
        if (match.Match_Status !== 'Matched') {
            res.status(400).json({ message: "ยกเลิกการจับคู่ได้เฉพาะคำขอที่จับคู่สำเร็จแล้วเท่านั้น" });
            return;
        }

        await prisma.$transaction(async (tx) => {
            // 🛡️ เช็คซ้ำแบบ Atomic กันชนกับการกดพร้อมกันหลายครั้ง/หลายแท็บ
            const result = await tx.d7_Roommate_Matches.updateMany({
                where: { Match_ID: matchId, Match_Status: 'Matched' },
                data: { Match_Status: 'Unmatched', Response_Date: new Date() },
            });

            if (result.count === 0) {
                throw new Error("คำขอนี้ถูกดำเนินการไปแล้ว กรุณารีเฟรชหน้าจอ");
            }

            if (match.Post_ID) {
                await tx.d6_Roommate_Posts.update({
                    where: { Post_ID: match.Post_ID },
                    data: { Post_Status: 'Searching' },
                });
            }
        });

        if (match.Post_ID && match.Member_ID) {
            await removeChatParticipant(match.Post_ID, match.Member_ID);
        }

        if (match.Member_ID) {
            await createNotification({
                recipientType: 'Member',
                recipientId: match.Member_ID,
                type: 'Match_Unmatched',
                title: 'เจ้าของประกาศยกเลิกการจับคู่กับคุณ',
                body: 'เจ้าของประกาศยกเลิกการจับคู่กับคุณแล้ว คุณจะไม่อยู่ในกลุ่มแชทของประกาศนี้อีกต่อไป',
                link: '/my-roommate-matches',
            });
        }

        res.status(200).json({ message: "ยกเลิกการจับคู่สำเร็จ ประกาศเปิดรับคำขอใหม่อีกครั้ง" });
    } catch (error: any) {
        console.error(error);
        res.status(400).json({ message: error?.message || "เกิดข้อผิดพลาดในการยกเลิกการจับคู่" });
    }
};

// ==========================================
// 🚀 เจ้าของประกาศ: จองห้องพักจากประกาศที่จับคู่รูมเมทครบแล้ว
// (Flow "หารูมเมทก่อนได้หอ" — ตรงข้ามกับปุ่ม "ประกาศหารูมเมท" บนใบจองที่ยืนยันแล้ว
// ที่ทำตอนได้ห้องก่อนแล้วค่อยหารูมเมท) ทำได้เฉพาะตอนประกาศ Post_Status = 'Found'
// (จับคู่ครบตามจำนวนที่ต้องการแล้ว) และยังไม่เคยผูกใบจองมาก่อน — ใช้ตรรกะตัดสต๊อก
// แบบ atomic เดียวกับ createBooking ใน booking.controller.ts แล้วผูก Booking_ID
// กลับเข้าประกาศในทรานแซกชันเดียวกัน ให้ประกาศแสดงสถานะ "มีห้องแล้ว" ด้วยทันที
// ==========================================
const BOOKING_HOLD_HOURS = 72; // 3 วัน

export const bookFromPost = async (req: Request, res: Response): Promise<void> => {
    try {
        const postId = Number(req.params.postId);
        const memberId = req.user!.id;
        const { expectedMoveIn, noteToOwner } = req.body;

        if (isNaN(postId)) {
            res.status(400).json({ message: "ID ประกาศไม่ถูกต้อง" });
            return;
        }

        const post = await prisma.d6_Roommate_Posts.findUnique({ where: { Post_ID: postId } });
        if (!post) {
            res.status(404).json({ message: "ไม่พบประกาศนี้ในระบบ" });
            return;
        }
        if (post.Member_ID !== memberId) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์จองห้องจากประกาศนี้" });
            return;
        }
        if (post.Booking_ID) {
            res.status(400).json({ message: "ประกาศนี้มีห้องอยู่แล้ว" });
            return;
        }
        if (post.Post_Status !== 'Found') {
            res.status(400).json({ message: "ต้องจับคู่รูมเมทให้ครบตามจำนวนก่อนถึงจะจองห้องได้" });
            return;
        }
        if (!post.Room_Type_ID) {
            res.status(400).json({ message: "ประกาศนี้ไม่มีข้อมูลห้องพัก" });
            return;
        }
        const roomTypeId = post.Room_Type_ID;

        // --- 🛡️ ห้ามมีใบจอง Pending ซ้ำสำหรับห้องประเภทเดิม (เงื่อนไขเดียวกับ createBooking) ---
        const existingBooking = await prisma.d8_Bookings.findFirst({
            where: { Member_ID: memberId, Room_Type_ID: roomTypeId, Booking_Status: 'Pending' },
        });
        if (existingBooking) {
            res.status(400).json({ message: "คุณมีใบจองที่รอดำเนินการสำหรับห้องพักประเภทนี้อยู่แล้ว" });
            return;
        }

        const newBooking = await prisma.$transaction(async (tx) => {
            const roomType = await tx.d4_Room_Types.findUnique({ where: { Room_Type_ID: roomTypeId } });
            if (!roomType) throw new Error("ไม่พบห้องพักประเภทนี้ในระบบ");

            const stockResult = await tx.d4_Room_Types.updateMany({
                where: { Room_Type_ID: roomTypeId, Remaining_Rooms: { gt: 0 } },
                data: { Remaining_Rooms: { decrement: 1 } },
            });
            if (stockResult.count === 0) throw new Error("ห้องพักประเภทนี้เต็มแล้ว ไม่สามารถจองได้");

            const updatedRoomType = await tx.d4_Room_Types.findUnique({ where: { Room_Type_ID: roomTypeId } });
            if ((updatedRoomType?.Remaining_Rooms ?? 0) <= 0) {
                await tx.d4_Room_Types.update({
                    where: { Room_Type_ID: roomTypeId },
                    data: { Room_Status: 'Full' },
                });
            }

            const now = new Date();
            const expiresAt = new Date(now.getTime() + BOOKING_HOLD_HOURS * 60 * 60 * 1000);

            const booking = await tx.d8_Bookings.create({
                data: {
                    Member_ID: memberId,
                    Dorm_ID: roomType.Dorm_ID,
                    Room_Type_ID: roomTypeId,
                    Booking_Status: 'Pending',
                    Expected_Move_In: expectedMoveIn ? new Date(expectedMoveIn) : null,
                    Note_To_Owner: noteToOwner || null,
                    Requested_At: now,
                    Expires_At: expiresAt,
                },
            });

            await tx.d6_Roommate_Posts.update({
                where: { Post_ID: postId },
                data: { Booking_ID: booking.Booking_ID },
            });

            return booking;
        });

        res.status(201).json({ message: "จองห้องพักสำเร็จ! รอเจ้าของหอยืนยันภายใน 3 วัน", data: newBooking });
    } catch (error: any) {
        console.error("Book From Post Error:", error);
        const message = error?.message?.includes('เต็มแล้ว') || error?.message?.includes('ไม่พบห้องพัก')
            ? error.message
            : "เกิดข้อผิดพลาดในการจองห้องพัก";
        res.status(400).json({ message });
    }
};