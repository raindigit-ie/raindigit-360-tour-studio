import { mount, unmount } from "svelte";
import WalkingButtonList from "./WalkingButtonList.svelte";
import type { WalkingButtonListProps } from "./types";

let mounted: ReturnType<typeof mount> | null = null;
let mountedTarget: HTMLElement | null = null;

export function renderWalkingButtonList(target: HTMLElement, props: WalkingButtonListProps): void {
  if (mounted && mountedTarget === target) {
    unmount(mounted);
  } else if (mounted) {
    unmount(mounted);
  }
  target.replaceChildren();
  mounted = mount(WalkingButtonList, { target, props });
  mountedTarget = target;
}

export function clearWalkingButtonList(target: HTMLElement): void {
  if (mounted && mountedTarget === target) {
    unmount(mounted);
    mounted = null;
    mountedTarget = null;
  }
  target.replaceChildren();
}
