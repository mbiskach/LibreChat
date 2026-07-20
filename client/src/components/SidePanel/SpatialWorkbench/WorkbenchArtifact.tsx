import React from 'react';
import { X } from 'lucide-react';
import { useSetRecoilState } from 'recoil';
import { useLocalize } from '~/hooks';
import WorkbenchPanel from './WorkbenchPanel';
import { workbenchVisibleState } from './workbenchStore';

/**
 * The Spatial Workbench as a conversation-level "super artifact": the
 * persistent 3D surface mounted in the same wide resizable split that
 * artifacts use, opened by its own header button rather than created
 * per message - a stable workspace, not a disposable output.
 */
export default function WorkbenchArtifact() {
  const localize = useLocalize();
  const setVisible = useSetRecoilState(workbenchVisibleState);
  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-border-medium bg-surface-primary">
      <div className="flex items-center justify-between border-b border-border-medium px-3 py-2">
        <span className="text-sm font-semibold text-text-primary">
          {localize('com_sidepanel_workbench')}
        </span>
        <button
          type="button"
          aria-label="close workbench"
          onClick={() => setVisible(false)}
          className="rounded p-1 text-text-secondary hover:bg-surface-hover"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <WorkbenchPanel />
      </div>
    </div>
  );
}
