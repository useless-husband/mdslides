// Sample deck written by `mdslides init`.
export const INIT_TEMPLATE = `---
title: 我的第一份簡報
author: 你的名字
date: 2026-01-01
theme: light
aspect: 16:9
---

<!-- .slide: class="title" -->

# 我的第一份簡報

用 Markdown 寫，用瀏覽器播放

Note: 這是講者備註。按 s 開簡報者模式就能看到。

---

## 基本語法

- **粗體**、*斜體*、~~刪除線~~、\`行內程式碼\`
- [連結](https://example.com)
- 用 \`---\` 分頁

Note: 每一頁的備註都寫在 Note: 後面。

---

## 逐步顯示

+ 第一點：按一下才出現
+ 第二點：再按一下
+ 第三點：最後一項

---

## 程式碼與高亮行

\`\`\`js {2}
function greet(name) {
  return "Hello, " + name;
}
\`\`\`

---

## 表格

| 功能 | 按鍵 |
|:-----|:----:|
| 下一頁 | 空白鍵 |
| 總覽 | o |
| 簡報者模式 | s |

---

<!-- .slide: class="center" -->

## 謝謝

按 o 看總覽，按 f 全螢幕
`;
