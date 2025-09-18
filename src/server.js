// import 'dotenv/config';
// import express from 'express';
// import session from 'express-session';
// import passport from 'passport';
// import cors from 'cors';
// import authRouter from './auth.js';
// import uploadRouter from './upload.js';
// import healthRouter from './health.js';
// import { parseAllowedOrigins } from './utils.js';

// const app = express();
// const PORT = process.env.PORT || 4000;
// const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || '');

// const corsOptions = {
//   origin: function(origin, callback) {
//     // allow requests with no origin (like mobile apps or curl)
//     if (!origin) return callback(null, true);
//     if (!allowedOrigins.length) return callback(null, true);
//     if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   credentials: true,
//   methods: ['GET', 'POST', 'OPTIONS']
// };

// app.use(cors(corsOptions));
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // session (required by passport) - we use session only for handshake, token is JWT
// app.use(session({
//   secret: process.env.SESSION_SECRET || 'dev-secret',
//   resave: false,
//   saveUninitialized: false,
//   cookie: { secure: process.env.NODE_ENV === 'production' }
// }));

// app.use(passport.initialize());
// app.use(passport.session());

// // mount routers
// app.get('/', (req, res) => res.send('Hello World'));
// app.use('/api/auth', authRouter);
// app.use('/api/upload', uploadRouter);
// app.use('/api/health', healthRouter);

// // static success page (simple HTML)
// app.get('/api/auth/success', (req, res) => {
//   const user = req.query.user || '';
//   res.setHeader('Content-Type', 'text/html');
//   res.send(`<!doctype html>
// <html><head><meta charset="utf-8"><title>Authentication Successful</title>
// <style>
// body{font-family:Arial, sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:linear-gradient(135deg,#4CAF50 0%,#2e8b57 100%);color:#fff}
// .container{padding:2rem;background:rgba(255,255,255,0.08);border-radius:10px;text-align:center}
// .button{background:#fff;color:#4CAF50;padding:10px 20px;border:none;border-radius:5px;cursor:pointer}
// </style></head><body>
// <div class="container">
//   <h1>✅ Authentication Successful</h1>
//   <p>Welcome ${user ? user : ''}! You have been signed in successfully.</p>
//   <p>You can now close this window.</p>
//   <button class="button" onclick="window.close()">Close Window</button>
// </div>
// <script>setTimeout(()=>window.close(),3000);</script>
// </body></html>`);
// });

// app.use((err, req, res, next) => {
//   console.error('Unhandled error', err);
//   res.status(500).json({ error: err.message || 'server error' });
// });

// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });

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
