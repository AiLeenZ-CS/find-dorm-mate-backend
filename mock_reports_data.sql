-- =========================================================
-- Mock data สำหรับทดสอบหน้า "รายงานผู้ใช้" (D11_User_Reports)
-- รันบนฐานข้อมูล find_dorm_mate_db (MySQL)
-- =========================================================

-- 1) เพิ่มสมาชิกสมมุติเพิ่มอีก 3 คน (รหัสผ่านเป็น hash ปลอมไว้เฉย ๆ ใช้ล็อกอินจริงไม่ได้)
INSERT INTO `D1_Members`
  (`Username`, `Email`, `Password`, `First_Name`, `Last_Name`, `Gender`, `User_Role`, `Account_Status`, `Is_Profile_Completed`)
VALUES
  ('preechaS',    'preecha.s@gmail.com',   '$2b$10$GpEVfvJaU/2rJ9NVlJKy8.3G6DU7ePiXLbqOSb0QiG2nF0T9EhT.e', 'ปรีชา',     'สมบูรณ์',   'Male',   'Member', 'Active', 1),
  ('kanyarat_w',  'kanyarat.w@gmail.com',  '$2b$10$GpEVfvJaU/2rJ9NVlJKy8.3G6DU7ePiXLbqOSb0QiG2nF0T9EhT.e', 'กัญญารัตน์', 'วงศ์ษา',   'Female', 'Member', 'Active', 1),
  ('thanapon99',  'thanapon.p@gmail.com',  '$2b$10$GpEVfvJaU/2rJ9NVlJKy8.3G6DU7ePiXLbqOSb0QiG2nF0T9EhT.e', 'ธนพล',      'ประเสริฐ', 'Male',   'Member', 'Active', 1);

-- 2) เพิ่มการจองห้องสมมุติ (อ้างอิงหอพัก/ประเภทห้องที่มีอยู่จริง: Dorm_ID 1, Room_Type_ID 1)
INSERT INTO `D9_Bookings`
  (`Member_ID`, `Dorm_ID`, `Room_Type_ID`, `Booking_Status`, `Expected_Move_In`, `Requested_At`)
SELECT Member_ID, 1, 1, 'Confirmed', DATE_ADD(CURDATE(), INTERVAL 7 DAY), DATE_SUB(NOW(), INTERVAL 20 DAY)
FROM `D1_Members` WHERE `Username` = 'aaa';

INSERT INTO `D9_Bookings`
  (`Member_ID`, `Dorm_ID`, `Room_Type_ID`, `Booking_Status`, `Expected_Move_In`, `Requested_At`)
SELECT Member_ID, 1, 1, 'Confirmed', DATE_ADD(CURDATE(), INTERVAL 14 DAY), DATE_SUB(NOW(), INTERVAL 15 DAY)
FROM `D1_Members` WHERE `Username` = 'MidNightZ';

INSERT INTO `D9_Bookings`
  (`Member_ID`, `Dorm_ID`, `Room_Type_ID`, `Booking_Status`, `Expected_Move_In`, `Requested_At`)
SELECT Member_ID, 1, 1, 'Cancelled', DATE_ADD(CURDATE(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 10 DAY)
FROM `D1_Members` WHERE `Username` = 'preechaS';

-- 3) เพิ่มรายงานผู้ใช้ 6 รายการ (ผสมสถานะ Pending/Resolved และมี/ไม่มีการจองที่เกี่ยวข้อง)
INSERT INTO `D11_User_Reports`
  (`Reporter_ID`, `Reported_User_ID`, `Booking_ID`, `Reason`, `Status`, `Reported_At`, `Closed_At`)
SELECT
  reporter.Member_ID, reported.Member_ID, booking.Booking_ID,
  'ผู้เช่าส่งเสียงดังรบกวนเพื่อนบ้านตอนดึกเป็นประจำ',
  'Pending', DATE_SUB(NOW(), INTERVAL 2 DAY), NULL
