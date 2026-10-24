const fs = require('node:fs');
const path = require('node:path');

/**
 * 教程文档校验。
 *
 * 教学文档里大量出现 `文件:行号` 形式的引用，代码一改行号就会漂移，
 * 而漂移是静默的——读者跳过去只会看到一段不相干的代码。
 * 这个脚本做三件事：
 *
 * 1. 引用校验：文件存在、行号在范围内、指向的行不是空行/纯结构行；
 * 2. 结构校验：每个章节都被导读页和 README 链接，且首尾导航链完整；
 * 3. 链接校验：站内相对链接指向的文件必须存在。
 */

const root = path.join(__dirname, '..');
const tutorialDir = path.join(root, 'docs', 'tutorial');

const findings = [];

/** `路径:12` 或 `路径:12-34`，路径以仓库内已知目录开头 */
const REFERENCE = /((?:cloudfunctions|miniprogram|tests|docs|scripts)\/[\w\-./\u4e00-\u9fff]+\.(?:js|json|wxml|wxss|md)):(\d+)(?:-(\d+))?/g;

/** 指向这些内容说明行号已经漂到了结构行上，不是真正的锚点 */
const NON_ANCHOR = /^(?:\}|\}|\)|\]|\);|\}\),|\}\);|<\/\w+>|\s*)$/;

function listMarkdown(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => path.join(dir, name));
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function checkReferences(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let count = 0;

  for (const match of text.matchAll(REFERENCE)) {
    const [whole, target, startText, endText] = match;
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    count++;

    const absolute = path.join(root, target);
    if (!fs.existsSync(absolute)) {
      findings.push(`${relative(file)}: 引用 ${whole} 的文件不存在`);
      continue;
    }

    const targetLines = fs.readFileSync(absolute, 'utf8').split('\n');
    if (start < 1 || end > targetLines.length || end < start) {
      findings.push(`${relative(file)}: 引用 ${whole} 超出范围（该文件共 ${targetLines.length} 行）`);
      continue;
    }

    // 行号漂移最常见的落点是空行、右括号或闭合标签，这里挡一道
    const anchor = targetLines[start - 1].trim();
    if (NON_ANCHOR.test(anchor)) {
      findings.push(`${relative(file)}: 引用 ${whole} 指向的行不是有效代码（"${anchor.slice(0, 20)}"）`);
    }
  }

  return count;
}

function checkLinks(file) {
  const text = fs.readFileSync(file, 'utf8');
  let count = 0;

  for (const match of text.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    const [, label, href] = match;
    if (/^https?:\/\//.test(href) || href.startsWith('#')) continue;
    count++;

    const target = path.resolve(path.dirname(file), decodeURIComponent(href.split('#')[0]));
    if (!fs.existsSync(target)) {
      findings.push(`${relative(file)}: 链接 [${label}](${href}) 指向的文件不存在`);
    }
  }

  return count;
}

const chapters = listMarkdown(tutorialDir);
if (chapters.length === 0) {
  console.error('docs/tutorial 下没有找到任何章节');
  process.exit(1);
}

// 1 + 3：逐文件校验引用与链接
let referenceCount = 0;
let linkCount = 0;
const scanned = [...chapters, path.join(root, 'README.md')];
for (const file of scanned) {
  referenceCount += checkReferences(file);
  linkCount += checkLinks(file);
}

// 2：章节结构
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const index = fs.readFileSync(path.join(tutorialDir, '00-导读与课程地图.md'), 'utf8');

for (const chapter of chapters) {
  const name = path.basename(chapter);
  const body = fs.readFileSync(chapter, 'utf8');

  if (name !== '00-导读与课程地图.md') {
    if (!index.includes(name)) findings.push(`${name}: 没有被导读页链接`);
    if (!readme.includes(name)) findings.push(`${name}: 没有被 README 链接`);
    if (!/上一篇：/.test(body)) findings.push(`${name}: 缺少「上一篇」导航`);
    if (!/下一篇：|回到：/.test(body)) findings.push(`${name}: 缺少「下一篇」或「回到」导航`);
  }
}

// 导航链必须首尾相接：上一章的「下一篇」要指向下一章的「上一篇」
for (let i = 0; i < chapters.length - 1; i++) {
  const current = fs.readFileSync(chapters[i], 'utf8');
  const nextName = path.basename(chapters[i + 1]);
  const nextLink = /下一篇：\[[^\]]*\]\(([^)]+)\)/.exec(current);
  if (!nextLink) {
    findings.push(`${path.basename(chapters[i])}: 找不到指向下一章的「下一篇」链接`);
  } else if (decodeURIComponent(nextLink[1]) !== nextName) {
    findings.push(`${path.basename(chapters[i])}: 「下一篇」指向 ${nextLink[1]}，应为 ${nextName}`);
  }
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  console.error(`\n文档校验失败：${findings.length} 处问题`);
  process.exit(1);
}

console.log(
  `Docs checked: ${chapters.length} chapters, ${referenceCount} code references, ${linkCount} local links; navigation chain intact.`
);
