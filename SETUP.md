# 設定說明

## 設定帳號密碼

### 方法一：使用 .env 檔案（推薦）

1. **複製範例檔案**：
   ```bash
   cp .env.example .env
   ```

2. **編輯 .env 檔案**：
   ```bash
   # 使用你喜歡的編輯器開啟
   nano .env
   # 或
   vim .env
   # 或
   open -a TextEdit .env
   ```

3. **填入你的帳號密碼**：
   ```
   BBS_USERNAME=你的巴哈帳號
   BBS_PASSWORD=你的密碼
   ```

4. **儲存檔案**

5. **確認 .env 已被 .gitignore 排除**（避免不小心提交到 git）：
   ```bash
   cat .gitignore | grep .env
   ```
   應該會看到 `.env` 在列表中。

### 使用自動登入功能

設定完 .env 後，你可以使用 `bbs_auto_login` 工具自動登入：

```
1. 請使用 bbs_connect 工具連接到 BBS
2. 請使用 bbs_auto_login 工具自動登入
```

## 安全注意事項

✅ **安全做法**：
- `.env` 檔案已加入 `.gitignore`，不會被 git 追蹤
- 帳密僅存在本機，不會上傳到任何地方
- MCP server 在本機執行，不會將帳密傳送到外部服務

⚠️ **注意事項**：
- 不要將 `.env` 檔案分享給他人
- 不要將 `.env` 檔案提交到 git repository
- 定期更換密碼以保持帳號安全
- 如果懷疑帳密外洩，立即更換密碼

## 檔案權限（選用，額外安全措施）

你可以限制 .env 檔案的讀取權限：

```bash
chmod 600 .env
```

這樣只有你（檔案擁有者）可以讀寫這個檔案。

## 驗證設定

建置並測試：

```bash
# 建置專案
npm run build

# 確認 .env 檔案存在
ls -la .env

# 確認 .env 內容（不會顯示實際密碼，只檢查格式）
grep "BBS_USERNAME" .env
grep "BBS_PASSWORD" .env
```

## 疑難排解

### 錯誤：找不到帳密

如果看到錯誤訊息：
```
BBS credentials not found. Please create a .env file with BBS_USERNAME and BBS_PASSWORD
```

請檢查：
1. `.env` 檔案是否存在於專案根目錄
2. `.env` 檔案中是否有 `BBS_USERNAME` 和 `BBS_PASSWORD`
3. 變數名稱是否拼寫正確（區分大小寫）
4. 等號兩邊不要有空格：`BBS_USERNAME=帳號` ✅  `BBS_USERNAME = 帳號` ❌

### 手動登入（不使用 .env）

如果你不想使用 .env 檔案，也可以手動登入：

1. 使用 `bbs_connect` 連接
2. 使用 `bbs_send` 輸入帳號
3. 使用 `bbs_send_key` 按 Enter
4. 使用 `bbs_send` 輸入密碼
5. 使用 `bbs_send_key` 按 Enter

但每次都要重複這些步驟，比較不方便。
