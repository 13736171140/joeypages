// 极简 VLESS-WS Worker（传输方式对齐第二份参考代码）
// 保留：VLESS WS、UUID 认证、回退(p)、订阅、首页、DNS over 53、0-rtt
// 传输：上行 message → 共享 Promise 队列串行 write
//       下行 while 循环复用同一队列，缓存 reader 直接 WS.send

import { connect } from 'cloudflare:sockets';

let 认证令牌 = '25284107-7424-8888-8396-cdd0623f4f05';
let 回退地址 = '';

const 解码器 = new TextDecoder();
function 解码64(t) {
  const 二 = atob(t);
  const 字节 = new Uint8Array(二.length);
  for (let i = 0; i < 二.length; i++) 字节[i] = 二.charCodeAt(i);
  return 解码器.decode(字节);
}

function 解析地址端口(s, 默认端口) {
  s = String(s || '').trim();
  if (!s) return ['', 默认端口];
  if (s.includes('[') && s.includes(']')) {
    const m = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (m) return [m[1], m[2] ? parseInt(m[2]) : 默认端口];
  }
  const i = s.lastIndexOf(':');
  if (i > 0) {
    const h = s.substring(0, i);
    const p = parseInt(s.substring(i + 1));
    if (!h.includes(':') && !isNaN(p) && p > 0 && p <= 65535) return [h, p];
  }
  return [s, 默认端口];
}

// 官方 CF IP 池（回退用）
const 官方直连地址 = 解码64('MTcyLjcxLjIxOC4xOTAsMTYyLjE1OC4yMjguODcsMTYyLjE1OC4xODkuMTM0LDE2Mi4xNTguMjYuNjMsMTYyLjE1OC4yNS44NiwxNjIuMTU4LjI5LjIxNiwxNjIuMTU4LjIxOC4xNjAsMTYyLjE1OC4yMjcuMjE0LDE3Mi42OS4xMTguMTk4LDE3Mi42OS4xMTkuMTUw').split(',');
function 取官方直连地址() {
  return 官方直连地址[Math.floor(Math.random() * 官方直连地址.length)];
}

// ============ 入口 ============
export default {
  async fetch(请求, 环境) {
    try {
      读取环境(环境);
      const 网址 = new URL(请求.url);

      if (请求.headers.get('Upgrade') === 'websocket') {
        return await 处理网页套接字请求(请求);
      }

      const 路径 = 网址.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
      if (路径 === 认证令牌 || 路径 === `${认证令牌}/sub`) {
        return 订阅(请求);
      }

      if (网址.pathname === '/' || 网址.pathname === '') {
        return 首页(请求);
      }

      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return new Response(String((e && e.stack) || e), { status: 500 });
    }
  }
};

function 读取环境(环境 = {}) {
  认证令牌 = String(环境.u || 环境.U || 认证令牌).toLowerCase();
  回退地址 = String(环境.p || 环境.P || '').trim();
}

