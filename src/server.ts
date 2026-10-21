// 📄 ไฟล์นี้ทำหน้าที่: จุดเริ่มต้นของ backend (entry point) — สร้าง Express app, ตั้งค่า CORS,
// mount route ทุกกลุ่มเข้ากับ path /api/*, และสั่งเริ่ม cron job ตรวจสอบการจองที่หมดอายุ
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.route';
import dormRoutes from './routes/dorm.route';
import roommateRoutes from './routes/roommate.route';
import bookingRoutes from './routes/booking.route';
import adminRoutes from './routes/admin.route';
import notificationRoutes from './routes/notification.route';
import reviewRoutes from './routes/review.route';
import imageRoutes from './routes/image.route';
import { startBookingCronJob } from './cron/booking.cron';
import { PORT, ALLOWED_ORIGINS } from './config/env';

const app = express();

app.use(cors(ALLOWED_ORIGINS ? { origin: ALLOWED_ORIGINS } : {}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dorms', dormRoutes);
app.use('/api/roommates', roommateRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/images', imageRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Backend รันพร้อมแล้วที่ http://localhost:${PORT}`);
  startBookingCronJob();
});