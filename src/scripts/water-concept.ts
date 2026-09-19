import { createStageCycle } from "./concept-stage-cycle";

type WaterScene = {
  setStage: (stage: number) => void;
  dispose: () => void;
};

export function initWaterConcept() {
  const visual = document.querySelector<HTMLElement>("[data-water-visual]");
  const host = document.querySelector<HTMLElement>("[data-water-scene]");
  if (!visual || !host) return;

  const stages = document.querySelectorAll<HTMLButtonElement>("[data-water-stage]");
  const stageControls = document.querySelector<HTMLElement>(".water-stages");
  if (stageControls) stageControls.hidden = false;
  const label = document.querySelector<HTMLElement>("[data-scene-label]");
  const caption = document.querySelector<HTMLElement>("[data-scene-caption]");
  const status = document.querySelector<HTMLElement>("[data-water-status]");
  const descriptions = [
    { label: "Bij de bron beginnen.", caption: "Een kleine lekkage verdient aandacht.", status: "Opsporen: we zoeken waar de leiding lekt." },
    { label: "Het water onder controle.", caption: "De watertoevoer wordt afgesloten.", status: "Afsluiten: de kraan draait dicht en het water stopt." },
    { label: "Weer zoals het hoort.", caption: "De verbinding is hersteld en gecontroleerd.", status: "Herstellen: de koppeling is gerepareerd. De leiding is weer dicht." },
  ];

  let stage = 0;
  let scene: WaterScene | undefined;
  let disposed = false;

  function setStage(next: number, announce = false) {
    if (!Number.isInteger(next) || next < 0 || next >= descriptions.length) return;
    stage = next;
    visual!.dataset.stage = String(stage);
    stages.forEach(item => item.setAttribute("aria-pressed", String(Number(item.dataset.waterStage) === stage)));
    const description = descriptions[stage];
    if (label) label.textContent = description.label;
    if (caption) caption.textContent = description.caption;
    // The automatic loop should not speak over someone reading the page.
    if (status) status.textContent = announce ? description.status : "";
    host!.setAttribute("aria-label", description.status);
    scene?.setStage(stage);
  }

  const cycle = createStageCycle(() => setStage((stage + 1) % descriptions.length));

  stages.forEach(button => {
    button.addEventListener("click", () => {
      setStage(Number(button.dataset.waterStage), true);
      cycle.restart();
    });
  });

  // Content and contact links are ready before the optional WebGL enhancement.
  import("./water-scene")
    .then(({ createWaterScene }) => {
      if (disposed) return;
      scene = createWaterScene(host, false);
      scene.setStage(stage);
      visual.dataset.renderer = "ready";
    })
    .catch(() => {
      visual.dataset.renderer = "fallback";
    });

  // Do not destroy a page that is being stored in the back/forward cache.
  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) return;
    disposed = true;
    cycle.dispose();
    scene?.dispose();
    window.removeEventListener("pagehide", onPageHide);
  };
  window.addEventListener("pagehide", onPageHide);
}
