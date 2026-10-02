#!/usr/bin/env node
/**
 * 用 GitHub REST API 把当前提交上传到一个仓库。
 *
 * 为什么需要它：有些网络环境里 github.com 的 git 通道（smart HTTP push）不通，
 * `git push` 会卡在 "Trying <ip>:443..." 上、没有任何输出，而 api.github.com 正常。
 * 这个脚本把同一个提交拆成 blob / tree / commit / ref 四步发出去，走 api.github.com。
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node scripts/publish-api.mjs
 *   GITHUB_TOKEN=ghp_xxx node scripts/publish-api.mjs --repo my-name --branch main
 *   node scripts/publish-api.mjs --dry-run          # 只看会上传什么，不发请求
 *
 * 令牌需要 Contents: read/write；要顺带新建仓库还要 Administration: write。
 * 令牌只从环境变量读，不落盘、不写进 git config、不出现在命令行参数里。
 *
 * 上传内容 = `git ls-tree -r HEAD`，也就是你刚提交的那份，不会把工作区里
 * 未提交或已忽略的东西偷偷带上去。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const API = 'https://api.github.com';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Blob uploads in flight at once. */
const CONCURRENCY = 6;

/** Parse `--flag value` / `--flag`. */
function parseArgs(argv) {
  const out = { repo: 'dsh-vk1-pet', branch: 'main', owner: null, dryRun: false, message: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--repo') out.repo = argv[++i];
    else if (arg === '--owner') out.owner = argv[++i];
    else if (arg === '--branch') out.branch = argv[++i];
    else if (arg === '--message') out.message = argv[++i];
    else if (arg === '--help' || arg === '-h') { out.help = true; }
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`);
  }
  return out;
}

/** Run one git command in the repository root. */
function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, ...options });
}

/**
 * Every committed file, with its exact bytes and mode.
 * @returns `{ path, mode, bytes }[]`.
 */
function readCommittedTree() {
  const raw = git(['ls-tree', '-r', '-z', 'HEAD'], { encoding: 'utf8' });
  const files = [];
  for (const record of raw.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const [mode, type, sha] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (type !== 'blob') continue;
    if (mode !== '100644' && mode !== '100755') throw new Error(`unsupported mode ${mode} on ${path}`);
    files.push({ path, mode, bytes: git(['cat-file', 'blob', sha]) });
  }
  return files;
}

/**
 * One authenticated API call.
 * @param token - the PAT.
 * @param route - path below the API root.
 * @param init - fetch init; `body` is JSON-encoded when it is an object.
 * @returns the parsed JSON body, or null for 204.
 * @throws with the API's own message on a non-2xx answer.
 */
async function api(token, route, init = {}) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'dsh-vk1-pet-publish',
    ...(init.headers ?? {}),
  };
  const body = init.body === undefined || typeof init.body === 'string'
    ? init.body
    : JSON.stringify(init.body);
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${API}${route}`, { ...init, headers, body });
  const text = await response.text();
  let parsed = null;
  try { parsed = text === '' ? null : JSON.parse(text); } catch { /* non-JSON error page */ }
  if (!response.ok) {
    const detail = parsed?.message ?? text.slice(0, 200);
    const errors = Array.isArray(parsed?.errors) ? ` ${JSON.stringify(parsed.errors)}` : '';
    throw new Error(`${init.method ?? 'GET'} ${route} -> ${response.status} ${detail}${errors}`);
  }
  return parsed;
}

/** Run tasks with a bounded number in flight. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Human-readable byte size. */
function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('usage: GITHUB_TOKEN=… node scripts/publish-api.mjs [--repo name] [--owner login] [--branch main] [--dry-run]\n');
    return 0;
  }

  let head;
  try {
    head = git(['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    process.stderr.write('error: 还没有任何提交，先 git commit\n');
    return 1;
  }

  const files = readCommittedTree();
  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  const executables = files.filter((file) => file.mode === '100755').map((file) => file.path);
  process.stdout.write(`提交 ${head}：${files.length} 个文件，共 ${human(total)}\n`);
  if (executables.length > 0) process.stdout.write(`可执行位保留：${executables.join(', ')}\n`);

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  if (args.dryRun) {
    for (const file of files.slice(0, 8)) process.stdout.write(`  ${file.path} (${human(file.bytes.length)})\n`);
    if (files.length > 8) process.stdout.write(`  … 另有 ${files.length - 8} 个\n`);
    process.stdout.write('dry run：没有发出任何请求。\n');
    return 0;
  }
  if (token === '') {
    process.stderr.write('error: 需要 GITHUB_TOKEN（fine-grained PAT，Contents: read/write；新建仓库还需 Administration: write）\n');
    return 1;
  }

  // ── 身份与仓库 ────────────────────────────────────────────────────────────
  const owner = args.owner ?? (await api(token, '/user')).login;
  process.stdout.write(`以 ${owner} 的身份上传到 ${owner}/${args.repo} ……\n`);

  let exists = true;
  try {
    await api(token, `/repos/${owner}/${args.repo}`);
  } catch (error) {
    if (!/-> 404/.test(error.message)) throw error;
    exists = false;
  }
  if (!exists) {
    await api(token, '/user/repos', {
      method: 'POST',
      body: {
        name: args.repo,
        description: 'DSH 余额桌宠：把 VK-1 做成 DeepSeek Harness 的 web 插件',
        private: false,
        auto_init: false,
      },
    });
    process.stdout.write('  已新建公开仓库\n');
  }

  // ── blob ─────────────────────────────────────────────────────────────────
  let done = 0;
  const blobs = await pool(files, CONCURRENCY, async (file) => {
    const blob = await api(token, `/repos/${owner}/${args.repo}/git/blobs`, {
      method: 'POST',
      body: { content: file.bytes.toString('base64'), encoding: 'base64' },
    });
    done += 1;
    if (done % 10 === 0 || done === files.length) process.stdout.write(`  blob ${done}/${files.length}\n`);
    return { path: file.path, mode: file.mode, type: 'blob', sha: blob.sha };
  });

  // ── tree ─────────────────────────────────────────────────────────────────
  const tree = await api(token, `/repos/${owner}/${args.repo}/git/trees`, {
    method: 'POST',
    body: { tree: blobs },
  });
  process.stdout.write(`  tree ${tree.sha}\n`);

  // ── commit ───────────────────────────────────────────────────────────────
  // Re-publishing onto an existing branch keeps its history instead of
  // rewriting it, so a second run is a normal fast-forward.
  let parents = [];
  try {
    const ref = await api(token, `/repos/${owner}/${args.repo}/git/ref/heads/${args.branch}`);
    parents = [ref.object.sha];
  } catch (error) {
    if (!/-> 404|-> 409/.test(error.message)) throw error;
  }
  const message = args.message
    ?? git(['log', '-1', '--pretty=%B'], { encoding: 'utf8' }).trim();
  const commit = await api(token, `/repos/${owner}/${args.repo}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.sha, parents },
  });
  process.stdout.write(`  commit ${commit.sha.slice(0, 7)}${parents.length > 0 ? ' (fast-forward)' : ' (initial)'}\n`);

  // ── ref ──────────────────────────────────────────────────────────────────
  if (parents.length > 0) {
    await api(token, `/repos/${owner}/${args.repo}/git/refs/heads/${args.branch}`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: false },
    });
  } else {
    await api(token, `/repos/${owner}/${args.repo}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${args.branch}`, sha: commit.sha },
    });
  }

  process.stdout.write(`\n完成：https://github.com/${owner}/${args.repo}\n`);
  return 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    process.stderr.write(`error: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  },
);
