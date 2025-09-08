// script.js - safer, no top-level static imports so camera always initializes
// Includes: camera capture, image enhancement call, 3D generation call, lazy three.js loading,
// a visible generator timer, and a Download GLB button created dynamically.

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const video = document.getElementById('cameraPreview');
  const canvas = document.getElementById('captureCanvas');
  const ctx = canvas.getContext('2d');
  const capturedImg = document.getElementById('capturedImg');
  const promptInput = document.getElementById('promptInput');
  const generatedImg = document.getElementById('generatedImg');
  const viewer = document.getElementById('viewer');
  const status = document.getElementById('status');
  const toggleCameraBtn = document.getElementById('toggleCameraBtn');
  const captureBtn = document.getElementById('captureBtn');
  const genImgBtn = document.getElementById('generateImageBtn');
  const gen3DBtn = document.getElementById('generate3DBtn');

  // State
  let stream = null;
  let isCameraOpen = false;
  let capturedBlob = null;
  let generatedImageBlob = null;

  // global container for some shared state (blob, objectUrl, timers)
  window._x3d = window._x3d || {};

  function setStatus(msg, isError = false) {
    status.textContent = msg;
    status.style.color = isError ? '#b00020' : '#333';
    console[isError ? 'error' : 'log'](msg);
  }

  // Safety: disable buttons if no getUserMedia
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('getUserMedia not supported in this browser.', true);
    toggleCameraBtn.disabled = true;
    captureBtn.disabled = true;
    genImgBtn.disabled = true;
    gen3DBtn.disabled = true;
    return;
  }

  // Wire listeners
  toggleCameraBtn.addEventListener('click', toggleCamera);
  captureBtn.addEventListener('click', captureSnapshot);
  genImgBtn.addEventListener('click', generateImage);
  gen3DBtn.addEventListener('click', generate3DModel);

  async function toggleCamera() {
    if (isCameraOpen) return closeCamera();

    try {
      setStatus('Requesting camera permission...');
      const constraints = {
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
        audio: false
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      video.playsInline = true;
      await video.play();
      isCameraOpen = true;
      toggleCameraBtn.textContent = 'Close Camera';
      setStatus('Camera opened.');
    } catch (err) {
      if (err && err.name === 'NotAllowedError') {
        setStatus('Camera permission denied. Allow camera in site settings.', true);
      } else if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
        setStatus('No camera found on device.', true);
      } else if (err && err.name === 'SecurityError') {
        setStatus('Security error: serve page over HTTPS or use localhost.', true);
      } else {
        setStatus(`Error opening camera: ${err?.message || err}`, true);
      }
      console.error('getUserMedia error object:', err);
      stream = null;
      isCameraOpen = false;
      toggleCameraBtn.textContent = 'Open Camera';
    }
  }

  function closeCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    video.srcObject = null;
    isCameraOpen = false;
    toggleCameraBtn.textContent = 'Open Camera';
    setStatus('Camera closed.');
  }

  function captureSnapshot() {
    if (!isCameraOpen || !video.videoWidth) {
      setStatus('Open the camera first.', true);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) {
        setStatus('Capture failed (no blob).', true);
        return;
      }
      capturedBlob = blob;
      capturedImg.src = URL.createObjectURL(blob);
      capturedImg.style.display = 'block';
      setStatus('Snapshot captured successfully.');
    }, 'image/png');
  }

  // ===== Placeholder / original endpoint constants (do NOT commit real keys) =====
  const GEMINI_API_KEY = 'AIzaSyBfm8bW1bMqA1lytqnAyHktC1jGjaX2zsY';
  const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent';
  const THREED_API = 'https://ahmad-sarmad-ali-3d-model-ai.hf.space/generate-3d/';

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Keep API call, but it will not block the camera init.
  async function generateImage() {
    if (!capturedBlob || !promptInput.value) {
      setStatus('Capture a snapshot and enter a prompt first.', true);
      return;
    }
    setStatus('Generating enhanced image...');
    genImgBtn.disabled = true;
    try {
      const base64 = await blobToBase64(capturedBlob);
      // Note: CORS & API key visibility — consider calling your backend instead of browser.
      const resp = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptInput.value }, { inline_data: { mime_type: 'image/png', data: base64 } }] }]
        })
      });
      if (!resp.ok) throw new Error(`API error ${resp.status}`);
      const data = await resp.json();
      const genBase64 = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data)?.inlineData?.data
                        || data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data)?.inline_data?.data;
      if (!genBase64) throw new Error('No image data returned.');
      generatedImageBlob = await (await fetch(`data:image/png;base64,${genBase64}`)).blob();
      generatedImg.src = URL.createObjectURL(generatedImageBlob);
      generatedImg.style.display = 'block';
      setStatus('Image enhanced successfully.');
    } catch (err) {
      console.error('generateImage error:', err);
      setStatus(`Error generating image: ${err?.message || err}`, true);
    } finally {
      genImgBtn.disabled = false;
    }
  }

  // ----------------------------
  // Helpers for model generation UI
  // ----------------------------
  function startGenTimer() {
    stopGenTimer(); // clear any existing
    const tEl = document.createElement('div');
    tEl.id = 'glbTimer';
    tEl.style.cssText = 'position:absolute;left:10px;top:10px;padding:6px 8px;background:rgba(0,0,0,0.6);color:#fff;border-radius:6px;font-weight:600;z-index:999;';
    tEl.textContent = 'Generating 3D model — 00:00';
    viewer.appendChild(tEl);
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const s = Math.floor(elapsed / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      tEl.textContent = `Generating 3D model — ${mm}:${ss}`;
    }, 250);
    window._x3d.genTimerId = id;
    window._x3d.genTimerEl = tEl;
  }

  function stopGenTimer(success = true) {
    if (window._x3d.genTimerId) {
      clearInterval(window._x3d.genTimerId);
      delete window._x3d.genTimerId;
    }
    if (window._x3d.genTimerEl) {
      const el = window._x3d.genTimerEl;
      if (success) {
        el.textContent = 'Model ready';
        setTimeout(() => {
          if (el && el.parentNode) el.remove();
        }, 900);
      } else {
        el.style.background = 'rgba(176,0,32,0.9)';
        el.textContent = 'Generation failed';
        setTimeout(() => {
          if (el && el.parentNode) el.remove();
        }, 1500);
      }
      delete window._x3d.genTimerEl;
    }
  }

  // ensure there's a download button and wire it to available blob
  function ensureDownloadButton() {
    let btn = document.getElementById('downloadGlbBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'downloadGlbBtn';
      btn.textContent = 'Download GLB';
      btn.style.cssText = [
        'position:absolute',
        'top:10px',
        'right:10px',
        'z-index:999',
        'padding:8px 10px',
        'border-radius:6px',
        'border:0',
        'background:#0a74ff',
        'color:white',
        'cursor:pointer',
        'font-weight:600'
      ].join(';');
      viewer.appendChild(btn);
    }
    const info = window._x3d || {};
    btn.disabled = !info.blob;
    btn.onclick = () => {
      const info2 = window._x3d || {};
      if (!info2.blob) {
        setStatus('No GLB blob available for download (CORS or fetch failed).', true);
        return;
      }
      if (!info2.objectUrl) info2.objectUrl = URL.createObjectURL(info2.blob);
      const a = document.createElement('a');
      a.href = info2.objectUrl;
      a.download = info2.filename || 'model.glb';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    return btn;
  }

  // ----------------------------
  // generate3DModel: sends image blob to remote service and handles returned GLB blob
  // ----------------------------
  async function generate3DModel() {
    if (!generatedImageBlob) {
      setStatus('Generate an enhanced image first.', true);
      return;
    }

    setStatus('Generating 3D model (sending to remote service)...');
    gen3DBtn.disabled = true;

    // start visible timer
    startGenTimer();

    try {
      const fd = new FormData();
      fd.append('image', generatedImageBlob, 'image.png');

      const resp = await fetch(THREED_API, { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(`API error ${resp.status}`);

      // Get blob and create object URL
      const blob = await resp.blob();

      // infer filename if possible (Content-Disposition)
      let filename = 'model.glb';
      try {
        const contentDisposition = resp.headers.get('Content-Disposition') || resp.headers.get('content-disposition');
        if (contentDisposition) {
          const m = /filename\*?=(?:UTF-8'')?["']?([^;"']+)/i.exec(contentDisposition);
          if (m && m[1]) filename = decodeURIComponent(m[1]);
        }
      } catch (e) { /* ignore */ }

      // store globally for later download & viewer use
      const objectUrl = URL.createObjectURL(blob);
      if (window._x3d.objectUrl && window._x3d.objectUrl !== objectUrl) {
        try { URL.revokeObjectURL(window._x3d.objectUrl); } catch (e) {}
      }
      window._x3d.blob = blob;
      window._x3d.objectUrl = objectUrl;
      window._x3d.filename = filename;

      setStatus('3D model returned. Loading viewer...');
      // create/enable download button immediately (blob available)
      ensureDownloadButton();

      // Pass objectUrl to initThreeJS to load into three
      await initThreeJS(objectUrl);
      // initThreeJS will stop the timer on successful load.
    } catch (err) {
      console.error('generate3DModel error:', err);
      stopGenTimer(false);
      setStatus(`Error generating 3D model: ${err?.message || err}`, true);
    } finally {
      gen3DBtn.disabled = false;
    }
  }

  // ----------------------------
  // initThreeJS: lazy-load three & loaders (local -> CDN fallback) and display GLB in viewer
  // ----------------------------
  async function initThreeJS(glbUrl) {
    try {
      setStatus('Loading 3D libraries (local -> fallback CDN)...');

      // Try local dynamic imports first, fall back to CDN module builds
      let THREEmod, GLTFmod, OrbitMod;
      try {
        THREEmod = await import('./lib/three.module.min.js');
        GLTFmod = await import('./lib/GLTFLoader.js');
        OrbitMod = await import('./lib/OrbitControls.js');
      } catch (localErr) {
        console.warn('Local import failed, falling back to CDN modules:', localErr);
        const ver = '0.155.0'; // keep loaders matched to this version
        THREEmod = await import(`https://unpkg.com/three@${ver}/build/three.module.js`);
        GLTFmod  = await import(`https://unpkg.com/three@${ver}/examples/jsm/loaders/GLTFLoader.js`);
        OrbitMod = await import(`https://unpkg.com/three@${ver}/examples/jsm/controls/OrbitControls.js`);
      }

      // Resolve exports across builds
      const THREE = THREEmod.THREE || THREEmod.default || THREEmod;
      const GLTFLoader = GLTFmod.GLTFLoader || GLTFmod.default || GLTFmod;
      const OrbitControls = OrbitMod.OrbitControls || OrbitMod.default || OrbitMod;

      if (!THREE) throw new Error('Three.js module not available (check ./lib path or CDN).');

      // Clear viewer and prepare canvas
      viewer.innerHTML = '';
      viewer.style.position = viewer.style.position || 'relative';

      const container = viewer;
      const width = container.clientWidth || 800;
      const height = Math.max(400, width * 0.75);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);

      const light = new THREE.DirectionalLight(0xffffff, 1.5);
      light.position.set(5, 5, 5);
      scene.add(light);
      scene.add(new THREE.AmbientLight(0xaaaaaa));

      // Load GLB (glbUrl can be an object URL or a remote URL)
      const loader = new GLTFLoader();
      loader.load(glbUrl, (gltf) => {
        // successful load
        const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!root) {
          stopGenTimer(false);
          setStatus('GLB has no scene to display.', true);
          return;
        }

        // center & scale
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = maxDim > 0 ? 1.0 / maxDim * 1.8 : 1.0;
        root.scale.set(scale, scale, scale);

        const center = box.getCenter(new THREE.Vector3());
        root.position.sub(center.multiplyScalar(scale));

        scene.add(root);

        // set camera
        const camDistance = (Math.max(size.length() * scale, 1)) * 1.5;
        camera.position.set(camDistance, camDistance * 0.6, camDistance);
        camera.lookAt(new THREE.Vector3(0, 0, 0));
        camera.updateProjectionMatrix();

        setStatus('3D model loaded. Drag to rotate, scroll to zoom.');
        // stop generation timer with success
        stopGenTimer(true);

        // ensure download button exists and is enabled (if blob was stored earlier)
        ensureDownloadButton();
      }, undefined, (err) => {
        console.error('GLTF load error:', err);
        stopGenTimer(false);
        setStatus('Error loading GLB into viewer (see console).', true);
      });

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;

      (function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      })();

      // responsive
      window.addEventListener('resize', () => {
        const newWidth = container.clientWidth || 800;
        const newHeight = Math.max(400, newWidth * 0.75);
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight);
      });
    } catch (err) {
      console.error('initThreeJS dynamic import or setup error:', err);
      stopGenTimer(false);
      setStatus(`Could not load 3D libraries or model: ${err?.message || err}. Check ./lib paths and module formats.`, true);
    }
  }

  // Clean up
  window.addEventListener('beforeunload', () => {
    try {
      if (capturedImg.src) URL.revokeObjectURL(capturedImg.src);
    } catch (_) {}
    try {
      if (generatedImg.src) URL.revokeObjectURL(generatedImg.src);
    } catch (_) {}
    try {
      if (stream) stream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    try {
      if (window._x3d && window._x3d.objectUrl) URL.revokeObjectURL(window._x3d.objectUrl);
    } catch (_) {}
  });

  setStatus('Ready to start. Open the camera to begin.');
});
