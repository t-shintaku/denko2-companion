/**
 * 事務期限のカレンダー出力(FR-002 の ICS 出力)。
 *
 * このアプリは開かなければ何も言わない。申込みを落とさないという完成条件に対して、
 * 「毎日アプリを開く」を前提にするのは弱い。期限だけはスマホの標準カレンダーへ移す。
 */

import type { ResolvedAdminTask } from './adminTasks';
import { nowJstIso } from './jst';

/** ISO8601(+09:00)を ICS の UTC 形式 20260817T010000Z へ */
export function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** 75オクテット折り返し。日本語があるので文字数ではなくバイト数で折る */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const chSize = new TextEncoder().encode(ch).length;
    if (size + chSize > 73) {
      out.push(current);
      current = ch;
      size = chSize;
    } else {
      current += ch;
      size += chSize;
    }
  }
  out.push(current);
  return out.join('\r\n ');
}

export function buildIcs(tasks: ResolvedAdminTask[], now: Date = new Date()): string {
  const stamp = toIcsUtc(nowJstIso(now));
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//denko2-companion//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:電工二種 手続き期限',
  ];

  for (const task of tasks) {
    if (!task.applicable || !task.dueAt || task.doneAt) continue;
    const sourceLabel =
      task.dueSource === 'official'
        ? '公式'
        : task.dueSource === 'user'
          ? '自分で入力'
          : '本ツールの推定';
    const description = [
      task.template.description,
      `期限の出どころ: ${sourceLabel}`,
      task.confirmNote ?? '',
      task.template.officialUrl ?? '',
    ]
      .filter(Boolean)
      .join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:denko2-${task.template.id}@denko2-companion`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsUtc(task.dueAt)}`,
      `DTEND:${toIcsUtc(task.dueAt)}`,
      fold(`SUMMARY:${escapeText(`【電工二種】${task.template.title}`)}`),
      fold(`DESCRIPTION:${escapeText(description)}`),
      // 7日前と前日に通知。アプリを開かなくても届く
      'BEGIN:VALARM',
      'TRIGGER:-P7D',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${escapeText(`7日後が期限: ${task.template.title}`)}`),
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${escapeText(`明日が期限: ${task.template.title}`)}`),
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function icsFileName(): string {
  return 'denko2-deadlines.ics';
}
