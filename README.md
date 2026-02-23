# Bahamut BBS MCP Server

這是一個 Model Context Protocol (MCP) server，用於連接到巴哈姆特 BBS (bbs.gamer.com.tw)。

## 功能

- 透過 WebSocket 連接到巴哈姆特 BBS
- 發送文字指令到 BBS
- 發送特殊按鍵（方向鍵、Enter 等）
- 讀取 BBS 畫面內容
- 支援 Big5 編碼

## 安裝

```bash
npm install
npm run build
```

## 設定帳號密碼

請參考 [SETUP.md](SETUP.md) 詳細說明。

**快速設定**：

```bash
# 1. 複製範例檔案
cp .env.example .env
cp .mcp.json.example .mcp.json

# 2. 編輯 .env 並填入你的帳號密碼
nano .env  # 或使用你喜歡的編輯器

# 3. 編輯 .mcp.json 並修改為你的實際專案路徑
nano .mcp.json  # 或使用你喜歡的編輯器

# 4. 重新建置
npm run build
```

然後在 `.env` 檔案中填入：
```
BBS_USERNAME=你的帳號
BBS_PASSWORD=你的密碼
```

在 `.mcp.json` 檔案中修改路徑：
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

## 使用方式

### 在 Claude Desktop 中設定

1. **複製 MCP 設定範例**：
   ```bash
   cp .mcp.json.example .mcp.json
   ```

2. **修改 .mcp.json 中的路徑**為你的實際專案路徑：
   ```json
   {
     "mcpServers": {
       "baha-bbs": {
         "command": "node",
         "args": ["/實際路徑/baha-chat/dist/index.js"]
       }
     }
   }
   ```

3. **編輯 Claude Desktop 的設定檔**（`~/Library/Application Support/Claude/claude_desktop_config.json`），加入 .mcp.json 的內容或使用絕對路徑：

   ```json
   {
     "mcpServers": {
       "baha-bbs": {
         "command": "node",
         "args": ["/你的路徑/baha-chat/dist/index.js"]
       }
     }
   }
   ```

### 可用工具

1. **bbs_connect** - 連接到 BBS
2. **bbs_auto_login** - 使用 .env 設定的帳密自動登入 ⭐
3. **bbs_send** - 發送文字到 BBS
4. **bbs_send_key** - 發送特殊按鍵 ⭐ 新增
   - 方向鍵：up, down, left, right
   - 換頁：pgup, pgdn, pageup, pagedown
   - 導航：home, end
   - 其他：enter, esc, space, backspace, delete, insert
5. **bbs_send_ctrl** - 發送 Ctrl 組合鍵 🆕
   - 例如：Ctrl+P 發文、Ctrl+W 儲存、Ctrl+X 離開
6. **bbs_get_screen** - 取得目前畫面內容
7. **bbs_get_context** - 取得結構化畫面資料（推薦，較省 token）
8. **bbs_disconnect** - 中斷連線

### 使用範例

#### 快速登入（推薦）

1. 連接並自動登入：
   ```
   請使用 bbs_connect 工具連接
   請使用 bbs_auto_login 工具自動登入
   ```

2. 查看登入後畫面：
   ```
   請使用 bbs_get_screen 工具
   ```

#### 手動登入

1. 首先連接到 BBS：
   ```
   使用 bbs_connect 工具
   ```

2. 發送文字（例如登入帳號）：
   ```
   使用 bbs_send 工具，text: "your_username"
   ```

3. 按下 Enter：
   ```
   使用 bbs_send_key 工具，key: "enter"
   ```

4. 查看目前畫面：
   ```
   使用 bbs_get_screen 工具
   ```

## BBS 指令參考

完整的 BBS 指令對照表請參考：[BBS_COMMANDS.md](BBS_COMMANDS.md)

包含：
- 基本瀏覽指令（方向鍵、換頁）
- 功能指令（發文、刪文、搜尋）
- 編輯器指令（檔案操作、游標移動、文字編輯）
- 常用操作流程範例

## 技術細節

- 使用 WebSocket 連接到 `wss://term.gamer.com.tw/bbs`
- 支援 Big5 編碼轉換（BBS 常用編碼）
- 處理 ANSI 控制碼和特殊按鍵
- 支援完整的 Ctrl 組合鍵
- 基於 MCP SDK 建立

## 開發

```bash
# 開發模式（自動重新編譯）
npm run dev

# 建置
npm run build

# 執行
npm start
```

## 注意事項

- BBS 使用 Big5 編碼，畫面可能包含 ANSI 控制碼
- 某些操作可能需要特定的按鍵順序
- 建議先手動連接 BBS 了解操作流程，再透過此工具操作
