import React, { useEffect } from 'react';
import { Boxes } from 'lucide-react';
import { useRecoilState } from 'recoil';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import { workbenchVisibleState } from './workbenchStore';

/** Header button: opens the Spatial Workbench in the wide split. */
export default function WorkbenchToggle() {
  const localize = useLocalize();
  const [visible, setVisible] = useRecoilState(workbenchVisibleState);
  const label = localize('com_sidepanel_workbench');

  // auto-open: this button is always mounted in a conversation, so it
  // watches the tool side-channel and opens the workbench when NEW
  // geometry is published (a fresh tool call) - geometry that existed
  // before the page loaded does not pop the panel uninvited
  useEffect(() => {
    const port = window.localStorage.getItem('truss_gltf_port') ?? '8714';
    let last: number | null = null;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/latest.json`);
        if (!r.ok) {
          return;
        }
        const j = await r.json();
        if (!j.stamp) {
          return;
        }
        if (last === null) {
          last = j.stamp; // baseline: pre-existing geometry stays quiet
          return;
        }
        if (j.stamp !== last) {
          last = j.stamp;
          setVisible(true);
        }
      } catch {
        /* tool server not running */
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [setVisible]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={visible}
      onClick={() => setVisible(!visible)}
      className={cn(
        'flex items-center justify-center rounded-xl p-2 transition-colors hover:bg-surface-hover',
        visible ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary',
      )}
    >
      <Boxes size={18} />
    </button>
  );
}
