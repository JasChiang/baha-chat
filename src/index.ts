#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
  CallToolResult,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";
import iconv from "iconv-lite";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import xtermPkg from "@xterm/headless";
const { Terminal } = xtermPkg;

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

interface BBSConnection {
  ws: WebSocket | null;
  connected: boolean;
  terminal: InstanceType<typeof Terminal> | null;
  lastScreenContent: string;
  buffer: Buffer;
}

class BahaBBSServer {
  private server: Server;
  private connection: BBSConnection = {
    ws: null,
    connected: false,
    terminal: null,
    lastScreenContent: "",
    buffer: Buffer.alloc(0),
  };

  constructor() {
    this.server = new Server(
      {
        name: "baha-bbs-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: "bbs_connect",
          description: "Connect to Bahamut BBS via WebSocket",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "bbs_auto_login",
          description: "Automatically login to BBS using credentials from .env file (BBS_USERNAME and BBS_PASSWORD)",
          inputSchema: {
            type: "object",
            properties: {
              return_mode: {
                type: "string",
                enum: ["full", "summary"],
                description: "Response format: 'full' returns complete screen (default), 'summary' returns state + key info (saves ~70% tokens)",
                default: "summary",
              },
            },
          },
        },
        {
          name: "bbs_send",
          description: "Send a command or text to the BBS",
          inputSchema: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "Text or command to send to BBS",
              },
              return_mode: {
                type: "string",
                enum: ["full", "summary"],
                description: "Response format: 'full' returns complete screen (default), 'summary' returns state + key info (saves ~70% tokens)",
                default: "summary",
              },
            },
            required: ["text"],
          },
        },
        {
          name: "bbs_send_key",
          description: "Send a special key to the BBS (arrow keys, Page Up/Down, Home/End, Enter, etc.)",
          inputSchema: {
            type: "object",
            properties: {
              key: {
                type: "string",
                enum: [
                  "up", "down", "left", "right",
                  "pgup", "pgdn", "pageup", "pagedown",
                  "home", "end",
                  "enter", "esc", "space",
                  "backspace", "delete", "insert",
                ],
                description: "Special key to send",
              },
              return_mode: {
                type: "string",
                enum: ["full", "summary"],
                description: "Response format: 'full' returns complete screen (default), 'summary' returns state + key info (saves ~70% tokens)",
                default: "summary",
              },
            },
            required: ["key"],
          },
        },
        {
          name: "bbs_send_ctrl",
          description: "Send a control key combination (Ctrl+letter) to BBS for commands like ^P (post), ^W (file operations), etc.",
          inputSchema: {
            type: "object",
            properties: {
              letter: {
                type: "string",
                pattern: "^[a-zA-Z]$",
                description: "Letter to combine with Ctrl (a-z or A-Z)",
              },
              return_mode: {
                type: "string",
                enum: ["full", "summary"],
                description: "Response format: 'full' returns complete screen (default), 'summary' returns state + key info (saves ~70% tokens)",
                default: "summary",
              },
            },
            required: ["letter"],
          },
        },
        {
          name: "bbs_get_screen",
          description: "Get the current screen content from BBS",
          inputSchema: {
            type: "object",
            properties: {
              return_mode: {
                type: "string",
                enum: ["full", "summary"],
                description: "Response format: 'full' returns complete screen (default), 'summary' returns state + key info (saves ~70% tokens)",
                default: "summary",
              },
            },
          },
        },
        {
          name: "bbs_get_context",
          description: "Get structured context data from BBS (state, articles, menus, etc.) - uses 80-90% less tokens than bbs_get_screen. Returns JSON with parsed information: article lists, menu options, current state, etc. Always use this instead of bbs_get_screen for navigation and queries.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "bbs_disconnect",
          description: "Disconnect from BBS",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ];

      return { tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const returnMode = (args as any)?.return_mode || "summary";

        switch (name) {
          case "bbs_connect":
            return await this.handleConnect();

          case "bbs_auto_login":
            return await this.handleAutoLogin(returnMode);

          case "bbs_send":
            if (!args || typeof args.text !== "string") {
              throw new Error("Missing required parameter: text");
            }
            return await this.handleSend(args.text, returnMode);

          case "bbs_send_key":
            if (!args || typeof args.key !== "string") {
              throw new Error("Missing required parameter: key");
            }
            return await this.handleSendKey(args.key, returnMode);

          case "bbs_send_ctrl":
            if (!args || typeof args.letter !== "string") {
              throw new Error("Missing required parameter: letter");
            }
            return await this.handleSendCtrl(args.letter, returnMode);

          case "bbs_get_screen":
            return await this.handleGetScreen(returnMode);

          case "bbs_get_context":
            return await this.handleGetContext();

          case "bbs_disconnect":
            return await this.handleDisconnect();

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  private getScreenContent(): string {
    if (!this.connection.terminal) {
      return "";
    }

    const buffer = this.connection.terminal.buffer.active;
    const lines: string[] = [];

    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true)); // true = remove trailing whitespace
      }
    }

    return lines.join('\n');
  }

  private detectScreenState(content: string): string {
    if (content.includes("【主功能表】")) return "main_menu";
    if (content.includes("請輸入看板名稱")) return "board_search";
    if (content.includes("看板《") && content.includes("[^P]發表")) return "board_list";
    if (content.includes("編輯文章") && content.includes("Ctrl-Z")) return "editor";
    if (content.includes("文 章 發 表 綱 領")) return "posting_guide";
    if (content.includes("類別:") && content.includes("看板")) return "category_select";
    if (content.includes("標題：")) return "title_input";
    if (content.includes("選擇簽名檔")) return "signature_select";
    if (content.includes("[S]存檔")) return "save_prompt";
    if (content.includes("順利貼出佈告")) return "post_success";
    if (content.includes("請按任意鍵繼續")) return "press_any_key";
    if (content.includes("本板用途僅供")) return "board_enter";
    return "unknown";
  }

  private getScreenSummary(content: string): string {
    const lines = content.split('\n');
    const state = this.detectScreenState(content);

    // Extract key information based on state
    let summary = `[State: ${state}]\n`;

    // Get first 2 non-empty lines (usually title/header)
    const topLines = lines.filter(l => l.trim().length > 0).slice(0, 2);
    if (topLines.length > 0) {
      summary += `Top: ${topLines.join(' | ')}\n`;
    }

    // Get last 2 non-empty lines (usually status/prompt)
    const bottomLines = lines.filter(l => l.trim().length > 0).slice(-2);
    if (bottomLines.length > 0) {
      summary += `Bottom: ${bottomLines.join(' | ')}\n`;
    }

    // Extract specific prompts or important info
    const promptLine = lines.find(l =>
      l.includes("：") || l.includes("?") || l.includes("請") ||
      l.includes(">") || l.includes("類別") || l.includes("標題")
    );
    if (promptLine && promptLine.trim()) {
      summary += `Prompt: ${promptLine.trim()}\n`;
    }

    // Check for success/error messages
    if (content.includes("成功") || content.includes("順利")) {
      summary += "Status: SUCCESS\n";
    }
    if (content.includes("錯誤") || content.includes("失敗")) {
      summary += "Status: ERROR\n";
    }

    return summary.trim();
  }

  private parseArticleList(content: string): any {
    const lines = content.split('\n');
    const articles = [];
    let boardInfo = { id: "", name: "", moderators: [] as string[] };
    let cursorInfo = { line: -1, article_id: -1 };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Parse board header: 【板主：xxx】 測試區 看板《test》
      if (line.includes("【板主：") && line.includes("看板《")) {
        const modMatch = line.match(/【板主：([^】]+)】/);
        const nameMatch = line.match(/】\s*([^\s]+)\s+看板/);
        const idMatch = line.match(/看板《([^》]+)》/);
        if (modMatch) {
          boardInfo.moderators = modMatch[1].split('/').map(m => m.trim());
        }
        if (nameMatch) boardInfo.name = nameMatch[1].trim();
        if (idMatch) boardInfo.id = idMatch[1].trim();
        continue;
      }

      // Parse article line: >    6 +  02/23 example_user   ◇ [測試] 標題
      // or reply line:      52067 +  02/23 pi           Re 標題 (沒有 ◇)
      const articleMatch = line.match(/^\s*(>?)\s*(\d+)\s+(\+?)\s+(\d+\/\d+)\s+(\S+)\s+(?:◇\s+)?(.+)/);
      if (articleMatch) {
        const hasCursor = articleMatch[1] === '>';
        const id = parseInt(articleMatch[2]);
        const hasResponses = articleMatch[3] === '+';
        const date = articleMatch[4];
        const author = articleMatch[5];
        const title = articleMatch[6].trim();

        articles.push({
          line_number: i,
          id,
          date,
          author,
          title,
          has_responses: hasResponses,
          is_new: hasResponses,
          has_cursor: hasCursor
        });

        if (hasCursor) {
          cursorInfo = { line: i, article_id: id };
        }
      }
    }

    // Calculate pagination info
    const firstId = articles.length > 0 ? articles[0].id : 0;
    const lastId = articles.length > 0 ? articles[articles.length - 1].id : 0;

    return {
      state: "board_list",
      board: boardInfo,
      articles,
      cursor: cursorInfo,
      pagination: {
        visible_count: articles.length,
        first_article_id: firstId,
        last_article_id: lastId,
        note: "Showing current page only. Use bbs_send_key('pgup'/'pgdn') to navigate pages, or 'home'/'end' for first/last page."
      },
      actions: {
        available: ["read", "post", "search", "favorite", "back"],
        hotkeys: {
          "left": "離開",
          "right": "閱讀",
          "ctrl_p": "發表",
          "pgup": "上一頁",
          "pgdn": "下一頁",
          "home": "第一頁",
          "end": "最後一頁"
        }
      }
    };
  }

  private parseMainMenu(content: string): any {
    const lines = content.split('\n');
    const menuOptions = [];
    let username = "";
    let onlineUsers = 0;
    let timestamp = "";

    for (const line of lines) {
      // Parse menu options: (B)oards 【佈告討論區】
      const optionMatch = line.match(/\(([A-Z])\)(\w+)\s+【([^】]+)】/);
      if (optionMatch) {
        menuOptions.push({
          key: optionMatch[1],
          name: optionMatch[2],
          description: optionMatch[3],
          selected: line.includes(">")
        });
      }

      // Parse status line: [2/23 星期一 13:18] [訪客] 511 人 [到此一遊] example_user
      const statusMatch = line.match(/\[([^\]]+)\].*\[訪客\]\s*(\d+)\s*人.*\[([^\]]+)\]\s*(\S+)/);
      if (statusMatch) {
        timestamp = statusMatch[1];
        onlineUsers = parseInt(statusMatch[2]);
        username = statusMatch[4];
      }
    }

    return {
      state: "main_menu",
      user: {
        username,
        status: "到此一遊"
      },
      online_users: onlineUsers,
      menu_options: menuOptions,
      timestamp
    };
  }

  private parseContext(content: string): any {
    const state = this.detectScreenState(content);

    switch (state) {
      case "board_list":
        return this.parseArticleList(content);

      case "main_menu":
        return this.parseMainMenu(content);

      case "category_select": {
        const categories = [
          { key: "a", name: "問題" },
          { key: "b", name: "情報" },
          { key: "c", name: "心得" },
          { key: "d", name: "討論" },
          { key: "e", name: "攻略" },
          { key: "f", name: "秘技" },
          { key: "g", name: "閒聊" },
          { key: "h", name: "其它" }
        ];
        return {
          state: "category_select",
          board: this.getCurrentBoard(content),
          prompt: "類別:",
          categories,
          can_skip: true,
          skip_key: "enter"
        };
      }

      case "title_input": {
        const titleMatch = content.match(/標題：(.+)/);
        return {
          state: "title_input",
          board: this.getCurrentBoard(content),
          prompt: "標題：",
          current_input: titleMatch ? titleMatch[1].trim() : "",
          max_length: 80,
          waiting_for: "title"
        };
      }

      case "signature_select": {
        return {
          state: "signature_select",
          prompt: "選擇簽名檔 (1 ~ 9, 0=不加)",
          default: 0,
          available_signatures: [0]
        };
      }

      case "editor": {
        return {
          state: "editor",
          stats: {
            mode: "insert"
          },
          available_commands: {
            "ctrl_x": "存檔/結束",
            "ctrl_q": "放棄",
            "ctrl_z": "操作說明",
            "ctrl_w": "檔案處理"
          }
        };
      }

      case "save_prompt": {
        return {
          state: "save_prompt",
          prompt: "檔案處理",
          options: [
            { key: "S", action: "save", description: "存檔" },
            { key: "L", action: "local", description: "站內" },
            { key: "A", action: "abort", description: "放棄" },
            { key: "T", action: "title", description: "改標題" },
            { key: "E", action: "edit", description: "繼續" },
            { key: "R", action: "read_temp", description: "讀暫存檔" },
            { key: "W", action: "write_temp", description: "寫暫存檔" },
            { key: "D", action: "delete_temp", description: "刪暫存檔" }
          ]
        };
      }

      case "post_success": {
        return {
          state: "post_success",
          success: true,
          message: "順利貼出佈告",
          next_action: "press_any_key"
        };
      }

      case "board_enter": {
        const noticeLines = content.split('\n').filter(l =>
          l.trim().length > 0 &&
          !l.includes("請按任意鍵") &&
          l.trim() !== ""
        ).slice(0, 3);
        return {
          state: "board_enter",
          notice: noticeLines.join(' '),
          next_action: "press_any_key"
        };
      }

      case "board_search": {
        const inputMatch = content.match(/請輸入看板名稱[^：]*：(.+)/);
        return {
          state: "board_search",
          prompt: "請輸入看板名稱(按空白鍵自動搜尋)：",
          current_input: inputMatch ? inputMatch[1].trim() : "",
          waiting_for: "board_name"
        };
      }

      default: {
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        return {
          state: "unknown",
          hint: "無法自動解析此畫面",
          screen_preview: {
            top_lines: lines.slice(0, 2),
            bottom_lines: lines.slice(-2)
          },
          suggestion: "使用 return_mode='full' 查看完整螢幕"
        };
      }
    }
  }

  private getCurrentBoard(content: string): string {
    const match = content.match(/看板《([^》]+)》/) || content.match(/發表文章於【\s*(\S+)\s*】/);
    return match ? match[1] : "";
  }

  private async waitForScreenUpdate(timeoutMs: number = 1000): Promise<void> {
    const startTime = Date.now();
    const startContent = this.getScreenContent();
    let lastContent = startContent;
    let stableCount = 0;

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const currentContent = this.getScreenContent();

        // Screen has changed from start
        if (currentContent !== startContent) {
          // Check if content is stable (unchanged for 2 checks = 100ms)
          if (currentContent === lastContent) {
            stableCount++;
            if (stableCount >= 2) {
              clearInterval(checkInterval);
              resolve();
              return;
            }
          } else {
            stableCount = 0;
            lastContent = currentContent;
          }
        }

        // Timeout
        if (elapsed >= timeoutMs) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50); // Check every 50ms
    });
  }

  private async handleConnect(): Promise<CallToolResult> {
    if (this.connection.connected) {
      return {
        content: [
          {
            type: "text",
            text: "Already connected to BBS",
          } as TextContent,
        ],
      };
    }

    return new Promise<CallToolResult>((resolve, reject) => {
      try {
        this.connection.ws = new WebSocket("wss://term.gamer.com.tw/bbs", {
          origin: "https://term.gamer.com.tw"
        });
        this.connection.buffer = Buffer.alloc(0);

        this.connection.ws.on("open", () => {
          this.connection.connected = true;

          // Initialize terminal emulator
          this.connection.terminal = new Terminal({
            cols: 80,
            rows: 24,
            allowProposedApi: true
          });

          resolve({
            content: [
              {
                type: "text",
                text: "Successfully connected to Bahamut BBS!",
              } as TextContent,
            ],
          });
        });

        this.connection.ws.on("message", (data: Buffer) => {
          // Accumulate buffer to handle incomplete Big5 sequences
          this.connection.buffer = Buffer.concat([this.connection.buffer, data]);

          try {
            // Big5 decode to UTF-8
            const utf8String = iconv.decode(this.connection.buffer, "big5");

            // Feed to terminal emulator
            if (this.connection.terminal) {
              this.connection.terminal.write(utf8String);
            }

            // Successfully decoded, clear buffer
            this.connection.buffer = Buffer.alloc(0);
          } catch (e) {
            // Possibly incomplete Big5 sequence, keep buffer for next message
          }
        });

        this.connection.ws.on("error", (error) => {
          console.error("WebSocket error:", error);
          if (!this.connection.connected) {
            reject(new Error(`WebSocket error: ${error.message || error}`));
          }
        });

        this.connection.ws.on("close", () => {
          this.connection.connected = false;
          this.connection.ws = null;
          if (!this.connection.connected) {
            reject(new Error("WebSocket closed before connection was established"));
          }
        });

        // Timeout after 30 seconds
        setTimeout(() => {
          if (!this.connection.connected) {
            reject(new Error("Connection timeout after 30 seconds. WebSocket 'open' event was not fired."));
          }
        }, 30000);
      } catch (error) {
        reject(error);
      }
    });
  }

  private async handleSend(text: string, returnMode: string = "summary"): Promise<CallToolResult> {
    if (!this.connection.connected || !this.connection.ws) {
      throw new Error("Not connected to BBS. Use bbs_connect first.");
    }

    // Encode text as Big5 and send
    const encoded = iconv.encode(text, "big5");
    this.connection.ws.send(encoded);

    // Wait for screen update
    await this.waitForScreenUpdate(1000);

    const screenContent = this.getScreenContent();
    const response = returnMode === "summary"
      ? this.getScreenSummary(screenContent)
      : screenContent;

    return {
      content: [
        {
          type: "text",
          text: `Sent input: [HIDDEN]\n\n${returnMode === "summary" ? "Summary" : "Response"}:\n${response}`,
        } as TextContent,
      ],
    };
  }

  private async handleSendKey(key: string, returnMode: string = "summary"): Promise<CallToolResult> {
    if (!this.connection.connected || !this.connection.ws) {
      throw new Error("Not connected to BBS. Use bbs_connect first.");
    }

    // Map keys to control codes
    const keyMap: { [key: string]: Buffer } = {
      // Arrow keys
      up: Buffer.from([0x1b, 0x5b, 0x41]), // ESC[A
      down: Buffer.from([0x1b, 0x5b, 0x42]), // ESC[B
      right: Buffer.from([0x1b, 0x5b, 0x43]), // ESC[C
      left: Buffer.from([0x1b, 0x5b, 0x44]), // ESC[D

      // Page navigation
      pgup: Buffer.from([0x1b, 0x5b, 0x35, 0x7e]), // ESC[5~
      pageup: Buffer.from([0x1b, 0x5b, 0x35, 0x7e]), // ESC[5~
      pgdn: Buffer.from([0x1b, 0x5b, 0x36, 0x7e]), // ESC[6~
      pagedown: Buffer.from([0x1b, 0x5b, 0x36, 0x7e]), // ESC[6~

      // Home/End
      home: Buffer.from([0x1b, 0x5b, 0x48]), // ESC[H
      end: Buffer.from([0x1b, 0x5b, 0x46]), // ESC[F

      // Other special keys
      enter: Buffer.from([0x0d]), // CR
      esc: Buffer.from([0x1b]), // ESC
      space: Buffer.from([0x20]), // Space
      backspace: Buffer.from([0x08]), // BS
      delete: Buffer.from([0x7f]), // DEL
      insert: Buffer.from([0x1b, 0x5b, 0x32, 0x7e]), // ESC[2~
    };

    const keyCode = keyMap[key.toLowerCase()];
    if (!keyCode) {
      throw new Error(`Unknown key: ${key}`);
    }

    this.connection.ws.send(keyCode);

    // Wait for screen update
    await this.waitForScreenUpdate(800);

    const screenContent = this.getScreenContent();
    const response = returnMode === "summary"
      ? this.getScreenSummary(screenContent)
      : screenContent;

    return {
      content: [
        {
          type: "text",
          text: `Sent key: ${key}\n\n${returnMode === "summary" ? "Summary" : "Response"}:\n${response}`,
        } as TextContent,
      ],
    };
  }

  private async handleSendCtrl(letter: string, returnMode: string = "summary"): Promise<CallToolResult> {
    if (!this.connection.connected || !this.connection.ws) {
      throw new Error("Not connected to BBS. Use bbs_connect first.");
    }

    // Convert letter to uppercase and get control code
    const upperLetter = letter.toUpperCase();
    const charCode = upperLetter.charCodeAt(0);

    // Ctrl+letter is calculated as: letter code - 64
    // For example: Ctrl+A = 1, Ctrl+B = 2, ..., Ctrl+Z = 26
    if (charCode < 65 || charCode > 90) {
      throw new Error(`Invalid letter for Ctrl combination: ${letter}`);
    }

    const ctrlCode = charCode - 64;
    const keyCode = Buffer.from([ctrlCode]);

    this.connection.ws.send(keyCode);

    // Wait for screen update
    await this.waitForScreenUpdate(800);

    const screenContent = this.getScreenContent();
    const response = returnMode === "summary"
      ? this.getScreenSummary(screenContent)
      : screenContent;

    return {
      content: [
        {
          type: "text",
          text: `Sent Ctrl+${upperLetter} (code: ${ctrlCode})\n\n${returnMode === "summary" ? "Summary" : "Response"}:\n${response}`,
        } as TextContent,
      ],
    };
  }

  private async handleGetScreen(returnMode: string = "summary"): Promise<CallToolResult> {
    if (!this.connection.connected) {
      throw new Error("Not connected to BBS. Use bbs_connect first.");
    }

    const screenContent = this.getScreenContent();
    const response = returnMode === "summary"
      ? this.getScreenSummary(screenContent)
      : screenContent;

    return {
      content: [
        {
          type: "text",
          text: `Current screen ${returnMode === "summary" ? "summary" : ""}:\n${response}`,
        } as TextContent,
      ],
    };
  }

  private async handleGetContext(): Promise<CallToolResult> {
    if (!this.connection.connected) {
      throw new Error("Not connected to BBS. Use bbs_connect first.");
    }

    const screenContent = this.getScreenContent();
    const contextData = this.parseContext(screenContent);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(contextData, null, 2),
        } as TextContent,
      ],
    };
  }

  private async handleDisconnect(): Promise<CallToolResult> {
    if (!this.connection.connected || !this.connection.ws) {
      return {
        content: [
          {
            type: "text",
            text: "Not connected to BBS",
          } as TextContent,
        ],
      };
    }

    this.connection.ws.close();
    this.connection.connected = false;
    this.connection.ws = null;
    this.connection.buffer = Buffer.alloc(0);

    if (this.connection.terminal) {
      this.connection.terminal.dispose();
      this.connection.terminal = null;
    }

    return {
      content: [
        {
          type: "text",
          text: "Disconnected from BBS",
        } as TextContent,
      ],
    };
  }

  private async handleAutoLogin(returnMode: string = "summary"): Promise<CallToolResult> {
    const username = process.env.BBS_USERNAME;
    const password = process.env.BBS_PASSWORD;

    if (!username || !password) {
      throw new Error(
        "BBS credentials not found. Please create a .env file with BBS_USERNAME and BBS_PASSWORD"
      );
    }

    if (!this.connection.connected) {
      throw new Error("Not connected to BBS. Use bbs_connect first.");
    }

    const steps: string[] = [];

    // Wait for welcome screen (use fixed delays for reliability)
    await new Promise(resolve => setTimeout(resolve, 3500)); // Need at least 3s
    steps.push("Waited for welcome screen");

    // Send username
    const encodedUsername = iconv.encode(username + "\r", "big5");
    this.connection.ws?.send(encodedUsername);
    await new Promise(resolve => setTimeout(resolve, 2000));
    steps.push("Sent username");

    // Send password (wait longer for BBS to be ready)
    const encodedPassword = iconv.encode(password + "\r", "big5");
    this.connection.ws?.send(encodedPassword);
    await new Promise(resolve => setTimeout(resolve, 2000));
    steps.push("Sent password");

    // Handle duplicate login prompt (press Enter to confirm)
    this.connection.ws?.send(Buffer.from([0x0d])); // Enter
    await new Promise(resolve => setTimeout(resolve, 1000));
    steps.push("Handled duplicate login prompt");

    // Skip post-login pages (系統公告、十大熱門、過路勇者足跡、etc.)
    for (let i = 0; i < 5; i++) {
      this.connection.ws?.send(Buffer.from([0x20])); // Space
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    steps.push("Skipped post-login pages");

    const screenContent = this.getScreenContent();
    const response = returnMode === "summary"
      ? this.getScreenSummary(screenContent)
      : screenContent;

    return {
      content: [
        {
          type: "text",
          text: `Auto-login completed!\n\nSteps:\n${steps.join("\n")}\n\nCurrent screen ${returnMode === "summary" ? "summary" : ""}:\n${response}`,
        } as TextContent,
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Bahamut BBS MCP Server running on stdio");
  }
}

const server = new BahaBBSServer();
server.run().catch(console.error);
