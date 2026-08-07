// 能力测绘效率台 · 本地桥接服务（零依赖，仅做文件搬运，不触碰任何 API key）
// 启动：node bridge.mjs   然后浏览器打开 http://127.0.0.1:8787/
import http from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8787;
const HOST = '127.0.0.1';
const QUEUE = path.join(__dirname, '.aiq', 'queue');
const DONE = path.join(__dirname, '.aiq', 'done');
const INDEX = path.join(__dirname, 'index.html');

await mkdir(QUEUE, { recursive: true });
await mkdir(DONE, { recursive: true });

function newId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

async function readJson(file){
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { return null; }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);

  // 托管工作台页面
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    try {
      const html = await readFile(INDEX, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('index.html 未找到，请确认 bridge.mjs 与 index.html 同目录');
    }
    return;
  }

  // 健康检查
  if (req.method === 'GET' && u.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, queue: QUEUE, done: DONE }));
    return;
  }

  // 提交任务 → 写入队列
  if (req.method === 'POST' && u.pathname === '/api/submit') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let task = null;
    try { task = JSON.parse(body).task; } catch (e) {}
    if (!task || typeof task !== 'string' || !task.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'task required' }));
      return;
    }
    const tid = newId();
    const createdAt = new Date().toISOString();
    await writeFile(
      path.join(QUEUE, `task-${tid}.json`),
      JSON.stringify({ id: tid, task: task.trim(), createdAt }, null, 2)
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: tid, createdAt }));
    return;
  }

  // 读取结果
  if (req.method === 'GET' && u.pathname === '/api/results') {
    let files = [];
    try { files = (await readdir(DONE)).filter(f => f.endsWith('.json')); } catch (e) {}
    const arr = [];
    for (const f of files) {
      const d = await readJson(path.join(DONE, f));
      if (d) arr.push(d);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(arr));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`能力测绘效率台 · 本地桥接已启动`);
  console.log(`  打开: http://${HOST}:${PORT}/`);
  console.log(`  队列: ${QUEUE}`);
});