// ============ 首页 / 订阅 ============
function 首页(请求) {
  const 主机 = 请求.headers.get('Host') || new URL(请求.url).hostname;
  const 链接 = 生成VLESS链接(主机, 认证令牌);
  const 订阅地址 = `${new URL(请求.url).origin}/${认证令牌}/sub`;
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VLESS Worker</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#0f0;padding:2rem;max-width:900px;margin:0 auto;line-height:1.6}
h1{color:#0ff}h2{color:#0ff;margin-top:1.5rem}pre{background:#000;padding:1rem;border:1px solid #0f0;overflow-x:auto;word-break:break-all;white-space:pre-wrap;color:#0f0}
small{color:#888}table{border-collapse:collapse;margin:1rem 0}td{padding:4px 12px;border-bottom:1px solid #333}td:first-child{color:#0ff}</style></head>
<body><h1>VLESS Worker</h1>
<h2>节点链接</h2><pre>${链接}</pre>
<h2>订阅链接</h2><pre>${订阅地址}</pre>
<h2>配置方式（环境变量）</h2>
<table>
<tr><td>u</td><td>UUID（当前：${认证令牌}）</td></tr>
<tr><td>p</td><td>回退地址，例如 ProxyIP.HK.CMLiussss.net:443（当前：${回退地址 || '空（使用内置 CF IP 池）'}）</td></tr>
</table>
<small>极简版：仅 VLESS-WS + 回退。传输方式与第二份参考代码一致。</small>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

function 生成VLESS链接(主机, 用户) {
  const 参数 = new URLSearchParams({
    encryption: 'none',
    security: 'tls',
    sni: 主机,
    fp: 'chrome',
    type: 'ws',
    host: 主机,
    path: '/?ed=2048',
  });
  return `vless://${用户}@${主机}:443?${参数.toString()}#${encodeURIComponent(主机)}`;
}

function 订阅(请求) {
  const 主机 = 请求.headers.get('Host') || new URL(请求.url).hostname;
  const 链接 = 生成VLESS链接(主机, 认证令牌);
  return new Response(btoa(链接 + '\n'), {
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    }
  });
}

// ============ VLESS WS 代理（传输方式对齐第二份） ============
async function 处理网页套接字请求(请求) {
  const 对 = new WebSocketPair();
  const [客户端, 服务端] = Object.values(对);
  服务端.accept();
  服务端.binaryType = 'arraybuffer';

  // 与第二份一致的共享状态：
  //   传输队列 = 上行 write 和下行 send 共用的一条 Promise 链
  //   首包处理完成 = 首包的 promise（后续消息先 await 它）
  let 远端 = null;
  let 写入器 = null;   // 缓存 writer，只 getWriter 一次
  let 读取器 = null;   // 缓存 reader，只 getReader 一次
  let 首包已处理 = false;
  let 首包处理完成 = null;
  let 已关闭 = false;
  let 传输队列 = Promise.resolve();

  const 关闭全部 = () => {
    if (已关闭) return;
    已关闭 = true;
    try { 写入器?.releaseLock(); } catch {}
    try { 远端?.close(); } catch {}
    关闭套接字(服务端);
  };

  // 上行：message → 队列 → 缓存writer.write（完全对齐第二份结构）
  const 处理消息 = (数据) => {
    if (已关闭) return;
    if (!首包已处理) {
      首包已处理 = true;
      首包处理完成 = 处理首包(数据).catch(() => { 关闭全部(); });
      传输队列 = 传输队列.then(() => 首包处理完成);
      return;
    }
    传输队列 = 传输队列.then(async () => {
      if (已关闭) return;
      await 首包处理完成;
      if (已关闭) return;
      if (写入器) {
        try { await 写入器.write(数据); } catch { 关闭全部(); }
      }
    });
  };

  async function 处理首包(数据) {
    const 字节 = 处理值值8数组(数据);
    const 结果 = 解析网页套接字值头部(字节, 认证令牌);
    if (结果.hasError) throw new Error(结果.message);
    const { port, hostname, rawIndex, version, isUDP } = 结果;
    const 头部 = new Uint8Array([version[0], 0]);
    const 首包 = 字节.subarray(rawIndex);

    if (isUDP) {
      if (port === 53) {
        处理值用户数据报(首包, 服务端, 头部).catch(() => 关闭全部());
        return;
      }
      throw new Error('UDP 仅支持 53');
    }

    const 建连 = async (地址, 端口值) => {
      const 远端套接字 = connect({ hostname: 地址, port: 端口值 });
      const w = 远端套接字.writable.getWriter();
      await w.write(首包);
      return { 远端: 远端套接字, 写入器: w };
    };

    let 连接;
    try {
      连接 = await 建连(hostname, port);
    } catch {
      const 回退 = 回退地址 || 取官方直连地址();
      const [h, p] = 解析地址端口(回退, port);
      连接 = await 建连(h, p);
    }

    远端 = 连接.远端;
    写入器 = 连接.写入器;
    读取器 = 远端.readable.getReader();  // reader 只取一次

    if (服务端.readyState === 1) 服务端.send(头部);
    启动回传管道();
  }

  // 下行：while + 缓存reader，复用同一条 传输队列（完全对齐第二份结构）
  async function 启动回传管道() {
    try {
      while (true) {
        await 传输队列;                 // 等上行 write 和上一块下行 send 都完成
        if (已关闭) break;
        const { value, done } = await 读取器.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          传输队列 = 传输队列.then(() => {
            if (已关闭) return;
            if (服务端.readyState === 1) {
              try { 服务端.send(value); } catch { 关闭全部(); }
            }
          });
        }
      }
    } catch {}
    关闭全部();
  }

  服务端.addEventListener('message', (事件) => 处理消息(处理值值8数组(事件.data)));
  服务端.addEventListener('close', 关闭全部);
  服务端.addEventListener('error', 关闭全部);

  // 0-rtt 早期数据：模拟成第一个 message 入队
  const 前置 = 请求.headers.get('sec-websocket-protocol') || '';
  const { earlyData, error } = 处理基础64值数组(前置);
  if (error) 关闭全部();
  else if (earlyData) 处理消息(处理值值8数组(earlyData));

  return new Response(null, { status: 101, webSocket: 客户端 });
}

// ============ DNS over 53 ============
async function 处理值用户数据报(报文, ws, 头部) {
  try {
    const 远端 = connect({ hostname: '8.8.4.4', port: 53 });
    const 写入器 = 远端.writable.getWriter();
    await 写入器.write(报文);
    写入器.releaseLock();
    const 读取器 = 远端.readable.getReader();
    let 一次 = true;
    while (true) {
      const { value, done } = await 读取器.read();
      if (done) break;
      const 数据 = 处理值值8数组(value);
      if (!数据.byteLength) continue;
      if (ws.readyState !== 1) break;
      if (一次 && 头部) {
        const 合并 = new Uint8Array(头部.byteLength + 数据.byteLength);
        合并.set(头部, 0); 合并.set(数据, 头部.byteLength);
        ws.send(合并);
        一次 = false;
      } else {
        ws.send(数据);
      }
    }
    读取器.releaseLock();
  } catch {}
}

// ============ 工具 ============
function 处理值值8数组(数据) {
  if (数据 instanceof Uint8Array) return 数据;
  if (数据 instanceof ArrayBuffer) return new Uint8Array(数据);
  if (ArrayBuffer.isView(数据)) return new Uint8Array(数据.buffer, 数据.byteOffset, 数据.byteLength);
  return new Uint8Array(数据);
}

function 关闭套接字(ws) {
  try {
    if (ws.readyState === 1 || ws.readyState === 2) ws.close();
  } catch {}
}

function 处理基础64值数组(s) {
  if (!s) return { error: null };
  try {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    return { earlyData: Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer, error: null };
  } catch (e) { return { error: e }; }
}

// ============ VLESS 头部解析 ============
const 地址类型_四版 = 1;
const 地址类型_网址 = 2;
const 地址类型_六版 = 3;
const 共享解码器 = new TextDecoder();
const 唯一标识字节缓存 = new Map();
const 错误_无效数据 = atob('aW52YWxpZCBkYXRh');
const 错误_无效用户 = atob('aW52YWxpZCB1c2Vy');
const 错误_不支持命令 = atob('Y29tbWFuZCBpcyBub3Qgc3VwcG9ydGVk');
const 错误_无效地址类型 = atob('aW52YWxpZCBhZGRyZXNzVHlwZQ==');
const 错误_空地址 = atob('YWRkcmVzc1ZhbHVlIGlzIGVtcHR5');

function 获取唯一标识字节(t) {
  if (唯一标识字节缓存.has(t)) return 唯一标识字节缓存.get(t);
  const h = String(t || '').replace(/-/g, '');
  if (h.length !== 32) return null;
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const v = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(v)) return null;
    b[i] = v;
  }
  if (唯一标识字节缓存.size > 16) 唯一标识字节缓存.clear();
  唯一标识字节缓存.set(t, b);
  return b;
}

