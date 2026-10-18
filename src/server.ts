import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.route';
import dormRoutes from './routes/dorm.route';
import roommateRoutes from './routes/roommate.route'; // ✅ 1. Import Route รูมเมท
import bookingRoutes from './routes/booking.route';
import adminRoutes from './routes/admin.route';
import notificationRoutes from './routes/notification.route';
import reviewRoutes from './routes/review.route';
import imageRoutes from './routes/image.route';
import { startBookingCronJob } from './cron/booking.cron';
import { PORT, ALLOWED_ORIGINS } from './config/env';

const app = express();

// 🚀 ไม่ตั้งค่า ALLOWED_ORIGINS ใน .env (ตอน dev) = เปิดรับทุก origin เหมือนเดิม
// ตั้งค่าแล้ว (ตอน deploy จริง) = จำกัดเฉพาะโดเมนที่อนุญาตเท่านั้น
app.use(cors(ALLOWED_ORIGINS ? { origin: ALLOWED_ORIGINS } : {}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dorms', dormRoutes);
app.use('/api/roommates', roommateRoutes); // ✅ 2. เปิดใช้งาน Path /api/roommates
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/images', imageRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Backend รันพร้อมแล้วที่ http://localhost:${PORT}`);
  startBookingCronJob();
});