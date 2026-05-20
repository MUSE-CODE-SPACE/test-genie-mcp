// Intentionally broken Node app — multiple security issues planted for vibe-check tests.
const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');

// BAD: hardcoded AWS key.
const AWS_KEY = 'AKIA2X7QV6JKLM8RTUVW';

// BAD: hardcoded GitHub PAT.
const GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

// BAD: hardcoded JWT secret.
const JWT_SECRET = 'super-secret-jwt-signing-key-123456';

const app = express();
app.use(express.json());

// BAD: SQL injection via concatenation.
app.get('/user/:id', (req, res) => {
  const db = { query: (_s, _cb) => {} };
  db.query("SELECT * FROM users WHERE id = " + req.params.id, (rows) => res.json(rows));
});

// BAD: Math.random for password reset token.
function generateResetToken() {
  const token = Math.random().toString(36).slice(2);
  return token;
}

// BAD: eval() with user input.
app.post('/calc', (req, res) => {
  const expr = req.body.expr;
  const result = eval(expr);
  res.json({ result });
});

// BAD: child_process exec with user-controlled template literal.
app.get('/ping', (req, res) => {
  exec(`ping -c 1 ${req.query.host}`, (err, out) => res.send(out));
});

// BAD: CORS wildcard with credentials.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

// BAD: weak hash for password.
function hashPassword(p) {
  return crypto.createHash('md5').update(p).digest('hex');
}

// BAD: cookie without httpOnly / secure / sameSite.
app.get('/login', (req, res) => {
  res.cookie('session', 'abc123');
  res.send('ok');
});

// BAD: SSRF — fetch user-controlled URL.
app.get('/proxy', async (req, res) => {
  const r = await fetch(req.query.url);
  res.send(await r.text());
});

app.listen(3000);
