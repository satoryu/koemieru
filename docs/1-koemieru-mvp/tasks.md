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
- [x] **6. PCM変換モジュール**
  - [x] 既知のFloat32のフィクスチャを使い、`lib/audio/pcm.ts`（`downmixToMono`、`resample`、`float32ToInt16PCM`、`int16ToBase64`）をTDDで実装 — chrome APIへの依存なし
- [x] **7. AudioWorkletタップの配線**
  - [x] `public/pcm-worklet.js`（WXTにworklet専用エントリポイントがないため静的アセットとして配置）を`ctx.audioWorklet.addModule()`で読み込み、`source`から分岐した`AudioWorkletNode`でFloat32フレームをメインスレッドへ送る配線を追加。ワークレット内で約85ms（4096フレーム）単位にバッチしてpostMessageの頻度を抑えている
  - [x] `lib/audio/pcm.ts`への実際の変換とWebSocket送信はタスク8で配線予定。現時点ではチャンク数をカウントしログ出力するのみ
  - [ ] 手動確認（ログでケイデンスと再生への影響がないことを確認）は、タスク8〜9完了後の一括確認ラウンドに合わせて実施
- [x] **8. OpenAI Realtime WebSocket接続**
  - [x] `developers.openai.com`（realtime-transcription、realtime-vad）で文字起こしセッション設定JSON・VAD設定・イベント名を再検証（`session.update`型`transcription`、`gpt-live-transcribe`、`input_audio_buffer.append`、`conversation.item.input_audio_transcription.delta`/`.completed`、`item_id`フィールド、`server_vad`の形状を確認済み）
  - [x] フェイクのWebSocketに対して`lib/openai/realtimeSession.ts`のペイロード生成・イベントルーティングをTDDで実装
  - [x] オフスクリーンドキュメントに配線: `CAPTURE_STARTED`後に接続を開き、セッション設定を送信し、AudioWorkletタップからのチャンクを`lib/audio/pcm.ts`で変換して`input_audio_buffer.append`でストリーミング
  - [x] 予期しない切断時の状態遷移: `isCapturing`フラグで意図的な`stopCapture()`と予期しない切断を区別し、後者はリソースを解放した上で`WS_CLOSED`をブロードキャスト（`background.ts`はこれもセッション終了として扱う）
  - [x] `wxt.config.ts`: `host_permissions: ["https://api.openai.com/*"]`を追加
  - [x] `sidepanel/main.ts`: `WS_CONNECTING`/`WS_OPEN`/`WS_CLOSED`のステータス表示を追加
  - [x] **手動確認（コア動作）**: 実際のOpenAI APIキーでWebSocket接続が確立し、`session.update`が受理され、音声チャンクの送信・約2秒ごとの`input_audio_buffer.commit`を経て文字起こしが実際に返ってくることを確認済み
  - [x] **実装時に判明した追加修正**（いずれも実機テストで発見、公式ドキュメントに記載なし/誤りがあった）:
    - `?model=<文字起こしモデル>`はWebSocket接続URLでは`invalid_model`エラーになる。未文書化の`?intent=transcription`パラメータが正しい接続方法（コミュニティ報告ベース）
    - `sendAudioChunk`がWebSocketの`CONNECTING`状態中に呼ばれ`InvalidStateError`が発生 → `onopen`発火まで送信をガードするよう修正
    - このモデルは`turn_detection`（サーバー側VAD）自体をサポートしておらず、`turn_detection: null`にした上で`input_audio_buffer.commit`を手動送信する方式に変更（約2秒間隔）
  - [ ] 無効なAPIキーでの拒否パス（`CAPTURE_FAILED`/`WS_CLOSED`が明確に表示されるか）は未確認 — タスク10の一括確認と合わせて実施
- [x] **9. 文字起こしの描画**
  - [x] `lib/transcript/transcriptStore.ts`をTDDで実装（同一itemに対するdelta→final、順不同での到着、重複ファイナル、空のdelta/final、`reset()`を含む13ケース）
  - [x] `TRANSCRIPT_DELTA`/`TRANSCRIPT_FINAL`を描画に接続。DOM APIで構築（`innerHTML`不使用）し、下端付近にいる場合のみ自動追従。`CAPTURE_STARTED`で新セッションとして`reset()`
  - [x] **手動確認**: 実際の音声で文字起こしがサイドパネルに表示されることを確認済み
  - [ ] 重複がないか・自動スクロールの挙動は未確認 — タスク10の一括確認と合わせて実施
- [ ] **10. Start/Stopライフサイクルの堅牢性 + 残りの手動確認まとめ**
  - [ ] 音声が途切れず再生され続けるか（タスク5の残り）
  - [ ] Stopでクリーンに`Idle`へ戻るか
  - [ ] キャプチャ中にタブを閉じて`TAB_GONE`が表示されるか
  - [ ] 無効なAPIキーでの拒否パスが明確に表示されるか
  - [ ] 文字起こしの重複がないか・自動スクロールが正しく動くか
  - [ ] 拡張機能を再読み込みせずにStart→Stop→Startを繰り返す
  - [ ] `chrome://extensions`のサービスワーカーインスペクタで、開いたままのソケットやオフスクリーンドキュメントが残っていないか確認
  - [ ] Startの連打で2つのパイプラインが生成されないようガードする
- [ ] **11. 30分間の安定性シナリオ**（最終的な受け入れゲート。requirements.mdのTarget Validation Scenario参照）
  - [ ] シナリオを実施し、CLAUDE.mdのDefinition of Doneに従ってIssue/PRに結果を記録する
- [x] **12. コミット方式の切り替え（精度改善、MVPのAcceptance Criteria外の追加作業）**
  - [x] 固定間隔でのコミットは発話の途中で切れやすく精度が落ちるという実機での所感を受け、`lib/audio/commitStrategy.ts`をTDDで実装（固定間隔／簡易VADの2方式を共通インターフェースの下に統一）
  - [x] `lib/storage/commitStrategyStore.ts`で選択を永続化（`apiKeyStore.ts`と同パターン）
  - [x] `lib/messaging/protocol.ts`の`START_CAPTURE`に`commitStrategy`フィールドを追加
  - [x] `background.ts`が保存済みの選択を読み取り`START_CAPTURE`に含める。`offscreen/main.ts`が選択に応じたストラテジーを生成して使用
  - [x] サイドパネルにドロップダウンUIを追加（同一音源での比較用）
  - [ ] 手動確認: 同じ音源で両方式を試し、簡易VADの方が文の途中で切れにくいか比較する
- [x] **13. 文字起こしのコピー機能（MVPのAcceptance Criteria外の追加作業）**
  - [x] `lib/transcript/transcriptStore.ts`に`transcriptStateToText()`をTDDで追加（確定セグメント+進行中テキストをプレーンテキスト化）
  - [x] サイドパネルに「Copy transcript」ボタンを追加。`navigator.clipboard.writeText()`でコピーし、「Copied」の一時表示でフィードバック。文字起こしが空の間はボタンを無効化
  - [ ] 手動確認: コピーしたテキストを実際に貼り付けて内容が正しいか確認

## 補足

- この環境にはブラウザ自動操作ツールが存在しないため、Chromeでの手動確認はプロジェクトオーナーが行う。Claudeはタスクごとに毎回確認を依頼するのではなく、チェックポイントをまとめて依頼する。
- 完了時に報告する既知の限界事項: 未検証の生キーによるWebSocket認証、切断時の自動再接続なし、セッションをまたいだ永続化なし（意図的な設計）、プレースホルダーアイコン、リサンプリング品質の影響が未検証であること。
