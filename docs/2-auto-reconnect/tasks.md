# OpenAI Realtimeセッションの自動再接続: タスク

Issue: [#2](https://github.com/satoryu/koemieru/issues/2) · 要件: [requirements.md](requirements.md) · 設計: [design.md](design.md)

TDDで進める。再接続の中核ロジックはフェイクWebSocket + 擬似タイマーで完全にユニットテストできる設計にしてあるため、実装の大部分はブラウザを触らずに検証できる。ブラウザでの手動確認は最後にまとめて行う。

- [x] **0. Issue / ブランチ / ドキュメント整備**
  - [x] GitHub Issue [#2](https://github.com/satoryu/koemieru/issues/2) を作成
  - [x] ブランチ`feature/2-auto-reconnect`を作成
  - [x] `docs/2-auto-reconnect/{requirements,design,tasks}.md`を作成
  - [x] **注意**: `main`にはまだMVPのコードが入っていないため、このブランチは`feature/1-koemieru-mvp`から切っている。MVPのPRが先にmergeされた時点で`main`にrebaseする
- [x] **1. `onServerError`のシグネチャ拡張**
  - [x] `lib/openai/realtimeSession.test.ts`を`(message, code, errorType)`を期待するよう更新（レッド）
  - [x] `lib/openai/realtimeSession.ts`の`RealtimeSessionHandlers`と呼び出し箇所を更新（グリーン）
  - [x] 既存の呼び出し元（`entrypoints/offscreen/main.ts`）が壊れていないことを`pnpm compile`で確認
- [x] **2. `lib/openai/reconnectingSession.ts`をTDDで実装**
  - [x] 開いている間は`sendAudioChunk` / `commit`を実接続へ委譲する
  - [x] 予期しないcloseで`onClose`を呼ばず、`onReconnecting(1, 6, reason)`を呼ぶ
  - [x] バックオフ時間の経過後に再接続し、`onOpen`が再度発火する
  - [x] 試行ごとに待ち時間が増える（500ms → 1s → 2s …）
  - [x] 試行回数を使い切ったら`onClose`を1度だけ呼ぶ
  - [x] 再試行不可エラー（`invalid_api_key` / `insufficient_quota` / `credit_balance_exhausted` / `invalid_model`）では再接続せず、そのメッセージ付きで即`onClose`
  - [x] `close()`（ユーザーによる停止）の後は再接続せず、保留中のタイマーもキャンセルする
  - [x] 切断中のチャンクをバッファし、再オープン時に順序どおりflushする
  - [x] バッファが上限を超えたら古い方から捨てる
  - [x] 接続が安定閾値（10秒）を超えて開いていたら試行回数をリセットする
  - [x] `item_id`に接続世代を前置する（`0:item_x` → 再接続後は`1:item_x`）
  - [x] 初回オープンでは`onReconnected`を呼ばず、再接続の成功時のみ呼ぶ
- [x] **3. メッセージプロトコルに`WS_RECONNECTING`を追加**
  - [x] `lib/messaging/protocol.ts`の判別可能なユニオン型に追加し、ヘッダコメントの方向表にも追記
- [x] **4. オフスクリーンドキュメントの配線**
  - [x] `connectRealtimeSession` → `createReconnectingRealtimeSession`に差し替え
  - [x] `onReconnecting`で`WS_RECONNECTING`をブロードキャスト
  - [x] `onReconnected`で`commitStrategy?.reset()`
  - [x] `lastServerErrorMessage`のstashをラッパー側へ移し、こちらからは削除
  - [x] `onClose`（＝セッション終了時のみ発火するようになる）の既存teardownロジックはそのまま維持
- [x] **5. サイドパネルのステータス表示**
  - [x] `WS_RECONNECTING`を処理し`Connection lost — reconnecting (1/6)…`を表示
  - [x] 再接続中もStopボタンを有効なまま維持する
- [x] **6. 自動テストとビルドをグリーンにする**
  - [x] `pnpm test`（新規テスト + 既存スイートの回帰）
  - [x] `pnpm compile`
  - [x] `pnpm build`
- [ ] **7. 手動確認（Chrome）**
  - [ ] **ネットワーク瞬断による再接続**（60分待たずに全経路を通せる本命の再現手段）
    - [ ] タブの音声が途切れず鳴り続ける
    - [ ] ステータスが`Connection lost — reconnecting (1/6)…`に変わる
    - [ ] 回線復帰後に自動で`Capturing tab audio… transcribing…`へ戻る
    - [ ] 切断中に喋られた内容がバッファから復元されて文字起こしに現れる
    - [ ] オフスクリーンドキュメントが閉じられていない（`chrome://extensions`で確認）
  - [ ] **再試行不可パス**: 無効なAPIキーで開始し、再接続ループに入らず即座にエラー内容が表示される
  - [ ] **停止のクリーンさ**: 再接続待ちの最中にStopを押し、ただちに`Idle`へ戻り、オフスクリーンドキュメントも残らない
  - [ ] **60分超えの実走**（最終的な受け入れゲート）: 実際の長時間音源で60分を跨がせ、自動で張り直されて文字起こしが継続すること、前後で重複・欠落がないことを確認する
- [ ] **8. 記録とPR**
  - [ ] 手動確認の結果をIssue #2に記録
  - [x] `docs/1-koemieru-mvp/design.md`の「既知の限界事項：自動再接続なし」にIssue #2で解消した旨を追記
  - [ ] PRを作成し、CLAUDE.mdのCode Reviewの観点（正確性 / 可読性 / 性能 / セキュリティ / 保守性）でセルフレビューする

## 補足

- ブラウザ自動操作ツールがこの環境にないため、Chromeでの手動確認はプロジェクトオーナーが行う。
- 60分超えの実走は実際の講演・長時間動画に合わせて行うため、他のタスクより後になる可能性がある。その場合も瞬断テスト（タスク7の1番目）で再接続の全経路は検証済みの状態にしておく。
