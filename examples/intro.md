---
title: mdslides 介紹
author: useless-husband
date: 2026-09-29
theme: light
aspect: 16:9
---

<!-- .slide: class="title" -->

# mdslides

把一份 Markdown 變成單一 HTML 檔的簡報

useless-husband · 2026

Note: 這份簡報本身就是用 mdslides 做的，原始檔是 examples/intro.md。按 s 可以開簡報者模式，看到這些備註。

---

## 為什麼要做這個

- 用 PowerPoint 或 Keynote 做簡報，內容和排版糾纏在一起
- 檔案很大，用 git 也看不出這次改了什麼
- 想要：**只寫內容**，其他交給工具
- 目標：輸出**一個 HTML 檔**，雙擊就能播，寄給別人也不會壞

Note: 重點是單一檔案。圖片、CSS、JS 全部內嵌，沒有 CDN，斷網也能用。

---

## 一份 Markdown 就是一份簡報

```md
---
title: 我的簡報
theme: dark
---

# 第一頁

---

## 第二頁

- 用三個減號分頁
- 講者備註寫在 Note: 後面

Note: 只有你看得到
```

Note: 最上面的 front matter 設定標題、作者、主題和比例。分頁線是單獨一行的三個減號，程式碼區塊裡的不算。

---

## 逐步顯示

清單項目前面用 `+`，每按一下才出現一項：

+ 第一步：先講問題
+ 第二步：再講做法
+ 第三步：最後給結論

一般的 `-` 項目則會一次全部出現。

Note: 往回翻的時候會先一步一步收起來，再回到上一頁。

---

## 程式碼與語法高亮

在語言後面加 `{2,4-5}` 就能標出重點行：

```js {2,4-5}
function fizzbuzz(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    if (i % 15 === 0) out.push("FizzBuzz");
    else if (i % 3 === 0) out.push("Fizz");
    else out.push(String(i));
  }
  return out;
}
```

支援 js / ts、python、bash、json、html、css、go。

Note: 高亮器是自己寫的小型掃描器，不是完整的語法分析，但關鍵字、字串、註解、數字都會上色。標出的行以外會變淡，聽眾的視線就會跟著走。

---

## 表格與對齊

| 按鍵 | 功能 | 備註 |
|:-----|:----:|-----:|
| 空白 / → / PageDown | 下一步 | 有逐步項目時先顯示項目 |
| ← / PageUp | 上一步 | |
| Home / End | 第一頁 / 最後一頁 | |
| o | 總覽 | 方向鍵選取，Enter 進入 |
| f | 全螢幕 | |
| b | 黑屏 | |
| s | 簡報者模式 | 開新視窗 |

---

## 圖片會直接內嵌

本機圖片在建置時轉成 base64，輸出仍然只有一個檔案：

![從 Markdown 到 HTML 的流程](flow.svg)

`![說明](flow.svg)`，路徑相對於 Markdown 檔。

---

## 主題與版面

- [x] light：白底，預設
- [x] dark：深色
- [x] paper：米白底，像紙本
- [ ] 想要別的？用 `--css my.css` 追加自己的 CSS

每頁可以用註解換版面：

```html
<!-- .slide: class="center" -->
```

內建 `center`、`title`、`small`、`cols`、`invert`。

Note: 播放時按 t 可以即時切換三種主題，方便挑選。

---

## 指令

```bash
# 產生單一 HTML 檔
mdslides talk.md -o talk.html

# 本機預覽，存檔就自動重新載入
mdslides serve talk.md --port 18080

# 存成 PDF 時，把備註印在每頁下面
mdslides talk.md --print-notes
```

> 存成 PDF：用 Chrome 開啟輸出檔，列印，目的地選「另存為 PDF」。

---

<!-- .slide: class="center" -->

## 原理

Markdown 解析器、語法高亮、播放器都是自己寫的

零執行期依賴，`node --test` 就能跑測試

Note: 結束。程式碼在 GitHub，歡迎看 src/ 底下的實作，每個檔案都不長。
