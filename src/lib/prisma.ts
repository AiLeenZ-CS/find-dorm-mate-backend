import { PrismaClient } from '@prisma/client';

// 🚀 Client เดียวใช้ร่วมกันทั้งแอป — ก่อนหน้านี้แต่ละ controller/cron สร้าง PrismaClient ของตัวเอง
// ทำให้เปิด connection pool ซ้ำซ้อนหลายชุดโดยไม่จำเป็น
export const prisma = new PrismaClient();
