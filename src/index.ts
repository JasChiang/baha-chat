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
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import xtermPkg from "@xterm/headless";
import { decodeBig5UAO, encodeBig5UAO } from "./uaoCodec.js";
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

interface ThreadSearchOptions {
  keyword: string;
  authorPrefix: string;
  markedMode: "any" | "yes" | "no";
  gyMin: number | null;
}

class BahaBBSServer {
  private readonly terminalCols = 80;
  private readonly terminalRows = 24;
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
        {
          name: "bbs_reset_screen",
          description: "Reset local terminal screen buffer to match a fresh 80x24 BBS viewport",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "bbs_collect_thread",
          description: "Collect the current article and related-topic posts into structured data for thread summarization",
          inputSchema: {
            type: "object",
            properties: {
              keyword_search: {
                type: "string",
                description: "Optional board-list keyword search using '~' thread mode before collecting posts",
              },
              author_prefix: {
                type: "string",
                description: "Optional author/ID prefix filter for '~' thread mode. Use '*' as the first character for fuzzy matching",
              },
              marked_mode: {
                type: "string",
                enum: ["any", "yes", "no"],
                default: "any",
                description: "Optional m-mark filter for '~' thread mode",
              },
              gy_min: {
                type: "number",
                minimum: 0,
                description: "Optional GY lower bound for '~' thread mode",
              },
              max_related_posts: {
                type: "number",
                minimum: 1,
                maximum: 20,
                default: 5,
                description: "Maximum number of related posts to collect, including the seed article",
              },
            },
          },
        },
        {
          name: "bbs_summarize_thread",
          description: "Summarize the current article thread into a neutral or BBS-ready draft without posting it",
          inputSchema: {
            type: "object",
            properties: {
              keyword_search: {
                type: "string",
                description: "Optional board-list keyword search using '~' thread mode before summarizing",
              },
              author_prefix: {
                type: "string",
                description: "Optional author/ID prefix filter for '~' thread mode. Use '*' as the first character for fuzzy matching",
              },
              marked_mode: {
                type: "string",
                enum: ["any", "yes", "no"],
                default: "any",
                description: "Optional m-mark filter for '~' thread mode",
              },
              gy_min: {
                type: "number",
                minimum: 0,
                description: "Optional GY lower bound for '~' thread mode",
              },
              max_related_posts: {
                type: "number",
                minimum: 1,
                maximum: 20,
                default: 8,
                description: "Maximum number of related posts to analyze, including the seed article",
              },
              style: {
                type: "string",
                enum: ["neutral", "bbs_post"],
                default: "neutral",
                description: "Summary output style",
              },
            },
          },
        },
        {
          name: "stock_quote",
          description: "Get near-realtime Taiwan stock quotes from TWSE mis API (盤中延遲約 0-20 秒). Returns OHLC, volume, 5-tier bid/ask, prior close. Supports: plain code ('2330' auto-detects tse/otc), explicit prefix ('tse_2330.tw'/'otc_8299.tw'), and market index aliases ('TAIEX'/'加權'/'t00' → 加權指數; 'TPEX'/'櫃買'/'o00' → 櫃買指數).",
          inputSchema: {
            type: "object",
            properties: {
              symbols: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 20,
                description: "Stock codes. Plain digits ('2330') tries both tse and otc; explicit prefix ('tse_2330.tw' / 'otc_8299.tw') skips detection.",
              },
            },
            required: ["symbols"],
          },
        },
        {
          name: "bbs_enter_board",
          description: "Composite shortcut: from main menu, search a board by name and enter it (s + name + Enter + Space for any 'press any key' welcome). Replaces 4 manual steps.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Board name, e.g. 'Chat', 'test'" },
              return_mode: { type: "string", enum: ["full", "summary"], default: "summary" },
            },
            required: ["name"],
          },
        },
        {
          name: "bbs_jump_to_article",
          description: "Composite shortcut: from a board list, jump cursor to a specific article id (id + Enter). Caller must already be on the board list.",
          inputSchema: {
            type: "object",
            properties: {
              article_id: { type: "number", description: "Target article id (the integer shown in board list)" },
              return_mode: { type: "string", enum: ["full", "summary"], default: "summary" },
            },
            required: ["article_id"],
          },
        },
        {
          name: "bbs_jump_and_read",
          description: "Composite shortcut: from a board list, jump to article id, press → to read it, return content. One call replaces jump + Enter + right + get_screen.",
          inputSchema: {
            type: "object",
            properties: {
              article_id: { type: "number", description: "Target article id" },
              return_mode: { type: "string", enum: ["full", "summary"], default: "full" },
            },
            required: ["article_id"],
          },
        },
        {
          name: "bbs_read_thread",
          description: "Composite shortcut: from a board list, jump to the seed article and walk forward N posts in the same thread using ']'. Returns concatenated content of each post (full screen of each).",
          inputSchema: {
            type: "object",
            properties: {
              article_id: { type: "number", description: "Seed article id" },
              count: { type: "number", minimum: 1, maximum: 20, default: 5, description: "Number of posts to read including the seed" },
            },
            required: ["article_id"],
          },
        },
        {
          name: "bbs_start_reply",
          description: "Composite shortcut: from an article view (or board list with cursor on target), drive the full reply wizard (y → F → Enter category → Enter title → Y quote → 0 sig → Enter → Ctrl-T to end). Leaves you in the editor at the end of quoted body, ready for content.",
          inputSchema: {
            type: "object",
            properties: {
              return_mode: { type: "string", enum: ["full", "summary"], default: "summary" },
            },
          },
        },
        {
          name: "bbs_save_post",
          description: "Composite shortcut: in the editor with content already typed (or pass content to insert), append '--\\n本文由 AI 發送' signature when sign=true (default), then Ctrl-W → s → Enter to save. Returns the post-success screen.",
          inputSchema: {
            type: "object",
            properties: {
              content: { type: "string", description: "Optional: content to send (with \\n line breaks) before saving. If omitted, only signs and saves." },
              sign: { type: "boolean", default: true, description: "Append '--\\n本文由 AI 發送' signature before saving" },
              return_mode: { type: "string", enum: ["full", "summary"], default: "summary" },
            },
          },
        },
        {
          name: "stock_history",
          description: "Get daily OHLC history for any Taiwan stock. TWSE listed (上市) uses official STOCK_DAY API; TPEX listed (上櫃, 8xxx etc.) falls back to FinMind (no token needed, free tier). Returns last N trading days oldest→newest. Each row tagged with source ('twse' / 'finmind').",
          inputSchema: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Stock code, e.g. '2330' or 'tse_2330.tw' (prefix stripped automatically)" },
              days: { type: "number", minimum: 1, maximum: 240, default: 60, description: "Number of trading days back from today" },
            },
            required: ["symbol"],
          },
        },
        {
          name: "stock_indicators",
          description: "Calculate technical indicators from daily history. Supports TWSE 上市 + TPEX 上櫃 (via FinMind fallback). Indicators: ma5/10/20/60/120/240, ema12/26, kd, macd, rsi(14), boll. Returns current values + last 5-day series for each.",
          inputSchema: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Stock code" },
              indicators: {
                type: "array",
                items: { type: "string" },
                description: "List of indicators: ma5, ma10, ma20, ma60, ma120, ma240, ema12, ema26, kd, macd, rsi, boll. Default: ma5, ma20, kd, macd, rsi, boll.",
              },
              days: { type: "number", minimum: 30, maximum: 240, default: 120, description: "History range for calculation (need ≥60 for accurate MACD)" },
            },
            required: ["symbol"],
          },
        },
        {
          name: "bbs_reply_to",
          description: "Full one-shot reply: assumes you are already on the target board list. Jumps to article id, runs start_reply wizard, types content, signs and saves. Set verify=true to also navigate back and confirm the post is visible.",
          inputSchema: {
            type: "object",
            properties: {
              article_id: { type: "number", description: "Target article id (caller must already be on the board list)" },
              content: { type: "string", description: "Reply content with \\n line breaks. Signature is appended automatically when sign=true." },
              sign: { type: "boolean", default: true, description: "Append AI signature" },
              verify: { type: "boolean", default: false, description: "After save, navigate to the new post and return its full content for verification" },
            },
            required: ["article_id", "content"],
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

          case "bbs_reset_screen":
            return await this.handleResetScreen();

          case "bbs_collect_thread":
            return await this.handleCollectThread(
              typeof args?.max_related_posts === "number" ? args.max_related_posts : 5,
              this.parseThreadSearchOptions(args)
            );

          case "bbs_summarize_thread":
            return await this.handleSummarizeThread(
              typeof args?.max_related_posts === "number" ? args.max_related_posts : 8,
              typeof args?.style === "string" ? args.style : "neutral",
              this.parseThreadSearchOptions(args)
            );

          case "stock_quote":
            if (!args || !Array.isArray(args.symbols) || args.symbols.length === 0) {
              throw new Error("Missing required parameter: symbols (non-empty array)");
            }
            return await this.handleStockQuote(args.symbols as string[]);

          case "bbs_enter_board":
            if (!args || typeof args.name !== "string" || args.name.length === 0) {
              throw new Error("Missing required parameter: name");
            }
            return await this.handleEnterBoard(args.name, returnMode);

          case "bbs_jump_to_article":
            if (!args || typeof args.article_id !== "number") {
              throw new Error("Missing required parameter: article_id (number)");
            }
            return await this.handleJumpToArticle(args.article_id, returnMode);

          case "bbs_jump_and_read":
            if (!args || typeof args.article_id !== "number") {
              throw new Error("Missing required parameter: article_id (number)");
            }
            return await this.handleJumpAndRead(args.article_id, (args as any).return_mode || "full");

          case "bbs_read_thread":
            if (!args || typeof args.article_id !== "number") {
              throw new Error("Missing required parameter: article_id (number)");
            }
            return await this.handleReadThread(
              args.article_id,
              typeof args.count === "number" ? args.count : 5
            );

          case "bbs_start_reply":
            return await this.handleStartReply(returnMode);

          case "bbs_save_post":
            return await this.handleSavePost(
              typeof args?.content === "string" ? args.content : "",
              args?.sign !== false,
              returnMode
            );

          case "bbs_reply_to":
            if (!args || typeof args.article_id !== "number" || typeof args.content !== "string") {
              throw new Error("Missing required parameters: article_id (number), content (string)");
            }
            return await this.handleReplyTo(
              args.article_id,
              args.content,
              args.sign !== false,
              args.verify === true
            );

          case "stock_history":
            if (!args || typeof args.symbol !== "string") {
              throw new Error("Missing required parameter: symbol");
            }
            return await this.handleStockHistory(
              args.symbol,
              typeof args.days === "number" ? args.days : 60
            );

          case "stock_indicators":
            if (!args || typeof args.symbol !== "string") {
              throw new Error("Missing required parameter: symbol");
            }
            return await this.handleStockIndicators(
              args.symbol,
              Array.isArray(args.indicators) ? (args.indicators as string[]) : ["ma5", "ma20", "kd", "macd", "rsi", "boll"],
              typeof args.days === "number" ? args.days : 120
            );

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
    const viewportY = buffer.viewportY ?? Math.max(0, buffer.length - this.terminalRows);
    const end = viewportY + this.terminalRows;
    for (let i = viewportY; i < end; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true)); // true = remove trailing whitespace
      } else {
        lines.push("");
      }
    }

    return lines.join('\n');
  }

  private resetLocalTerminal() {
    if (this.connection.terminal) {
      this.connection.terminal.dispose();
    }

    // Keep a no-scrollback terminal so MCP sees exactly what a user sees on a standard 80x24 BBS viewport.
    this.connection.terminal = new Terminal({
      cols: this.terminalCols,
      rows: this.terminalRows,
      scrollback: 0,
      allowProposedApi: true
    });
    this.connection.lastScreenContent = "";
    this.connection.buffer = Buffer.alloc(0);
  }

  private getSpecialKeyBuffer(key: string): Buffer {
    const keyMap: { [key: string]: Buffer } = {
      up: Buffer.from([0x1b, 0x5b, 0x41]),
      down: Buffer.from([0x1b, 0x5b, 0x42]),
      right: Buffer.from([0x1b, 0x5b, 0x43]),
      left: Buffer.from([0x1b, 0x5b, 0x44]),
      pgup: Buffer.from([0x1b, 0x5b, 0x35, 0x7e]),
      pageup: Buffer.from([0x1b, 0x5b, 0x35, 0x7e]),
      pgdn: Buffer.from([0x1b, 0x5b, 0x36, 0x7e]),
      pagedown: Buffer.from([0x1b, 0x5b, 0x36, 0x7e]),
      home: Buffer.from([0x1b, 0x5b, 0x48]),
      end: Buffer.from([0x1b, 0x5b, 0x46]),
      enter: Buffer.from([0x0d]),
      esc: Buffer.from([0x1b]),
      space: Buffer.from([0x20]),
      backspace: Buffer.from([0x08]),
      delete: Buffer.from([0x7f]),
      insert: Buffer.from([0x1b, 0x5b, 0x32, 0x7e]),
    };

    const keyCode = keyMap[key.toLowerCase()];
    if (!keyCode) {
      throw new Error(`Unknown key: ${key}`);
    }

    return keyCode;
  }

  private async sendRawBuffer(buffer: Buffer, timeoutMs: number): Promise<string> {
    const ws = this.ensureActiveConnection();
    ws.send(buffer);
    await this.waitForScreenUpdate(timeoutMs);
    return this.getScreenContent();
  }

  private async sendRawText(text: string, timeoutMs: number = 1000): Promise<string> {
    return this.sendRawBuffer(encodeBig5UAO(text), timeoutMs);
  }

  private async sendRawKey(key: string, timeoutMs: number = 800): Promise<string> {
    return this.sendRawBuffer(this.getSpecialKeyBuffer(key), timeoutMs);
  }

  private normalizeThreadTitle(title: string): string {
    return title
      .replace(/^[>=>◆◇\s]+/, "")
      .replace(/^Re(?::|\^\d+:)?\s*/i, "")
      .replace(/^=>\s*/, "")
      .replace(/^\[[^\]]+\]\s*/, "")
      .trim();
  }

  private buildTextTokens(text: string): string[] {
    const asciiTokens = text
      .toLowerCase()
      .match(/[a-z0-9]{2,}/g) ?? [];
    const cjkChars = text.match(/[\u4e00-\u9fff]/g) ?? [];
    return [...asciiTokens, ...cjkChars];
  }

  private similarityScore(a: string, b: string): number {
    const aTokens = new Set(this.buildTextTokens(a));
    const bTokens = new Set(this.buildTextTokens(b));

    if (aTokens.size === 0 || bTokens.size === 0) {
      return 0;
    }

    let overlap = 0;
    for (const token of aTokens) {
      if (bTokens.has(token)) {
        overlap++;
      }
    }

    return overlap / Math.max(aTokens.size, bTokens.size);
  }

  private looksLikeSamePoint(a: string, b: string): boolean {
    if (!a || !b) {
      return false;
    }

    if (a === b || a.includes(b) || b.includes(a)) {
      return true;
    }

    return this.similarityScore(a, b) >= 0.55;
  }

  private compressBodyPreview(body: string, maxLines: number = 3): string {
    return body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, maxLines)
      .join(' ');
  }

  private sanitizeArticlePageLines(content: string): string[] {
    const lines = content.split('\n');
    const sanitized: string[] = [];
    let metadataEnded = false;

    for (const line of lines) {
      if (!metadataEnded) {
        if (line.includes("時間:")) {
          metadataEnded = true;
        }
        continue;
      }

      if (
        line.includes("文章選讀") ||
        line.includes("(g)寫得好!") ||
        line.includes("(h)求助") ||
        line.includes("(PgUp)(PgDn)") ||
        line.includes("相關主題") ||
        line.includes("搜尋標題") ||
        line.includes("※ Origin:")
      ) {
        continue;
      }

      if (/瀏覽\s+P\.\d+\(\d+%\)/.test(line)) {
        continue;
      }

      sanitized.push(line);
    }

    return sanitized;
  }

  private collectArticleSectionsFromPages(pages: string[]) {
    const firstPage = pages[0] ?? "";
    const metadata = this.parseArticleView(firstPage).metadata;
    const bodyLines: string[] = [];
    const quoteLines: string[] = [];
    const signatureLines: string[] = [];
    let inSignature = false;

    for (const page of pages) {
      for (const line of this.sanitizeArticlePageLines(page)) {
        if (line.trim() === "--") {
          inSignature = true;
          continue;
        }

        if (inSignature) {
          signatureLines.push(line);
          continue;
        }

        if (line.startsWith(">") || line.startsWith("※ 引述《")) {
          quoteLines.push(line);
          continue;
        }

        bodyLines.push(line);
      }
    }

    const body = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const preview = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 4)
      .join('\n');

    return {
      metadata,
      normalized_title: this.normalizeThreadTitle(metadata.title),
      quote_count: quoteLines.filter((line) => line.trim().length > 0).length,
      body,
      body_preview: preview,
      compact_preview: this.compressBodyPreview(body),
      signature_preview: signatureLines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 3),
    };
  }

  private async moveToThreadSeedArticle() {
    const currentPages = await this.collectCurrentArticlePages();
    const currentArticle = this.collectArticleSectionsFromPages(currentPages);
    const currentFingerprint = `${currentArticle.metadata.author}|${currentArticle.metadata.time}|${currentArticle.metadata.title}`;

    const seedScreen = await this.sendRawText("=", 1000);
    if (this.detectScreenState(seedScreen) !== "article_view") {
      return {
        navigated: false,
        currentArticle,
      };
    }

    const seedPages = await this.collectCurrentArticlePages();
    const seedArticle = this.collectArticleSectionsFromPages(seedPages);
    const seedFingerprint = `${seedArticle.metadata.author}|${seedArticle.metadata.time}|${seedArticle.metadata.title}`;

    if (seedFingerprint === currentFingerprint) {
      return {
        navigated: false,
        currentArticle: seedArticle,
      };
    }

    return {
      navigated: true,
      currentArticle: seedArticle,
    };
  }

  private async collectCurrentArticlePages(maxPages: number = 12): Promise<string[]> {
    const pages: string[] = [];
    const seenFingerprints = new Set<string>();

    for (let i = 0; i < maxPages; i++) {
      const screen = this.getScreenContent();
      const fingerprint = screen
        .replace(/瀏覽\s+P\.\d+\(\d+%\).*/g, "")
        .replace(/文章選讀.*/g, "")
        .trim();

      if (seenFingerprints.has(fingerprint)) {
        break;
      }

      seenFingerprints.add(fingerprint);
      pages.push(screen);

      if (screen.includes("文章選讀") || screen.includes("※ Origin:")) {
        break;
      }

      await this.sendRawKey("pgdn");
    }

    return pages;
  }

  private async ensureArticleViewFromCurrentState(): Promise<void> {
    const state = this.detectScreenState(this.getScreenContent());

    if (state === "article_view") {
      return;
    }

    if (state === "board_list" || state === "thread_list") {
      await this.sendRawKey("right");
      return;
    }

    throw new Error("bbs_collect_thread works from board list, thread list, or article view.");
  }

  private parseThreadSearchOptions(args: any): ThreadSearchOptions {
    const gyMin =
      typeof args?.gy_min === "number" && Number.isFinite(args.gy_min)
        ? Math.max(0, Math.floor(args.gy_min))
        : null;
    const markedMode =
      args?.marked_mode === "yes" || args?.marked_mode === "no" ? args.marked_mode : "any";

    return {
      keyword: typeof args?.keyword_search === "string" ? args.keyword_search.trim() : "",
      authorPrefix: typeof args?.author_prefix === "string" ? args.author_prefix.trim() : "",
      markedMode,
      gyMin,
    };
  }

  private shouldRunThreadSearch(options: ThreadSearchOptions): boolean {
    return Boolean(
      options.keyword ||
      options.authorPrefix ||
      options.markedMode !== "any" ||
      options.gyMin !== null
    );
  }

  private async submitPromptValue(value: string = "", delayMs: number = 800) {
    if (value) {
      await this.sendRawText(value, delayMs);
    }

    return this.sendRawKey("enter", delayMs);
  }

  private async enterThreadKeywordMode(options: ThreadSearchOptions) {
    if (!this.shouldRunThreadSearch(options)) {
      return;
    }

    const state = this.detectScreenState(this.getScreenContent());
    if (state !== "board_list") {
      throw new Error("keyword_search requires starting from a board list screen.");
    }

    const modeScreen = await this.sendRawText("~", 800);
    if (!modeScreen.includes("[串接模式]")) {
      throw new Error("Failed to enter thread keyword mode with '~'.");
    }

    if (options.keyword) {
      await this.sendRawText(options.keyword, 800);
    }

    let screen = await this.sendRawKey("enter", 1000);

    if (screen.includes("作者(第一個字打*表模糊搜尋)：")) {
      screen = await this.submitPromptValue(options.authorPrefix, 1000);
    }

    if (screen.includes("限定有m標記的文章? [y/N]：")) {
      const markedValue =
        options.markedMode === "yes" ? "y" : options.markedMode === "no" ? "n" : "";
      screen = await this.submitPromptValue(markedValue, 1000);
    }

    if (screen.includes("請輸入GY值下限[0]：")) {
      const gyValue = options.gyMin !== null ? String(options.gyMin) : "";
      screen = await this.submitPromptValue(gyValue, 1000);
    }

    if (!screen.includes("【主題串列】")) {
      throw new Error("Thread keyword mode did not reach the topic list after filters.");
    }
  }

  private isSocketUsable(): boolean {
    return this.connection.ws !== null && this.connection.ws.readyState === WebSocket.OPEN;
  }

  private ensureActiveConnection() {
    if (!this.isSocketUsable()) {
      this.cleanupConnectionState();
      throw new Error("Not connected to BBS. Use bbs_connect first.");
    }

    this.connection.connected = true;
    return this.connection.ws as WebSocket;
  }

  private cleanupConnectionState(options: { preserveTerminal?: boolean } = {}) {
    this.connection.connected = false;
    this.connection.ws = null;
    this.connection.buffer = Buffer.alloc(0);
    this.connection.lastScreenContent = "";

    if (!options.preserveTerminal && this.connection.terminal) {
      this.connection.terminal.dispose();
      this.connection.terminal = null;
    }
  }

  private detectScreenState(content: string): string {
    if (content.includes("【主功能表】")) return "main_menu";
    if (content.includes("請輸入看板名稱")) return "board_search";
    if (content.includes("看板《") && content.includes("[^P]發表")) return "board_list";
    if (content.includes("【主題串列】") && content.includes("[串接模式]關鍵字:")) return "thread_list";
    if (content.includes("編輯文章") && content.includes("Ctrl-Z")) return "editor";
    if (content.includes("文 章 發 表 綱 領")) return "posting_guide";
    if (content.includes("類別:") && content.includes("看板")) return "category_select";
    if (content.includes("標題：")) return "title_input";
    if (content.includes("選擇簽名檔")) return "signature_select";
    if (content.includes("[S]存檔")) return "save_prompt";
    if (content.includes("順利貼出佈告")) return "post_success";
    if (content.includes("請按任意鍵繼續")) return "press_any_key";
    if (content.includes("本板用途僅供")) return "board_enter";
    // Article view: has author/title/time metadata and navigation hints
    if ((content.includes("作者:") || content.includes("標題:") || content.includes("時間:")) &&
        (content.includes("瀏覽") || content.includes("文章選讀"))) return "article_view";
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

  private parseArticleView(content: string): any {
    const lines = content.split('\n');
    let metadata = { author: "", title: "", time: "", board: "" };
    let contentStart = -1;
    let hasSignature = false;
    let hasQuote = false;

    // Parse metadata (first few lines)
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];

      if (line.includes("作者:")) {
        const match = line.match(/作者:\s*(\S+).*看板:\s*(\S+)/);
        if (match) {
          metadata.author = match[1];
          metadata.board = match[2];
        }
      }
      if (line.includes("標題:")) {
        const match = line.match(/標題:\s*(.+)/);
        if (match) metadata.title = match[1].trim();
      }
      if (line.includes("時間:")) {
        const match = line.match(/時間:\s*(.+)/);
        if (match) metadata.time = match[1].trim();
        contentStart = i + 1; // Content starts after time line
        break;
      }
    }

    // Detect signature and quote
    hasSignature = content.includes("--\n") || content.includes("-- \n");
    hasQuote = content.includes("※ 引述《") || content.includes("> ");

    // Get progress indicator
    const progressMatch = content.match(/瀏覽\s+P\.(\d+)\((\d+)%\)/);
    const progress = progressMatch ? {
      page: parseInt(progressMatch[1]),
      percent: parseInt(progressMatch[2])
    } : null;

    return {
      state: "article_view",
      mode: content.includes("編輯文章") ? "editor" : "viewing",
      metadata,
      structure: {
        has_signature: hasSignature,
        has_quote: hasQuote,
        content_start_line: contentStart
      },
      progress,
      format_check: {
        metadata_complete: !!(metadata.author && metadata.title && metadata.time),
        metadata_position: contentStart > 0 ? "correct (lines 1-3)" : "missing or malformed"
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

      case "article_view":
        return this.parseArticleView(content);

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
    if (this.isSocketUsable()) {
      this.connection.connected = true;
      return {
        content: [
          {
            type: "text",
            text: "Already connected to BBS",
          } as TextContent,
        ],
      };
    }

    this.cleanupConnectionState();

    return new Promise<CallToolResult>((resolve, reject) => {
      let settled = false;

      try {
        this.connection.ws = new WebSocket("wss://term.gamer.com.tw/bbs", {
          origin: "https://term.gamer.com.tw"
        });
        this.connection.buffer = Buffer.alloc(0);

        this.connection.ws.on("open", () => {
          settled = true;
          this.connection.connected = true;

          // Initialize terminal emulator
          this.resetLocalTerminal();

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
          // Accumulate buffer to handle incomplete Big5-UAO sequences.
          this.connection.buffer = Buffer.concat([this.connection.buffer, data]);

          const { text, remaining } = decodeBig5UAO(this.connection.buffer);
          if (this.connection.terminal && text.length > 0) {
            this.connection.terminal.write(text);
          }
          this.connection.buffer = remaining;
        });

        this.connection.ws.on("error", (error) => {
          console.error("WebSocket error:", error);
          if (!settled) {
            this.cleanupConnectionState();
            reject(new Error(`WebSocket error: ${error.message || error}`));
          }
        });

        this.connection.ws.on("close", () => {
          const wasConnected = this.connection.connected;
          this.cleanupConnectionState({ preserveTerminal: true });
          if (!settled) {
            reject(new Error("WebSocket closed before connection was established"));
            return;
          }

          if (wasConnected && this.connection.terminal) {
            // Keep the last visible screen for inspection after unexpected disconnects.
            this.connection.lastScreenContent = this.getScreenContent();
          }
        });

        // Timeout after 30 seconds
        setTimeout(() => {
          if (!settled) {
            this.cleanupConnectionState();
            reject(new Error("Connection timeout after 30 seconds. WebSocket 'open' event was not fired."));
          }
        }, 30000);
      } catch (error) {
        this.cleanupConnectionState();
        reject(error);
      }
    });
  }

  private async handleSend(text: string, returnMode: string = "summary"): Promise<CallToolResult> {
    const ws = this.ensureActiveConnection();

    // Encode text as Big5-UAO and send.
    const encoded = encodeBig5UAO(text);
    ws.send(encoded);

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
    const screenContent = await this.sendRawKey(key);
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
    const ws = this.ensureActiveConnection();

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

    ws.send(keyCode);

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
    this.ensureActiveConnection();

    const screenContent = this.getScreenContent();
    const state = this.detectScreenState(screenContent);

    let response: string;

    if (returnMode === "summary") {
      response = this.getScreenSummary(screenContent);
    } else {
      // Full mode: add structured info for article view
      if (state === "article_view" || state === "editor") {
        const context = this.parseArticleView(screenContent);
        response = `=== SCREEN MODE: ${context.mode.toUpperCase()} ===\n\n`;

        if (context.metadata.author || context.metadata.title || context.metadata.time) {
          response += `=== METADATA ===\n`;
          if (context.metadata.author) response += `作者: ${context.metadata.author}\n`;
          if (context.metadata.board) response += `看板: ${context.metadata.board}\n`;
          if (context.metadata.title) response += `標題: ${context.metadata.title}\n`;
          if (context.metadata.time) response += `時間: ${context.metadata.time}\n`;
          response += `\n`;
        }

        response += `=== CONTENT ===\n${screenContent}\n\n`;
        response += `=== FORMAT CHECK ===\n`;
        response += `Metadata: ${context.format_check.metadata_complete ? '✓ Complete' : '✗ Incomplete'}\n`;
        response += `Position: ${context.format_check.metadata_position}\n`;
        response += `Signature: ${context.structure.has_signature ? '✓ Found' : '✗ Not found'}\n`;
        response += `Quote: ${context.structure.has_quote ? '✓ Found' : '✗ Not found'}\n`;
      } else {
        response = screenContent;
      }
    }

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
    this.ensureActiveConnection();

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
    if (!this.isSocketUsable()) {
      this.cleanupConnectionState();
      return {
        content: [
          {
            type: "text",
            text: "Not connected to BBS",
          } as TextContent,
        ],
      };
    }

    const ws = this.connection.ws as WebSocket;
    ws.close();
    this.cleanupConnectionState();

    return {
      content: [
        {
          type: "text",
          text: "Disconnected from BBS",
        } as TextContent,
      ],
    };
  }

  private async handleResetScreen(): Promise<CallToolResult> {
    this.ensureActiveConnection();

    this.resetLocalTerminal();
    return {
      content: [
        {
          type: "text",
          text: "Local terminal screen reset. Send one key (e.g., enter/space) to refresh from BBS.",
        } as TextContent,
      ],
    };
  }

  private async collectThreadData(maxRelatedPosts: number, threadSearch: ThreadSearchOptions) {
    this.ensureActiveConnection();
    if (this.shouldRunThreadSearch(threadSearch)) {
      await this.enterThreadKeywordMode(threadSearch);
    }
    await this.ensureArticleViewFromCurrentState();

    const collected = [];
    const seenArticles = new Set<string>();
    const boundedMaxPosts = Math.min(Math.max(Math.floor(maxRelatedPosts), 1), 20);
    let repeatedPointStreak = 0;

    const seedResult = await this.moveToThreadSeedArticle();
    const seedArticle = seedResult.currentArticle;
    const seedFingerprint = `${seedArticle.metadata.author}|${seedArticle.metadata.time}|${seedArticle.metadata.title}`;
    seenArticles.add(seedFingerprint);
    collected.push({
      index: 1,
      role: "seed",
      title: seedArticle.metadata.title,
      normalized_title: seedArticle.normalized_title,
      author: seedArticle.metadata.author,
      time: seedArticle.metadata.time,
      board: seedArticle.metadata.board,
      quote_count: seedArticle.quote_count,
      body_preview: seedArticle.body_preview,
      compact_preview: seedArticle.compact_preview,
      body_length: seedArticle.body.length,
      signature_preview: seedArticle.signature_preview,
    });

    for (let i = 1; i < boundedMaxPosts; i++) {
      const nextScreen = await this.sendRawText("+", 1000);
      if (this.detectScreenState(nextScreen) !== "article_view") {
        break;
      }

      const pages = await this.collectCurrentArticlePages();
      const article = this.collectArticleSectionsFromPages(pages);
      const fingerprint = `${article.metadata.author}|${article.metadata.time}|${article.metadata.title}`;

      if (seenArticles.has(fingerprint)) {
        break;
      }

      const compactPreview = article.compact_preview;
      const duplicateOf: any = collected.find((post: any) =>
        this.looksLikeSamePoint(post.compact_preview, compactPreview)
      );

      seenArticles.add(fingerprint);
      collected.push({
        index: i + 1,
        role: "related",
        title: article.metadata.title,
        normalized_title: article.normalized_title,
        author: article.metadata.author,
        time: article.metadata.time,
        board: article.metadata.board,
        quote_count: article.quote_count,
        body_preview: article.body_preview,
        compact_preview: compactPreview,
        body_length: article.body.length,
        signature_preview: article.signature_preview,
        duplicate_of: duplicateOf ? duplicateOf.index : null,
      });

      if (duplicateOf) {
        repeatedPointStreak += 1;
      } else {
        repeatedPointStreak = 0;
      }

      if (repeatedPointStreak >= 3) {
        break;
      }
    }

    const seed = collected[0] ?? null;
    const normalizedTitle = seed ? seed.normalized_title : "";
    const representativePosts = collected.filter((post: any) => !post.duplicate_of);

    return {
      state: "thread_collected",
      navigation_mode: "related_topics",
      seed_title: seed?.title ?? "",
      normalized_title: normalizedTitle,
      posts_collected: collected.length,
      representative_posts: representativePosts.length,
      notes: [
        "Collected from current article or board cursor",
        this.shouldRunThreadSearch(threadSearch)
          ? "Thread search can start from keyword, author/ID prefix, m-mark filter, or GY lower bound"
          : "Started from the current board cursor or article view",
        "Moved to thread seed with '=' when possible",
        "Followed BBS related-topic navigation with '+'",
        "Body preview excludes quote lines and signature lines when possible",
        "Stops early when consecutive related posts mostly repeat existing points",
      ],
      posts: collected,
    };
  }

  private buildDiscussionPoints(posts: any[]) {
    const representatives = posts.filter((post) => !post.duplicate_of && post.compact_preview);
    const points = representatives.map((post) => {
      const supportCount = posts.filter(
        (candidate) => candidate.index === post.index || candidate.duplicate_of === post.index
      ).length;

      return {
        index: post.index,
        support_count: supportCount,
        representative_preview: post.compact_preview,
        author: post.author,
      };
    });

    points.sort((a, b) => b.support_count - a.support_count || a.index - b.index);
    return points.slice(0, 4);
  }

  private composeNeutralSummary(threadData: any, discussionPoints: any[]) {
    const topic = threadData.normalized_title || threadData.seed_title;
    const intro =
      `這串主要是在討論 ${topic}。` +
      (threadData.posts_collected > 1
        ? `我先整理了目前比較集中的意見。`
        : `目前可讀到的回應不多，先整理可見重點。`);

    const pointLines = discussionPoints.map((point, idx) =>
      `${idx + 1}. ${point.representative_preview}`
    );

    const closing =
      discussionPoints.length > 1
        ? "整體看下來，這串有幾個重複出現的觀點，但也混有不少短接話或補一句的回文。"
        : "整體看下來，這串目前比較像單一方向的補充，尚未出現太明顯的分歧。";

    return [intro, "", "目前較常出現的意見包括：", ...pointLines, "", closing].join("\n");
  }

  private composeBbsPostSummary(threadData: any, discussionPoints: any[]) {
    const topic = threadData.normalized_title || threadData.seed_title;
    const lines = [
      `幫忙整理一下這串 ${topic} 的重點：`,
      "",
      `目前看下來，這串比較集中的意見有幾個。`,
      ...discussionPoints.map((point, idx) => `${idx + 1}. ${point.representative_preview}`),
      "",
      threadData.posts_collected > discussionPoints.length + 1
        ? "其餘回文有不少是在接前一句，或是重複補同一個方向。"
        : "目前回文方向還算集中，沒有明顯分成很多支線。"
    ];

    return lines.join("\n");
  }

  private async handleCollectThread(
    maxRelatedPosts: number = 5,
    threadSearch: ThreadSearchOptions
  ): Promise<CallToolResult> {
    const threadData = await this.collectThreadData(maxRelatedPosts, threadSearch);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(threadData, null, 2),
        } as TextContent,
      ],
    };
  }

  private async handleSummarizeThread(
    maxRelatedPosts: number = 8,
    style: string = "neutral",
    threadSearch: ThreadSearchOptions
  ): Promise<CallToolResult> {
    const threadData = await this.collectThreadData(maxRelatedPosts, threadSearch);
    const discussionPoints = this.buildDiscussionPoints(threadData.posts);
    const summaryDraft = style === "bbs_post"
      ? this.composeBbsPostSummary(threadData, discussionPoints)
      : this.composeNeutralSummary(threadData, discussionPoints);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              state: "thread_summarized",
              style,
              topic: threadData.normalized_title || threadData.seed_title,
              posts_collected: threadData.posts_collected,
              representative_posts: threadData.representative_posts,
              discussion_points: discussionPoints,
              summary_draft: summaryDraft,
              note: "Draft only. Review before posting back to BBS.",
            },
            null,
            2
          ),
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

    const ws = this.ensureActiveConnection();

    const steps: string[] = [];

    // Wait for welcome screen (use fixed delays for reliability)
    await new Promise(resolve => setTimeout(resolve, 3500)); // Need at least 3s
    steps.push("Waited for welcome screen");

    // Send username
    const encodedUsername = encodeBig5UAO(username + "\r");
    ws.send(encodedUsername);
    await new Promise(resolve => setTimeout(resolve, 2000));
    steps.push("Sent username");

    // Send password (wait longer for BBS to be ready)
    const encodedPassword = encodeBig5UAO(password + "\r");
    ws.send(encodedPassword);
    await new Promise(resolve => setTimeout(resolve, 2000));
    steps.push("Sent password");

    // Handle duplicate login prompt (press Enter to confirm)
    ws.send(Buffer.from([0x0d])); // Enter
    await new Promise(resolve => setTimeout(resolve, 1000));
    steps.push("Handled duplicate login prompt");

    // Skip post-login pages (系統公告、十大熱門、過路勇者足跡、etc.)
    for (let i = 0; i < 5; i++) {
      ws.send(Buffer.from([0x20])); // Space
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

  private normalizeStockSymbol(raw: string): string[] {
    const s = raw.trim().toLowerCase();
    const original = raw.trim();
    // Market index aliases
    const indexMap: Record<string, string> = {
      "taiex": "tse_t00.tw",
      "t00": "tse_t00.tw",
      "加權": "tse_t00.tw",
      "加權指數": "tse_t00.tw",
      "大盤": "tse_t00.tw",
      "tpex": "otc_o00.tw",
      "o00": "otc_o00.tw",
      "櫃買": "otc_o00.tw",
      "櫃買指數": "otc_o00.tw",
    };
    if (indexMap[s]) return [indexMap[s]];
    if (indexMap[original]) return [indexMap[original]];
    if (/^(tse|otc)_[\w\d]+\.tw$/.test(s)) return [s];
    if (/^\d{3,6}$/.test(s)) return [`tse_${s}.tw`, `otc_${s}.tw`];
    return [s];
  }

  private parseFiveTier(raw: string): number[] {
    if (!raw || raw === "-") return [];
    return raw
      .split("_")
      .filter(x => x.length > 0)
      .map(x => parseFloat(x))
      .filter(x => !isNaN(x) && x > 0);
  }

  private async handleStockQuote(symbols: string[]): Promise<CallToolResult> {
    const candidates = symbols.flatMap(s => this.normalizeStockSymbol(s));
    if (candidates.length === 0) {
      throw new Error("No valid stock symbols provided");
    }

    const exCh = candidates.join("|");
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;

    let data: any;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "application/json, text/plain, */*",
          "Referer": "https://mis.twse.com.tw/stock/fibest.jsp",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      data = await res.json();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`TWSE mis API fetch failed: ${msg}`);
    }

    if (data.rtcode !== "0000") {
      throw new Error(`TWSE mis API error rtcode=${data.rtcode}: ${data.rtmessage}`);
    }

    const msgArray = Array.isArray(data.msgArray) ? data.msgArray : [];
    if (msgArray.length === 0) {
      throw new Error(`No data returned for symbols: ${symbols.join(", ")}`);
    }

    const quotes = msgArray.map((item: any) => {
      const z = item.z && item.z !== "-" ? parseFloat(item.z) : null;
      const y = item.y && item.y !== "-" ? parseFloat(item.y) : null;
      const o = item.o && item.o !== "-" ? parseFloat(item.o) : null;
      const h = item.h && item.h !== "-" ? parseFloat(item.h) : null;
      const l = item.l && item.l !== "-" ? parseFloat(item.l) : null;
      const v = item.v && item.v !== "-" ? parseInt(item.v, 10) : null;
      const tv = item.tv && item.tv !== "-" ? parseInt(item.tv, 10) : null;
      const bids = this.parseFiveTier(item.b || "");
      const asks = this.parseFiveTier(item.a || "");
      const midPrice = bids.length > 0 && asks.length > 0
        ? (bids[0] + asks[0]) / 2
        : null;
      const lastPrice = z ?? midPrice ?? h ?? o ?? null;
      const change = lastPrice !== null && y !== null ? lastPrice - y : null;
      const changePct = change !== null && y !== null && y !== 0 ? (change / y) * 100 : null;

      return {
        code: item.ch || "",
        name: item.n || "",
        exchange: item.ex || "",
        date: item.d || "",
        timestamp: item["%"] || item.t || "",
        last: lastPrice,
        last_source: z !== null ? "trade" : midPrice !== null ? "mid" : "estimate",
        prior_close: y,
        open: o,
        high: h,
        low: l,
        limit_up: item.u && item.u !== "-" ? parseFloat(item.u) : null,
        limit_down: item.w && item.w !== "-" ? parseFloat(item.w) : null,
        cumulative_volume: v,
        tick_volume: tv,
        change,
        change_pct: changePct,
        bid_top5: bids,
        ask_top5: asks,
      };
    });

    const lines: string[] = [`查詢時間: ${new Date().toISOString()}`, ""];
    for (const q of quotes) {
      lines.push(`【${q.code}】${q.name} (${q.exchange.toUpperCase()})`);
      const arrow = q.change === null ? "" : q.change > 0 ? "↑" : q.change < 0 ? "↓" : "─";
      const changeStr = q.change !== null && q.change_pct !== null
        ? `${arrow} ${q.change.toFixed(2)} (${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%)`
        : "—";
      const lastStr = q.last !== null ? `${q.last.toFixed(2)}` : "—";
      const lastTag = q.last_source === "trade" ? "" : q.last_source === "mid" ? " (中價)" : " (估)";
      lines.push(`  最新: ${lastStr}${lastTag}  ${changeStr}`);
      lines.push(`  開: ${q.open ?? "—"}  高: ${q.high ?? "—"}  低: ${q.low ?? "—"}  昨收: ${q.prior_close ?? "—"}`);
      if (q.cumulative_volume !== null) lines.push(`  累計量: ${q.cumulative_volume.toLocaleString()} 張`);
      if (q.bid_top5.length > 0 || q.ask_top5.length > 0) {
        lines.push(`  五檔買: ${q.bid_top5.join(" / ") || "—"}`);
        lines.push(`  五檔賣: ${q.ask_top5.join(" / ") || "—"}`);
      }
      lines.push(`  時間: ${q.date} ${q.timestamp}`);
      lines.push("");
    }
    lines.push("--- JSON ---");
    lines.push(JSON.stringify(quotes, null, 2));

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        } as TextContent,
      ],
    };
  }

  // ===== Low-level building blocks for composite tools =====

  private async _rawText(text: string, waitMs: number = 800): Promise<void> {
    const ws = this.ensureActiveConnection();
    ws.send(encodeBig5UAO(text));
    await this.waitForScreenUpdate(waitMs);
  }

  private async _rawKey(key: string, waitMs: number = 800): Promise<void> {
    await this.sendRawKey(key, waitMs);
  }

  private async _rawCtrl(letter: string, waitMs: number = 800): Promise<void> {
    const ws = this.ensureActiveConnection();
    const upperLetter = letter.toUpperCase();
    const charCode = upperLetter.charCodeAt(0);
    if (charCode < 65 || charCode > 90) {
      throw new Error(`Invalid letter for Ctrl combination: ${letter}`);
    }
    const ctrlCode = charCode - 64;
    ws.send(Buffer.from([ctrlCode]));
    await this.waitForScreenUpdate(waitMs);
  }

  private formatScreen(returnMode: string): string {
    const content = this.getScreenContent();
    return returnMode === "summary" ? this.getScreenSummary(content) : content;
  }

  // ===== A 級：composite shortcuts =====

  private async handleEnterBoard(name: string, returnMode: string): Promise<CallToolResult> {
    await this._rawText("s", 600);
    await this._rawText(name, 600);
    await this._rawKey("enter", 1200);

    // Some boards show a welcome page that needs Space to pass
    const screen1 = this.getScreenContent();
    if (/請按任意鍵繼續/.test(screen1)) {
      await this._rawKey("space", 800);
    }

    return {
      content: [
        {
          type: "text",
          text: `Entered board: ${name}\n\n${returnMode === "summary" ? "Summary" : "Screen"}:\n${this.formatScreen(returnMode)}`,
        } as TextContent,
      ],
    };
  }

  private async handleJumpToArticle(articleId: number, returnMode: string): Promise<CallToolResult> {
    await this._rawText(String(articleId), 500);
    await this._rawKey("enter", 800);

    return {
      content: [
        {
          type: "text",
          text: `Jumped to article #${articleId}\n\n${returnMode === "summary" ? "Summary" : "Screen"}:\n${this.formatScreen(returnMode)}`,
        } as TextContent,
      ],
    };
  }

  private async handleJumpAndRead(articleId: number, returnMode: string): Promise<CallToolResult> {
    await this._rawText(String(articleId), 500);
    await this._rawKey("enter", 800);
    await this._rawKey("right", 1200);

    return {
      content: [
        {
          type: "text",
          text: `Article #${articleId}:\n\n${this.formatScreen(returnMode)}`,
        } as TextContent,
      ],
    };
  }

  private async handleReadThread(articleId: number, count: number): Promise<CallToolResult> {
    await this._rawText(String(articleId), 500);
    await this._rawKey("enter", 800);
    await this._rawKey("right", 1200);

    const posts: string[] = [];
    posts.push(`--- Post 1 ---\n${this.getScreenContent()}`);

    for (let i = 1; i < count; i++) {
      await this._rawText("]", 1200);
      const screen = this.getScreenContent();
      // If pressing ] returns to board list (no more in thread), stop
      if (/\[←\]離開 \[→\]閱讀/.test(screen) && !/作者:/.test(screen)) {
        posts.push(`--- Post ${i + 1}: thread ended (back to board list) ---`);
        break;
      }
      posts.push(`--- Post ${i + 1} ---\n${screen}`);
    }

    return {
      content: [
        {
          type: "text",
          text: `Thread starting at #${articleId} (${posts.length} post(s)):\n\n${posts.join("\n\n")}`,
        } as TextContent,
      ],
    };
  }

  private async handleStartReply(returnMode: string): Promise<CallToolResult> {
    // y from article view OR board list (cursor on target)
    await this._rawText("y", 600);
    // F = reply to board
    await this._rawText("F", 600);
    await this._rawKey("enter", 800);
    // Skip category selector
    await this._rawKey("enter", 800);
    // Accept default Re: title
    await this._rawKey("enter", 800);
    // Quote original
    await this._rawText("Y", 600);
    await this._rawKey("enter", 800);
    // No predefined sig (we add it manually)
    await this._rawText("0", 600);
    await this._rawKey("enter", 1200);
    // Jump to end of file in editor
    await this._rawCtrl("t", 600);

    const screen = this.getScreenContent();
    const inEditor = /編輯文章/.test(screen);

    return {
      content: [
        {
          type: "text",
          text: `Reply wizard finished. In editor: ${inEditor}\n\n${returnMode === "summary" ? "Summary" : "Screen"}:\n${this.formatScreen(returnMode)}`,
        } as TextContent,
      ],
    };
  }

  private async handleSavePost(content: string, sign: boolean, returnMode: string): Promise<CallToolResult> {
    // Build full payload
    let payload = content || "";
    if (sign) {
      if (payload.length > 0 && !payload.endsWith("\n")) payload += "\n";
      payload += "--\n本文由 AI 發送";
    }

    if (payload.length > 0) {
      await this._rawText(payload, 1500);
    }

    // Save: Ctrl-W → s → Enter
    await this._rawCtrl("w", 800);
    await this._rawText("s", 500);
    await this._rawKey("enter", 1800);

    const screen = this.getScreenContent();
    const success = /順利貼出佈告/.test(screen);

    return {
      content: [
        {
          type: "text",
          text: `Save attempted. Success: ${success}\n\n${returnMode === "summary" ? "Summary" : "Screen"}:\n${this.formatScreen(returnMode)}`,
        } as TextContent,
      ],
    };
  }

  // ===== B 級：full one-shot reply =====

  private async handleReplyTo(articleId: number, content: string, sign: boolean, verify: boolean): Promise<CallToolResult> {
    // Step 1: jump to article in board list
    await this._rawText(String(articleId), 500);
    await this._rawKey("enter", 800);

    // Step 2: start reply wizard from board list
    await this._rawText("y", 600);
    await this._rawText("F", 600);
    await this._rawKey("enter", 800);
    await this._rawKey("enter", 800);   // category skip
    await this._rawKey("enter", 800);   // title accept
    await this._rawText("Y", 600);
    await this._rawKey("enter", 800);   // quote confirm
    await this._rawText("0", 600);
    await this._rawKey("enter", 1200);  // enter editor
    await this._rawCtrl("t", 600);      // jump to end

    // Step 3: write content + signature
    let payload = content;
    if (sign) {
      if (payload.length > 0 && !payload.endsWith("\n")) payload += "\n";
      payload += "--\n本文由 AI 發送";
    }
    if (payload.length > 0) {
      await this._rawText(payload, 1500);
    }

    // Step 4: save
    await this._rawCtrl("w", 800);
    await this._rawText("s", 500);
    await this._rawKey("enter", 1800);

    const screenAfterSave = this.getScreenContent();
    const success = /順利貼出佈告/.test(screenAfterSave);

    let verifyBlock = "";
    if (success && verify) {
      // Press Space to return to board list
      await this._rawKey("space", 1000);
      // The newly posted reply is now somewhere on the board.
      // We don't know the new article id without parsing; return current screen as evidence.
      const boardScreen = this.getScreenContent();
      verifyBlock = `\n\n--- Verify (board list after post) ---\n${boardScreen}`;
    }

    return {
      content: [
        {
          type: "text",
          text: `bbs_reply_to(${articleId}) → success: ${success}\n\nPost-save screen:\n${screenAfterSave}${verifyBlock}`,
        } as TextContent,
      ],
    };
  }

  // ===== Stock history (TWSE STOCK_DAY) =====

  private parseTwseRow(row: string[]): { date: string; open: number; high: number; low: number; close: number; volume: number } | null {
    if (!Array.isArray(row) || row.length < 7) return null;
    const dateRoc = row[0];
    const m = dateRoc.match(/^(\d+)\/(\d+)\/(\d+)$/);
    if (!m) return null;
    const year = parseInt(m[1], 10) + 1911;
    const date = `${year}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const num = (s: string): number => {
      if (typeof s !== "string" || s === "--") return NaN;
      return parseFloat(s.replace(/,/g, ""));
    };
    const volume = parseInt((row[1] || "0").replace(/,/g, ""), 10);
    const open = num(row[3]);
    const high = num(row[4]);
    const low = num(row[5]);
    const close = num(row[6]);
    if ([open, high, low, close].some(x => !isFinite(x))) return null;
    return { date, open, high, low, close, volume };
  }

  private async fetchTwseMonth(stockNo: string, yyyymm: string): Promise<any[][]> {
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${yyyymm}01&stockNo=${encodeURIComponent(stockNo)}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "application/json, text/plain, */*",
        },
      });
      if (!res.ok) return [];
      const data: any = await res.json();
      if (data.stat !== "OK" || !Array.isArray(data.data)) return [];
      return data.data;
    } catch {
      return [];
    }
  }

  private async _fetchStockHistory(symbol: string, days: number): Promise<{ date: string; open: number; high: number; low: number; close: number; volume: number; source?: string }[]> {
    const stockNo = symbol.replace(/^(tse|otc)_/i, "").replace(/\.tw$/i, "");
    if (!/^\d+$/.test(stockNo)) {
      throw new Error(`Invalid symbol: ${symbol} (expected digits like '2330')`);
    }

    // Try TWSE first (TSE listed stocks)
    const twseResult = await this._fetchTwseStockHistory(stockNo, days);
    if (twseResult.length > 0) {
      return twseResult.map(r => ({ ...r, source: "twse" }));
    }

    // Fallback to FinMind for OTC / TPEX stocks
    const finMindResult = await this._fetchFinMindHistory(stockNo, days);
    if (finMindResult.length > 0) {
      return finMindResult.map(r => ({ ...r, source: "finmind" }));
    }

    throw new Error(`No history data for ${stockNo}. Not found on TWSE STOCK_DAY or FinMind. Check stock code or try again later.`);
  }

  private async _fetchTwseStockHistory(stockNo: string, days: number): Promise<{ date: string; open: number; high: number; low: number; close: number; volume: number }[]> {
    const today = new Date();
    const monthsToFetch = Math.max(2, Math.ceil(days / 18) + 1);
    const months: string[] = [];
    for (let i = 0; i < monthsToFetch; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const y = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      months.push(`${y}${mm}`);
    }

    const monthResults = await Promise.all(months.map(yyyymm => this.fetchTwseMonth(stockNo, yyyymm)));
    const allRows = monthResults.flat();

    if (allRows.length === 0) return [];

    const map = new Map<string, any>();
    for (const row of allRows) {
      const parsed = this.parseTwseRow(row);
      if (parsed) map.set(parsed.date, parsed);
    }

    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-days);
  }

  private async _fetchFinMindHistory(stockNo: string, days: number): Promise<{ date: string; open: number; high: number; low: number; close: number; volume: number }[]> {
    const today = new Date();
    const start = new Date();
    // Pad for weekends/holidays: assume ~70% trading day ratio
    start.setDate(today.getDate() - Math.ceil(days / 0.7) - 7);

    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const params = new URLSearchParams({
      dataset: "TaiwanStockPrice",
      data_id: stockNo,
      start_date: fmt(start),
      end_date: fmt(today),
    });
    const token = (process.env.FINMIND_TOKEN || "").trim();
    if (token) params.append("token", token);
    const url = `https://api.finmindtrade.com/api/v4/data?${params.toString()}`;

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "application/json",
        },
      });
      if (!res.ok) return [];
      const data: any = await res.json();
      if (data.status !== 200 || !Array.isArray(data.data)) return [];

      return data.data
        .map((row: any) => ({
          date: row.date,
          open: typeof row.open === "number" ? row.open : parseFloat(row.open),
          high: typeof row.max === "number" ? row.max : parseFloat(row.max),
          low: typeof row.min === "number" ? row.min : parseFloat(row.min),
          close: typeof row.close === "number" ? row.close : parseFloat(row.close),
          volume: typeof row.Trading_Volume === "number" ? row.Trading_Volume : parseInt(row.Trading_Volume || "0", 10),
        }))
        .filter((r: any) => isFinite(r.open) && isFinite(r.close) && r.close > 0)
        .sort((a: any, b: any) => a.date.localeCompare(b.date))
        .slice(-days);
    } catch {
      return [];
    }
  }

  private async handleStockHistory(symbol: string, days: number): Promise<CallToolResult> {
    const result = await this._fetchStockHistory(symbol, days);
    const stockNo = symbol.replace(/^(tse|otc)_/i, "").replace(/\.tw$/i, "");

    const lines = [
      `Stock: ${stockNo} (TWSE)`,
      `Range: ${result[0]?.date} ~ ${result[result.length - 1]?.date}`,
      `Records: ${result.length}`,
      "",
      "Last 10 days:",
      ...result.slice(-10).map(r => `  ${r.date}  O:${r.open}  H:${r.high}  L:${r.low}  C:${r.close}  V:${r.volume.toLocaleString()}`),
      "",
      "--- JSON ---",
      JSON.stringify(result),
    ];

    return { content: [{ type: "text", text: lines.join("\n") } as TextContent] };
  }

  // ===== Technical indicators =====

  private calcMA(values: number[], n: number): (number | null)[] {
    const out: (number | null)[] = [];
    for (let i = 0; i < values.length; i++) {
      if (i < n - 1) { out.push(null); continue; }
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += values[j];
      out.push(sum / n);
    }
    return out;
  }

  private calcEMA(values: number[], n: number): (number | null)[] {
    const k = 2 / (n + 1);
    const out: (number | null)[] = [];
    let ema: number | null = null;
    for (let i = 0; i < values.length; i++) {
      if (i < n - 1) { out.push(null); continue; }
      if (ema === null) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += values[j];
        ema = sum / n;
      } else {
        ema = values[i] * k + ema * (1 - k);
      }
      out.push(ema);
    }
    return out;
  }

  private calcKD(highs: number[], lows: number[], closes: number[], period = 9): { k: (number | null)[]; d: (number | null)[] } {
    const ks: (number | null)[] = [];
    const ds: (number | null)[] = [];
    let prevK = 50, prevD = 50;
    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) { ks.push(null); ds.push(null); continue; }
      let hMax = -Infinity, lMin = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (highs[j] > hMax) hMax = highs[j];
        if (lows[j] < lMin) lMin = lows[j];
      }
      const rsv = hMax === lMin ? 50 : ((closes[i] - lMin) / (hMax - lMin)) * 100;
      const k = (2 / 3) * prevK + (1 / 3) * rsv;
      const d = (2 / 3) * prevD + (1 / 3) * k;
      ks.push(k); ds.push(d);
      prevK = k; prevD = d;
    }
    return { k: ks, d: ds };
  }

  private calcMACD(closes: number[]): { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] } {
    const ema12 = this.calcEMA(closes, 12);
    const ema26 = this.calcEMA(closes, 26);
    const macd = ema12.map((v, i) => (v !== null && ema26[i] !== null) ? (v as number) - (ema26[i] as number) : null);
    const macdNonNull: number[] = [];
    const idxMap: number[] = [];
    for (let i = 0; i < macd.length; i++) {
      if (macd[i] !== null) { macdNonNull.push(macd[i] as number); idxMap.push(i); }
    }
    const sig9 = this.calcEMA(macdNonNull, 9);
    const signal: (number | null)[] = closes.map(() => null);
    for (let j = 0; j < sig9.length; j++) {
      if (sig9[j] !== null) signal[idxMap[j]] = sig9[j];
    }
    const hist = macd.map((v, i) => (v !== null && signal[i] !== null) ? (v as number) - (signal[i] as number) : null);
    return { macd, signal, hist };
  }

  private calcRSI(closes: number[], period = 14): (number | null)[] {
    const out: (number | null)[] = [];
    if (closes.length < period + 1) return closes.map(() => null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) avgGain += diff; else avgLoss -= diff;
    }
    avgGain /= period; avgLoss /= period;
    for (let i = 0; i < period; i++) out.push(null);
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
    }
    return out;
  }

  private calcBoll(closes: number[], n = 20, mult = 2): { mid: (number | null)[]; up: (number | null)[]; lo: (number | null)[] } {
    const mid = this.calcMA(closes, n);
    const up: (number | null)[] = [];
    const lo: (number | null)[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (mid[i] === null) { up.push(null); lo.push(null); continue; }
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += (closes[j] - (mid[i] as number)) ** 2;
      const std = Math.sqrt(sum / n);
      up.push((mid[i] as number) + mult * std);
      lo.push((mid[i] as number) - mult * std);
    }
    return { mid, up, lo };
  }

  private fmtNum(v: number | null, digits = 2): string {
    return v === null || !isFinite(v) ? "—" : v.toFixed(digits);
  }

  private last(arr: (number | null)[]): number | null {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== null && isFinite(arr[i] as number)) return arr[i];
    }
    return null;
  }

  private lastN(arr: (number | null)[], n: number): (number | null)[] {
    return arr.slice(-n);
  }

  private async handleStockIndicators(symbol: string, indicators: string[], days: number): Promise<CallToolResult> {
    const history = await this._fetchStockHistory(symbol, days);
    if (history.length < 30) {
      throw new Error(`History too short (${history.length} days). Increase 'days' parameter to ≥60.`);
    }
    const closes = history.map(r => r.close);
    const highs = history.map(r => r.high);
    const lows = history.map(r => r.low);
    const dates = history.map(r => r.date);

    const requested = indicators.map(s => s.toLowerCase());
    const result: any = {
      symbol: symbol.replace(/^(tse|otc)_/i, "").replace(/\.tw$/i, ""),
      latest_date: dates[dates.length - 1],
      latest_close: closes[closes.length - 1],
      records_used: history.length,
      indicators: {},
    };

    const maPeriods = [
      { key: "ma5", n: 5 },
      { key: "ma10", n: 10 },
      { key: "ma20", n: 20 },
      { key: "ma60", n: 60 },
      { key: "ma120", n: 120 },
      { key: "ma240", n: 240 },
    ];
    for (const { key, n } of maPeriods) {
      if (requested.includes(key)) {
        const series = this.calcMA(closes, n);
        result.indicators[key] = { current: this.last(series), recent_5: this.lastN(series, 5) };
      }
    }

    if (requested.includes("ema12")) {
      const s = this.calcEMA(closes, 12);
      result.indicators.ema12 = { current: this.last(s), recent_5: this.lastN(s, 5) };
    }
    if (requested.includes("ema26")) {
      const s = this.calcEMA(closes, 26);
      result.indicators.ema26 = { current: this.last(s), recent_5: this.lastN(s, 5) };
    }
    if (requested.includes("kd")) {
      const { k, d } = this.calcKD(highs, lows, closes, 9);
      result.indicators.kd = {
        current_k: this.last(k),
        current_d: this.last(d),
        recent_5_k: this.lastN(k, 5),
        recent_5_d: this.lastN(d, 5),
      };
    }
    if (requested.includes("macd")) {
      const { macd, signal, hist } = this.calcMACD(closes);
      result.indicators.macd = {
        current_macd: this.last(macd),
        current_signal: this.last(signal),
        current_hist: this.last(hist),
        recent_5_hist: this.lastN(hist, 5),
      };
    }
    if (requested.includes("rsi")) {
      const s = this.calcRSI(closes, 14);
      result.indicators.rsi = { current: this.last(s), recent_5: this.lastN(s, 5) };
    }
    if (requested.includes("boll")) {
      const { mid, up, lo } = this.calcBoll(closes, 20, 2);
      result.indicators.boll = {
        mid: this.last(mid),
        upper: this.last(up),
        lower: this.last(lo),
      };
    }

    // Human-readable summary
    const lines: string[] = [
      `Stock: ${result.symbol}  最近收盤: ${result.latest_close}  (${result.latest_date})`,
      `Records: ${result.records_used} 天`,
      "",
    ];
    for (const [name, val] of Object.entries(result.indicators)) {
      const v: any = val;
      if (name === "kd") {
        lines.push(`KD: K=${this.fmtNum(v.current_k, 1)}  D=${this.fmtNum(v.current_d, 1)}`);
      } else if (name === "macd") {
        lines.push(`MACD: ${this.fmtNum(v.current_macd, 3)}  Signal: ${this.fmtNum(v.current_signal, 3)}  Hist: ${this.fmtNum(v.current_hist, 3)}`);
      } else if (name === "boll") {
        lines.push(`Bollinger: 上 ${this.fmtNum(v.upper)} / 中 ${this.fmtNum(v.mid)} / 下 ${this.fmtNum(v.lower)}`);
      } else {
        lines.push(`${name.toUpperCase()}: ${this.fmtNum(v.current)}`);
      }
    }
    lines.push("", "--- JSON ---", JSON.stringify(result));

    return { content: [{ type: "text", text: lines.join("\n") } as TextContent] };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Bahamut BBS MCP Server running on stdio");
  }
}

const server = new BahaBBSServer();
server.run().catch(console.error);
