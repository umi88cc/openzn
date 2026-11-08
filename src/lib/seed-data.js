// AI指南 — 本地无 D1 时的兜底数据（v5）
// wrangler dev 未绑 D1 也能打开首页看版式；正式部署后一律读 D1，不用这份数据。
import { CATEGORIES } from './config.js';

export const FALLBACK_CATEGORIES = CATEGORIES;

export const FALLBACK_ARTICLES = [
  {
    id: 1, slug: 'what-is-openclaw', title: '什么是 OpenClaw？它有哪些用途？',
    summary: 'OpenClaw 入门第一篇：它是什么，能帮你做什么，新人先看这篇再看部署教程。',
    tag: 'OpenClaw', category_slug: 'intro', category_name: '智能简介',
    views: 0, likes_count: 0, comments_count: 0, favorites_count: 0, is_pinned: 1,
    content: '# 什么是 OpenClaw？它有哪些用途？\n\n> 本文为示例占位正文，正式内容由站长在后台撰写后替换。\n\nOpenClaw 是一个开源的 AI 智能体框架，可以帮你把大模型变成能干活的助手。\n\n[reply]\n这里是回复可见的隐藏命令示例。\n[/reply]\n\n```bash\necho "hello openclaw"\n```',
  },
  {
    id: 2, slug: 'what-is-hermes', title: '什么是 Hermes？它与 OpenClaw 有哪些不同，有什么用途？',
    summary: 'Hermes 入门第一篇：它和 OpenClaw 的区别、各自适合什么场景。',
    tag: 'Hermes', category_slug: 'intro', category_name: '智能简介',
    views: 0, likes_count: 0, comments_count: 0, favorites_count: 0, is_pinned: 1,
    content: '# 什么是 Hermes？它与 OpenClaw 有哪些不同？\n\n> 本文为示例占位正文，正式内容由站长在后台撰写后替换。\n\nHermes 是另一类智能体方案，侧重不同的部署与使用方式。\n\n[vip]\n这里是会员可见的隐藏内容示例。\n[/vip]',
  },
  {
    id: 3, slug: 'deploy-pc-quickstart', title: '电脑本地快速上手：部署 OpenClaw 第一步',
    summary: '部署教程第一篇：电脑本地部署的完整流程，命令在中后期隐藏，仅回复可见。',
    tag: 'OpenClaw', category_slug: 'deploy', category_name: '部署教程',
    views: 0, likes_count: 0, comments_count: 0, favorites_count: 0, is_pinned: 0,
    content: '# 电脑本地快速上手\n\n先按步骤准备环境，再执行下面的命令。\n\n[reply]\n```bash\necho "deploy openclaw on pc"\n```\n[/reply]',
  },
];

export const FALLBACK_LEADERBOARD = [];
