import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// 🚀 สร้าง Master Admin คนแรก (รันครั้งเดียวตอน deploy/setup เท่านั้น - ไม่มีการสมัคร
// Admin ผ่านแอปหรือ API สาธารณะใดๆ ทั้งสิ้น ต้องมาจาก seed นี้เท่านั้น)
// วิธีใช้: ตั้งค่า SEED_MASTER_ADMIN_EMAIL / SEED_MASTER_ADMIN_PASSWORD ใน .env ก่อน แล้วรัน
//   npx prisma db seed
async function main() {
  const email = process.env.SEED_MASTER_ADMIN_EMAIL;
  const password = process.env.SEED_MASTER_ADMIN_PASSWORD;
  const username = process.env.SEED_MASTER_ADMIN_USERNAME || 'master_admin';

  if (!email || !password) {
    throw new Error(
      'กรุณาตั้งค่า SEED_MASTER_ADMIN_EMAIL และ SEED_MASTER_ADMIN_PASSWORD ใน .env ก่อนรัน seed'
    );
  }

  const existing = await prisma.d1_Members.findFirst({ where: { User_Role: 'Master_Admin' } });
  if (existing) {
    console.log(`มี Master Admin อยู่แล้ว: ${existing.Email} (ข้ามการสร้างใหม่)`);
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const masterAdmin = await prisma.d1_Members.create({
    data: {
      Username: username,
      Email: email,
      Password: hashedPassword,
      User_Role: 'Master_Admin',
      Is_Profile_Completed: true,
    },
  });

  console.log(`สร้าง Master Admin สำเร็จ: ${masterAdmin.Email} (Member_ID: ${masterAdmin.Member_ID})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
