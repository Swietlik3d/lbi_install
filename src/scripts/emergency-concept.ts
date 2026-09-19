import type { EmergencyKind } from "../config/emergency-concepts";
import { createStageCycle } from "./concept-stage-cycle";

type ConceptScene = { setStage: (stage: number) => void; dispose: () => void };

export function initEmergencyConcept() {
  const kind = document.body.dataset.emergencyKind as EmergencyKind | undefined;
  const visual = document.querySelector<HTMLElement>("[data-emergency-visual]");
  const host = document.querySelector<HTMLElement>("[data-emergency-scene]");
  if ((kind !== "gas" && kind !== "elektra") || !visual || !host) return;

  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-emergency-stage]");
  const controls = document.querySelector<HTMLElement>(".water-stages");
  const label = document.querySelector<HTMLElement>("[data-scene-label]");
  const caption = document.querySelector<HTMLElement>("[data-scene-caption]");
  const status = document.querySelector<HTMLElement>("[data-emergency-status]");
  let stage = 0;
  let disposed = false;
  let scene: ConceptScene | undefined;
  if (controls) controls.hidden = false;

  function setStage(next: number, announce = false) {
    if (!Number.isInteger(next) || next < 0 || next >= buttons.length) return;
    const button = buttons[next];
    stage = next;
    visual!.dataset.stage = String(stage);
    buttons.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    if (label) label.textContent = button.dataset.label ?? "";
    if (caption) caption.textContent = button.dataset.caption ?? "";
    if (status) status.textContent = announce ? button.dataset.announcement ?? "" : "";
    host!.setAttribute("aria-label", button.dataset.announcement ?? "");
    scene?.setStage(stage);
  }
  const cycle = createStageCycle(() => setStage((stage + 1) % buttons.length));
  buttons.forEach(button => button.addEventListener("click", () => {
    setStage(Number(button.dataset.emergencyStage), true);
    cycle.restart();
  }));

  import("./emergency-scene").then(({ createEmergencyScene }) => {
    if (disposed) return;
    scene = createEmergencyScene(host, kind, false);
    scene.setStage(stage);
    visual.dataset.renderer = "ready";
  }).catch(() => {
    visual.dataset.renderer = "fallback";
  });

  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) return;
    disposed = true;
    cycle.dispose();
    scene?.dispose();
    window.removeEventListener("pagehide", onPageHide);
  };
  window.addEventListener("pagehide", onPageHide);
}
