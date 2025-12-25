import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, request } from 'obsidian';


// 設定のインターフェース
interface GcalSyncSettings {
    googleClientId: string;
    googleClientSecret: string;
    googleAccessToken: string;
    googleRefreshToken: string;
    enabledForDailyNotes: boolean;
    insertPosition: 'top' | 'bottom' | 'heading';
    headingText: string;
    autoRefresh: boolean;
    refreshInterval: number; // 秒単位
    calendarIds: string[]; // 表示するカレンダーIDのリスト
    insertMargin: number; // 挿入時のマージン（行数）
}

// デフォルト設定
const DEFAULT_SETTINGS: GcalSyncSettings = {
    googleClientId: '',
    googleClientSecret: '',
    googleAccessToken: '',
    googleRefreshToken: '',
    enabledForDailyNotes: true,
    insertPosition: 'heading',
    headingText: '## 📅 今日の予定',
    autoRefresh: true,
    refreshInterval: 60,
    calendarIds: ['primary'], // デフォルトはメインカレンダー
    insertMargin: 0 // デフォルトは0行（直下）
};

// カレンダーイベントの型
interface CalendarEvent {
    summary: string;
    start: string;
    end: string;
    location?: string;
    description?: string;
    attendees?: string[];
    hangoutLink?: string;
    calendarColor?: string; // カレンダーの色
}

export default class GcalSyncPlugin extends Plugin {
    settings: GcalSyncSettings;
    authCallbackUrl: string = '';
    private refreshIntervalId: number | null = null;
    private currentFile: TFile | null = null;
    private calendarColors: Map<string, string> = new Map(); // カレンダーIDと色のマップ

    async onload() {
        await this.loadSettings();

        // コマンド: 今日の予定を挿入
        this.addCommand({
            id: 'insert-today-events',
            name: '今日の予定を挿入',
            callback: () => {
                this.insertTodayEvents();
            }
        });

        // コマンド: Google認証
        this.addCommand({
            id: 'authenticate-google',
            name: 'Googleアカウントで認証',
            callback: () => {
                this.authenticate();
            }
        });

        // 設定タブを追加
        this.addSettingTab(new GcalSyncSettingTab(this.app, this));

        // デイリーノート自動挿入
        if (this.settings.enabledForDailyNotes) {
            this.registerEvent(
                this.app.workspace.on('file-open', (file) => {
                    if (file && this.isDailyNote(file)) {
                        this.currentFile = file;
                        this.insertTodayEvents();

                        // 自動リフレッシュを開始
                        if (this.settings.autoRefresh) {
                            this.startAutoRefresh();
                        }
                    } else {
                        // デイリーノート以外のファイルを開いたらリフレッシュを停止
                        this.stopAutoRefresh();
                        this.currentFile = null;
                    }
                })
            );
        }
    }

    onunload() {
        // クリーンアップ処理
        this.stopAutoRefresh();
    }

    // 自動リフレッシュを開始
    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshIntervalId = window.setInterval(() => {
            if (this.currentFile && this.isDailyNote(this.currentFile)) {
                this.insertTodayEvents();
            }
        }, this.settings.refreshInterval * 1000);
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
    isDailyNote(file: TFile): boolean {
        // デイリーノートのパスパターンをチェック
        // 例: "00-Meta/デイリーノート.md" や日付形式のファイル
        const dailyNotePattern = /デイリーノート|daily|journal|\d{4}-\d{2}-\d{2}/i;
        return dailyNotePattern.test(file.path);
    }

