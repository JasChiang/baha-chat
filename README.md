# Bahamut BBS MCP Server

用來操作巴哈姆特 BBS 的 MCP server。

這個專案透過 WebSocket 連到 `wss://term.gamer.com.tw/bbs`，在本地模擬 80x24 的 BBS 終端畫面，提供可供 MCP client 呼叫的工具，例如登入、送出文字、送特殊按鍵、讀取畫面、解析列表與文章內容。

## 功能

- 連接巴哈姆特 BBS
- 使用帳密自動登入
- 發送文字、方向鍵、Enter、PageUp/PageDown、Ctrl 組合鍵
- 讀取目前可視畫面
- 輸出結構化 context，方便代理做導覽與判斷
- 支援 Big5-UAO 編碼處理
- 可重置本地終端畫面，避免 scrollback 或殘留畫面干擾

## 安裝

```bash
npm install
npm run build
```

## 設定

詳細步驟可參考 [SETUP.md](SETUP.md)。

### 1. 建立設定檔

```bash
cp .env.example .env
cp .mcp.json.example .mcp.json
```

### 2. 填入 BBS 帳號密碼

在 `.env` 內設定：

```env
BBS_USERNAME=你的帳號
BBS_PASSWORD=你的密碼
```

### 3. 設定 MCP server 路徑

把 `.mcp.json` 內的路徑改成你本機的實際位置：

```json
{
  "mcpServers": {
    "baha-bbs": {
      "command": "node",
      "args": ["/你的實際路徑/baha-chat/dist/index.js"]
    }
  }
}
```

如果你是接到 Claude Desktop，也可以把同樣的設定寫進：

`~/Library/Application Support/Claude/claude_desktop_config.json`

## 可用工具

### `bbs_connect`

建立到巴哈姆特 BBS 的 WebSocket 連線。

### `bbs_auto_login`

使用 `.env` 裡的 `BBS_USERNAME` / `BBS_PASSWORD` 自動登入。

### `bbs_send`

傳送一般文字或指令到 BBS。

### `bbs_send_key`

傳送特殊按鍵。

支援：

- `up`
- `down`
- `left`
- `right`
- `pgup` / `pageup`
- `pgdn` / `pagedown`
- `home`
- `end`
- `enter`
- `esc`
- `space`
- `backspace`
- `delete`
- `insert`

### `bbs_send_ctrl`

傳送 `Ctrl+<letter>` 組合鍵，例如：

- `Ctrl+P` 發文
- `Ctrl+W` 存檔
- `Ctrl+X` 離開

### `bbs_get_screen`

取得目前畫面內容。

`return_mode: "summary"` 時回傳較精簡內容；`"full"` 時可取得完整可視畫面。文章畫面會額外附上 metadata 與格式檢查資訊。

### `bbs_get_context`

回傳結構化畫面資料，適合用來判斷目前狀態、列表內容、文章資訊與導覽流程。通常比 `bbs_get_screen` 更省 token。

### `bbs_reset_screen`

重置本地終端緩衝，回到乾淨的 80x24 畫面狀態。當畫面漂移、scrollback 汙染或解析狀態不準時可用。

### `bbs_disconnect`

中斷連線。

## 畫面與解析行為

- `bbs_get_screen` / `bbs_get_context` 以「目前可視的 80x24 視窗」為準，不是完整 scrollback。
- 本地終端使用無 scrollback 模式，盡量貼近一般 BBS 客戶端看到的畫面。
- 文章畫面會嘗試解析：
  - 作者
  - 看板
  - 標題
  - 時間
  - 是否包含簽名
  - 是否包含引言
  - 目前瀏覽頁數與百分比

## 使用範例

### 快速登入

```text
1. 呼叫 bbs_connect
2. 呼叫 bbs_auto_login
3. 呼叫 bbs_get_context 或 bbs_get_screen
```

### 手動輸入帳號

```text
1. 呼叫 bbs_connect
2. 呼叫 bbs_send，text: "your_username"
3. 呼叫 bbs_send_key，key: "enter"
4. 視需求繼續輸入密碼
```

## 編碼說明

巴哈姆特 BBS 使用 Big5 家族編碼，但實際內容常混用 UAO 擴充字元，用來補足傳統 Big5 / CP950 對部分日文、特殊符號與站內常見擴充字元的支援。

這個專案目前不是單純用一般 Big5 轉換，而是加入 Big5-UAO encode/decode 邏輯，降低文字在收送過程中出現錯字、缺字或對應錯誤的機率。

`src/generated/uao-encode.json` 與 `src/generated/uao-decode.json` 的對照資料整理自 [`eight04/pyUAO`](https://github.com/eight04/pyUAO)。

## BBS 指令參考

常見操作可參考 [BBS_COMMANDS.md](BBS_COMMANDS.md)。

內容包含：

- 基本瀏覽指令
- 功能指令
- 編輯器操作
- 常見流程範例

## 開發

```bash
# watch mode
npm run dev

# build
npm run build

# run compiled server
npm start
```

## 注意事項

- 畫面含 ANSI 控制碼與終端游標移動效果，解析結果依當前可視區塊而定
- 某些 BBS 操作需要嚴格的按鍵順序
- 若畫面狀態異常，可先使用 `bbs_reset_screen`
- `.env`、`.mcp.json`、本機代理工具設定目錄不應提交到版本庫
