require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');
require('dayjs/locale/ko');

dayjs.extend(relativeTime);
dayjs.locale('ko');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// 공통 미들웨어: 로그인 정보 전달 및 시간 변환 함수
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.formatTime = (date) => dayjs(date).fromNow();
  next();
});

// --- Routes ---

// 1. 게시판 목록 조회
app.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 5;
  const offset = (page - 1) * limit;

  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM posts');
    const totalPosts = parseInt(countRes.rows[0].count);
    const totalPages = Math.ceil(totalPosts / limit);

    const postsRes = await pool.query(`
      SELECT p.*, (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count 
      FROM posts p 
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2`, 
      [limit, offset]
    );

    res.render('list', { posts: postsRes.rows, currentPage: page, totalPages });
  } catch (err) {
    console.error(err);
    res.status(500).send('서버 에러');
  }
});

// 2. 회원가입
app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', async (req, res) => {
  const { username, password, nickname } = req.body;
  try {
    await pool.query('INSERT INTO users (username, password, nickname) VALUES ($1, $2, $3)', [username, password, nickname]);
    res.redirect('/login');
  } catch (err) {
    res.send('<script>alert("이미 존재하는 아이디입니다."); history.back();</script>');
  }
});

// 3. 로그인
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const userRes = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
  if (userRes.rows.length > 0) {
    req.session.user = userRes.rows[0];
    res.redirect('/');
  } else {
    res.send('<script>alert("정보가 일치하지 않습니다."); history.back();</script>');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// 4. 게시물 조회
app.get('/post/:id', async (req, res) => {
  const postRes = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  const commentsRes = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at ASC', [req.params.id]);
  res.render('view', { post: postRes.rows[0], comments: commentsRes.rows });
});

// 5. 글쓰기 & 수정
app.get('/write', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('write', { post: null });
});

app.get('/edit/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const postRes = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  if (postRes.rows[0].author !== req.session.user.nickname) return res.send('권한이 없습니다.');
  res.render('write', { post: postRes.rows[0] });
});

app.post('/write', async (req, res) => {
  const { title, content, id } = req.body;
  const author = req.session.user.nickname;
  if (id) {
    await pool.query('UPDATE posts SET title = $1, content = $2 WHERE id = $3', [title, content, id]);
  } else {
    await pool.query('INSERT INTO posts (title, content, author) VALUES ($1, $2, $3)', [title, content, author]);
  }
  res.redirect('/');
});

// 삭제
app.get('/delete/:id', async (req, res) => {
    const postRes = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    if (req.session.user && postRes.rows[0].author === req.session.user.nickname) {
        await pool.query('DELETE FROM comments WHERE post_id = $1', [req.params.id]);
        await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
    }
    res.redirect('/');
});

// 추천
app.get('/like/:id', async (req, res) => {
  await pool.query('UPDATE posts SET likes = likes + 1 WHERE id = $1', [req.params.id]);
  res.redirect('/post/' + req.params.id);
});

// 댓글 쓰기
app.post('/comment', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { post_id, content } = req.body;
  await pool.query('INSERT INTO comments (post_id, author, content) VALUES ($1, $2, $3)', [post_id, req.session.user.nickname, content]);
  res.redirect('/post/' + post_id);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
