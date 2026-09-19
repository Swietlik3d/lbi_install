import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, CanvasTexture,
  CatmullRomCurve3, CircleGeometry, Color, CylinderGeometry, DirectionalLight,
  Group, HemisphereLight, MathUtils, Material, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, OrthographicCamera, PCFSoftShadowMap,
  PlaneGeometry, PMREMGenerator, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Texture,
  TorusGeometry, TubeGeometry, Vector3, WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { EmergencyKind } from "../config/emergency-concepts";

type ModelState = { stage: number; blend: number; time: number };
type Illustration = { update: (state: ModelState) => void };

function makeMesh(geometry: BufferGeometry, material: Material, parent: Group) {
  const object = new Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function box(width: number, height: number, depth: number, material: Material, parent: Group, x = 0, y = 0, z = 0, radius = .055) {
  const object = makeMesh(new RoundedBoxGeometry(width, height, depth, 3, radius), material, parent);
  object.position.set(x, y, z);
  return object;
}

function cylinder(radius: number, height: number, material: Material, parent: Group, x: number, y: number, z = 0, sides = 48) {
  const object = makeMesh(new CylinderGeometry(radius, radius, height, sides), material, parent);
  object.position.set(x, y, z);
  return object;
}

function pipe(points: number[][], radius: number, material: Material, parent: Group) {
  const curve = new CatmullRomCurve3(points.map(point => new Vector3(...point as [number, number, number])));
  return makeMesh(new TubeGeometry(curve, 64, radius, 20, false), material, parent);
}

function labelTexture(text: string, background: string, foreground: string, width = 512, height = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = foreground;
  ctx.font = `500 ${Math.round(height * .36)}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2, width * .87);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function label(text: string, width: number, height: number, x: number, y: number, z: number, parent: Group, background = "#ecece4", foreground = "#47525a") {
  const material = new MeshBasicMaterial({ map: labelTexture(text, background, foreground), toneMapped: false });
  const object = makeMesh(new PlaneGeometry(width, height), material, parent);
  object.position.set(x, y, z);
  object.castShadow = false;
  return object;
}

function createElectricModel(parent: Group): Illustration {
  const ivory = new MeshStandardMaterial({ color: 0xeeeadd, roughness: .35, metalness: .08 });
  const interior = new MeshStandardMaterial({ color: 0xc8cfcc, roughness: .38, metalness: .12 });
  const trim = new MeshStandardMaterial({ color: 0xf9f7ed, roughness: .23, metalness: .15 });
  const graphite = new MeshStandardMaterial({ color: 0x293944, roughness: .34, metalness: .36 });
  const steel = new MeshStandardMaterial({ color: 0xb4c2c1, roughness: .18, metalness: .92 });
  const brass = new MeshStandardMaterial({ color: 0xc69b52, roughness: .22, metalness: .76 });
  const darkCable = new MeshStandardMaterial({ color: 0x394b51, roughness: .6 });
  const goldCable = new MeshStandardMaterial({ color: 0xd7b56e, roughness: .48 });

  const enclosure = new Group();
  enclosure.position.set(-.83, .16, 0);
  enclosure.rotation.y = .035;
  parent.add(enclosure);
  box(3.12, 3.87, .6, interior, enclosure, 0, 0, 0, .15);
  box(2.9, 3.63, .24, ivory, enclosure, 0, 0, .33, .12);
  // A raised, closed surround: the model never exposes live conductors.
  box(3.08, .15, .18, trim, enclosure, 0, 1.83, .45, .05);
  box(3.08, .15, .18, trim, enclosure, 0, -1.83, .45, .05);
  box(.15, 3.56, .18, trim, enclosure, -1.46, 0, .45, .045);
  box(.15, 3.56, .18, trim, enclosure, 1.46, 0, .45, .045);
  box(2.51, .51, .1, graphite, enclosure, 0, 1.32, .48);
  label("LBI / ELEKTRA", 1.56, .23, -.25, 1.32, .537, enclosure, "#293944", "#e9ecdf");
  const ledMaterial = new MeshStandardMaterial({ color: 0xf0b657, emissive: 0xf0a73d, emissiveIntensity: .6, roughness: .28 });
  const led = makeMesh(new SphereGeometry(.056, 16, 12), ledMaterial, enclosure);
  led.position.set(1, 1.32, .55);

  const toggles: Group[] = [];
  const windows: MeshStandardMaterial[] = [];
  for (let i = 0; i < 4; i++) {
    const module = new Group();
    module.position.x = -.945 + i * .63;
    enclosure.add(module);
    box(.555, 1.6, .39, trim, module, 0, .18, .6);
    box(.43, .57, .045, interior, module, 0, .12, .818, .025);
    const toggle = new Group();
    toggle.position.set(0, .1, .88);
    module.add(toggle);
    box(.355, .19, .13, i === 1 ? brass : graphite, toggle, 0, 0, 0, .025);
    for (let ridge = 0; ridge < 3; ridge++) box(.28, .018, .015, i === 1 ? brass : graphite, toggle, 0, -.048 + ridge * .048, .075, .006);
    toggles.push(toggle);
    label(i === 0 ? "LBI" : `0${i}`, .33, .13, 0, .77, .81, module);
    label(i === 0 ? "MAIN" : "GROUP", .35, .12, 0, -.43, .81, module);
    const indicator = new MeshStandardMaterial({ color: i === 1 ? 0xc38d3b : 0x748e7c, roughness: .6 });
    box(.1, .06, .017, indicator, module, 0, .53, .818, .009);
    windows.push(indicator);
    const screw = cylinder(.048, .025, steel, module, 0, -.69, .819, 12);
    screw.rotation.x = Math.PI / 2;
    box(.049, .009, .005, graphite, module, 0, -.69, .836, .002);
  }

  box(2.54, .44, .09, ivory, enclosure, 0, -1.11, .48);
  const badges = [
    label("01  /  STORING", 1.79, .27, 0, -1.1, .532, enclosure, "#e5dfc9", "#8c672d"),
    label("02  /  CONTROLE", 1.79, .27, 0, -1.1, .533, enclosure, "#e1e7e5", "#52636a"),
    label("03  /  HERSTELD", 1.79, .27, 0, -1.1, .534, enclosure, "#dee8dc", "#466451"),
  ];
  for (const x of [-1.25, 1.25]) for (const y of [-1.57, 1.6]) {
    const screw = cylinder(.045, .025, steel, enclosure, x, y, .47, 12);
    screw.rotation.x = Math.PI / 2;
  }

  // An insulated cable leads to a separate display lamp.
  pipe([[-1.1, -1.6, .12], [-1.1, -1.92, .2], [-.2, -2, .8], [1.5, -2, .75], [2.02, -1.89, .32], [2.02, -1.58, .04]], .047, darkCable, parent);
  pipe([[-.74, -1.6, .12], [-.74, -1.88, -.13], [.3, -1.96, -.35], [1.63, -1.96, -.33], [2.15, -1.8, -.05]], .042, goldCable, parent);

  const lamp = new Group();
  lamp.position.set(2.06, -1.87, .05);
  parent.add(lamp);
  cylinder(.69, .18, graphite, lamp, 0, .02);
  cylinder(.58, .045, brass, lamp, 0, .125);
  cylinder(.2, .96, steel, lamp, 0, .65);
  cylinder(.34, .28, graphite, lamp, 0, 1.14);
  for (let i = 0; i < 6; i++) {
    const ring = makeMesh(new TorusGeometry(.245, .025, 10, 48), brass, lamp);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.28 + i * .047;
  }
  const neck = cylinder(.21, .21, trim, lamp, 0, 1.63);
  neck.castShadow = false;
  const bulbOffColor = new Color(0x8b806d);
  const bulbOnColor = new Color(0xffd793);
  const bulbMaterial = new MeshPhysicalMaterial({ color: bulbOffColor, roughness: .27, metalness: .06, transmission: .08, thickness: .3, clearcoat: .5, emissive: 0xffbd53, emissiveIntensity: 0 });
  const bulb = makeMesh(new SphereGeometry(.67, 40, 28), bulbMaterial, lamp);
  bulb.position.y = 2.2;
  bulb.scale.y = 1.11;
  const glowMaterial = new MeshBasicMaterial({ color: 0xffce74, transparent: true, opacity: 0, depthWrite: false });
  const glow = makeMesh(new SphereGeometry(.75, 28, 20), glowMaterial, lamp);
  glow.position.copy(bulb.position);
  glow.scale.y = 1.08;
  glow.castShadow = false;
  label("LBI / LIGHT", .89, .16, 0, .24, .41, lamp, "#293944", "#e2d5b5");

  const haloMaterial = new MeshBasicMaterial({ color: 0xe9b95a, transparent: true, opacity: .3 });
  const halo = makeMesh(new TorusGeometry(.73, .012, 8, 80), haloMaterial, parent);
  halo.position.set(2.06, .39, .05);
  halo.rotation.x = .48;
  const pulses = Array.from({ length: 6 }, (_, i) => {
    const material = new MeshBasicMaterial({ color: 0xf5ce77, transparent: true, opacity: .4 });
    const dot = makeMesh(new SphereGeometry(.028, 10, 8), material, parent);
    dot.castShadow = false;
    return { mesh: dot, phase: i / 6 };
  });

  return {
    update({ stage, blend, time }) {
      const isolation = stage === 0 ? 0 : Math.min(blend, 1);
      const restoration = MathUtils.clamp(blend - 1, 0, 1);
      toggles.forEach((toggle, index) => {
        const start = index === 1 ? -.14 : .16;
        toggle.position.y = MathUtils.lerp(MathUtils.lerp(start, -.16, isolation), .16, restoration);
        toggle.rotation.x = MathUtils.lerp(.25, -.25, (toggle.position.y + .16) / .32);
        windows[index].color.setHex(stage === 2 ? 0x6e9880 : stage === 1 ? 0x8f9692 : index === 1 ? 0xd7a049 : 0x718c7b);
      });
      ledMaterial.color.setHex(stage === 2 ? 0x77b391 : stage === 1 ? 0x8d9f9d : 0xe1b159);
      ledMaterial.emissive.setHex(stage === 2 ? 0x528866 : 0xd8a34e);
      ledMaterial.emissiveIntensity = stage === 1 ? .05 : .25 + Math.sin(time * 1.6) * .12;
      badges.forEach((badge,index) => badge.visible = index === stage);
      const faintGlow = (1 - isolation) * (.10 + Math.sin(time * 1.1) * .035);
      bulbMaterial.emissiveIntensity = MathUtils.lerp(faintGlow, .95 + Math.sin(time * .9) * .035, restoration);
      bulbMaterial.color.copy(bulbOffColor).lerp(bulbOnColor, restoration);
      glowMaterial.opacity = MathUtils.lerp(faintGlow * .12, .065, restoration);
      haloMaterial.opacity = stage === 2 ? .1 + Math.sin(time * 1.2) * .035 : .04;
      halo.rotation.y = time * .12;
      pulses.forEach(({mesh: dot,phase}) => {
        const angle = (time * .08 + phase) * Math.PI * 2;
        dot.position.set(2.06 + Math.cos(angle) * .85, .42 + Math.sin(angle) * .28, Math.sin(angle) * .4);
        dot.visible = stage === 2;
      });
    },
  };
}

function createGasModel(parent: Group): Illustration {
  const copper = new MeshStandardMaterial({ color: 0xc28b64, metalness: .87, roughness: .24 });
  const copperLight = new MeshStandardMaterial({ color: 0xe3b38c, metalness: .83, roughness: .19 });
  const brass = new MeshStandardMaterial({ color: 0xbc9656, metalness: .82, roughness: .26 });
  const steel = new MeshStandardMaterial({ color: 0xc0c8c3, metalness: .94, roughness: .17 });
  const graphite = new MeshStandardMaterial({ color: 0x554b42, metalness: .6, roughness: .35 });
  const yellow = new MeshStandardMaterial({ color: 0xe3b14e, metalness: .22, roughness: .29 });
  const rubber = new MeshStandardMaterial({ color: 0x564839, roughness: .66 });
  const green = new MeshStandardMaterial({ color: 0x829780, metalness: .48, roughness: .32 });

  pipe([[-2.6,-1.24,0],[-2.6,-.15,0],[-2.48,.19,0],[-2.16,.35,0],[-1.65,.37,0],[2.05,.37,0],[2.4,.2,0],[2.55,-.13,0],[2.55,-1.2,0]], .225, copper, parent);
  const collar = (x: number, radius = .285, width = .2, material: Material = brass) => {
    const result = cylinder(radius, width, material, parent, x, .37, 0, 6);
    result.rotation.z = Math.PI / 2;
    return result;
  };
  [-2.02, -1.35, -.65, -.15, .35, 1.78].forEach(x => collar(x));
  [-2.6, 2.55].forEach(x => {
    cylinder(.285,.22,brass,parent,x,-1.05,0,6);
    for (let i=0;i<5;i++) {
      const thread = makeMesh(new TorusGeometry(.223,.012,8,40),copperLight,parent);
      thread.rotation.x = Math.PI / 2;
      thread.position.set(x,-1.31 + i*.044,0);
    }
    cylinder(.18,.012,rubber,parent,x,-1.248);
  });
  const valveBody = cylinder(.34,.54,brass,parent,-1.02,.37);
  valveBody.rotation.z = Math.PI / 2;
  cylinder(.13,.32,brass,parent,-1.02,.71,0,6);
  const lever = new Group();
  lever.position.set(-1.02,.91,0);
  parent.add(lever);
  box(1.05,.095,.185,yellow,lever,.28,0,0,.06);
  cylinder(.065,.13,steel,lever,0,.035,0,6);
  box(.04,.01,.12,graphite,lever,.67,.056,0,.004);

  // A gauge is intentionally unnumbered: this is an illustration, never a live pressure reading.
  cylinder(.12,.53,brass,parent,.97,.73,0,6);
  const gauge = new Group();
  gauge.position.set(.97,1.55,.06);
  parent.add(gauge);
  const housing = cylinder(.7,.29,steel,gauge,0,0);
  housing.rotation.x = Math.PI / 2;
  const outer = makeMesh(new TorusGeometry(.645,.055,16,80),copperLight,gauge);
  outer.position.z = .15;

  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = faceCanvas.height = 512;
  const ctx = faceCanvas.getContext("2d")!;
  ctx.fillStyle = "#f6f1e5";
  ctx.fillRect(0,0,512,512);
  for(let i=0;i<=40;i++) {
    const angle = Math.PI * .75 + i/40*Math.PI*1.5;
    const inner = i%5===0 ? 166 : 182;
    ctx.strokeStyle = i>26 ? "#859779" : "#b79d7c";
    ctx.lineWidth = i%5===0 ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(256+Math.cos(angle)*inner,256+Math.sin(angle)*inner);
    ctx.lineTo(256+Math.cos(angle)*204,256+Math.sin(angle)*204);
    ctx.stroke();
  }
  ctx.fillStyle="#675a49"; ctx.textAlign="center";
  ctx.font='500 25px "Segoe UI",sans-serif'; ctx.fillText("LBI",256,175);
  ctx.font='400 17px "Segoe UI",sans-serif'; ctx.fillText("LEIDINGCONTROLE",256,345);
  const faceTexture = new CanvasTexture(faceCanvas); faceTexture.colorSpace = SRGBColorSpace;
  const face = makeMesh(new CircleGeometry(.605,80),new MeshBasicMaterial({map:faceTexture,toneMapped:false}),gauge);
  face.position.z = .17;
  face.castShadow = false;
  const needle = new Group(); needle.position.z=.2; gauge.add(needle);
  const arm = box(.024,.43,.018,graphite,needle,0,.17,0,.009);
  arm.castShadow = false;
  const pivot = cylinder(.061,.027,brass,gauge,0,0,.225,24); pivot.rotation.x=Math.PI/2;
  const glassMaterial = new MeshPhysicalMaterial({color:0xffffff,metalness:0,roughness:.08,transparent:true,opacity:.085,depthWrite:false,clearcoat:.3});
  const glass = makeMesh(new CircleGeometry(.617,80),glassMaterial,gauge);
  glass.position.z=.24; glass.castShadow=false;

  const repair = collar(.11,.292,.57,copperLight);
  const inspectionRingMaterial = new MeshBasicMaterial({color:0xe4ad6f,transparent:true,opacity:.52});
  const inspection = makeMesh(new TorusGeometry(.46,.014,10,64),inspectionRingMaterial,parent);
  inspection.rotation.y=Math.PI/2; inspection.position.set(.08,.37,0);
  inspection.castShadow=false;
  const orbit = makeMesh(new TorusGeometry(.63,.007,8,64),new MeshBasicMaterial({color:0xb89e7c,transparent:true,opacity:.2}),parent);
  orbit.rotation.y=Math.PI/2; orbit.position.copy(inspection.position); orbit.castShadow=false;

  // Soft, rising wisps illustrate the leak without obscuring the pipe or gauge.
  const vaporCanvas = document.createElement("canvas");
  vaporCanvas.width = vaporCanvas.height = 128;
  const vaporContext = vaporCanvas.getContext("2d")!;
  const vaporGradient = vaporContext.createRadialGradient(64, 64, 3, 64, 64, 64);
  vaporGradient.addColorStop(0, "rgba(255,255,255,.85)");
  vaporGradient.addColorStop(.32, "rgba(255,255,255,.55)");
  vaporGradient.addColorStop(.7, "rgba(255,255,255,.16)");
  vaporGradient.addColorStop(1, "rgba(255,255,255,0)");
  vaporContext.fillStyle = vaporGradient;
  vaporContext.fillRect(0, 0, 128, 128);
  const vaporTexture = new CanvasTexture(vaporCanvas);
  vaporTexture.colorSpace = SRGBColorSpace;
  const vapor = Array.from({ length: 24 }, (_, index) => {
    const material = new SpriteMaterial({
      map: vaporTexture, color: index % 3 === 0 ? 0xecede4 : 0x8e9d93,
      transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    });
    const wisp = new Sprite(material);
    parent.add(wisp);
    return { wisp, material, phase: index / 24 };
  });

  const plaque = new Group(); plaque.position.set(-.02,-1.64,.78); parent.add(plaque);
  box(2.22,.51,.08,graphite,plaque,0,0,0,.06);
  const texts = ["01 / ONDERZOEK","02 / AFGESLOTEN","03 / GECONTROLEERD"].map(text => label(text,2.04,.26,0,0,.049,plaque,"#554b42","#f0dec0"));
  return {
    update({stage,blend,time}) {
      const closure=MathUtils.clamp(blend,0,1);
      const leakAmount = 1 - MathUtils.smoothstep(closure, .02, .98);
      vapor.forEach(({ wisp, material, phase }) => {
        const life = (time * .3 + phase) % 1;
        const spread = .025 + life * .22;
        wisp.position.set(
          .11 - life * .48 + Math.sin(time * .85 + phase * 15) * spread,
          .61 + life * 2.5,
          .26 + Math.cos(time * .65 + phase * 13) * spread * .6,
        );
        const size = .16 + life * .94;
        wisp.scale.set(size * .78, size * 1.25, 1);
        material.rotation = Math.sin(time * .3 + phase * 8) * .45;
        material.opacity = Math.sin(life * Math.PI) * .3 * leakAmount;
        wisp.visible = leakAmount > .005;
      });
      lever.rotation.y=closure*Math.PI/2;
      needle.rotation.z=MathUtils.lerp(.72,-.75,closure)+Math.sin(time*.7)*.007;
      repair.material=stage===2?green:copperLight;
      inspectionRingMaterial.color.setHex(stage===2?0x91a58c:0xe4ad6f);
      inspectionRingMaterial.opacity=stage===1?.13:.32+Math.sin(time*1.5)*.12;
      inspection.position.x=.08+Math.sin(time*.9)*.055;
      const scale=1+Math.sin(time*1.25)*.045; inspection.scale.setScalar(scale);
      orbit.rotation.z=time*.12;
      texts.forEach((text,index)=>text.visible=index===stage);
    },
  };
}

/** Same studio, lighting and interaction grammar as the water page; distinct physical models. */
export function createEmergencyScene(host: HTMLElement, kind: EmergencyKind, initiallyPaused: boolean) {
  const renderer=new WebGLRenderer({antialias:true,alpha:true,powerPreference:"low-power"});
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<600?1.25:1.5));
  renderer.setClearColor(0,0);
  renderer.toneMapping=ACESFilmicToneMapping;
  renderer.toneMappingExposure=.96;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-hidden","true");
  host.appendChild(renderer.domElement);
  const scene=new Scene();
  const environmentGenerator=new PMREMGenerator(renderer);
  const room=new RoomEnvironment();
  const environment=environmentGenerator.fromScene(room,.04);
  scene.environment=environment.texture;
  scene.environmentIntensity=1.2;
  room.dispose(); environmentGenerator.dispose();
  const camera=new OrthographicCamera(-4,4,4,-4,.1,70);
  camera.position.set(kind==="gas"?5.1:5.4,kind==="gas"?3.6:3.3,10);
  camera.lookAt(0,kind==="gas"?.1:-.02,0);
  scene.add(new AmbientLight(0xfff9ef,.75));
  scene.add(new HemisphereLight(0xf8fcff,kind==="gas"?0x916b50:0x788a86,1.65));
  const key=new DirectionalLight(0xfff8e9,3.2);
  key.position.set(-3.5,7,6); key.castShadow=true;
  key.shadow.mapSize.set(1024,1024);
  Object.assign(key.shadow.camera,{left:-5,right:5,top:5,bottom:-5});
  key.shadow.normalBias=.022; key.shadow.bias=-.0001; key.shadow.radius=4;
  scene.add(key);
  const rim=new DirectionalLight(kind==="gas"?0xffd7b0:0xc2e0ec,2.6);
  rim.position.set(5,3,-5); scene.add(rim);
  const assembly=new Group(); assembly.rotation.y=-.23; scene.add(assembly);
  const floor=cylinder(3.5,.14,new MeshStandardMaterial({color:kind==="gas"?0xe5d5c1:0xe3e1d5,roughness:.47,metalness:.03}),assembly,0,kind==="gas"?-1.98:-2.2,0,100);
  floor.castShadow=false;
  const illustration=kind==="gas"?createGasModel(assembly):createElectricModel(assembly);
  let stage=0,blend=0,time=1.8,frame=0,lastTime=0;
  let paused=initiallyPaused,visible=true,disposed=false,contextLost=false;
  let pointerX=0,pointerY=0;

  function render(delta:number) {
    blend=MathUtils.lerp(blend,stage,paused?1:1-Math.exp(-delta*4));
    assembly.rotation.y=MathUtils.lerp(assembly.rotation.y,-.23+(paused?0:pointerX*.15),paused?1:.04);
    assembly.rotation.x=MathUtils.lerp(assembly.rotation.x,paused?0:pointerY*.035,paused?1:.04);
    illustration.update({stage,blend,time});
    renderer.render(scene,camera);
  }
  function tick(now:number) {
    frame=0;
    if(disposed||contextLost||paused||!visible||document.hidden) return;
    const delta=lastTime?Math.min((now-lastTime)/1000,.05):.016;
    lastTime=now; time+=delta; render(delta); frame=requestAnimationFrame(tick);
  }
  function schedule() {
    if(disposed||contextLost) return;
    cancelAnimationFrame(frame); frame=0; lastTime=0;
    if(paused) render(0);
    else if(visible&&!document.hidden) frame=requestAnimationFrame(tick);
  }
  function resize() {
    if(disposed||contextLost||!host.clientWidth||!host.clientHeight) return;
    renderer.setSize(host.clientWidth,host.clientHeight,false);
    const aspect=host.clientWidth/host.clientHeight;
    const halfHeight=Math.max(kind==="gas"?3.28:3.3,3.7/aspect);
    camera.left=-halfHeight*aspect; camera.right=halfHeight*aspect; camera.top=halfHeight; camera.bottom=-halfHeight;
    camera.updateProjectionMatrix(); render(0);
  }
  const resizeObserver=new ResizeObserver(resize); resizeObserver.observe(host);
  const intersectionObserver=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;schedule();},{threshold:.02});
  intersectionObserver.observe(host);
  const onVisibility=()=>schedule(); document.addEventListener("visibilitychange",onVisibility);
  const onPointer=(event:PointerEvent)=>{
    if(paused||event.pointerType!=="mouse") return;
    const bounds=host.getBoundingClientRect();
    pointerX=(event.clientX-bounds.left)/bounds.width-.5; pointerY=(event.clientY-bounds.top)/bounds.height-.5;
  };
  const onPointerLeave=()=>{pointerX=0;pointerY=0;};
  host.addEventListener("pointermove",onPointer,{passive:true}); host.addEventListener("pointerleave",onPointerLeave);
  const setRendererState=(ready:boolean)=>{
    const visual=host.closest<HTMLElement>("[data-emergency-visual]");
    if(visual) visual.dataset.renderer=ready?"ready":"fallback";
  };
  const onContextLost=(event:Event)=>{event.preventDefault();contextLost=true;cancelAnimationFrame(frame);frame=0;setRendererState(false);};
  const onContextRestored=()=>{contextLost=false;resize();schedule();setRendererState(true);};
  renderer.domElement.addEventListener("webglcontextlost",onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored",onContextRestored);
  resize();schedule();

  return {
    setStage(next:number){stage=next;if(paused) render(0);},
    setPaused(next:boolean){paused=next;schedule();},
    dispose(){
      disposed=true;cancelAnimationFrame(frame);
      resizeObserver.disconnect();intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange",onVisibility);
      host.removeEventListener("pointermove",onPointer);host.removeEventListener("pointerleave",onPointerLeave);
      renderer.domElement.removeEventListener("webglcontextlost",onContextLost);renderer.domElement.removeEventListener("webglcontextrestored",onContextRestored);
      const materials=new Set<Material>(),geometries=new Set<BufferGeometry>(),textures=new Set<Texture>();
      scene.traverse(object=>{
        if(!(object instanceof Mesh) && !(object instanceof Sprite)) return;
        if(object instanceof Mesh) geometries.add(object.geometry);
        (Array.isArray(object.material)?object.material:[object.material]).forEach(material=>{
          materials.add(material);
          for(const value of Object.values(material)) if(value instanceof Texture) textures.add(value);
        });
      });
      geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());textures.forEach(texture=>texture.dispose());
      environment.dispose();renderer.dispose();renderer.domElement.remove();
    },
  };
}
