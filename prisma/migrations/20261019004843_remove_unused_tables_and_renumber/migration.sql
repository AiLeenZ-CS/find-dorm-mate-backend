-- 🚀 ตัดตารางที่ไม่ได้ใช้งานเลยออก (D8_Queues, D12_Chats — ไม่มีโค้ดใดอ้างอิงเลยทั้งโปรเจกต์)
-- แล้ว renumber ตารางที่เหลือให้เลขเรียงต่อเนื่องกัน เขียน SQL เองแทนให้ Prisma diff อัตโนมัติ
-- เพราะ diff แบบ non-interactive จะมองว่าเป็นการ DROP ตารางเก่า + CREATE ตารางใหม่ (ข้อมูลหาย)
-- แทนที่จะมองว่าเป็นการ "เปลี่ยนชื่อ" จึงต้องใช้ RENAME TABLE ตรงๆ เพื่อรักษาข้อมูลเดิมไว้
-- (InnoDB จะอัปเดต FOREIGN KEY ที่ตารางอื่นชี้มาที่ตารางที่ถูกเปลี่ยนชื่อให้อัตโนมัติ)

-- 1) ตัด FK ของ D9_Bookings.Queue_ID ที่ชี้ไป D8_Queues แล้วลบคอลัมน์ทิ้ง (ไม่มีโค้ดใช้งานฟิลด์นี้)
ALTER TABLE `D9_Bookings` DROP FOREIGN KEY `D9_Bookings_Queue_ID_fkey`;
ALTER TABLE `D9_Bookings` DROP COLUMN `Queue_ID`;

-- 2) ลบ 2 ตารางที่ไม่มีโค้ดอ้างอิงเลย (ทั้ง D8_Queues และ D12_Chats ว่างอยู่แล้ว ไม่มีข้อมูลสูญหาย)
DROP TABLE `D8_Queues`;
DROP TABLE `D12_Chats`;

-- 3) Renumber ตารางที่เหลือให้เลขเรียงต่อเนื่อง (D9-D14 เดิม เลื่อนลงมาเติมช่องว่างของ D8, D12)
RENAME TABLE `D9_Bookings` TO `D8_Bookings`;
RENAME TABLE `D10_Reviews` TO `D9_Reviews`;
RENAME TABLE `D11_User_Reports` TO `D10_User_Reports`;
RENAME TABLE `D13_Notifications` TO `D11_Notifications`;
RENAME TABLE `D14_Device_Tokens` TO `D12_Device_Tokens`;
