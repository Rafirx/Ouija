  
// ── Letter/Number positions extracted from GLB node data ─────────────
// Format: char → [glbX, glbZ]  (Y is always the board surface)
const LETTER_POS = {
  A:[-1.1209,0.7390], B:[-0.9302,0.7292], C:[-0.7411,0.7285],
  D:[-0.5386,0.7282], E:[-0.3470,0.7283], F:[-0.1779,0.7208],
  G:[ 0.0123,0.7300], H:[ 0.2153,0.7282], I:[ 0.3874,0.7282],
  J:[ 0.5255,0.7485], K:[ 0.6917,0.7277], L:[ 0.8721,0.7390],
  M:[ 1.0697,0.7235],
  N:[-1.2005,1.0923], O:[-0.9876,1.0922], P:[-0.7860,1.0802],
  Q:[-0.5942,1.0995], R:[-0.3986,1.0920], S:[-0.2189,1.0928],
  T:[-0.0415,1.0767], U:[ 0.1523,1.0964], V:[ 0.3461,1.0863],
  W:[ 0.5611,1.0857], X:[ 0.7837,1.0917], Y:[ 0.9772,1.0817],
  Z:[ 1.1678,1.0922],
  '0':[ 0.5192,1.4579], '1':[-0.5613,1.4579], '2':[-0.4410,1.4598],
  '3':[-0.3215,1.4572], '4':[-0.1982,1.4583], '5':[-0.0817,1.4586],
  '6':[ 0.0386,1.4619], '7':[ 0.1590,1.4503], '8':[ 0.2792,1.4582],
  '9':[ 0.3997,1.4529],
};

const container = document.getElementById('canvas-container');
const loadMsg   = document.getElementById('load-msg');
const statusEl  = document.getElementById('status');
const outputEl  = document.getElementById('output-text');
const curLetEl  = document.getElementById('current-letter');

const W = container.clientWidth;
const H = container.clientHeight;

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080503);
scene.fog = new THREE.FogExp2(0x080503, 0.1);

// Camera – zoomed in for better detail
const camera = new THREE.PerspectiveCamera(50, W/H, 0.01, 60);
camera.position.set(0, 3.4, 2.6);
camera.lookAt(0, 0.1, 0.4);


scene.add(new THREE.AmbientLight(0x3d2200, 0.45));

const keyLight = new THREE.PointLight(0xffa040, 2.8, 10);
keyLight.position.set(0, 3.5, 1);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024,1024);
scene.add(keyLight);

const leftC  = new THREE.PointLight(0xff8025, 1.3, 6);
leftC.position.set(-2.8, 1.8, 0.5);
scene.add(leftC);

const rightC = new THREE.PointLight(0xff8025, 1.3, 6);
rightC.position.set( 2.8, 1.8, 0.5);
scene.add(rightC);

const backL  = new THREE.PointLight(0x3d0f3d, 0.7, 6);
backL.position.set(0, 1.2, -3);
scene.add(backL);

// Planchette glow light
const pGlow = new THREE.PointLight(0xffd080, 0, 2.0);
scene.add(pGlow);

// Light flicker
let flickT=0;
function flickerLights(dt){
  flickT += dt;
  const f = Math.sin(flickT*3.9)*0.14 + Math.sin(flickT*7.1)*0.07 + Math.sin(flickT*13.3)*0.03;
  keyLight.intensity = 2.8 + f;
  leftC.intensity    = 1.3 + f*0.5;
  rightC.intensity   = 1.3 + f*0.5;
}

// ── Load helpers ────────────────────────────────────────────────────────
function loadScript(src){ return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);}); }

async function loadLoaders(){
  await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js');
  await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js');
  await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/MTLLoader.js');
}

// ── Board + Planchette state ─────────────────────────────────────────
let board=null, planchette=null, glowMesh=null;
let boardScale=1, boardOX=0, boardOZ=0;
const BOARD_Y = 0.12;  // Positioned on top of the board surface

