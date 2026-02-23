# 巴哈姆特 BBS 指令參考

## MCP 工具對照表

### 基本瀏覽指令

| BBS 按鍵 | MCP 工具呼叫 | 說明 |
|---------|-------------|------|
| ↑ (p) | `bbs_send_key` key: "up" | 上移一篇文章 |
| ↓ (n) | `bbs_send_key` key: "down" | 下移一篇文章 |
| → (r) | `bbs_send_key` key: "right" | 閱讀/進入此篇文章 |
| ← | `bbs_send_key` key: "left" | 返回上一層 |
| PgUp (P) | `bbs_send_key` key: "pgup" | 上移一頁 |
| PgDn (N) | `bbs_send_key` key: "pgdn" | 下移一頁 |
| Home | `bbs_send_key` key: "home" | 跳到第一篇 |
| End ($) | `bbs_send_key` key: "end" | 跳到最後一篇 |

### 功能指令（使用 Ctrl 組合鍵）

| BBS 指令 | MCP 工具呼叫 | 說明 |
|---------|-------------|------|
| ^P | `bbs_send_ctrl` letter: "P" | 發表文章 |
| d | `bbs_send` text: "d" | 刪除文章 |
| v | `bbs_send` text: "v" | 設定閱讀記錄 |
| s | `bbs_send` text: "s" | 搜尋看板 |
| q | `bbs_send` text: "q" | 離開/返回 |

### 編輯器指令

#### 檔案處理
| BBS 指令 | MCP 工具呼叫 | 說明 |
|---------|-------------|------|
| ^W | `bbs_send_ctrl` letter: "W" | 檔案寫入/儲存 |
| ^X | `bbs_send_ctrl` letter: "X" | 離開編輯器 |

#### 顯示控制
| BBS 指令 | MCP 工具呼叫 | 說明 |
|---------|-------------|------|
| ^L | `bbs_send_ctrl` letter: "L" | 重新顯示畫面 |
| ^V | `bbs_send_ctrl` letter: "V" | 切換 ANSI 編輯模式 |
| ^Z | `bbs_send_ctrl` letter: "Z" | 顯示求助畫面 |

#### 游標移動
| BBS 指令 | MCP 工具呼叫 | 說明 |
|---------|-------------|------|
| ^A / Home | `bbs_send_ctrl` letter: "A" 或 `bbs_send_key` key: "home" | 移到此行開頭 |
| ^E / End | `bbs_send_ctrl` letter: "E" 或 `bbs_send_key` key: "end" | 移到此行結尾 |
| ^P / ↑ | `bbs_send_ctrl` letter: "P" 或 `bbs_send_key` key: "up" | 往上移動一行 |
| ^N / ↓ | `bbs_send_ctrl` letter: "N" 或 `bbs_send_key` key: "down" | 往下移動一行 |
| ^S | `bbs_send_ctrl` letter: "S" | 移到檔案開頭 |
| ^T | `bbs_send_ctrl` letter: "T" | 移到檔案結尾 |
| ^B / PgUp | `bbs_send_ctrl` letter: "B" 或 `bbs_send_key` key: "pgup" | 往上移動一頁 |
| ^F / PgDn | `bbs_send_ctrl` letter: "F" 或 `bbs_send_key` key: "pgdn" | 往下移動一頁 |

#### 刪除與插入
| BBS 指令 | MCP 工具呼叫 | 說明 |
|---------|-------------|------|
| ^H / BS | `bbs_send_ctrl` letter: "H" 或 `bbs_send_key` key: "backspace" | 刪除前一個字元 |
| ^D / DEL | `bbs_send_ctrl` letter: "D" 或 `bbs_send_key` key: "delete" | 刪除目前的字元 |
| ^Y | `bbs_send_ctrl` letter: "Y" | 刪除目前這行 |
| ^K | `bbs_send_ctrl` letter: "K" | 刪除游標之後至行尾 |
| ^O / Ins | `bbs_send_ctrl` letter: "O" 或 `bbs_send_key` key: "insert" | 切換插入/覆寫模式 |
| ^G | `bbs_send_ctrl` letter: "G" | 刪除目前這行之後至檔案結尾 |

