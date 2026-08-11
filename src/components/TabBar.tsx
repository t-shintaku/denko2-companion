export type TabId = 'home' | 'academic' | 'practical' | 'records' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'home', label: 'ホーム' },
  { id: 'academic', label: '学科' },
  { id: 'practical', label: '技能' },
  { id: 'records', label: '記録' },
  { id: 'settings', label: '設定' },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  return (
    <nav className="tabbar" aria-label="メインナビゲーション">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
