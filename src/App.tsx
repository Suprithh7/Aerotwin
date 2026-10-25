import { useEffect } from 'react';
import BriefStage from './components/rehearsal/BriefStage';
import FlyStage from './components/rehearsal/FlyStage';
import DebriefStage from './components/rehearsal/DebriefStage';
import EngineerOverlay from './components/rehearsal/EngineerOverlay';
import { useRehearsalStore } from './rehearsal/store';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

export default function App() {
  const stage = useRehearsalStore((s) => s.stage);
  const overlayOpen = useRehearsalStore((s) => s.overlayOpen);
  const setOverlay = useRehearsalStore((s) => s.setOverlay);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (useRehearsalStore.getState().overlayOpen) {
          e.preventDefault();
          useRehearsalStore.getState().setOverlay(false);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        const store = useRehearsalStore.getState();
        store.setOverlay(!store.overlayOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="h-full font-sans text-txt">
      {stage === 'brief' && <BriefStage />}
      {stage === 'fly' && <FlyStage />}
      {stage === 'debrief' && <DebriefStage />}
      {overlayOpen && <EngineerOverlay onClose={() => setOverlay(false)} />}
    </div>
  );
}
