# 快速開始

## 一鍵設定（推薦）

```bash
./setup.sh
```

這個腳本會：
- 建立 `.env` 檔案
- 詢問你的帳號密碼
- 自動設定檔案權限
- **你的帳密只會儲存在本機的 `.env` 檔案中**

## 手動設定

```bash
# 1. 複製設定範例
cp .env.example .env

# 2. 編輯 .env 填入帳密
nano .env

# 3. 安裝套件
npm install

# 4. 建置專案
npm run build
```

## 加入 Claude Desktop

編輯設定檔：
```bash
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

加入以下內容：
```json
{
  "mcpServers": {
    "baha-bbs": {
      "command": "node",
      "args": ["/path/to/baha-chat/dist/index.js"]
    }
  }
}
```

## 開始使用

1. **重啟 Claude Desktop**

2. **連接並登入**：
   ```
   請使用 bbs_connect 工具連接到巴哈姆特 BBS
   請使用 bbs_auto_login 工具自動登入
   ```

3. **開始瀏覽**：
   ```
   請使用 bbs_get_screen 工具查看目前畫面
   ```

## 安全說明

✅ **降低帳密外洩風險的做法**：
- 儲存在本機 `.env` 檔案
- `.env` 已被 `.gitignore` 排除
- MCP server 在本機執行
- 優先使用 `bbs_auto_login`，避免在對話中手動輸入密碼

⚠️ **請記得**：
- 不要分享 `.env` 檔案
- 不要提交到 git
- 定期更換密碼
- 如果曾在對話中輸入密碼，請立即更換密碼

## 需要幫助？

- 詳細設定說明：[SETUP.md](SETUP.md)
- 使用範例：[USAGE_EXAMPLES.md](USAGE_EXAMPLES.md)
- 專案說明：[README.md](README.md)
