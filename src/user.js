// routes/user.js
import express from 'express';
import { getPool } from '../db.js';
import { meetingUploadMiddleware, parseMeetingData } from '../middleware/uploadMeeting.js';

const router = express.Router();

router.post(
  '/',
  meetingUploadMiddleware,
  parseMeetingData,
  async (req, res) => {
    const pool = getPool();
    const data = req.meetingData;
    const profile = data.userProfile;

    try {
      // 1️⃣ Upsert user
      let userId = null;
      if (profile?.email) {
        const result = await pool.query(
          `INSERT INTO users (email, name, image, given_name, family_name, email_verified)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             image = EXCLUDED.image,
             given_name = EXCLUDED.given_name,
             family_name = EXCLUDED.family_name,
             email_verified = EXCLUDED.email_verified,
             updated_at = NOW()
           RETURNING id`,
          [profile.email, profile.name, profile.picture, profile.given_name, profile.family_name, profile.email_verified]
        );
        userId = result.rows[0].id;
      }

      // 2️⃣ Insert meeting
      const meet = await pool.query(
        `INSERT INTO meetings (meeting_code, meeting_title, meet_url, user_id, duration_ms, raw_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          data.meetingInfo.meetingCode,
          data.meetingInfo.meetingTitle,
          data.meetingInfo.meetUrl,
          userId,
          data.durationMs,
          data
        ]
      );
      const meetingId = meet.rows[0].id;

      // 3️⃣ Insert participants
      if (data.participants?.length) {
        for (const p of data.participants) {
          await pool.query(
            `INSERT INTO participants (meeting_id, name, join_time)
             VALUES ($1, $2, $3)`,
            [meetingId, p.name, p.joinTime]
          );
        }
      }

      // 4️⃣ Insert engagement signals
      if (data.engagement?.length) {
        for (const s of data.engagement) {
          await pool.query(
            `INSERT INTO engagement_signals (meeting_id, participant_name, video_on)
             VALUES ($1, $2, $3)`,
            [meetingId, s.name, s.videoOn]
          );
        }
      }

      // 5️⃣ Optionally: Save audio blobs to disk/S3
      if (req.files?.user_audio) {
        console.log("User audio size:", req.files.user_audio[0].buffer.length);
        // TODO: save buffer to storage
      }

      res.json({ success: true, meetingId });
    } catch (err) {
      console.error("❌ Failed to save meeting data", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