function updateBoardTransform(){
  if(!board) return;
  boardScale = board.scale.x;
  boardOX    = board.position.x;
  boardOZ    = board.position.z;
}

function glbToWorld(gx, gz){
  return new THREE.Vector3(
    gx * boardScale + boardOX,
    BOARD_Y,
    gz * boardScale + boardOZ
  );
}

// ── Animation state ───────────────────────────────────────────────────
let animSrc = new THREE.Vector3();
let animDst = new THREE.Vector3();
let animT=1, animDur=1;
let animDone=null;
let bobT=0, glowI=0, glowTarget=0;

function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }

function movePlanchetteTo(worldPos, dur, cb){
  animSrc.copy(planchette.position);
  animDst.copy(worldPos);
  animT=0; animDur=dur; animDone=cb;
}

// ── Init ────────────────────────────────────────────────────────────────
(async ()=>{
  await loadLoaders();

  loadMsg.textContent = 'Loading Ouija Board…';
  const gltfLoader = new THREE.GLTFLoader();
  const objLoader  = new THREE.OBJLoader();

  // Fetch files as blobs → object URLs (works when served from same dir)
  async function fetchAsURL(path){
    const res = await fetch(path);
    if(!res.ok) throw new Error(`Failed: ${path}`);
    return URL.createObjectURL(await res.blob());
  }

  let boardLoaded=false, planchetteLoaded=false;

  function tryFinish(){
    if(boardLoaded && planchetteLoaded){
      document.getElementById('loading').style.display='none';
      document.getElementById('ask-btn').disabled=false;
      updateBoardTransform();
      // Start planchette at board center
      const startPos = glbToWorld(0, 0.82);
      planchette.position.copy(startPos);
      pGlow.position.copy(startPos);
      statusEl.textContent='The board awaits your question…';
    }
  }

  // Load board
  try {
    const boardURL = await fetchAsURL('OuijaBoard.glb');
    gltfLoader.load(boardURL, gltf => {
      board = gltf.scene;
      board.traverse(o=>{
        if(o.isMesh){
          o.castShadow=true; o.receiveShadow=true;
          if(o.material){
            const mats = Array.isArray(o.material)?o.material:[o.material];
            mats.forEach(m=>{ if(m.roughness!==undefined) m.roughness=Math.min(m.roughness*1.08,1); });
          }
        }
      });
      const box = new THREE.Box3().setFromObject(board);
      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      board.position.sub(center);
      const scl = 5.2 / Math.max(size.x, size.z);
      board.scale.setScalar(scl);
      // re-center X/Z after scale
      const box2 = new THREE.Box3().setFromObject(board);
      const c2   = box2.getCenter(new THREE.Vector3());
      board.position.x -= c2.x;
      board.position.z -= c2.z - 0.25;
      board.position.y  = -0.05;
      scene.add(board);
      boardLoaded=true; tryFinish();
    },
    xhr => { loadMsg.textContent=`Board ${Math.round(xhr.loaded/xhr.total*100)}%…`; },
    err => {
      console.error('Board error:', err);
      // Fallback flat board
      const g=new THREE.BoxGeometry(3.2,0.08,2.4);
      const m=new THREE.MeshStandardMaterial({color:0x3d2200,roughness:0.85,metalness:0.05});
      board=new THREE.Mesh(g,m);
      board.position.set(0,-0.05,0.25); board.receiveShadow=true;
      scene.add(board); boardLoaded=true; tryFinish();
    });
  } catch(e){
    console.error(e);
    // fallback
    const g=new THREE.BoxGeometry(3.2,0.08,2.4);
    const m=new THREE.MeshStandardMaterial({color:0x3d2200,roughness:0.85});
    board=new THREE.Mesh(g,m); board.position.set(0,-0.05,0.25);
    scene.add(board); boardLoaded=true; tryFinish();
  }

  // Load planchette
  loadMsg.textContent = 'Loading Planchette…';
  try {
    const mtlText = await fetch('Planchette.mtl').then(r=>r.text());
    const objText = await fetch('Planchette.obj').then(r=>r.text());

    // Parse MTL
    const mats={};
    let cur=null;
    for(const line of mtlText.split('\n')){
      const p=line.trim().split(/\s+/);
      if(p[0]==='newmtl'){cur=p[1];mats[cur]={};}
      else if(cur&&p[0]==='Kd') mats[cur].color=[+p[1],+p[2],+p[3]];
      else if(cur&&p[0]==='Pr')  mats[cur].roughness=+p[1];
      else if(cur&&p[0]==='Pm')  mats[cur].metalness=+p[1];
    }
    function makeMat(name){
      const d=mats[name]||{};
      const col=d.color?new THREE.Color(...d.color):new THREE.Color(0.82,0.66,0.44);
      return new THREE.MeshStandardMaterial({color:col, roughness:d.roughness??0.62, metalness:d.metalness??0});
    }

    const pg = objLoader.parse(objText);
    pg.traverse(o=>{
      if(o.isMesh){
        const n=o.material?.name||'';
        o.material=makeMat(n); o.castShadow=true;
      }
    });

    // Fit planchette - properly center all meshes
    const pb=new THREE.Box3().setFromObject(pg);
    const pc=pb.getCenter(new THREE.Vector3());
    const ps=pb.getSize(new THREE.Vector3());
    // Subtract center from all meshes to center them properly
    pg.traverse(o => {
      if(o.isMesh) {
        o.position.sub(pc);
      }
    });
    const pscl=0.65/Math.max(ps.x,ps.z);
    pg.scale.setScalar(pscl);

    planchette=new THREE.Group();
    planchette.add(pg);

    // Glow halo
    const gGeo=new THREE.SphereGeometry(0.12,14,14);
    const gMat=new THREE.MeshBasicMaterial({color:0xffd080,transparent:true,opacity:0,depthWrite:false});
    glowMesh=new THREE.Mesh(gGeo,gMat);
    planchette.add(glowMesh);

    scene.add(planchette);
    planchetteLoaded=true; tryFinish();
  } catch(e){
    console.error('Planchette error:', e);
    // Fallback teardrop-ish shape
    const geo=new THREE.CylinderGeometry(0.08,0.15,0.04,20);
    const mat=new THREE.MeshStandardMaterial({color:0xc8a864,roughness:0.55});
    planchette=new THREE.Group();
    planchette.add(new THREE.Mesh(geo,mat));
    glowMesh=new THREE.Mesh(
      new THREE.SphereGeometry(0.12,12,12),
      new THREE.MeshBasicMaterial({color:0xffd080,transparent:true,opacity:0,depthWrite:false})
    );
    planchette.add(glowMesh);
    scene.add(planchette);
    planchetteLoaded=true; tryFinish();
  }
})();

