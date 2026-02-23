#!/bin/bash

echo "🚀 巴哈姆特 BBS MCP Server 設定"
echo "================================"
echo ""

# Check if .env already exists
if [ -f .env ]; then
    echo "⚠️  .env 檔案已存在"
    read -p "是否要覆寫？(y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "取消設定"
        exit 0
    fi
fi

# Copy .env.example to .env
if [ -f .env.example ]; then
    cp .env.example .env
    echo "✅ 已建立 .env 檔案"
else
    echo "❌ 找不到 .env.example 檔案"
    exit 1
fi

# Ask for username
echo ""
read -p "請輸入你的巴哈姆特帳號: " username

# Ask for password (hidden input)
echo -n "請輸入你的密碼: "
read -s password
echo ""

# Update .env file
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/your_username_here/$username/" .env
    sed -i '' "s/your_password_here/$password/" .env
else
    # Linux
    sed -i "s/your_username_here/$username/" .env
    sed -i "s/your_password_here/$password/" .env
fi

# Set file permissions
chmod 600 .env

echo ""
echo "✅ 設定完成！"
echo ""
echo "📋 下一步："
echo "1. 執行: npm install"
echo "2. 執行: npm run build"
echo "3. 將此 MCP server 加入 Claude Desktop 設定"
echo ""
echo "🔒 安全提示："
echo "- .env 檔案已設定為僅你可讀寫 (chmod 600)"
echo "- .env 已被 .gitignore 排除，不會被 git 追蹤"
echo "- 定期更換密碼以保持安全"
echo ""
