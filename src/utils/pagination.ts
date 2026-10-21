// 📄 ไฟล์นี้ทำหน้าที่: รวม helper กลางสำหรับทำ pagination (parsePagination อ่าน page/limit
// จาก query string, buildMeta สร้างข้อมูล meta) ใช้ร่วมกันในหลาย controller ที่ต้องแบ่งหน้ารายการ
import { Request } from 'express';

export interface PaginationParams {
  skip: number;
  take: number;
  page: number;
  limit: number;
}

// 🚀 อ่าน ?page=&limit= จาก query string — ถ้าไม่ส่งมาเลยจะคืน null (พฤติกรรมเดิม: ดึงมาหมด)
// เพื่อไม่ให้ frontend เดิมที่ยังไม่รองรับ pagination พัง ต้องส่ง page+limit มาทั้งคู่ถึงจะเปิดใช้งาน
export function parsePagination(req: Request, defaultLimit = 20, maxLimit = 100): PaginationParams | null {
  const { page: pageRaw, limit: limitRaw } = req.query;
  if (pageRaw === undefined && limitRaw === undefined) return null;

  const page = Math.max(1, Number(pageRaw) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(limitRaw) || defaultLimit));

  return { skip: (page - 1) * limit, take: limit, page, limit };
}

export function buildMeta(pagination: PaginationParams | null, total: number) {
  if (!pagination) return undefined;
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages: Math.ceil(total / pagination.limit),
  };
}
