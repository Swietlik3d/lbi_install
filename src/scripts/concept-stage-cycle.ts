/** One three-second clock per page, with a fresh interval after a manual choice. */
export function createStageCycle(advance: () => void) {
  let timer: number | undefined;
  let suspended = false;
  let disposed = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function stop() {
    window.clearTimeout(timer);
    timer = undefined;
  }

  function restart() {
    stop();
    if (disposed || suspended || document.hidden || reducedMotion.matches) return;
    timer = window.setTimeout(() => {
      advance();
      restart();
    }, 3000);
  }

  const onPageHide = () => { suspended = true; stop(); };
  const onPageShow = () => { suspended = false; restart(); };
  document.addEventListener("visibilitychange", restart);
  reducedMotion.addEventListener("change", restart);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  restart();

  return {
    restart,
    dispose() {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", restart);
      reducedMotion.removeEventListener("change", restart);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    },
  };
}
