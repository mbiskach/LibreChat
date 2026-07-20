import { atom } from 'recoil';

/**
 * Whether the Spatial Workbench occupies the wide conversation split
 * (the same resizable panel artifacts render in). Toggled by the
 * header button; deliberately conversation-global for the spike -
 * per-conversation scene state is the workbench service's job, not
 * the client's.
 */
export const workbenchVisibleState = atom<boolean>({
  key: 'workbenchVisible',
  default: false,
});
