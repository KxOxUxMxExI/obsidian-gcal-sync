var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GcalSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  googleClientId: "",
  googleClientSecret: "",
  googleAccessToken: "",
  googleRefreshToken: "",
  enabledForDailyNotes: true,
  autoRefresh: true,
  refreshInterval: 60,
  calendarIds: ["primary"]
  // デフォルトはメインカレンダー
};
var GcalSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.authCallbackUrl = "";
    this.refreshIntervalId = null;
    this.currentFile = null;
    this.calendarColors = /* @__PURE__ */ new Map();
  }
  // カレンダーIDと色のマップ
  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "insert-today-events",
      name: "\u4ECA\u65E5\u306E\u4E88\u5B9A\u3092\u633F\u5165",
      callback: () => {
        this.insertTodayEvents();
      }
    });
    this.addCommand({
      id: "authenticate-google",
      name: "Google\u30A2\u30AB\u30A6\u30F3\u30C8\u3067\u8A8D\u8A3C",
      callback: () => {
        this.authenticate();
      }
    });
    this.addSettingTab(new GcalSyncSettingTab(this.app, this));
    if (this.settings.enabledForDailyNotes) {
      this.registerEvent(
        this.app.workspace.on("file-open", (file) => {
          if (file && this.isDailyNote(file)) {
            this.currentFile = file;
            this.insertTodayEvents();
            if (this.settings.autoRefresh) {
              this.startAutoRefresh();
            }
          } else {
            this.stopAutoRefresh();
            this.currentFile = null;
          }
        })
      );
    }
  }
  onunload() {
    this.stopAutoRefresh();
  }
  // 自動リフレッシュを開始
  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshIntervalId = window.setInterval(() => {
      if (this.currentFile && this.isDailyNote(this.currentFile)) {
        this.insertTodayEvents();
      }
    }, this.settings.refreshInterval * 1e3);
  }
  // 自動リフレッシュを停止
  stopAutoRefresh() {
    if (this.refreshIntervalId !== null) {
      window.clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  // デイリーノートかどうかを判定
  isDailyNote(file) {
    const dailyNotePattern = /デイリーノート|daily|journal|\d{4}-\d{2}-\d{2}/i;
    return dailyNotePattern.test(file.path);
  }
  // 今日の予定を挿入
  async insertTodayEvents() {
    console.log("=== insertTodayEvents \u958B\u59CB ===");
    if (!this.settings.googleAccessToken) {
      console.log("\u30A8\u30E9\u30FC: Google\u8A8D\u8A3C\u304C\u5FC5\u8981\u3067\u3059");
      new import_obsidian.Notice("\u5148\u306BGoogle\u30A2\u30AB\u30A6\u30F3\u30C8\u3067\u8A8D\u8A3C\u3057\u3066\u304F\u3060\u3055\u3044");
      return;
    }
    try {
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile) {
        console.log("\u30A8\u30E9\u30FC: \u30A2\u30AF\u30C6\u30A3\u30D6\u30D5\u30A1\u30A4\u30EB\u304C\u3042\u308A\u307E\u305B\u3093");
        return;
      }
      console.log("\u30A2\u30AF\u30C6\u30A3\u30D6\u30D5\u30A1\u30A4\u30EB:", activeFile.path);
      const targetDate = this.getDateFromFileName(activeFile.basename);
      console.log("\u30D5\u30A1\u30A4\u30EB\u540D\u304B\u3089\u53D6\u5F97\u3057\u305F\u65E5\u4ED8:", targetDate);
      if (!targetDate) {
        console.log("\u30A8\u30E9\u30FC: \u30D5\u30A1\u30A4\u30EB\u540D\u304B\u3089\u65E5\u4ED8\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
        new import_obsidian.Notice("\u30D5\u30A1\u30A4\u30EB\u540D\u304B\u3089\u65E5\u4ED8\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
        return;
      }
      console.log("\u30A4\u30D9\u30F3\u30C8\u53D6\u5F97\u958B\u59CB:", targetDate);
      const events = await this.fetchEventsForDate(targetDate);
      console.log("\u53D6\u5F97\u3057\u305F\u30A4\u30D9\u30F3\u30C8\u6570:", events.length);
      console.log("\u30A4\u30D9\u30F3\u30C8\u8A73\u7D30:", events);
      const formattedEvents = this.formatEvents(events);
      console.log("\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u6E08\u307F\u30A4\u30D9\u30F3\u30C8:", formattedEvents);
      console.log("\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u6E08\u307F\u30A4\u30D9\u30F3\u30C8\u306E\u9577\u3055:", formattedEvents.length);
      await this.insertToActiveFile(formattedEvents);
    } catch (error) {
      console.error("\u4E88\u5B9A\u306E\u53D6\u5F97\u306B\u5931\u6557:", error);
      new import_obsidian.Notice("\u4E88\u5B9A\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
    }
  }
  // ファイル名から日付を取得 (YYYY-MM-DD 形式)
  getDateFromFileName(fileName) {
    const match = fileName.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return null;
  }
  // 指定した日付の予定を取得
  async fetchEventsForDate(dateString) {
    const date = new Date(dateString);
    const startOfDay = new Date(date.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(date.setHours(23, 59, 59, 999)).toISOString();
    await this.fetchCalendarColors();
    const allEvents = [];
    for (const calendarId of this.settings.calendarIds) {
      try {
        const events = await this.fetchEventsFromCalendar(calendarId, startOfDay, endOfDay);
        const color = this.calendarColors.get(calendarId) || "#4285f4";
        events.forEach((event) => event.calendarColor = color);
        allEvents.push(...events);
      } catch (error) {
        console.error(`\u30AB\u30EC\u30F3\u30C0\u30FC ${calendarId} \u306E\u53D6\u5F97\u306B\u5931\u6557:`, error);
      }
    }
    allEvents.sort((a, b) => {
      const timeA = new Date(a.start).getTime();
      const timeB = new Date(b.start).getTime();
      return timeA - timeB;
    });
    return allEvents;
  }
  // 指定したカレンダーから予定を取得
  async fetchEventsFromCalendar(calendarId, startOfDay, endOfDay) {
    var _a;
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(startOfDay)}&timeMax=${encodeURIComponent(endOfDay)}&singleEvents=true&orderBy=startTime`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${this.settings.googleAccessToken}`
      }
    });
    if (!response.ok) {
      if (response.status === 401) {
        await this.refreshAccessToken();
        return this.fetchEventsFromCalendar(calendarId, startOfDay, endOfDay);
      }
      throw new Error(`API error: ${response.status}`);
    }
    const data = await response.json();
    return ((_a = data.items) == null ? void 0 : _a.map((item) => {
      var _a2, _b, _c, _d, _e;
      return {
        summary: item.summary || "(\u30BF\u30A4\u30C8\u30EB\u306A\u3057)",
        start: ((_a2 = item.start) == null ? void 0 : _a2.dateTime) || ((_b = item.start) == null ? void 0 : _b.date),
        end: ((_c = item.end) == null ? void 0 : _c.dateTime) || ((_d = item.end) == null ? void 0 : _d.date),
        location: item.location,
        description: item.description,
        attendees: (_e = item.attendees) == null ? void 0 : _e.map((a) => a.email),
        hangoutLink: item.hangoutLink
      };
    })) || [];
  }
  // カレンダーの色情報を取得
  async fetchCalendarColors() {
    if (this.calendarColors.size > 0) {
      return;
    }
    const url = `https://www.googleapis.com/calendar/v3/users/me/calendarList`;
    try {
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${this.settings.googleAccessToken}`
        }
      });
      if (!response.ok) {
        if (response.status === 401) {
          await this.refreshAccessToken();
          return this.fetchCalendarColors();
        }
        throw new Error(`Failed to fetch calendar list: ${response.status}`);
      }
      const data = await response.json();
      data.items.forEach((calendar) => {
        if (calendar.id && calendar.backgroundColor) {
          this.calendarColors.set(calendar.id, calendar.backgroundColor);
        }
      });
    } catch (error) {
      console.error("Failed to fetch calendar colors:", error);
    }
  }
  // アクセストークンをリフレッシュ
  async refreshAccessToken() {
    const url = "https://oauth2.googleapis.com/token";
    const body = new URLSearchParams({
      client_id: this.settings.googleClientId,
      client_secret: this.settings.googleClientSecret,
      refresh_token: this.settings.googleRefreshToken,
      grant_type: "refresh_token"
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    if (!response.ok) {
      throw new Error("\u30C8\u30FC\u30AF\u30F3\u306E\u30EA\u30D5\u30EC\u30C3\u30B7\u30E5\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
    }
    const data = await response.json();
    this.settings.googleAccessToken = data.access_token;
    await this.saveSettings();
  }
  // イベントをフォーマット
  formatEvents(events) {
    if (events.length === 0) {
      return "\u4E88\u5B9A\u306F\u3042\u308A\u307E\u305B\u3093";
    }
    let formatted = "";
    for (const event of events) {
      const startTime = this.formatTime(event.start);
      const endTime = this.formatTime(event.end);
      const hasDetails = event.location || event.description || event.attendees && event.attendees.length > 0 || event.hangoutLink;
      const isAllDay = startTime === endTime;
      const timeDisplay = isAllDay ? "All-day event" : `${startTime} - ${endTime}`;
      const timeText = event.calendarColor ? `<span style="text-decoration: underline; text-decoration-color: ${event.calendarColor}; text-decoration-thickness: 2px; font-weight: bold;">${timeDisplay}</span>` : `**${timeDisplay}**`;
      if (hasDetails) {
        formatted += `- ${timeText} ${event.summary}
`;
        if (event.location) {
          const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`;
          formatted += `	- **\u5834\u6240:** [${event.location}](${mapUrl})
`;
        }
        if (event.description) {
          formatted += `	- **\u30E1\u30E2:** ${event.description}
`;
        }
        if (event.attendees && event.attendees.length > 0) {
          formatted += `	- **\u53C2\u52A0\u8005:** ${event.attendees.join(", ")}
`;
        }
        if (event.hangoutLink) {
          formatted += `	- **\u30EA\u30F3\u30AF:** [\u{1F4F9} Google Meet\u306B\u53C2\u52A0](${event.hangoutLink})
`;
        }
      } else {
        formatted += `- ${timeText} ${event.summary}
`;
      }
    }
    return formatted;
  }
  // 時刻をフォーマット
  formatTime(dateString) {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return "\u7D42\u65E5";
    }
    return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  // アクティブファイルに挿入
  async insertToActiveFile(content) {
    console.log("=== insertToActiveFile \u547C\u3073\u51FA\u3057 ===");
    console.log("\u53D7\u3051\u53D6\u3063\u305F content:", content);
    console.log("content \u306E\u9577\u3055:", content.length);
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      console.log("\u30A8\u30E9\u30FC: \u30A2\u30AF\u30C6\u30A3\u30D6\u306A\u30D5\u30A1\u30A4\u30EB\u304C\u3042\u308A\u307E\u305B\u3093");
      new import_obsidian.Notice("\u30A2\u30AF\u30C6\u30A3\u30D6\u306A\u30D5\u30A1\u30A4\u30EB\u304C\u3042\u308A\u307E\u305B\u3093");
      return;
    }
    console.log("\u30A2\u30AF\u30C6\u30A3\u30D6\u30D5\u30A1\u30A4\u30EB:", activeFile.path);
    const currentContent = await this.app.vault.read(activeFile);
    console.log("\u73FE\u5728\u306E\u30CE\u30FC\u30C8\u5185\u5BB9 (\u5148\u982D200\u6587\u5B57):", currentContent.slice(0, 200));
    const scheduleHeadingPattern = /^###\s+Schedule\s*$/m;
    const scheduleMatch = currentContent.match(scheduleHeadingPattern);
    if (!scheduleMatch || scheduleMatch.index === void 0) {
      console.log("\u30A8\u30E9\u30FC: ### Schedule \u898B\u51FA\u3057\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
      return;
    }
    const scheduleHeadingEnd = scheduleMatch.index + scheduleMatch[0].length;
    console.log("### Schedule \u898B\u51FA\u3057\u306E\u4F4D\u7F6E:", scheduleMatch.index);
    const afterSchedule = currentContent.slice(scheduleHeadingEnd);
    const nextHeadingMatch = afterSchedule.match(/^###\s+/m);
    const searchEnd = (nextHeadingMatch == null ? void 0 : nextHeadingMatch.index) !== void 0 ? scheduleHeadingEnd + nextHeadingMatch.index : currentContent.length;
    console.log("Schedule \u30BB\u30AF\u30B7\u30E7\u30F3\u306E\u7BC4\u56F2:", { start: scheduleHeadingEnd, end: searchEnd });
    const scheduleSection = currentContent.slice(scheduleHeadingEnd, searchEnd);
    const startMarker = "%%start%%";
    const endMarker = "%%end%%";
    const startIdx = scheduleSection.indexOf(startMarker);
    const endIdx = scheduleSection.indexOf(endMarker);
    console.log("Schedule \u30BB\u30AF\u30B7\u30E7\u30F3\u5185\u306E\u30DE\u30FC\u30AB\u30FC\u4F4D\u7F6E:", { startIdx, endIdx });
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      console.log("\u30A8\u30E9\u30FC: Schedule \u30BB\u30AF\u30B7\u30E7\u30F3\u5185\u306B\u30DE\u30FC\u30AB\u30FC\u304C\u898B\u3064\u304B\u3089\u306A\u3044\u304B\u9806\u5E8F\u304C\u4E0D\u6B63");
      console.log("startMarker \u304C\u898B\u3064\u304B\u3063\u305F:", startIdx !== -1);
      console.log("endMarker \u304C\u898B\u3064\u304B\u3063\u305F:", endIdx !== -1);
      return;
    }
    const absoluteStartIdx = scheduleHeadingEnd + startIdx;
    const absoluteEndIdx = scheduleHeadingEnd + endIdx;
    const afterStart = absoluteStartIdx + startMarker.length;
    const beforeEnd = absoluteEndIdx;
    const before = currentContent.slice(0, afterStart);
    const after = currentContent.slice(beforeEnd);
    const trimmed = content.trim();
    console.log("trimmed content:", trimmed);
    console.log("trimmed \u306E\u9577\u3055:", trimmed.length);
    if (!trimmed) {
      console.log("\u8B66\u544A: content \u304C\u7A7A\u306A\u306E\u3067\u4F55\u3082\u3057\u306A\u3044");
      return;
    }
    const newContent = `${before}
${trimmed}
${after}`;
    console.log("\u65B0\u3057\u3044\u5185\u5BB9\u3092\u66F8\u304D\u8FBC\u307F\u4E2D...");
    await this.app.vault.modify(activeFile, newContent);
    console.log("\u2705 \u66F8\u304D\u8FBC\u307F\u5B8C\u4E86");
  }
  // Google OAuth認証
  async authenticate() {
    if (!this.settings.googleClientId || !this.settings.googleClientSecret) {
      new import_obsidian.Notice("\u5148\u306B\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8ID\u3068\u30B7\u30FC\u30AF\u30EC\u30C3\u30C8\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
      return;
    }
    const PORT = 8080;
    const REDIRECT_URI = `http://localhost:${PORT}/callback`;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(this.settings.googleClientId)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/calendar.readonly")}&access_type=offline&prompt=consent`;
    try {
      const http = window.require("http");
      const server = http.createServer(async (req, res) => {
        var _a;
        if ((_a = req.url) == null ? void 0 : _a.startsWith("/callback")) {
          const url = new URL(req.url, `http://localhost:${PORT}`);
          const code = url.searchParams.get("code");
          if (code) {
            try {
              await this.exchangeCodeForToken(code, REDIRECT_URI);
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end("<h1>\u2705 \u8A8D\u8A3C\u6210\u529F!</h1><p>\u3053\u306E\u30BF\u30D6\u3092\u9589\u3058\u3066Obsidian\u306B\u623B\u3063\u3066\u304F\u3060\u3055\u3044\u3002</p><script>setTimeout(() => window.close(), 2000);<\/script>");
              new import_obsidian.Notice("\u8A8D\u8A3C\u306B\u6210\u529F\u3057\u307E\u3057\u305F!");
            } catch (error) {
              res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
              res.end("<h1>\u274C \u8A8D\u8A3C\u5931\u6557</h1><p>\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002</p>");
              new import_obsidian.Notice("\u8A8D\u8A3C\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
            }
            setTimeout(() => {
              server.close();
            }, 3e3);
          }
        }
      });
      server.listen(PORT, () => {
        window.open(authUrl, "_blank");
        new import_obsidian.Notice("\u30D6\u30E9\u30A6\u30B6\u3067\u8A8D\u8A3C\u3092\u5B8C\u4E86\u3057\u3066\u304F\u3060\u3055\u3044");
      });
      setTimeout(() => {
        server.close();
        if (!this.settings.googleAccessToken) {
          new import_obsidian.Notice("\u8A8D\u8A3C\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F");
        }
      }, 6e4);
    } catch (error) {
      console.error("http\u30E2\u30B8\u30E5\u30FC\u30EB\u304C\u4F7F\u3048\u307E\u305B\u3093:", error);
      new import_obsidian.Notice("\u30D6\u30E9\u30A6\u30B6\u3067\u8A8D\u8A3C\u3092\u5B8C\u4E86\u3057\u3001\u30B3\u30FC\u30EB\u30D0\u30C3\u30AFURL\u3092\u624B\u52D5\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");
      this.authCallbackUrl = "";
      window.open(authUrl, "_blank");
      const checkInterval = setInterval(async () => {
        if (this.authCallbackUrl) {
          clearInterval(checkInterval);
          try {
            const url = new URL(this.authCallbackUrl);
            const code = url.searchParams.get("code");
            if (code) {
              await this.exchangeCodeForToken(code, REDIRECT_URI);
              new import_obsidian.Notice("\u8A8D\u8A3C\u306B\u6210\u529F\u3057\u307E\u3057\u305F!");
            }
          } catch (error2) {
            console.error("\u8A8D\u8A3C\u30A8\u30E9\u30FC:", error2);
            new import_obsidian.Notice("\u8A8D\u8A3C\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
          }
          this.authCallbackUrl = "";
        }
      }, 1e3);
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!this.settings.googleAccessToken) {
          new import_obsidian.Notice("\u8A8D\u8A3C\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F");
        }
      }, 6e4);
    }
  }
  // 認証コードをトークンに交換
  async exchangeCodeForToken(code, redirectUri) {
    const url = "https://oauth2.googleapis.com/token";
    const body = new URLSearchParams({
      code,
      client_id: this.settings.googleClientId,
      client_secret: this.settings.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    if (!response.ok) {
      throw new Error("\u30C8\u30FC\u30AF\u30F3\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
    }
    const data = await response.json();
    this.settings.googleAccessToken = data.access_token;
    this.settings.googleRefreshToken = data.refresh_token;
    await this.saveSettings();
  }
  // 既存のGoogle Calendar Importerプラグインから認証情報をコピー
  async copyAuthFromGoogleCalendarImporter() {
    try {
      const gcalImporterData = await this.app.vault.adapter.read(
        ".obsidian/plugins/google-calendar-importer/data.json"
      );
      const gcalSettings = JSON.parse(gcalImporterData);
      if (gcalSettings.googleAccessToken && gcalSettings.googleRefreshToken) {
        this.settings.googleClientId = gcalSettings.googleClientId;
        this.settings.googleClientSecret = gcalSettings.googleClientSecret;
        this.settings.googleAccessToken = gcalSettings.googleAccessToken;
        this.settings.googleRefreshToken = gcalSettings.googleRefreshToken;
        await this.saveSettings();
        new import_obsidian.Notice("Google Calendar Importer\u304B\u3089\u8A8D\u8A3C\u60C5\u5831\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F!");
      } else {
        new import_obsidian.Notice("Google Calendar Importer\u306E\u8A8D\u8A3C\u60C5\u5831\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
      }
    } catch (error) {
      new import_obsidian.Notice("Google Calendar Importer\u30D7\u30E9\u30B0\u30A4\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
    }
  }
};
var GcalSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("gcal-sync-settings");
    containerEl.createEl("h2", { text: "Gcal Sync for Obsidian" });
    new import_obsidian.Setting(containerEl).setName("Google Client ID").setDesc("Google Cloud Console\u306EOAuth 2.0\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8ID").addText((text) => text.setPlaceholder("\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8ID\u3092\u5165\u529B").setValue(this.plugin.settings.googleClientId).onChange(async (value) => {
      this.plugin.settings.googleClientId = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Google Client Secret").setDesc("Google Cloud Console\u306EOAuth 2.0\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8\u30B7\u30FC\u30AF\u30EC\u30C3\u30C8").addText((text) => text.setPlaceholder("\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8\u30B7\u30FC\u30AF\u30EC\u30C3\u30C8\u3092\u5165\u529B").setValue(this.plugin.settings.googleClientSecret).onChange(async (value) => {
      this.plugin.settings.googleClientSecret = value;
      await this.plugin.saveSettings();
    }));
    const isAuthorized = !!this.plugin.settings.googleAccessToken;
    new import_obsidian.Setting(containerEl).setName("Google\u8A8D\u8A3C").setDesc(isAuthorized ? "\u2705 \u8A8D\u8A3C\u6E08\u307F - Google\u30AB\u30EC\u30F3\u30C0\u30FC\u306B\u30A2\u30AF\u30BB\u30B9\u3067\u304D\u307E\u3059" : "\u274C \u672A\u8A8D\u8A3C - Google\u30A2\u30AB\u30A6\u30F3\u30C8\u3067\u8A8D\u8A3C\u3057\u3066\u30AB\u30EC\u30F3\u30C0\u30FC\u306B\u30A2\u30AF\u30BB\u30B9").addButton((button) => button.setButtonText(isAuthorized ? "\u518D\u8A8D\u8A3C" : "\u8A8D\u8A3C\u3059\u308B").setCta().onClick(() => {
      this.plugin.authenticate();
    }));
    new import_obsidian.Setting(containerEl).setName("\u8868\u793A\u3059\u308B\u30AB\u30EC\u30F3\u30C0\u30FC").setDesc("\u30AB\u30EC\u30F3\u30C0\u30FCID\u3092\u30AB\u30F3\u30DE\u533A\u5207\u308A\u3067\u5165\u529B (\u4F8B: primary, work@example.com, private@example.com)").addTextArea((text) => text.setPlaceholder("primary").setValue(this.plugin.settings.calendarIds.join(", ")).onChange(async (value) => {
      this.plugin.settings.calendarIds = value.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u30C7\u30A4\u30EA\u30FC\u30CE\u30FC\u30C8\u81EA\u52D5\u633F\u5165").setDesc("\u30C7\u30A4\u30EA\u30FC\u30CE\u30FC\u30C8\u3092\u958B\u3044\u305F\u6642\u306B\u81EA\u52D5\u3067\u4E88\u5B9A\u3092\u633F\u5165").addToggle((toggle) => toggle.setValue(this.plugin.settings.enabledForDailyNotes).onChange(async (value) => {
      this.plugin.settings.enabledForDailyNotes = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u81EA\u52D5\u30EA\u30D5\u30EC\u30C3\u30B7\u30E5").setDesc("\u30C7\u30A4\u30EA\u30FC\u30CE\u30FC\u30C8\u3092\u958B\u3044\u3066\u3044\u308B\u9593\u3001\u5B9A\u671F\u7684\u306B\u4E88\u5B9A\u3092\u66F4\u65B0").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoRefresh).onChange(async (value) => {
      this.plugin.settings.autoRefresh = value;
      await this.plugin.saveSettings();
    }));
    if (this.plugin.settings.autoRefresh) {
      new import_obsidian.Setting(containerEl).setName("\u30EA\u30D5\u30EC\u30C3\u30B7\u30E5\u9593\u9694").setDesc("\u4E88\u5B9A\u3092\u66F4\u65B0\u3059\u308B\u9593\u9694(\u79D2)").addText((text) => text.setPlaceholder("60").setValue(String(this.plugin.settings.refreshInterval)).onChange(async (value) => {
        const interval = parseInt(value);
        if (!isNaN(interval) && interval > 0) {
          this.plugin.settings.refreshInterval = interval;
          await this.plugin.saveSettings();
        }
      }));
    }
  }
};
