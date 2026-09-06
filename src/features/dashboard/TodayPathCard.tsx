import type { TodayPath, TodayStep } from '../../domain/todayPath';

const KIND_VERB: Record<TodayStep['kind'], string> = {
  review: '解く',
  lesson: '学ぶ',
  official: '確かめる',
};

/**
 * ホームの最上部。**今日やることを、順番どおりに1枚で見せる。**
 *
 * 押す場所を1つに絞るのが目的なので、大きなボタンは「いまここ」の1件にしか出さない。
 * ただし各行も押せるようにしてある(順番を無視したい日のため)。
 * 行は静かな見た目にして、勧めている1件が画面から一目で分かる状態を崩さない。
 *
 * 「1件やれば今日は勝ち」は既存の方針なので残す。ただし**残りを隠さない**。
 * 隠すと「次に何があるか」が消えて、本人の元の不満(どれから始めるか分からない)へ戻る。
 */
export function TodayPathCard({
  path,
  budget,
  onBudget,
  onStart,
  gap,
  comebacks,
}: {
  path: TodayPath;
  budget: 10 | 30 | 60;
  onBudget: (m: 10 | 30 | 60) => void;
  onStart: (step: TodayStep) => void;
  gap?: number;
  comebacks: number;
}) {
  const current = path.currentIndex !== undefined ? path.steps[path.currentIndex] : undefined;

  return (
    <section className="today" aria-label="今日やること">
      <p className="today__kicker">きょうの道のり</p>

      {gap !== undefined && gap >= 3 && (
        <p className="today__comeback">
          {gap}日ぶり。おかえり！ 戻ってきた時点で、もう1歩前進。復帰はこれで{comebacks + 1}回目。
        </p>
      )}

      <ol className="today__steps">
        {path.steps.map((step, i) => {
          const state = step.done ? 'is-done' : i === path.currentIndex ? 'is-now' : 'is-later';
          return (
            <li key={step.kind}>
              <button
                type="button"
                className={`today__step ${state}`}
                onClick={() => onStart(step)}
              >
                <span className="today__num" aria-hidden="true">{step.done ? '✓' : i + 1}</span>
                <span className="today__body">
                  <strong>{step.title}</strong>
                  <span className="today__detail">{step.detail}</span>
                  {step.note && <span className="today__note-inline">{step.note}</span>}
                  <span className="today__meta">
                    約{step.minutes}分 · {KIND_VERB[step.kind]}
                    {step.done ? ' · 今日はクリア' : i === path.currentIndex ? ' · いまここ' : ' · このあと'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {current ? (
        <>
          <button className="today__start" type="button" onClick={() => onStart(current)}>
            今日のぶんを始める <span aria-hidden="true">→</span>
          </button>
          <p className="today__note">
            {path.clearedToday ? (
              <>
                今日のぶんは<strong>もうクリア</strong>。ここから先はおかわり。やめても記録は減りません。
              </>
            ) : (
              <>
                上から順にやるだけでOK。<strong>1つ終われば今日はクリア。</strong>
                途中でやめても、そこまでの記録は残ります。
              </>
            )}
          </p>
        </>
      ) : (
        <div className="today__done">
          <strong>今日のぶんは終わり。おつかれさま。</strong>
          <p>1つ進めた時点で今日の勝ち。続きは明日の自分に任せてOK。</p>
        </div>
      )}

      <div className="today__budget">
        <span>今日つかえる時間</span>
        <div role="group" aria-label="今日つかえる時間">
          {([10, 30, 60] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={m === budget ? 'is-on' : undefined}
              aria-pressed={m === budget}
              onClick={() => onBudget(m)}
            >
              {m}分
            </button>
          ))}
        </div>
        <small>迷ったら30分のままでOK。教材の長さがこれに合わせて変わります。</small>
      </div>
    </section>
  );
}
