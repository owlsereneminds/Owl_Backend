import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { query } from './db.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'dev-secret';
const COOKIE_NAME = 'meet_jwt';

// Passport user serialization (we won't use sessions heavily; JWT will be used)
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Configure Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || `${process.env.BACKEND_URL || 'http://localhost:4000'}/auth/google/callback`,
  passReqToCallback: false,
},
async (accessToken, refreshToken, profile, cb) => {
  // profile contains the user info
  const email = profile.emails?.[0]?.value;
  const name = profile.displayName;
  const image = profile.photos?.[0]?.value;

  // Upsert user (non-blocking attempt OK, but keep synchronous here)
  try {
    await query(
      `INSERT INTO users (email, name, image, given_name, family_name, locale, email_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         image = EXCLUDED.image,
         given_name = EXCLUDED.given_name,
         family_name = EXCLUDED.family_name,
         locale = EXCLUDED.locale,
         email_verified = EXCLUDED.email_verified,
         updated_at = NOW()
       RETURNING id, email, name, image`,
      [
        email,
        name,
        image || null,
        profile.name?.givenName || null,
        profile.name?.familyName || null,
        profile._json?.locale || null,
        profile._json?.email_verified ?? false
      ]
    );
  } catch (err) {
    console.error('DB upsert error', err);
    // continue — we don't block authentication on DB issues
  }

  const user = {
    id: profile.id,
    email,
    name,
    image,
    provider: 'google',
    accessToken,
    refreshToken
  };

  return cb(null, user);
}));

// route to start auth
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'], accessType: 'offline', prompt: 'consent' })
);

// callback route
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/auth/failure' }),
  (req, res) => {
    // req.user is set by passport
    const user = req.user || {};
    // create JWT token
    const token = jwt.sign({
      sub: user.id,
      name: user.name,
      email: user.email,
      picture: user.image
    }, JWT_SECRET, { expiresIn: '30d' });

    // set cookie and redirect to success page (frontend should read cookie or query param)
    const cookieOptions = [
      `HttpOnly; Path=/; Max-Age=${30 * 24 * 60 * 60}`
    ];
    if (process.env.NODE_ENV === 'production') {
      cookieOptions.push('Secure; SameSite=None');
    } else {
      cookieOptions.push('SameSite=Lax');
    }

    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; ${cookieOptions.join('; ')}`);
    // redirect with optional user info in query if needed
    const redirectUrl = `${process.env.CLIENT_URL || CLIENT_URL}/auth/success?user=${encodeURIComponent(user.name || user.email || '')}`;
    return res.redirect(redirectUrl);
  }
);

router.get('/failure', (req, res) => {
  res.status(401).send('Authentication Failed');
});

export default router;