// ── Generate AI response ──────────────────────────────────────────────
async function generateResponse(question){
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',
        max_tokens:1000,
        system:`You are the spirit channeled through an ancient Ouija board oracle. A seeker asks you a question.

Respond with ONLY a valid JSON object. Nothing else — no markdown, no explanation.
Format: {"answer": "YOUR ANSWER HERE"}

Rules for the answer:
- Use ONLY capital letters A-Z, digits 0-9, and spaces
- No punctuation, apostrophes, or symbols whatsoever
- Keep it short and mysterious: 1–6 words (rarely up to 10)
- Be cryptic, poetic, and otherworldly
- Sometimes answer just YES or NO
- Examples: "YES", "NO", "BEYOND THE VEIL", "ASK AGAIN SOON", "3 MOONS", "TRUST THE DARK", "SEEK WITHIN", "THE DEAD KNOW ALL"`,
        messages:[{role:'user',content:question}]
      })
    });
    const data=await res.json();
    const txt=data.content.map(b=>b.text||'').join('');
    const clean=txt.replace(/```json|```/g,'').trim();
    const parsed=JSON.parse(clean);
    return parsed.answer.toUpperCase().replace(/[^A-Z0-9 ]/g,'').trim();
  } catch(e){
    console.warn('API fallback',e);
    const fb=['YES','NO','BEYOND KNOWING','SEEK WITHIN','ASK AGAIN','THE SPIRITS SPEAK','3 MOONS PASS'];
    return fb[Math.floor(Math.random()*fb.length)];
  }
}

