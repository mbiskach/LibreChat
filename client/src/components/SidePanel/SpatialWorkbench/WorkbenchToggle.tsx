import React from 'react';
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
