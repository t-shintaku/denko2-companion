import { URGENCY_LABEL, sortByUrgency, type ResolvedAdminTask } from '../../domain/adminTasks';
import { formatJstDateTime } from '../../domain/jst';
import { repo } from '../../db/repo';
import { useVault } from '../../state/VaultContext';

function badgeClass(task: ResolvedAdminTask): string {
  switch (task.urgency) {
    case 'overdue':
    case 'due-1':
      return 'badge badge--danger';
    case 'due-3':
    case 'due-7':
    case 'open-now':
      return 'badge badge--warn';
    case 'done':
      return 'badge badge--ok';
    default:
      return 'badge';
  }
}

export function AdminTaskRow({ task }: { task: ResolvedAdminTask }) {
  const { reload } = useVault();
  const toggle = async () => {
    await repo.setAdminTaskDone(task.template.id, !task.doneAt);
    await reload();
  };

  return (
    <div className="card">
      <div className="row row--between">
        <strong>{task.template.title}</strong>
        {/* 色だけで状態を出さない。必ずテキストを添える(§13) */}
        <span className={badgeClass(task)}>{URGENCY_LABEL[task.urgency]}</span>
      </div>
      <p className="muted">{task.template.description}</p>
      <ul className="plain muted">
        {task.opensAt && <li>受付開始: {formatJstDateTime(task.opensAt)}</li>}
        <li>
          期限: {task.dueAt ? formatJstDateTime(task.dueAt) : '未設定'}
          {task.dueSource === 'official' && ' (公式)'}
          {task.dueSource === 'derived' && ' (本ツールの推定)'}
          {task.dueSource === 'user' && ' (自分で入力)'}
          {task.daysLeft !== undefined && ` — あと${task.daysLeft}日`}
        </li>
      </ul>
      {task.needsUserConfirm && (
        <p className="notice">
          {task.confirmNote ??
            'この期限は受験日から逆算した目安。公式でチェックして、設定で日付を更新しよう。'}
        </p>
      )}
      <div className="row">
        {task.template.officialUrl && (
          <a className="btn btn-sm" href={task.template.officialUrl} target="_blank" rel="noreferrer">
            公式でチェック
          </a>
        )}
        <button className={task.doneAt ? 'btn-sm' : 'btn-primary btn-sm'} onClick={toggle}>
          {task.doneAt ? '未完了に戻す' : 'できた！'}
        </button>
      </div>
    </div>
  );
}

export function AdminTaskList({ tasks }: { tasks: ResolvedAdminTask[] }) {
  const visible = sortByUrgency(tasks.filter((t) => t.applicable));
  return (
    <div>
      {visible.map((task) => (
        <AdminTaskRow key={task.template.id} task={task} />
      ))}
    </div>
  );
}