    // 今日の予定を挿入
    async insertTodayEvents() {
        if (!this.settings.googleAccessToken) {
            new Notice('先にGoogleアカウントで認証してください');
            return;
        }

        try {
            // アクティブファイルから日付を取得
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                return;
            }

            const targetDate = this.getDateFromFileName(activeFile.basename);
            if (!targetDate) {
                new Notice('ファイル名から日付を取得できませんでした');
                return;
            }

            const events = await this.fetchEventsForDate(targetDate);
            const formattedEvents = this.formatEvents(events);
            await this.insertToActiveFile(formattedEvents);
        } catch (error) {
            console.error('予定の取得に失敗:', error);
            new Notice('予定の取得に失敗しました');
        }
    }

    // ファイル名から日付を取得 (YYYY-MM-DD 形式)
    getDateFromFileName(fileName: string): string | null {
        // YYYY-MM-DD 形式を検索
        const match = fileName.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
            return `${match[1]}-${match[2]}-${match[3]}`;
        }
        return null;
    }

    // 指定した日付の予定を取得
    async fetchEventsForDate(dateString: string): Promise<CalendarEvent[]> {
        const date = new Date(dateString);
        const startOfDay = new Date(date.setHours(0, 0, 0, 0)).toISOString();
        const endOfDay = new Date(date.setHours(23, 59, 59, 999)).toISOString();

        // カレンダーの色情報を取得
        await this.fetchCalendarColors();

        // 複数のカレンダーから予定を取得
        const allEvents: CalendarEvent[] = [];

        for (const calendarId of this.settings.calendarIds) {
            try {
                const events = await this.fetchEventsFromCalendar(calendarId, startOfDay, endOfDay);
                // カレンダーの色を各イベントに追加
                const color = this.calendarColors.get(calendarId) || '#4285f4';
                events.forEach(event => event.calendarColor = color);
                allEvents.push(...events);
            } catch (error) {
                console.error(`カレンダー ${calendarId} の取得に失敗:`, error);
            }
        }

        // 開始時刻でソート
        allEvents.sort((a, b) => {
            const timeA = new Date(a.start).getTime();
            const timeB = new Date(b.start).getTime();
            return timeA - timeB;
        });

        return allEvents;
    }

    // 指定したカレンダーから予定を取得
    async fetchEventsFromCalendar(calendarId: string, startOfDay: string, endOfDay: string): Promise<CalendarEvent[]> {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(startOfDay)}&timeMax=${encodeURIComponent(endOfDay)}&singleEvents=true&orderBy=startTime`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.settings.googleAccessToken}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                // トークンが期限切れの場合、リフレッシュを試みる
                await this.refreshAccessToken();
                return this.fetchEventsFromCalendar(calendarId, startOfDay, endOfDay); // 再試行
            }
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();

        return data.items?.map((item: any) => ({
            summary: item.summary || '(タイトルなし)',
            start: item.start?.dateTime || item.start?.date,
            end: item.end?.dateTime || item.end?.date,
            location: item.location,
            description: item.description,
            attendees: item.attendees?.map((a: any) => a.email),
            hangoutLink: item.hangoutLink
        })) || [];
    }

    // カレンダーの色情報を取得
    async fetchCalendarColors(): Promise<void> {
        if (this.calendarColors.size > 0) {
            return; // すでに取得済みならスキップ
        }

        const url = `https://www.googleapis.com/calendar/v3/users/me/calendarList`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.settings.googleAccessToken}`
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    await this.refreshAccessToken();
                    return this.fetchCalendarColors(); // 再試行
                }
                throw new Error(`Failed to fetch calendar list: ${response.status}`);
            }

            const data = await response.json();
            data.items.forEach((calendar: any) => {
                if (calendar.id && calendar.backgroundColor) {
                    this.calendarColors.set(calendar.id, calendar.backgroundColor);
                }
            });
        } catch (error) {
            console.error('Failed to fetch calendar colors:', error);
        }
    }

    // アクセストークンをリフレッシュ
    async refreshAccessToken() {
        const url = 'https://oauth2.googleapis.com/token';
        const body = new URLSearchParams({
            client_id: this.settings.googleClientId,
            client_secret: this.settings.googleClientSecret,
            refresh_token: this.settings.googleRefreshToken,
            grant_type: 'refresh_token'
        });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
        });

        if (!response.ok) {
            throw new Error('トークンのリフレッシュに失敗しました');
        }

        const data = await response.json();
        this.settings.googleAccessToken = data.access_token;
        await this.saveSettings();
    }

    // イベントをフォーマット
    formatEvents(events: CalendarEvent[]): string {
        if (events.length === 0) {
            return '予定はありません';
        }

        let formatted = '';

        for (const event of events) {
            const startTime = this.formatTime(event.start);
            const endTime = this.formatTime(event.end);

            // 詳細情報があるかチェック
            const hasDetails = event.location || event.description || (event.attendees && event.attendees.length > 0) || event.hangoutLink;

            // 全日イベントかチェック (開始時刻と終了時刻が同じ)
            const isAllDay = startTime === endTime;
            const timeDisplay = isAllDay ? 'All-day event' : `${startTime} - ${endTime}`;

            // イベントのタイトル行 - 時間に色付きアンダーライン
            const timeText = event.calendarColor
                ? `<span style="text-decoration: underline; text-decoration-color: ${event.calendarColor}; text-decoration-thickness: 2px; font-weight: bold;">${timeDisplay}</span>`
                : `**${timeDisplay}**`;

            if (hasDetails) {
                // 詳細情報がある場合
                formatted += `- ${timeText} ${event.summary}\n`;


                if (event.location) {
                    // 場所にGoogleマップリンクを追加
                    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`;
                    formatted += `\t- **場所:** [${event.location}](${mapUrl})\n`;
                }
                if (event.description) {
                    formatted += `\t- **メモ:** ${event.description}\n`;
                }
                if (event.attendees && event.attendees.length > 0) {
                    formatted += `\t- **参加者:** ${event.attendees.join(', ')}\n`;
                }
                if (event.hangoutLink) {
                    formatted += `\t- **リンク:** [📹 Google Meetに参加](${event.hangoutLink})\n`;
                }


            } else {
                // 詳細情報がない場合
                formatted += `- ${timeText} ${event.summary}\n`;
            }
        }

        return formatted;
    }

    // 時刻をフォーマット
    formatTime(dateString: string): string {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return '終日';
        }
        return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }

    // アクティブファイルに挿入
    async insertToActiveFile(content: string) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('アクティブなファイルがありません');
            return;
        }

        const currentContent = await this.app.vault.read(activeFile);

        let newContent: string;

        if (this.settings.insertPosition === 'heading') {
            // 指定した見出しの下に挿入
            // 見出しマークダウン(###)を含むかチェック
            const headingText = this.settings.headingText.trim();
            let headingPattern: RegExp;

            if (headingText.startsWith('#')) {
                // 見出しマークダウンがある場合、そのまま検索
                const escapedHeading = headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                headingPattern = new RegExp(`^${escapedHeading}\\s*$`, 'm');
            } else {
                // 見出しマークダウンがない場合、任意の見出しレベルで検索
                const escapedHeading = headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                headingPattern = new RegExp(`^#{1,6}\\s+${escapedHeading}\\s*$`, 'm');
            }

            const match = currentContent.match(headingPattern);

            if (match && match.index !== undefined) {
                // 見出しが見つかった場合
                const headingEnd = match.index + match[0].length;
                const afterHeading = currentContent.slice(headingEnd);

                // 見出しの直後からリスト項目が続く限り削除
                const lines = afterHeading.split('\n');
                let deleteLineCount = 0;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const trimmed = line.trim();

                    // リスト項目ならカウント
                    if (trimmed.startsWith('- ') || line.startsWith('\t- ')) {
                        deleteLineCount++;
                    } else if (trimmed === '') {
                        // 空行はスキップ(次の行もチェック)
                        deleteLineCount++;
                    } else {
                        // リスト以外が来たら終了
                        break;
                    }
                }

                // 削除する範囲を計算
                let deleteEndPos = headingEnd;
                for (let i = 0; i < deleteLineCount; i++) {
                    const nextNewline = currentContent.indexOf('\n', deleteEndPos);
                    if (nextNewline === -1) {
                        deleteEndPos = currentContent.length;
                        break;
                    }
                    deleteEndPos = nextNewline + 1;
                }

                // マージンを計算 (最低1個の改行)
                const margin = '\n'.repeat(this.settings.insertMargin + 1);
                const trimmedContent = content.trim();

                // 新しいコンテンツを組み立て (最後に改行を追加)
                newContent = currentContent.slice(0, headingEnd) + margin + trimmedContent + '\n' + currentContent.slice(deleteEndPos);

            } else {
                // 見出しが見つからない場合、先頭に見出しごと挿入
                new Notice(`見出し「${headingText}」が見つかりませんでした。先頭に挿入します。`);
                newContent = content + '\n\n' + currentContent;
            }
        } else if (this.settings.insertPosition === 'top') {
            newContent = content + '\n\n' + currentContent;
        } else {
            newContent = currentContent + '\n\n' + content;
        }

        await this.app.vault.modify(activeFile, newContent);
    }

    // Google OAuth認証
    async authenticate() {
        if (!this.settings.googleClientId || !this.settings.googleClientSecret) {
            new Notice('先にクライアントIDとシークレットを設定してください');
            return;
        }

        const PORT = 8080;
        const REDIRECT_URI = `http://localhost:${PORT}/callback`;

        // 認証URL生成
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${encodeURIComponent(this.settings.googleClientId)}&` +
            `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly')}&` +
            `access_type=offline&` +
            `prompt=consent`;

        try {
            // Electronのrequireを使ってhttpモジュールにアクセス
            const http = (window as any).require('http');

            // ローカルサーバーを起動
            const server = http.createServer(async (req: any, res: any) => {
                if (req.url?.startsWith('/callback')) {
                    const url = new URL(req.url, `http://localhost:${PORT}`);
                    const code = url.searchParams.get('code');

                    if (code) {
                        try {
                            await this.exchangeCodeForToken(code, REDIRECT_URI);
                            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end('<h1>✅ 認証成功!</h1><p>このタブを閉じてObsidianに戻ってください。</p><script>setTimeout(() => window.close(), 2000);</script>');
                            new Notice('認証に成功しました!');
                        } catch (error) {
                            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end('<h1>❌ 認証失敗</h1><p>エラーが発生しました。</p>');
                            new Notice('認証に失敗しました');
                        }

                        // サーバーを閉じる
                        setTimeout(() => {
                            server.close();
                        }, 3000);
                    }
                }
            });

            server.listen(PORT, () => {
                // ブラウザで認証URLを開く
                window.open(authUrl, '_blank');
                new Notice('ブラウザで認証を完了してください');
            });

            // 60秒後にタイムアウト
            setTimeout(() => {
                server.close();
                if (!this.settings.googleAccessToken) {
                    new Notice('認証がタイムアウトしました');
                }
            }, 60000);

        } catch (error) {
            // httpモジュールが使えない場合は手動入力方式にフォールバック
            console.error('httpモジュールが使えません:', error);
            new Notice('ブラウザで認証を完了し、コールバックURLを手動で入力してください');

            // 認証コールバックを待機
            this.authCallbackUrl = '';

            // ブラウザで認証URLを開く
            window.open(authUrl, '_blank');

            // コールバックURLを監視
            const checkInterval = setInterval(async () => {
                if (this.authCallbackUrl) {
                    clearInterval(checkInterval);
                    try {
                        const url = new URL(this.authCallbackUrl);
                        const code = url.searchParams.get('code');
                        if (code) {
                            await this.exchangeCodeForToken(code, REDIRECT_URI);
                            new Notice('認証に成功しました!');
                        }
                    } catch (error) {
                        console.error('認証エラー:', error);
                        new Notice('認証に失敗しました');
                    }
                    this.authCallbackUrl = '';
                }
            }, 1000);

            // 60秒後にタイムアウト
            setTimeout(() => {
                clearInterval(checkInterval);
                if (!this.settings.googleAccessToken) {
                    new Notice('認証がタイムアウトしました');
                }
            }, 60000);
        }
    }

    // 認証コードをトークンに交換
    async exchangeCodeForToken(code: string, redirectUri: string) {
        const url = 'https://oauth2.googleapis.com/token';
        const body = new URLSearchParams({
            code: code,
            client_id: this.settings.googleClientId,
            client_secret: this.settings.googleClientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
        });

        if (!response.ok) {
            throw new Error('トークンの取得に失敗しました');
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
                '.obsidian/plugins/google-calendar-importer/data.json'
            );
            const gcalSettings = JSON.parse(gcalImporterData);

            if (gcalSettings.googleAccessToken && gcalSettings.googleRefreshToken) {
                this.settings.googleClientId = gcalSettings.googleClientId;
                this.settings.googleClientSecret = gcalSettings.googleClientSecret;
                this.settings.googleAccessToken = gcalSettings.googleAccessToken;
                this.settings.googleRefreshToken = gcalSettings.googleRefreshToken;
                await this.saveSettings();
                new Notice('Google Calendar Importerから認証情報をコピーしました!');
            } else {
                new Notice('Google Calendar Importerの認証情報が見つかりません');
            }
        } catch (error) {
            new Notice('Google Calendar Importerプラグインが見つかりません');
        }
    }
}

