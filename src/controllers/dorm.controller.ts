import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { parsePagination, buildMeta } from '../utils/pagination';
import {
    sanitizeImageInput,
    sanitizeImageListInput,
    toImageProxyRefListJson,
} from '../utils/image-proxy';

// 🚀 ใส่ proxy ref ให้รูปหอพัก/ห้องพัก (และสิ่งอำนวยความสะดวกของห้องที่ซ้อนอยู่ข้างใน) ก่อนส่ง
// response ออกไปเสมอ ไม่ส่ง path/URL ดิบจาก DB ออกไปตรงๆ
function withDormImageRefs<T extends { Dorm_Images?: string | null; Room_Types?: any[] }>(
    dorm: T
): T {
    return {
        ...dorm,
        ...(dorm.Dorm_Images !== undefined && { Dorm_Images: toImageProxyRefListJson(dorm.Dorm_Images) }),
        ...(dorm.Room_Types && {
            Room_Types: dorm.Room_Types.map((room) => withRoomImageRefs(room)),
        }),
    };
}

function withRoomImageRefs<T extends { Room_Images?: string | null }>(room: T): T {
    return {
        ...room,
        ...(room.Room_Images !== undefined && { Room_Images: toImageProxyRefListJson(room.Room_Images) }),
    };
}

// 🚀 แปลง Custom Facilities (Array<string> ที่เจ้าของพิมพ์เพิ่มเอง เช่น ["ที่จอดรถ 24 ชม."])
// ที่ Flutter ส่งมาเป็น raw array (เหมือน Facilities ของ Master) ให้เป็น JSON string เก็บลงคอลัมน์
// Custom_Facilities (@db.Text) — กรองค่าที่ไม่ใช่ string/ว่างเปล่าทิ้งไปกันข้อมูลขยะ
function serializeCustomFacilities(input: unknown): string | null {
    if (!Array.isArray(input)) return null;
    const cleaned = input
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim());
    return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}