// ── Spell-out animation ───────────────────────────────────────────────
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function spellOut(text){
  const tokens=[...text].filter(c=>c!==' ');
  outputEl.textContent='';
  let displayed='';
  glowTarget=1.2;

  for(let i=0;i<tokens.length;i++){
    const ch=tokens[i];
    const p2=LETTER_POS[ch];
    if(!p2) continue;

    const wPos=glbToWorld(p2[0],p2[1]);
    const dist=planchette.position.distanceTo(wPos);
    // Duration: closer = faster, max ~1.2s, min 0.3s
    const dur=Math.max(0.30, Math.min(dist*0.55+0.25, 1.2));

    curLetEl.textContent=`Moving to: ${ch}`;

    await new Promise(res=>movePlanchetteTo(wPos, dur, res));

    // Flash glow and update display
    glowTarget=3.0;
    displayed+=ch;
    outputEl.textContent=displayed;
    outputEl.classList.add('flash');
    setTimeout(()=>outputEl.classList.remove('flash'),350);

    curLetEl.textContent=`Channeling: ${ch}`;
    await sleep(320);
    glowTarget=0.9;
    await sleep(100);
  }

  // Return to center rest
  curLetEl.textContent='The spirits rest…';
  const center=glbToWorld(0,0.82);
  await new Promise(res=>movePlanchetteTo(center,0.9,res));
  glowTarget=0;
  await sleep(400);
  curLetEl.textContent='';
}

// ── Ask question ──────────────────────────────────────────────────────
let busy=false;
window.askQuestion=async function(){
  if(busy||!planchette) return;
  const q=document.getElementById('question-input').value.trim();
  if(!q) return;

  busy=true;
  document.getElementById('ask-btn').disabled=true;
  outputEl.textContent='…'; curLetEl.textContent='';
  statusEl.textContent='Consulting the spirits…';
  glowTarget=1.5;

  try {
    const answer=await generateResponse(q);
    statusEl.textContent='The board speaks…';
    await spellOut(answer);
    statusEl.textContent='Ask another question…';
  } catch(e){
    statusEl.textContent='The spirits are silent tonight.';
  }

  busy=false;
  document.getElementById('ask-btn').disabled=false;
};

document.getElementById('question-input').addEventListener('keydown',e=>{
  if(e.key==='Enter') window.askQuestion();
});

// ── Render loop ───────────────────────────────────────────────────────
let lastT=0;
function animate(now){
  requestAnimationFrame(animate);
  const dt=Math.min((now-lastT)/1000,0.05); lastT=now;

  flickerLights(dt);

  if(planchette){
    // Step movement animation
    if(animT<1){
      animT+=dt/animDur;
      if(animT>=1){
        animT=1;
        planchette.position.lerpVectors(animSrc,animDst,1);
        if(animDone){const cb=animDone;animDone=null;cb();}
      } else {
        planchette.position.lerpVectors(animSrc,animDst,easeInOutCubic(animT));
      }
    }

    // Gentle bob & sway when idle
    bobT+=dt;
    planchette.position.y = BOARD_Y + Math.sin(bobT*1.9)*0.013;
    planchette.rotation.y = Math.sin(bobT*0.65)*0.045;

    // Glow
    glowI += (glowTarget-glowI)*0.10;
    pGlow.intensity = glowI*2.2;
    pGlow.position.copy(planchette.position);
    if(glowMesh) glowMesh.material.opacity = Math.min(glowI*0.18, 0.5);
  }

  renderer.render(scene,camera);
}
requestAnimationFrame(animate);

// ── Resize ─────────────────────────────────────────────────────────────
new ResizeObserver(()=>{
  const w=container.clientWidth, h=container.clientHeight;
  camera.aspect=w/h; camera.updateProjectionMatrix();
  renderer.setSize(w,h);
}).observe(container);