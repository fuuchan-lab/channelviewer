# ChannelViewer（チャンネルビューアー）

YouTubeチャンネルの登録者数をリアルタイムに一覧表示する静的ウェブアプリです。

## 実行

ES モジュールと Service Worker を使うため、ローカルでは HTTP サーバー経由で開きます。

```sh
npx serve .            # または python -m http.server 5173
```

Google ログインを試す場合は、OAuth クライアントに登録済みの生成元（`http://localhost:5173` など）で開いてください。

## GitHub Pages

`main` ブランチへプッシュすると、GitHub Actionsが自動で公開します。

公開URL:

https://channelviewer.doitmyself.net/ （https://fuuchan-lab.github.io/channelviewer/ から転送）

## 機能

- YouTube Data API v3 による実際の登録者数の一覧表示（50件ずつまとめて取得、開いている間は10分ごとに自動更新）
- 登録者数の推移（スパークライン）と、記録期間の増減の集計
- チャンネル追加・削除（削除は「元に戻す」可）、検索、並び替え、ドラッグ＆ドロップ（タッチ対応）での手動並び替え
- Google ログイン（LeadLog と同じ方式）で、設定とチャンネルリストを Google ドライブの「ChannelViewer」フォルダーに保存し、同じアカウントの端末と共有
- オフライン対応（Service Worker）。電波がなくても保存済みのデータで開け、つながったら自動で同期・更新
- アプリ化（PWA）。設定画面からインストール、iPhone は「ホーム画面に追加」

## 構成

| ファイル | 内容 |
| --- | --- |
| `index.html` | 画面 |
| `style.css` | 見た目 |
| `js/app.js` | 画面の動き・状態・同期 |
| `js/drive.js` | Google ログインと Google ドライブ（LeadLog の `drive.ts` と同じ方式） |
| `js/token-waiter.js` | ログインのトークン待ち（LeadLog の `tokenWaiter.ts` と同じ） |
| `js/youtube.js` | YouTube Data API |
| `sw.js` | オフライン対応 |

## 設定

右上の歯車から、YouTube Data API v3 の API キーを登録してください。

Google ログインは、LeadLog と同じ Google Cloud のプロジェクト「LeadLog」の OAuth クライアントを標準で使うので、設定は不要です。独自のクライアントを使う場合は、設定の「詳細設定」でクライアントIDを入力します。

OAuth クライアント「LeadLog Web」の「承認済みの JavaScript 生成元」に `https://channelviewer.doitmyself.net` が必要です。