// [GET] API: ดึงรายการหอพักทั้งหมด (หน้า Feed)
export const getAllDorms = async (req: Request, res: Response): Promise<void> => {
    try {
        // 🚀 รองรับ ?page=&limit= (ไม่บังคับ — ถ้าไม่ส่งมาจะดึงมาทั้งหมดเหมือนเดิม เพื่อไม่ให้แอปเดิมพัง)
        const pagination = parsePagination(req);

        const [dorms, total, reviewAggregates] = await Promise.all([
            prisma.d3_Dormitories.findMany({
                include: {
                    Facilities: true, // ✅ ดึงข้อมูลสิ่งอำนวยความสะดวก
                    // 🚀 ดึง Facilities ของแต่ละห้องพักด้วย (เดิม Room_Types: true ดึงแค่ scalar
                    // field ของห้อง ไม่ดึงความสัมพันธ์ Facilities ระดับห้อง) ใช้กับตัวกรอง
                    // "สิ่งอำนวยความสะดวกห้องพัก" ที่หน้า Home ฝั่งสมาชิก
                    Room_Types: { include: { Facilities: true } },
                },
                ...(pagination && { skip: pagination.skip, take: pagination.take }),
            }),
            prisma.d3_Dormitories.count(),
            // 🚀 คะแนนรีวิวเฉลี่ยต่อหอ — ดึงรวดเดียวทุกหอด้วย groupBy แทนการ aggregate
            // แยกทีละหอ (N+1) ใช้ให้หน้า Home กรอง/โชว์ดาวเฉลี่ยได้โดยไม่ต้องยิง request แยก
            prisma.d9_Reviews.groupBy({
                by: ['Dorm_ID'],
                _avg: { Rating: true },
                _count: { Review_ID: true },
            }),
        ]);

        const ratingByDormId = new Map(
            reviewAggregates.map((r) => [r.Dorm_ID, { avg: r._avg.Rating, count: r._count.Review_ID }])
        );

        res.status(200).json({
            message: "ดึงข้อมูลสำเร็จ",
            data: dorms.map((d) => ({
                ...withDormImageRefs(d),
                Average_Rating: ratingByDormId.get(d.Dorm_ID)?.avg ?? null,
                Review_Count: ratingByDormId.get(d.Dorm_ID)?.count ?? 0,
            })),
            meta: buildMeta(pagination, total),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์" });
    }
};

// [GET] API: ดึงรายละเอียดหอพักแบบเจาะจง (คลิกดูรายละเอียด)
export const getDormById = async (req: Request, res: Response): Promise<void> => {
    try {
        const dormId = Number(req.params.id);
        if (isNaN(dormId)) {
            res.status(400).json({ message: "ID ไม่ถูกต้อง" });
            return;
        }

        const dorm = await prisma.d3_Dormitories.findUnique({
            where: { Dorm_ID: dormId },
            include: {
                Facilities: true,
                Room_Types: true
            }
        });

        if (!dorm) {
            res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
            return;
        }

        // 🚀 สรุปคะแนนรีวิวมาแนบไว้เลย เพื่อให้หน้ารายละเอียดหอพักโชว์ดาวเฉลี่ยได้
        // โดยไม่ต้องยิง request แยกไปที่ /api/reviews/dorm/:id ก่อน
        const reviewAggregate = await prisma.d9_Reviews.aggregate({
            where: { Dorm_ID: dormId },
            _avg: { Rating: true },
            _count: { Review_ID: true },
        });

        // 🚀 ก่อนจะส่งกลับไป ให้เช็คให้ชัวร์ว่ามี Latitude/Longitude ติดมาด้วย
        res.status(200).json({
            message: "ดึงข้อมูลสำเร็จ",
            data: {
                ...withDormImageRefs(dorm),
                Latitude: dorm.Latitude,
                Longitude: dorm.Longitude,
                Average_Rating: reviewAggregate._avg.Rating,
                Review_Count: reviewAggregate._count.Review_ID,
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาด" });
    }
};

// [GET] API: ดึงรายละเอียดประเภทห้องพัก (ตาม Room_Type_ID)
export const getRoomTypeById = async (req: Request, res: Response): Promise<void> => {
    try {
        const roomId = Number(req.params.id);
        if (isNaN(roomId)) {
            res.status(400).json({ message: "ID ห้องพักไม่ถูกต้อง" });
            return;
        }

        const room = await prisma.d4_Room_Types.findUnique({
            where: { Room_Type_ID: roomId },
            include: {
                Facilities: true,
                Dorm: {
                    select: { Dorm_Name: true, Contact_Info: true }
                }
            }
        });

        if (!room) {
            res.status(404).json({ message: "ไม่พบข้อมูลห้องพักนี้" });
            return;
        }

        res.status(200).json({ message: "ดึงรายละเอียดห้องพักสำเร็จ", data: withRoomImageRefs(room) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์" });
    }
};


export const createDorm = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            Dorm_Name, Address, Ownership_Proof_Image, Latitude, Longitude,
            Dorm_Type, Dorm_Images, Deposit_Fee, Insurance_Fee, Contract_Duration,
            Is_Pet_Friendly, Is_Smoking_Allowed, Contact_Info, Water_Rate,
            Electric_Rate, Facilities, Custom_Facilities, Dorm_Description
        } = req.body;

        if (!Dorm_Name) {
            res.status(400).json({ message: 'กรุณาระบุชื่อหอพัก' });
            return;
        }

        // 🚀 ใช้ Owner_ID จาก token ที่ login ไว้เท่านั้น ห้ามเชื่อค่าที่ client ส่งมาเอง
        // (ก่อนหน้านี้รับ Owner_ID จาก req.body ตรงๆ ใครก็สร้างหอพักแทนเจ้าของคนอื่นได้)
        const Owner_ID = req.user!.id;

        const newDorm = await prisma.d3_Dormitories.create({
            data: {
                Dorm_Name,
                Address,
                Ownership_Proof_Image: sanitizeImageInput(Ownership_Proof_Image),
                Latitude: Latitude ? parseFloat(Latitude) : null,
                Longitude: Longitude ? parseFloat(Longitude) : null,
                Dorm_Type,
                Dorm_Images: sanitizeImageListInput(Dorm_Images),
                Deposit_Fee: Deposit_Fee ? parseFloat(Deposit_Fee) : null,
                Insurance_Fee: Insurance_Fee ? parseFloat(Insurance_Fee) : null,
                Water_Rate: Water_Rate ? String(Water_Rate) : null,
                Electric_Rate: Electric_Rate ? String(Electric_Rate) : null,
                Contract_Duration: Contract_Duration ? parseInt(Contract_Duration, 10) : null,
                Is_Pet_Friendly: Is_Pet_Friendly === true || Is_Pet_Friendly === 'true',
                Is_Smoking_Allowed: Is_Smoking_Allowed === true || Is_Smoking_Allowed === 'true',
                Contact_Info,
                Dorm_Description: Dorm_Description ? String(Dorm_Description) : null,
                Owner_ID: Number(Owner_ID),
                Custom_Facilities: serializeCustomFacilities(Custom_Facilities),
                ...(Facilities && Array.isArray(Facilities) && Facilities.length > 0 && {
                    Facilities: {
                        connect: Facilities.map((id: any) => ({ Facility_ID: Number(id) }))
                    }
                })
            },
        });

        res.status(201).json({
            message: 'สร้างหอพักสำเร็จ! รอแอดมินตรวจสอบ',
            data: withDormImageRefs(newDorm)
        });

    } catch (error: any) {
        console.error('❌ Error creating dorm:', error);
        res.status(500).json({
            message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลหอพัก',
            details: error.message || String(error)
        });
    }
};

// [PATCH] API: แก้ไขข้อมูลหอพัก — รับได้ทุกฟิลด์ที่แก้ไขได้ตอนสร้าง รวมถึงรูปภาพ (ฟอร์มฝั่ง
// client ส่ง Dorm_Images มาเป็น JSON array ของ "รูปทั้งหมดที่ต้องการเก็บไว้" ทุกครั้งที่แก้
// เหมือนกับ Facilities ด้านล่าง — ไม่ใช่แค่รูปใหม่ที่เพิ่ม) ฟิลด์ไหนไม่ส่งมาจะคงค่าเดิมไว้
// ไม่ทับเป็น null เพื่อให้ฟอร์มฝั่ง client ส่งมาแค่บางฟิลด์ก็ยังใช้งานได้
export const updateDorm = async (req: Request, res: Response): Promise<void> => {
    try {
        const dormId = Number(req.params.id);
        if (isNaN(dormId)) {
            res.status(400).json({ message: "ID ไม่ถูกต้อง" });
            return;
        }

        const dorm = await prisma.d3_Dormitories.findUnique({ where: { Dorm_ID: dormId } });
        if (!dorm) {
            res.status(404).json({ message: "ไม่พบหอพักนี้ในระบบ" });
            return;
        }

        // 🚀 ต้องเป็นเจ้าของหอพักตัวนี้เท่านั้นถึงจะแก้ไขได้
        if (dorm.Owner_ID !== req.user!.id) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์แก้ไขหอพักนี้" });
            return;
        }

        const {
            Dorm_Name, Address, Dorm_Type, Dorm_Description, Contact_Info,
            Water_Rate, Electric_Rate, Deposit_Fee, Insurance_Fee, Contract_Duration,
            Is_Pet_Friendly, Is_Smoking_Allowed, Latitude, Longitude,
            Facilities, Custom_Facilities, Dorm_Images,
        } = req.body;

        const updatedDorm = await prisma.d3_Dormitories.update({
            where: { Dorm_ID: dormId },
            data: {
                Dorm_Name: Dorm_Name !== undefined ? String(Dorm_Name) : undefined,
                Address: Address !== undefined ? String(Address) : undefined,
                Dorm_Type: Dorm_Type !== undefined ? String(Dorm_Type) : undefined,
                Dorm_Description: Dorm_Description !== undefined ? String(Dorm_Description) : undefined,
                Contact_Info: Contact_Info !== undefined ? String(Contact_Info) : undefined,
                Water_Rate: Water_Rate !== undefined ? (Water_Rate ? String(Water_Rate) : null) : undefined,
                Electric_Rate: Electric_Rate !== undefined ? (Electric_Rate ? String(Electric_Rate) : null) : undefined,
                Deposit_Fee: Deposit_Fee !== undefined ? (Deposit_Fee !== null ? parseFloat(Deposit_Fee) : null) : undefined,
                Insurance_Fee: Insurance_Fee !== undefined ? (Insurance_Fee !== null ? parseFloat(Insurance_Fee) : null) : undefined,
                Contract_Duration: Contract_Duration !== undefined ? (Contract_Duration !== null ? parseInt(Contract_Duration, 10) : null) : undefined,
                Is_Pet_Friendly: Is_Pet_Friendly !== undefined
                    ? (Is_Pet_Friendly === true || Is_Pet_Friendly === 'true')
                    : undefined,
                Is_Smoking_Allowed: Is_Smoking_Allowed !== undefined
                    ? (Is_Smoking_Allowed === true || Is_Smoking_Allowed === 'true')
                    : undefined,
                Latitude: Latitude !== undefined ? (Latitude !== null ? parseFloat(Latitude) : null) : undefined,
                Longitude: Longitude !== undefined ? (Longitude !== null ? parseFloat(Longitude) : null) : undefined,
                Custom_Facilities: Custom_Facilities !== undefined
                    ? serializeCustomFacilities(Custom_Facilities)
                    : undefined,
                Dorm_Images: Dorm_Images !== undefined
                    ? sanitizeImageListInput(Dorm_Images)
                    : undefined,
                // 🚀 ใช้ set แทน connect เพราะฟอร์มแก้ไขส่ง "รายการที่เลือกทั้งหมด" มาทุกครั้ง
                // ต้องแทนที่ความสัมพันธ์เดิมทั้งชุด ไม่ใช่แค่เพิ่มรายการใหม่เข้าไป
                ...(Array.isArray(Facilities) && {
                    Facilities: {
                        set: Facilities.map((id: any) => ({ Facility_ID: Number(id) })),
                    },
                }),
            },
        });

        res.status(200).json({ message: "แก้ไขข้อมูลหอพักสำเร็จ", data: withDormImageRefs(updatedDorm) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูลหอพัก" });
    }
};

// [GET] API: ดึงรายการหอพักของตัวเอง (สำหรับ Owner Dashboard)
export const getDormsByOwnerId = async (req: Request, res: Response): Promise<void> => {
    try {
        const ownerId = Number(req.params.ownerId);
        if (isNaN(ownerId)) {
            res.status(400).json({ message: "ID เจ้าของหอพักไม่ถูกต้อง" });
            return;
        }

        // 🚀 เจ้าของหอพักดูได้เฉพาะหอพักของตัวเองเท่านั้น (เทียบกับ id ใน token ที่ login ไว้)
        if (req.user!.id !== ownerId) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์ดูข้อมูลนี้" });
            return;
        }

        const dorms = await prisma.d3_Dormitories.findMany({
            where: { Owner_ID: ownerId },
            orderBy: { Dorm_ID: 'desc' }
        });

        res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data: dorms.map((d) => withDormImageRefs(d)) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
    }
};

// [GET] API: ดึงสิ่งอำนวยความสะดวกเฉพาะของ "หอพัก" (จากตาราง D5)
export const getDormFacilities = async (req: Request, res: Response): Promise<void> => {
    try {
        const facilities = await prisma.d5_Facilities.findMany({
            where: { Facility_Type: 'Dormitory' },
            orderBy: { Facility_ID: 'asc' }
        });

        res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data: facilities });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงสิ่งอำนวยความสะดวก" });
    }
};

// [POST] API: สร้างประเภทห้องพักใหม่
export const createRoomType = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            Room_Type_Name, // 🆕 เพิ่มรับค่าชื่อห้องพัก (เช่น ห้อง VIP)
            Room_Type,      // ✅ ประเภทเพื่อค้นหา (เช่น Air, Fan)
            Price_Per_Month, Total_Rooms, Remaining_Rooms,
            Room_Images, Room_Status, Dorm_ID, Facilities, Custom_Facilities
        } = req.body;

        const dormId = Number(Dorm_ID);
        const price = Number(Price_Per_Month);
        const totalRooms = Number(Total_Rooms);
        const remainingRooms = Number(Remaining_Rooms);

        if (!Room_Type_Name || isNaN(dormId) || isNaN(price) || isNaN(totalRooms) || isNaN(remainingRooms)) {
            res.status(400).json({ message: "กรุณาระบุ Room_Type_Name, Dorm_ID, Price_Per_Month, Total_Rooms และ Remaining_Rooms ให้ครบและถูกต้อง" });
            return;
        }

        // 🚀 ต้องเป็นเจ้าของหอพักตัวนี้เท่านั้นถึงจะเพิ่มประเภทห้องได้
        const dorm = await prisma.d3_Dormitories.findUnique({ where: { Dorm_ID: dormId } });
        if (!dorm) {
            res.status(404).json({ message: "ไม่พบหอพักนี้ในระบบ" });
            return;
        }
        if (dorm.Owner_ID !== req.user!.id) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์เพิ่มห้องพักให้หอพักนี้" });
            return;
        }

        const newRoomType = await prisma.d4_Room_Types.create({
            data: {
                Room_Type_Name: Room_Type_Name, // 🆕 บันทึกลงตาราง
                Room_Type: Room_Type,
                Price_Per_Month: price,
                Total_Rooms: totalRooms,
                Remaining_Rooms: remainingRooms,
                // 🚀 Flutter ส่ง Room_Images มาเป็น JSON string ของ List<String> อยู่แล้ว (jsonEncode(imageUrls))
                // ห้าม JSON.stringify() ซ้ำ ไม่งั้นจะเป็นการ encode ซ้อนกัน 2 ชั้น ทำให้ฝั่งแอปดึงรูปไม่ออก
                Room_Images: sanitizeImageListInput(Room_Images),
                Room_Status,
                Dorm_ID: dormId,
                Custom_Facilities: serializeCustomFacilities(Custom_Facilities),
                ...(Array.isArray(Facilities) && Facilities.length > 0 && {
                    Facilities: {
                        connect: Facilities.map((id: number) => ({ Facility_ID: Number(id) }))
                    }
                })
            }
        });

        res.status(201).json({ message: "เพิ่มประเภทห้องพักสำเร็จ", data: withRoomImageRefs(newRoomType) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการเพิ่มห้องพัก" });
    }
};