function 处理值唯一标识(数据, 偏移, t) {
  const 标识 = 获取唯一标识字节(t);
  if (!标识) return false;
  for (let i = 0; i < 16; i++) if (数据[偏移 + i] !== 标识[i]) return false;
  return true;
}

function 解析网页套接字值头部(数据, 令牌) {
  const 字节 = 处理值值8数组(数据);
  if (字节.byteLength < 24) return { hasError: true, message: 错误_无效数据 };
  const 版本 = 字节.subarray(0, 1);
  if (!处理值唯一标识(字节, 1, 令牌)) return { hasError: true, message: 错误_无效用户 };
  const 附加长 = 字节[17];
  const 命令索引 = 18 + 附加长;
  if (字节.byteLength < 命令索引 + 5) return { hasError: true, message: 错误_无效数据 };
  const 命令 = 字节[命令索引];
  let isUDP = false;
  if (命令 === 1) {} else if (命令 === 2) isUDP = true;
  else return { hasError: true, message: 错误_不支持命令 };
  const 端口索引 = 19 + 附加长;
  const 端口 = (字节[端口索引] << 8) | 字节[端口索引 + 1];
  const 地址索引 = 端口索引 + 2;
  const 地址类型 = 字节[地址索引];
  let 地址长 = 0;
  let 地址值索引 = 地址索引 + 1;
  let 主机 = '';
  switch (地址类型) {
    case 地址类型_四版:
      地址长 = 4;
      if (字节.byteLength < 地址值索引 + 4) return { hasError: true, message: 错误_无效数据 };
      主机 = `${字节[地址值索引]}.${字节[地址值索引 + 1]}.${字节[地址值索引 + 2]}.${字节[地址值索引 + 3]}`;
      break;
    case 地址类型_网址:
      if (字节.byteLength < 地址值索引 + 1) return { hasError: true, message: 错误_无效数据 };
      地址长 = 字节[地址值索引++];
      if (字节.byteLength < 地址值索引 + 地址长) return { hasError: true, message: 错误_无效数据 };
      主机 = 共享解码器.decode(字节.subarray(地址值索引, 地址值索引 + 地址长));
      break;
    case 地址类型_六版:
      地址长 = 16;
      if (字节.byteLength < 地址值索引 + 16) return { hasError: true, message: 错误_无效数据 };
      {
        const v = new DataView(字节.buffer, 字节.byteOffset + 地址值索引, 16);
        const 段 = [];
        for (let i = 0; i < 8; i++) 段.push(v.getUint16(i * 2).toString(16));
        主机 = 段.join(':');
      }
      break;
    default:
      return { hasError: true, message: `${错误_无效地址类型}: ${地址类型}` };
  }
  if (!主机) return { hasError: true, message: `${错误_空地址}: ${地址类型}` };
  return {
    hasError: false,
    addressType: 地址类型,
    port: 端口,
    hostname: 主机,
    isUDP,
    rawIndex: 地址值索引 + 地址长,
    version: 版本,
  };
}