# ChannelViewer（チャンネルビューアー）

YouTubeチャンネルの登録者数をリアルタイムに一覧表示する静的ウェブアプリです。

## 実行

`index.html` をブラウザで開くだけで実行できます。

## GitHub Pages

`main` ブランチへプッシュすると、GitHub Actionsが自動で公開します。

公開URL:

https://fuuchan-lab.github.io/channelviewer/

## 機能

- YouTube Data API v3による実際の登録者数の一覧表示
- チャンネル追加・削除、ブラウザ保存
- Googleログインでドライブに設定・チャンネルリストを保存（複数端末で共有）
- 検索と並び替え
- ドラッグ＆ドロップによる手動並び替え
- ダークテーマ

## 設定

サイドバーの「設定」から、YouTube Data API v3のAPIキーと、Googleログイン用のOAuthクライアントIDを登録してください。
