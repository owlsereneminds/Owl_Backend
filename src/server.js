import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import cors from 'cors';
import authRouter from './auth.js';
import uploadRouter from './upload.js';
import healthRouter from './health.js';
import { parseAllowedOrigins } from './utils.js';
import serverless from 'serverless-http'; // 👈 ye add karo

const app = express();
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || '');

const corsOptions = {
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (!allowedOrigins.length) return callback(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(passport.initialize());
app.use(passport.session());

// Routes
app.get('/', (req, res) => res.send('Hello World from Vercel backend!'));
app.use('/api/auth', authRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/health', healthRouter);

app.get('/api/auth/success', (req, res) => {
  res.send("Auth success page");
});

app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: err.message || 'server error' });
});

// ❌ Ye line hata do
// app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

// ✅ Iske jagah ye add karo
export const handler = serverless(app);
