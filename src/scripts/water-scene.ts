import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  PMREMGenerator,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** A self-contained procedural illustration: no model, texture, or CDN requests. */
export function createWaterScene(host: HTMLElement, initiallyPaused: boolean) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 600 ? 1.25 : 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = .94;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const room = new RoomEnvironment();
  const environmentGenerator = new PMREMGenerator(renderer);
  const environmentTarget = environmentGenerator.fromScene(room, .04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 1.3;
  room.dispose();
  environmentGenerator.dispose();

  const camera = new OrthographicCamera(-4, 4, 4, -4, .1, 60);
  camera.position.set(5.7, 4.2, 9.3);
  camera.lookAt(.05, .15, 0);

  scene.add(new AmbientLight(0xf0fff8, .8));
  scene.add(new HemisphereLight(0xf3fdff, 0x547c72, 1.3));
  const key = new DirectionalLight(0xfffaf0, 3.2);
  key.position.set(-3, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.normalBias = .025;
  key.shadow.bias = -.0001;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new DirectionalLight(0x9bd8e7, 3);
  rim.position.set(5, 4, -5);
  scene.add(rim);

  const assembly = new Group();
  assembly.rotation.y = -.24;
  scene.add(assembly);

  const chrome = new MeshStandardMaterial({ color: 0xb4c3c5, metalness: .92, roughness: .22 });
  const edgeMetal = new MeshStandardMaterial({ color: 0xdce6e4, metalness: .86, roughness: .17 });
  const darkMetal = new MeshStandardMaterial({ color: 0x3f595c, metalness: .83, roughness: .32 });
  const rubber = new MeshStandardMaterial({ color: 0x203b3d, metalness: .15, roughness: .75 });
  const orange = new MeshStandardMaterial({ color: 0xe9744a, metalness: .3, roughness: .28 });
  const repairMaterial = new MeshStandardMaterial({ color: 0x549687, metalness: .75, roughness: .25 });
  const water = new MeshPhysicalMaterial({
    color: 0x35a8cf,
    metalness: .05,
    roughness: .08,
    transmission: .5,
    thickness: .35,
    ior: 1.333,
    clearcoat: 1,
    clearcoatRoughness: .08,
    attenuationColor: new Color(0x58b8d3),
    attenuationDistance: 1.7,
  });

  function mesh(geometry: ConstructorParameters<typeof Mesh>[0], material: ConstructorParameters<typeof Mesh>[1], parent: Group | Scene = assembly) {
    const result = new Mesh(geometry, material);
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }

  function pipe(points: Vector3[]) {
    return mesh(new TubeGeometry(new CatmullRomCurve3(points), 84, .255, 32, false), chrome);
  }

  // Left elbow and straight segment, separated from the right segment by a damaged joint.
  pipe([
    new Vector3(-2.55, -.8, 0), new Vector3(-2.55, .52, 0),
    new Vector3(-2.48, .89, 0), new Vector3(-2.22, 1.1, 0),
    new Vector3(-1.82, 1.14, 0), new Vector3(-.24, 1.14, 0),
  ]);
  pipe([
    new Vector3(.23, 1.14, 0), new Vector3(1.87, 1.14, 0),
    new Vector3(2.22, 1.09, 0), new Vector3(2.48, .86, 0),
    new Vector3(2.55, .5, 0), new Vector3(2.55, -.65, 0),
  ]);

  function cylinder(radius: number, length: number, x: number, y: number, material = chrome, horizontal = true, sides = 48) {
    const result = mesh(new CylinderGeometry(radius, radius, length, sides), material);
    result.position.set(x, y, 0);
    if (horizontal) result.rotation.z = Math.PI / 2;
    return result;
  }

  function ring(radius: number, thickness: number, x: number, y: number, horizontal = true, material = edgeMetal) {
    const result = mesh(new TorusGeometry(radius, thickness, 10, 48), material);
    result.position.set(x, y, 0);
    if (horizontal) result.rotation.y = Math.PI / 2;
    else result.rotation.x = Math.PI / 2;
    return result;
  }

  // Machined collars, hexagonal nuts and visible thread rings catch the studio light.
  [-1.78, -.3, .32, 1.85].forEach(x => {
    cylinder(.324, .19, x, 1.14, edgeMetal, true, 6);
    ring(.293, .027, x - .12, 1.14);
    ring(.293, .027, x + .12, 1.14);
  });
  [-2.55, 2.55].forEach(x => {
    cylinder(.33, .23, x, -.47, edgeMetal, false, 6);
    ring(.302, .025, x, -.31, false);
    ring(.302, .025, x, -.62, false);
    cylinder(.225, .013, x, x < 0 ? -.805 : -.66, rubber, false);
    for (let i = 0; i < 5; i++) ring(.26, .014, x, -.69 + i * .045, false);
  });
  for (let i = 0; i < 5; i++) {
    ring(.26, .012, -.48 - i * .044, 1.14);
    ring(.26, .012, .5 + i * .044, 1.14);
  }
  cylinder(.219, .022, -.131, 1.14, rubber);
  cylinder(.219, .022, .125, 1.14, rubber);
  ring(.25, .03, -.125, 1.14, true, darkMetal);
  ring(.25, .03, .13, 1.14, true, darkMetal);

  // A compact valve body with an orange handwheel, linked to the second step.
  cylinder(.34, .6, -1.08, 1.14, darkMetal);
  ring(.34, .04, -.75, 1.14);
  ring(.34, .04, -1.42, 1.14);
  cylinder(.15, .4, -1.08, 1.52, edgeMetal, false, 6);
  cylinder(.082, .34, -1.08, 1.83, chrome, false);
  const wheel = new Group();
  wheel.position.set(-1.08, 2.04, 0);
  assembly.add(wheel);
  const wheelRim = mesh(new TorusGeometry(.49, .06, 14, 64), orange, wheel);
  wheelRim.rotation.x = Math.PI / 2;
  const hub = mesh(new CylinderGeometry(.12, .12, .12, 24), orange, wheel);
  hub.position.y = 0;
  for (let i = 0; i < 3; i++) {
    const spoke = mesh(new BoxGeometry(.9, .055, .065), orange, wheel);
    spoke.rotation.y = (Math.PI * i) / 3;
  }
  const valveScrew = mesh(new CylinderGeometry(.064, .064, .14, 6), edgeMetal, wheel);
  valveScrew.position.y = .025;

  // The final step introduces a real coupling, closing the damaged joint.
  const coupling = new Group();
  coupling.position.set(0, 1.14, 0);
  assembly.add(coupling);
  const repairBody = mesh(new CylinderGeometry(.35, .35, .8, 48), repairMaterial, coupling);
  repairBody.rotation.z = Math.PI / 2;
  [-.37, .37].forEach(x => {
    const end = mesh(new CylinderGeometry(.39, .39, .11, 6), edgeMetal, coupling);
    end.rotation.z = Math.PI / 2;
    end.position.x = x;
    const seal = mesh(new TorusGeometry(.35, .018, 8, 48), rubber, coupling);
    seal.rotation.y = Math.PI / 2;
    seal.position.x = x * .73;
  });
  coupling.visible = false;

  // The puddle and ripples sit on a softly lit porcelain plinth.
  const floor = mesh(new CylinderGeometry(3.5, 3.5, .14, 100), new MeshStandardMaterial({ color: 0xdce8de, roughness: .5, metalness: .05 }));
  floor.position.y = -1.62;
  floor.castShadow = false;
  const baseRim = ring(3.48, .018, 0, -1.55, false, new MeshStandardMaterial({ color: 0xe9f1e7, roughness: .4 }));
  baseRim.castShadow = false;

  const puddleMaterial = new MeshPhysicalMaterial({ color: 0x84bfc4, metalness: .12, roughness: .15, transparent: true, opacity: .36, clearcoat: 1, side: DoubleSide, depthWrite: false });
  const puddle = mesh(new CircleGeometry(1.32, 80), puddleMaterial);
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(.04, -1.54, .29);
  puddle.scale.set(1.05, .79, 1);
  puddle.castShadow = false;
  const ripples = Array.from({ length: 4 }, () => {
    const ripple = mesh(new RingGeometry(.89, .907, 72), new MeshBasicMaterial({ color: 0xe9ffff, transparent: true, opacity: .6, side: DoubleSide, depthWrite: false }));
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(.04, -1.529, .28);
    ripple.castShadow = false;
    return ripple;
  });

  // An irregular glass-like stream is sculpted from overlapping, refractive beads.
  const stream = new Group();
  assembly.add(stream);
  const streamCurve = new CatmullRomCurve3([
    new Vector3(0, 1.08, .1), new Vector3(.01, .86, .15),
    new Vector3(-.02, .57, .19), new Vector3(.025, .25, .24),
    new Vector3(-.015, -.05, .29), new Vector3(.01, -.48, .33),
  ]);
  const streamCore = mesh(new TubeGeometry(streamCurve, 32, .057, 12, false), water, stream);
  streamCore.castShadow = false;
  const beadGeometry = new SphereGeometry(1, 18, 12);
  const beads = Array.from({ length: 20 }, (_, i) => {
    const bead = mesh(beadGeometry, water, stream);
    const ratio = i / 19;
    bead.position.set(Math.sin(i * .73) * .042, .97 - ratio * 1.45, .13 + ratio * .2);
    const radius = .088 - ratio * .036 + Math.sin(i * 1.8) * .013;
    bead.scale.set(radius, .105, radius);
    bead.castShadow = false;
    return bead;
  });

  const dropletCount = window.innerWidth < 600 ? 27 : 48;
  const droplets = new InstancedMesh(new SphereGeometry(1, 12, 8), water, dropletCount);
  assembly.add(droplets);
  const dropletObject = new Object3D();
  // Fixed seeds give the still illustration the same composition on every device.
  const seeds = Array.from({ length: dropletCount }, (_, index) => {
    const fract = (value: number) => value - Math.floor(value);
    return { offset: index / dropletCount, spread: fract(Math.sin(index * 97.1 + 4) * 43758.5), speed: fract(Math.sin(index * 51.7 + 8) * 17375.7), size: .023 + fract(Math.sin(index * 5.9 + 1) * 8598) * .041 };
  });
  droplets.frustumCulled = false;

  let stage = 0;
  let stageBlend = 0;
  let leakStrength = 1;
  let paused = initiallyPaused;
  let visible = true;
  let disposed = false;
  let contextLost = false;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 1.8;
  let pointerX = 0;
  let pointerY = 0;

  function renderScene(delta: number) {
    const snap = paused;
    const amount = snap ? 1 : 1 - Math.exp(-delta * 4.2);
    stageBlend = MathUtils.lerp(stageBlend, stage, amount);
    leakStrength = MathUtils.lerp(leakStrength, stage === 0 ? 1 : 0, amount);
    wheel.rotation.y = -Math.min(stageBlend, 1) * Math.PI * 1.8;
    wheel.position.y = 2.04 - Math.min(stageBlend, 1) * .07;

    coupling.visible = stageBlend > 1.025;
    const repairProgress = MathUtils.clamp(stageBlend - 1, 0, 1);
    coupling.scale.setScalar(.92 + repairProgress * .08);
    coupling.position.y = 1.14 + (1 - repairProgress) * .65;
    coupling.rotation.x = (1 - repairProgress) * .55;

    assembly.rotation.y = MathUtils.lerp(assembly.rotation.y, -.24 + (paused ? 0 : pointerX * .095), paused ? 1 : .035);
    assembly.rotation.x = MathUtils.lerp(assembly.rotation.x, paused ? 0 : pointerY * .022, paused ? 1 : .035);
    stream.visible = leakStrength > .045;
    stream.scale.x = leakStrength;
    stream.scale.z = leakStrength;
    droplets.visible = leakStrength > .025;
    beads.forEach((bead, i) => {
      bead.position.x = Math.sin(elapsed * 3.1 + i * .74) * .035;
      bead.scale.x = .088 - i / 19 * .036 + Math.sin(elapsed * 4 + i * 1.2) * .013;
      bead.scale.z = bead.scale.x;
    });
    seeds.forEach((seed, i) => {
      const life = (elapsed * (.45 + seed.speed * .25) + seed.offset) % 1;
      const angle = seed.spread * Math.PI * 2;
      const radial = life * (.4 + seed.speed * .7);
      dropletObject.position.set(Math.cos(angle) * radial, .86 - 2.33 * life * life, .2 + Math.sin(angle) * radial * .65);
      const scale = seed.size * leakStrength * Math.min(1, life * 8 + .2);
      dropletObject.scale.set(scale, scale * (1.25 + life * .9), scale);
      dropletObject.rotation.z = -Math.cos(angle) * life * .55;
      dropletObject.updateMatrix();
      droplets.setMatrixAt(i, dropletObject.matrix);
    });
    droplets.instanceMatrix.needsUpdate = true;
    ripples.forEach((ripple, index) => {
      const progress = (elapsed * .46 + index / ripples.length) % 1;
      ripple.scale.setScalar(.1 + progress * 1.23);
      (ripple.material as MeshBasicMaterial).opacity = (1 - progress) * .52 * leakStrength;
    });
    puddleMaterial.opacity = .22 + leakStrength * .16;
    renderer.render(scene, camera);
  }

  function tick(time: number) {
    frame = 0;
    if (disposed || contextLost || paused || !visible || document.hidden) return;
    const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : .016;
    lastTime = time;
    elapsed += delta;
    renderScene(delta);
    frame = requestAnimationFrame(tick);
  }

  function schedule() {
    if (disposed || contextLost) return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (paused) renderScene(0);
    else if (visible && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function resize() {
    if (disposed || contextLost) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const halfHeight = Math.max(3.35, 3.65 / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderScene(0);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibilityObserver = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    schedule();
  }, { threshold: .02 });
  visibilityObserver.observe(host);
  const onVisibility = () => schedule();
  document.addEventListener("visibilitychange", onVisibility);

  const onPointerMove = (event: PointerEvent) => {
    if (paused || event.pointerType !== "mouse") return;
    const bounds = host.getBoundingClientRect();
    pointerX = (event.clientX - bounds.left) / bounds.width - .5;
    pointerY = (event.clientY - bounds.top) / bounds.height - .5;
  };
  const onPointerLeave = () => { pointerX = 0; pointerY = 0; };
  host.addEventListener("pointermove", onPointerMove, { passive: true });
  host.addEventListener("pointerleave", onPointerLeave);

  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const visual = host.closest<HTMLElement>("[data-water-visual]");
    if (visual) visual.dataset.renderer = "fallback";
  };
  const onContextRestored = () => {
    contextLost = false;
    resize();
    schedule();
    const visual = host.closest<HTMLElement>("[data-water-visual]");
    if (visual) visual.dataset.renderer = "ready";
  };
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
  resize();
  schedule();

  return {
    setStage(next: number) { stage = next; if (paused) renderScene(0); },
    setPaused(next: boolean) { paused = next; schedule(); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      const geometries = new Set<NonNullable<Mesh["geometry"]>>();
      const materials = new Set<Material>();
      scene.traverse(object => {
        if (!(object instanceof Mesh)) return;
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(material => materials.add(material));
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      environmentTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
