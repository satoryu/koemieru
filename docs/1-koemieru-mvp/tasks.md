# Koemieru MVP: タスク

Issue: [#1](https://github.com/satoryu/koemieru/issues/1) · 要件: [requirements.md](requirements.md) · 設計: [design.md](design.md)

TDDの進め方：各ステップは、次に進む前にそれぞれ独立して検証できる状態にする（ユニットテストがグリーンであること、該当する場合は手動でのChrome確認）。プロジェクトオーナーの判断により、このMVPでの手動ブラウザ確認のチェックポイントはタスク5の終わり（タブキャプチャ単体、OpenAI接続前）に1回設ける。それ以降の手動確認（OpenAI接続、文字起こし描画、ライフサイクル、30分シナリオ）は、残りの実装がコード上完了した時点でまとめて依頼する。

- [x] **1. Issue / ブランチ / ドキュメント / リポジトリ整備**
  - [x] GitHub Issue #1、ブランチ`feature/1-koemieru-mvp`、`docs/1-koemieru-mvp/`（このフォルダ）を作成
  - [x] `pnpm install`
  - [x] スターターテンプレートのファイルを削除（popup、counter、content script、未使用アセット）
  - [x] `wxt.config.ts`のname/descriptionを更新
  - [x] `pnpm build`が素の拡張機能で通ることを確認
  - [x] Vitestをセットアップ（`vitest.config.ts`、`test`/`test:watch`スクリプト）
- [x] **2. サイドパネルの骨格**
  - [x] 静的UI: タイトル、APIキー入力、無効化されたStart/Stop、ステータス表示、空の文字起こしエリア
  - [x] `manifest.action: {}` + `background.ts`での`setPanelBehavior({openPanelOnActionClick: true})`
  - [ ] 手動確認: ツールバーアイコンでパネルが開く *(タスク5にまとめて実施)*
- [x] **3. APIキーの永続化**
  - [x] `wxt/testing/fake-browser`を使って`lib/storage/apiKeyStore.ts`をTDDで実装
  - [x] APIキー入力欄に接続（マウント時に読み込み、変更時に保存）
  - [ ] 手動確認: パネルを閉じて再度開いてもキーが保持されている、ログに出力されない *(タスク5にまとめて実施)*
- [x] **4. メッセージプロトコルの型定義**
  - [x] `lib/messaging/protocol.ts` の判別可能なユニオン型 + `isKoemieruMessage`/`isMessageOfType`ガード関数（テスト済み）
- [x] **5. オフスクリーンドキュメント + タブキャプチャのみの配線（OpenAIはまだ含まない）**
  - [x] `entrypoints/offscreen/index.html`
  - [x] `entrypoints/offscreen/main.ts`: `getUserMedia`での引き換えと再生パススルーのみ
  - [x] `background.ts`: `ENSURE_OFFSCREEN_READY`の処理（作成 + リトライ付きレディ確認）、セッションの状態管理、`chrome.tabs.onRemoved` → `TAB_GONE`
  - [x] `wxt.config.ts`: `tabCapture`、`offscreen`、`activeTab`権限を追加
  - [x] **設計変更**: `chrome.tabCapture`が`activeTab`と同じ「ユーザーによる呼び出し」を要求し、かつサイドパネル内のボタンクリックはその資格を満たさない（Chromiumの意図的な仕様、Won't Fixのバグ報告あり）ことが判明。Startのトリガーをサイドパネル内ボタンからツールバーアイコンのクリック（`action.onClicked`）に変更。詳細は[design.md](design.md)
  - [x] **手動確認（コア動作）**: 実機でログを追跡し、`action.onClicked` → `ENSURE_OFFSCREEN_READY` → `getMediaStreamId` → `START_CAPTURE` → `getUserMedia`成功 → `CAPTURE_STARTED`という一連の流れが動作し、サイドパネルのステータスが「Capturing tab audio…」になることを確認済み
  - [ ] 残りの詳細確認（音声が途切れず再生され続けるか、Stopでクリーンに`Idle`へ戻るか、キャプチャ中にタブを閉じて`TAB_GONE`が表示されるか）は、タスク8〜9完了後の一括確認ラウンドに合わせて実施
- [ ] **6. PCM変換モジュール**
  - [ ] 既知のFloat32のフィクスチャを使い、`lib/audio/pcm.ts`（`downmixToMono`、`resample`、`float32ToInt16PCM`、`int16ToBase64`）をTDDで実装 — chrome APIへの依存なし
- [ ] **7. AudioWorkletタップの配線**
  - [ ] オフスクリーンドキュメントの音声グラフからリアルタイムでタップし`lib/audio/pcm.ts`に流す。（まだWebSocketなし）チャンクをログ/カウントし、再生を壊さずに安定したケイデンスであることを確認
- [ ] **8. OpenAI Realtime WebSocket接続**
  - [ ] このステップを書く直前に、`developers.openai.com`で現行の文字起こしセッション設定JSONとイベント名を再検証する
  - [ ] フェイクのWebSocketに対して`lib/openai/realtimeSession.ts`のペイロード生成をTDDで実装
  - [ ] オフスクリーンドキュメントに配線: 接続を開き、セッション設定を送信し、`input_audio_buffer.append`でチャンクをストリーミング
  - [ ] `wxt.config.ts`: `host_permissions: ["https://api.openai.com/*"]`を追加
  - [ ] 手動確認: 有効なキーで接続が確立し音声再生中も維持される。無効なキーで「OpenAIがハンドシェイクを拒否する」失敗経路が発生し、明確に表示されることを確認
- [ ] **9. 文字起こしの描画**
  - [ ] `lib/transcript/transcriptStore.ts`をTDDで実装（同一itemに対するdelta→final、順不同での到着、空のdelta、重複しないこと）
  - [ ] `TRANSCRIPT_DELTA`/`TRANSCRIPT_FINAL`を描画に接続し、スクロールして離れていない限り自動追従
  - [ ] 手動確認: 実際の音声で、文字起こしが重複なく継続的に構築されることを確認
- [ ] **10. Start/Stopライフサイクルの堅牢性**
  - [ ] 拡張機能を再読み込みせずにStart→Stop→Startを繰り返す
  - [ ] `chrome://extensions`のサービスワーカーインスペクタで、開いたままのソケットやオフスクリーンドキュメントが残っていないか確認
  - [ ] Startの連打で2つのパイプラインが生成されないようガードする
- [ ] **11. 30分間の安定性シナリオ**（最終的な受け入れゲート。requirements.mdのTarget Validation Scenario参照）
  - [ ] シナリオを実施し、CLAUDE.mdのDefinition of Doneに従ってIssue/PRに結果を記録する

## 補足

- この環境にはブラウザ自動操作ツールが存在しないため、Chromeでの手動確認はプロジェクトオーナーが行う。Claudeはタスクごとに毎回確認を依頼するのではなく、チェックポイントをまとめて依頼する。
- 完了時に報告する既知の限界事項: 未検証の生キーによるWebSocket認証、切断時の自動再接続なし、セッションをまたいだ永続化なし（意図的な設計）、プレースホルダーアイコン、リサンプリング品質の影響が未検証であること。