FROM `D1_Members` reporter, `D1_Members` reported, `D9_Bookings` booking
WHERE reporter.Username = 'aaa' AND reported.Username = 'MidNightZ'
  AND booking.Member_ID = reported.Member_ID LIMIT 1;

INSERT INTO `D11_User_Reports`
  (`Reporter_ID`, `Reported_User_ID`, `Booking_ID`, `Reason`, `Status`, `Reported_At`, `Closed_At`)
SELECT
  reporter.Member_ID, reported.Member_ID, NULL,
  'นัดดูห้องพักแล้วไม่มาตามนัดหลายครั้งโดยไม่แจ้งล่วงหน้า',
  'Resolved', DATE_SUB(NOW(), INTERVAL 9 DAY), DATE_SUB(NOW(), INTERVAL 6 DAY)
FROM `D1_Members` reporter, `D1_Members` reported
WHERE reporter.Username = 'MidNightZ' AND reported.Username = 'kanyarat_w' LIMIT 1;

INSERT INTO `D11_User_Reports`
  (`Reporter_ID`, `Reported_User_ID`, `Booking_ID`, `Reason`, `Status`, `Reported_At`, `Closed_At`)
SELECT
  reporter.Member_ID, reported.Member_ID, NULL,
  'มีพฤติกรรมหลอกลวง ขอยืมเงินเพื่อนสมาชิกในหอแล้วไม่ยอมคืน',
  'Pending', DATE_SUB(NOW(), INTERVAL 1 DAY), NULL
FROM `D1_Members` reporter, `D1_Members` reported
WHERE reporter.Username = 'preechaS' AND reported.Username = 'aaa' LIMIT 1;

INSERT INTO `D11_User_Reports`
  (`Reporter_ID`, `Reported_User_ID`, `Booking_ID`, `Reason`, `Status`, `Reported_At`, `Closed_At`)
SELECT
  reporter.Member_ID, reported.Member_ID, booking.Booking_ID,
  'ทำทรัพย์สินส่วนกลางในหอพักเสียหายแล้วไม่ยอมรับผิดชอบค่าเสียหาย',
  'Resolved', DATE_SUB(NOW(), INTERVAL 12 DAY), DATE_SUB(NOW(), INTERVAL 4 DAY)
FROM `D1_Members` reporter, `D1_Members` reported, `D9_Bookings` booking
WHERE reporter.Username = 'kanyarat_w' AND reported.Username = 'thanapon99'
  AND booking.Member_ID = (SELECT Member_ID FROM D1_Members WHERE Username = 'preechaS') LIMIT 1;

INSERT INTO `D11_User_Reports`
  (`Reporter_ID`, `Reported_User_ID`, `Booking_ID`, `Reason`, `Status`, `Reported_At`, `Closed_At`)
SELECT
  reporter.Member_ID, reported.Member_ID, NULL,
  'ใช้ถ้อยคำหยาบคายและมีลักษณะคุกคามทางแชทในระบบ',
  'Pending', DATE_SUB(NOW(), INTERVAL 5 HOUR), NULL
FROM `D1_Members` reporter, `D1_Members` reported
WHERE reporter.Username = 'thanapon99' AND reported.Username = 'MidNightZ' LIMIT 1;

INSERT INTO `D11_User_Reports`
  (`Reporter_ID`, `Reported_User_ID`, `Booking_ID`, `Reason`, `Status`, `Reported_At`, `Closed_At`)
SELECT
  reporter.Member_ID, reported.Member_ID, NULL,
  'ค้างชำระค่าเช่าห้องเกินกำหนดโดยไม่แจ้งล่วงหน้า',
  'Resolved', DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 18 DAY)
FROM `D1_Members` reporter, `D1_Members` reported
WHERE reporter.Username = 'aaa' AND reported.Username = 'preechaS' LIMIT 1;
