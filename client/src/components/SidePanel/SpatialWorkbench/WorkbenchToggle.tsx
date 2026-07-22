import React, { useEffect, useRef } from 'react';
import { Boxes } from 'lucide-react';
import { useRecoilState } from 'recoil';
import { useLocalize } from '~/hooks';
import { useAuthContext } from '~/hooks/AuthContext';
import { cn } from '~/utils';
import { workbenchVisibleState } from './workbenchStore';
import { sideChannelBase, sideChannelFetch } from './sideChannel';

/** Header button: opens the Spatial Workbench in the wide split. */
export default function WorkbenchToggle() {
  const localize = useLocalize();
  const [visible, setVisible] = useRecoilState(workbenchVisibleState);
  const label = localize('com_sidepanel_workbench');
  // the relay proxy is JWT-authed; keep the latest token in a ref so the poll
  // interval always sends a fresh Bearer (tokens rotate on refresh).
  const { token } = useAuthContext();
  const tokenRef = useRef<string | undefined>(token);
  tokenRef.current = token;

  // auto-open: this button is always mounted in a conversation, so it
  // watches the tool side-channel and opens the workbench when NEW
  // geometry is published (a fresh tool call) - geometry that existed
  // before the page loaded does not pop the panel uninvited
  useEffect(() => {
    const base = sideChannelBase();
    let last: number | null = null;
    let sawEmpty = false;
    const iv = setInterval(async () => {
      try {
        const r = await sideChannelFetch(`${base}/latest.json`, tokenRef.current);
        if (!r.ok) {
          return;
        }
        const j = await r.json();
        if (!j.stamp) {
          // channel confirmed EMPTY: the next stamp to appear is NEW
          // geometry, not pre-existing (the take-2 lesson: baselining
          // the first-ever publish swallowed the auto-open)
          sawEmpty = true;
          return;
        }
        if (last === null) {
          last = j.stamp;
          if (sawEmpty) {
            setVisible(true); // first publish since we started watching
          }
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