// 設定タブ
class GcalSyncSettingTab extends PluginSettingTab {
    plugin: GcalSyncPlugin;

    constructor(app: App, plugin: GcalSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('gcal-sync-settings');

        containerEl.createEl('h2', { text: 'Gcal Sync for Obsidian' });

        // Google Client ID
        new Setting(containerEl)
            .setName('Google Client ID')
            .setDesc('Google Cloud ConsoleのOAuth 2.0クライアントID')
            .addText(text => text
                .setPlaceholder('クライアントIDを入力')
                .setValue(this.plugin.settings.googleClientId)
                .onChange(async (value) => {
                    this.plugin.settings.googleClientId = value;
                    await this.plugin.saveSettings();
                }));

        // Google Client Secret
        new Setting(containerEl)
            .setName('Google Client Secret')
            .setDesc('Google Cloud ConsoleのOAuth 2.0クライアントシークレット')
            .addText(text => text
                .setPlaceholder('クライアントシークレットを入力')
                .setValue(this.plugin.settings.googleClientSecret)
                .onChange(async (value) => {
                    this.plugin.settings.googleClientSecret = value;
                    await this.plugin.saveSettings();
                }));

        // 認証ボタン
        const isAuthorized = !!this.plugin.settings.googleAccessToken;
        new Setting(containerEl)
            .setName('Google認証')
            .setDesc(isAuthorized
                ? '✅ 認証済み - Googleカレンダーにアクセスできます'
                : '❌ 未認証 - Googleアカウントで認証してカレンダーにアクセス')
            .addButton(button => button
                .setButtonText(isAuthorized ? '再認証' : '認証する')
                .setCta()
                .onClick(() => {
                    this.plugin.authenticate();
                }));


        // デイリーノート自動挿入
        new Setting(containerEl)
            .setName('デイリーノート自動挿入')
            .setDesc('デイリーノートを開いた時に自動で予定を挿入')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enabledForDailyNotes)
                .onChange(async (value) => {
                    this.plugin.settings.enabledForDailyNotes = value;
                    await this.plugin.saveSettings();
                }));

        // 挿入位置
        new Setting(containerEl)
            .setName('挿入位置')
            .setDesc('予定を挿入する位置')
            .addDropdown(dropdown => dropdown
                .addOption('heading', '指定した見出しの下')
                .addOption('top', 'ファイルの先頭')
                .addOption('bottom', 'ファイルの末尾')
                .setValue(this.plugin.settings.insertPosition)
                .onChange(async (value: 'top' | 'bottom' | 'heading') => {
                    this.plugin.settings.insertPosition = value;
                    await this.plugin.saveSettings();
                    // 設定画面を再描画
                    this.display();
                }));

        // 見出しテキスト(挿入位置が「見出しの下」の場合のみ表示)
        if (this.plugin.settings.insertPosition === 'heading') {
            new Setting(containerEl)
                .setName('見出しテキスト')
                .setDesc('予定を挿入する見出し(例: ## 📅 今日の予定)')
                .addText(text => text
                    .setPlaceholder('## 📅 今日の予定')
                    .setValue(this.plugin.settings.headingText)
                    .onChange(async (value) => {
                        this.plugin.settings.headingText = value;
                        await this.plugin.saveSettings();
                    }));
        }

        // カレンダーID設定
        new Setting(containerEl)
            .setName('表示するカレンダー')
            .setDesc('カレンダーIDをカンマ区切りで入力 (例: primary, work@example.com, private@example.com)')
            .addTextArea(text => text
                .setPlaceholder('primary')
                .setValue(this.plugin.settings.calendarIds.join(', '))
                .onChange(async (value) => {
                    // カンマ区切りで分割してトリム
                    this.plugin.settings.calendarIds = value
                        .split(',')
                        .map(id => id.trim())
                        .filter(id => id.length > 0);
                    await this.plugin.saveSettings();
                }));

        // 挿入マージン設定
        new Setting(containerEl)
            .setName('挿入マージン')
            .setDesc('見出しの下に挿入する際の追加空行数 (0=最小限, 1=1行追加, 2=2行追加)')
            .addText(text => text
                .setPlaceholder('0')
                .setValue(String(this.plugin.settings.insertMargin))
                .onChange(async (value) => {
                    const margin = parseInt(value);
                    if (!isNaN(margin) && margin >= 0) {
                        this.plugin.settings.insertMargin = margin;
                        await this.plugin.saveSettings();
                    }
                }));

        // 自動リフレッシュ設定
        new Setting(containerEl)
            .setName('自動リフレッシュ')
            .setDesc('デイリーノートを開いている間、定期的に予定を更新')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoRefresh)
                .onChange(async (value) => {
                    this.plugin.settings.autoRefresh = value;
                    await this.plugin.saveSettings();
                }));

        // リフレッシュ間隔
        if (this.plugin.settings.autoRefresh) {
            new Setting(containerEl)
                .setName('リフレッシュ間隔')
                .setDesc('予定を更新する間隔(秒)')
                .addText(text => text
                    .setPlaceholder('60')
                    .setValue(String(this.plugin.settings.refreshInterval))
                    .onChange(async (value) => {
                        const interval = parseInt(value);
                        if (!isNaN(interval) && interval > 0) {
                            this.plugin.settings.refreshInterval = interval;
                            await this.plugin.saveSettings();
                        }
                    }));
        }
    }
}
