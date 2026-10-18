import 'dotenv/config';
import admin from 'firebase-admin';
import { prisma } from '../src/lib/prisma';
import { getFirestoreDb } from '../src/config/firebase-admin';

// 🚀 Script แก้ข้อมูลย้อนหลัง (รันครั้งเดียว) — ห้องแชท Firestore ปกติถูกสร้าง/อัปเดตโดย
// syncChatParticipants ตอนอนุมัติคำขอจับคู่ใน roommate.controller.ts แต่คู่ที่ถูกอนุมัติ
// "ก่อน" ที่ Firestore Database จะถูกเปิดใช้งานจริงในโปรเจกต์ (หรือช่วงที่ Admin SDK
// เขียนไม่ผ่านด้วยเหตุผลอื่น) จะไม่มีห้องแชทเลย เพราะตอนนั้นเขียนไม่สำเร็จแล้วถูก catch เงียบๆ
// ไป (ไม่บล็อกการอนุมัติคำขอหลัก) — รัน script นี้เพื่อ sync ย้อนหลังให้คู่ที่ Matched อยู่แล้ว
// ทุกคู่มีห้องแชทครบ
//
// วิธีรัน: cd Backend && npx ts-node scripts/backfill-chat-participants.ts
async function main() {
  const matches = await prisma.d7_Roommate_Matches.findMany({
    where: { Match_Status: 'Matched' },
    include: { Post: { select: { Member_ID: true } } },
  });

  const participantsByPost = new Map<number, Set<string>>();
  for (const match of matches) {
    if (!match.Post_ID || !match.Post?.Member_ID || !match.Member_ID) continue;

    const uids = participantsByPost.get(match.Post_ID) ?? new Set<string>();
    uids.add(`member_${match.Post.Member_ID}`);
    uids.add(`member_${match.Member_ID}`);
    participantsByPost.set(match.Post_ID, uids);
  }

  if (participantsByPost.size === 0) {
    console.log('ไม่มีคู่ที่ Matched อยู่ในระบบ — ไม่มีอะไรต้อง backfill');
    return;
  }

  const db = getFirestoreDb();
  for (const [postId, uidSet] of participantsByPost) {
    await db
      .collection('roommate_chats')
      .doc(`post_${postId}`)
      .set(
        {
          postId,
          participantIds: Array.from(uidSet),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    console.log(`✅ sync ห้องแชท post_${postId}:`, Array.from(uidSet));
  }

  console.log(`เสร็จแล้ว — sync ห้องแชททั้งหมด ${participantsByPost.size} ห้อง`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill Chat Participants Error:', error);
    process.exit(1);
  });