// [PATCH] API: แก้ไขข้อมูลประเภทห้องพัก — รองรับแก้รูปภาพด้วย (ฟอร์มฝั่ง client ส่ง
// Room_Images มาเป็น JSON array ของ "รูปทั้งหมดที่ต้องการเก็บไว้" ทุกครั้งที่แก้ เหมือนกับ
// Facilities ด้านล่าง) เจ้าของหอเท่านั้นที่แก้ไขได้ (เช็คผ่านห้อง -> หอ -> Owner_ID)
export const updateRoomType = async (req: Request, res: Response): Promise<void> => {
    try {
        const roomId = Number(req.params.id);
        if (isNaN(roomId)) {
            res.status(400).json({ message: "ID ห้องพักไม่ถูกต้อง" });
            return;
        }

        const room = await prisma.d4_Room_Types.findUnique({
            where: { Room_Type_ID: roomId },
            include: { Dorm: { select: { Owner_ID: true } } },
        });
        if (!room) {
            res.status(404).json({ message: "ไม่พบห้องพักนี้ในระบบ" });
            return;
        }
        if (room.Dorm?.Owner_ID !== req.user!.id) {
            res.status(403).json({ message: "คุณไม่มีสิทธิ์แก้ไขห้องพักนี้" });
            return;
        }

        const {
            Room_Type_Name, Room_Type, Price_Per_Month, Total_Rooms, Remaining_Rooms,
            Room_Status, Facilities, Custom_Facilities, Room_Images,
        } = req.body;

        const updatedRoom = await prisma.d4_Room_Types.update({
            where: { Room_Type_ID: roomId },
            data: {
                Room_Type_Name: Room_Type_Name !== undefined ? String(Room_Type_Name) : undefined,
                Room_Type: Room_Type !== undefined ? String(Room_Type) : undefined,
                Price_Per_Month: Price_Per_Month !== undefined ? parseFloat(Price_Per_Month) : undefined,
                Total_Rooms: Total_Rooms !== undefined ? parseInt(Total_Rooms, 10) : undefined,
                Remaining_Rooms: Remaining_Rooms !== undefined ? parseInt(Remaining_Rooms, 10) : undefined,
                Room_Status: Room_Status !== undefined ? String(Room_Status) : undefined,
                Custom_Facilities: Custom_Facilities !== undefined
                    ? serializeCustomFacilities(Custom_Facilities)
                    : undefined,
                Room_Images: Room_Images !== undefined
                    ? sanitizeImageListInput(Room_Images)
                    : undefined,
                // 🚀 ใช้ set แทน connect เพราะฟอร์มแก้ไขส่ง "รายการที่เลือกทั้งหมด" มาทุกครั้ง
                // ต้องแทนที่ความสัมพันธ์เดิมทั้งชุด ไม่ใช่แค่เพิ่มรายการใหม่เข้าไป
                ...(Array.isArray(Facilities) && {
                    Facilities: {
                        set: Facilities.map((id: any) => ({ Facility_ID: Number(id) })),
                    },
                }),
            },
        });

        res.status(200).json({ message: "แก้ไขข้อมูลห้องพักสำเร็จ", data: withRoomImageRefs(updatedRoom) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขห้องพัก" });
    }
};

// [GET] API: ดึงสิ่งอำนวยความสะดวกเฉพาะของ "ห้องพัก" (Room)
export const getRoomFacilities = async (req: Request, res: Response): Promise<void> => {
    try {
        const facilities = await prisma.d5_Facilities.findMany({
            where: { Facility_Type: 'Room' },
            orderBy: { Facility_ID: 'asc' }
        });
        res.status(200).json({ message: "ดึงข้อมูลสำเร็จ", data: facilities });
    } catch (error) {
        res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงสิ่งอำนวยความสะดวก" });
    }
};