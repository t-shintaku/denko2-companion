export type TabId = 'home' | 'academic' | 'practical' | 'records' | 'settings';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'ホーム', icon: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5" /></> },
  { id: 'academic', label: '学科', icon: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22Z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22Z" /></> },
  { id: 'practical', label: '技能', icon: <><path d="m14.5 6.5 3-3 3 3-3 3" /><path d="m9.5 14.5-3 3-3-3 3-3" /><path d="M8 16 16 8" /><path d="m5 5 14 14" /></> },
  { id: 'records', label: '記録', icon: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></> },
  { id: 'settings', label: '設定', icon: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.4 6a8 8 0 0 0-1.6 1L6.4 6 4.5 9.5 6.6 11a7 7 0 0 0 0 2l-2.1 1.5 2 3.4 2.4-1A8 8 0 0 0 10.4 18l.3 2.6h4L15 18a8 8 0 0 0 1.6-1l2.4 1 2-3.4L18.9 13a7 7 0 0 0 .1-1Z" /></> },
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            {tab.icon}
          </svg>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
