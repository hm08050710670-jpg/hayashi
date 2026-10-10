interface Props {
  /** 初回は「確認して始める」、設定から開いたときは「閉じる」 */
  firstTime: boolean;
  onAccept: () => void;
}

export function Notice({ firstTime, onAccept }: Props) {
  return (
    <div className="screen">
      <header className="bar">
        <span className="brand">GOLF ESCAPE AI</span>
        <span className="tag">試作版</span>
      </header>
      <div className="scroll pad">
        <h1 className="title">ご利用の前に</h1>

        <section className="note">
          <h2>用途</h2>
          <p>
            このアプリは、練習・レッスン・ラウンド後の振り返りのためのものです。林の写真から、木の間を通過できそうな方向と、その推定確率を表示します。
          </p>
        </section>

        <section className="note">
          <h2>ゴルフ規則について</h2>
          <p>
            競技やスコアを提出するラウンドの最中に、現在のボール位置にもとづくプレーの線などの助言を機器から得ることは、ゴルフ規則（規則4.3
            用具の使用）で認められない場合があります。競技で使う前に、競技委員会やクラブに確認してください。
          </p>
        </section>

        <section className="note">
          <h2>安全について</h2>
          <p>
            カメラを向ける前とショットの前に、周囲の人、カート、ほかのプレーヤー、コース管理車両を必ず自分の目で確認してください。前方に人がいる、または安全を確認できないときは、ルートを表示しません。
          </p>
        </section>

        <section className="note">
          <h2>表示される確率について</h2>
          <p>
            推定確率は、スコア帯ごとの仮のばらつきを使って計算した試算で、実測データによる検証はまだ行っていません。ショットの成功を保証するものではありません。写真に写っていない範囲の障害物は判定できません。
          </p>
        </section>

        <section className="note">
          <h2>写真の扱い</h2>
          <p>撮影した写真は、この端末の中だけで処理します。サーバーへ送信しません。</p>
        </section>
      </div>
      <footer className="actions">
        <button type="button" className="btn primary" onClick={onAccept}>
          {firstTime ? '確認して始める' : '閉じる'}
        </button>
      </footer>
    </div>
  );
}
