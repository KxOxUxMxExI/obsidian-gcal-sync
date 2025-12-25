# Gcal Sync for Obsidian

Google CalendarとObsidianを同期するプラグインです。デイリーノートに自動的にカレンダーイベントを挿入し、定期的に更新します。

## 機能

- ✅ **複数のカレンダーに対応**: 複数のGoogleカレンダーを同時に表示
- ✅ **カレンダーごとに色分け**: 時間に色付きアンダーラインで視覚的に区別
- ✅ **自動リフレッシュ**: 設定した間隔で自動的に予定を更新
- ✅ **柔軟な挿入位置**: `### Schedule` 見出しの下に自動挿入
- ✅ **詳細情報の表示**: 場所、説明、参加者、Google Meetリンクを表示
- ✅ **Googleマップ連携**: 場所をクリックするとGoogleマップで開く
- ✅ **全日イベント対応**: 全日イベントは "All-day event" と表示
- ✅ **Templater 連携**: Templater コマンドでノート作成時に自動挿入
- ✅ **マーカーベース**: `%%start%%` / `%%end%%` マーカーで挿入位置を指定
- ✅ **シンプルな設定**: 必要最小限の設定項目でわかりやすい

## インストール

1. このリポジトリをクローンまたはダウンロード
2. `obsidian-gcal-sync`フォルダを`.obsidian/plugins/`にコピー
3. Obsidianを再起動
4. 設定 → コミュニティプラグイン → Gcal Sync for Obsidianを有効化

## 設定

### Google Calendar API設定

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクトを作成
2. Google Calendar APIを有効化
3. OAuth 2.0クライアントIDを作成
   - アプリケーションの種類: デスクトップアプリ
   - リダイレクトURI: `http://localhost:42813/callback`
4. クライアントIDとクライアントシークレットをプラグイン設定に入力
5. 「Google Calendarと連携」ボタンをクリックして認証

### プラグイン設定

- **Google Client ID**: Google Cloud Console の OAuth 2.0 クライアント ID
- **Google Client Secret**: Google Cloud Console の OAuth 2.0 クライアントシークレット
- **表示するカレンダー**: カレンダー ID をカンマ区切りで入力（例: `primary, work@example.com`）
- **デイリーノート自動挿入**: デイリーノートを開いた時に自動で予定を挿入
- **自動リフレッシュ**: デイリーノートを開いている間、定期的に予定を更新
- **リフレッシュ間隔**: 予定を更新する間隔（秒）

## 使い方

### 1. デイリーノートのテンプレートを設定

テンプレートに以下を追加してください：

```markdown
### Schedule
<%* await app.commands.executeCommandById('obsidian-gcal-sync:insert-today-events'); '' %>
%%start%%
%%end%%
```

- **`### Schedule`**: 挿入先の見出し（変更可能）
- **Templater コマンド**: ノート作成時に自動実行（オプション）
- **`%%start%%` / `%%end%%`**: マーカー（必須）

### 2. デイリーノートを開く

- プラグインが自動的に `%%start%%` と `%%end%%` の間に予定を挿入
- 自動リフレッシュが有効な場合、定期的に更新

### 3. マーカーについて

- マーカー（`%%start%%` / `%%end%%`）は **CSS で非表示** になります
- テンプレートファイルでも見えませんが、`Ctrl+F` で検索すれば見つかります

## ⚠️ 重要な注意事項

### CSS による影響

このプラグインは **`styles.css`** で以下のスタイルを適用します：

```css
/* Obsidian コメント（%%...%%）を完全非表示 */
.cm-comment {
    display: none !important;
}

/* マーカー行全体を非表示 */
.cm-line:has(.cm-comment) {
    display: none !important;
}
```

**影響範囲:**
- **全ての Obsidian ノート**で `%%...%%` 形式のコメントが非表示になります
- 他のノートで `%%メモ%%` などを使っている場合、それも見えなくなります
- 必要に応じて `styles.css` を編集してスコープを限定してください

**スコープを限定する例（デイリーノートのみ）:**
```css
body:has(.tag[data-tag-name="#Daily"]) .cm-comment {
    display: none !important;
}
```

## 表示例

```markdown
### Schedule
- All-day event ※リボ調整
- All-day event 古賀苗さんの誕生日
- All-day event 岩井大信さんの誕生日
```

- マーカー（`%%start%%` / `%%end%%`）は表示されません
- 普通の箇条書きリストとして表示されます
- カレンダーごとに色付きアンダーラインで区別されます（HTML 対応テーマの場合）


## ライセンス

MIT

## 作者

KxOxUxMxExI

## 貢献

プルリクエストやイシューは大歓迎です!
