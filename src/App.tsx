import { useState } from 'react';
import { TabBar, type TabId } from './components/TabBar';
import { getLesson } from './data';
import { HomePage } from './features/dashboard/HomePage';
import { AcademicPage } from './features/curriculum/AcademicPage';
import { LessonPage } from './features/curriculum/LessonPage';
import { PracticalPage } from './features/practical/PracticalPage';
import { RecordsPage } from './features/review/RecordsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { SetupWizard } from './features/onboarding/SetupWizard';
import { useVault } from './state/VaultContext';
import type { LessonMode } from './domain/types';

export default function App() {
  const { ready, settings, reload } = useVault();
  const [tab, setTab] = useState<TabId>('home');
  const [open, setOpen] = useState<{ lessonId: string; mode: LessonMode } | undefined>();

  if (!ready) {
    return (
      <main className="app">
        <p className="muted">読み込み中…</p>
      </main>
    );
  }

  if (!settings) {
    return <SetupWizard onDone={reload} />;
  }

  const openLesson = (lessonId: string, mode: LessonMode) => setOpen({ lessonId, mode });
  const lesson = open ? getLesson(open.lessonId) : undefined;

  if (open && lesson) {
    return (
      <LessonPage
        lesson={lesson}
        initialMode={open.mode}
        onClose={() => setOpen(undefined)}
      />
    );
  }

  return (
    <>
      {tab === 'home' && <HomePage onOpenLesson={openLesson} onGoTo={setTab} />}
      {tab === 'academic' && <AcademicPage onOpenLesson={openLesson} />}
      {tab === 'practical' && <PracticalPage onOpenLesson={openLesson} />}
      {tab === 'records' && <RecordsPage />}
      {tab === 'settings' && <SettingsPage />}
      <TabBar active={tab} onChange={setTab} />
    </>
  );
}
