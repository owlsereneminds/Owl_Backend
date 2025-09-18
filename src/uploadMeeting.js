// middleware/uploadMeeting.js
import multer from 'multer';

const storage = multer.memoryStorage(); // keep in memory, later you can push to S3/Cloud
const upload = multer({ storage });

export const meetingUploadMiddleware = upload.fields([
  { name: 'meetingData', maxCount: 1 },
  { name: 'user_audio', maxCount: 1 },
  { name: 'remote_0' }, // you can allow multiple dynamic remote_X
  { name: 'remote_1' },
  { name: 'remote_2' }
]);

export function parseMeetingData(req, res, next) {
  try {
    if (!req.files?.meetingData) {
      return res.status(400).json({ error: 'meetingData missing' });
    }
    const jsonStr = req.files.meetingData[0].buffer.toString();
    req.meetingData = JSON.parse(jsonStr);
    next();
  } catch (err) {
    console.error("❌ Failed to parse meetingData", err);
    res.status(400).json({ error: 'Invalid meetingData' });
  }
}