#### 特殊指令
| BBS 指令 | MCP 工具呼叫 | 說明 |
|---------|-------------|------|
| ^U | `bbs_send_ctrl` letter: "U" | 輸入 ESC（以 * 表示）|
| ^C | `bbs_send_ctrl` letter: "C" | 設定/還原 ANSI 色彩 |
| ^Q | `bbs_send_ctrl` letter: "Q" | 使用者資料代碼 |

## 常用操作流程

### 瀏覽看板文章

```
1. 使用 bbs_send 工具，text: "s"  # 搜尋看板
2. 使用 bbs_send 工具，text: "看板名稱"
3. 使用 bbs_send_key 工具，key: "enter"
4. 使用 bbs_send_key 工具，key: "down"  # 瀏覽文章
5. 使用 bbs_send_key 工具，key: "right"  # 閱讀文章
```

### 發表文章

```
1. 進入看板
2. 使用 bbs_send_ctrl 工具，letter: "P"  # 按 ^P 發表
3. 輸入標題和內容
4. 使用 bbs_send_ctrl 工具，letter: "W"  # 儲存
5. 使用 bbs_send_ctrl 工具，letter: "X"  # 離開
```

### 回覆文章

```
1. 閱讀文章後，使用 bbs_send 工具，text: "y"  # 按 y 回應
2. 使用 bbs_send 工具，text: "F"  # 回應至看板（或 M 回應至信箱）
3. 使用 bbs_send_key 工具，key: "enter"  # 跳過類別選單（重要！不要選類別）
4. 使用 bbs_send 工具，text: "標題"  # 輸入標題（通常是 "Re: 原標題"）
5. 使用 bbs_send_key 工具，key: "enter"
6. 使用 bbs_send 工具，text: "Y"  # 是否引用原文（Y/N）
7. 使用 bbs_send_key 工具，key: "enter"
8. 使用 bbs_send 工具，text: "0"  # 選擇簽名檔（0=不加）
9. 使用 bbs_send_key 工具，key: "enter"
10. 輸入回覆內容
11. 使用 bbs_send_ctrl 工具，letter: "W"  # 儲存
12. 使用 bbs_send 工具，text: "S"  # 存檔
13. 使用 bbs_send_key 工具，key: "enter"
```

**重要提醒**：回覆文章時，出現類別選單要直接按 Enter 跳過，不要選擇類別（a/b/c/d 等），否則會在標題加上類別前綴。

### 跳到特定文章編號

```
使用 bbs_send 工具，text: "編號"
使用 bbs_send_key 工具，key: "enter"
```

## 使用範例

### 範例 1：瀏覽熱門看板

```
請幫我：
1. 連接到 BBS
2. 自動登入
3. 搜尋「C_Chat」看板
4. 進入看板
5. 顯示前幾篇文章的標題
```

### 範例 2：閱讀特定文章

```
請幫我：
1. 使用上下鍵移動到第 5 篇文章
2. 按右鍵進入閱讀
3. 顯示文章內容
```

### 範例 3：發表文章

```
請幫我：
1. 按 Ctrl+P 進入發文模式
2. 輸入標題：「測試文章」
3. 輸入內容：「這是一篇測試文章」
4. 儲存並送出
```

## 提示

- 某些功能需要登入後才能使用（如發文、回文）
- 編輯器中的控制碼只在編輯模式下有效
- 使用 `bbs_get_screen` 隨時查看目前畫面
- 如果不確定目前狀態，先查看畫面再決定下一步操作

## ANSI 色碼參考

編輯器中的 ANSI 色碼（使用 ^C 設定）：

| 顏色 | 前景碼 | 背景碼 |
|------|-------|-------|
| 黑 | 30 | 40 |
| 紅 | 31 | 41 |
| 綠 | 32 | 42 |
| 黃 | 33 | 43 |
| 藍 | 34 | 44 |
| 紫 | 35 | 45 |
| 靛 | 36 | 46 |
| 白 | 37 | 47 |
