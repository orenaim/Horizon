import * as THREE from "three";

/**
 * Click-to-hide model viewer for the loaded aircraft, enabled with `?inspect=1`.
 *
 * The downloaded C172 has no usable object names, so parts are identified in
 * `c172-glb.js` by triangle count and where they sit in the model. Working those
 * numbers out from a bounding-box dump is slow and easy to get wrong. This lets
 * you point at the offending mesh instead: drag to orbit, scroll to zoom, hover
 * to highlight, click to hide. The panel lists what you have hidden as loader
 * fingerprints, ready to paste into PRUNE.
 *
 * Dev-only, and off unless asked for.
 */

const HIGHLIGHT = new THREE.MeshBasicMaterial({
  color: 0xff3b1f,
  wireframe: true,
  toneMapped: false,
});

// Treat a press that barely moves as a click; anything more is an orbit drag.
const CLICK_SLOP = 5;

export function enableModelInspector(world) {
  const canvas = world.renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hidden = new Map();
  let hovered = null;
  let originalMaterial = null;

  // Park the aircraft and take the camera over, so the model can be walked
  // around instead of watched from the menu's island fly-by.
  world.start(0, false);
  world.paused = true;
  document.querySelector(".setup")?.classList.add("is-hidden");
  const centre = world.state.position.clone();
  world.plane.position.copy(centre);
  world.plane.rotation.set(0, 0, 0);

  // Framed on the span, so an 80 m A380 is watched from as far back,
  // proportionally, as an 11 m Skyhawk.
  const span = new THREE.Box3().setFromObject(world.plane).getSize(new THREE.Vector3()).x;
  const framed = Math.max(span, 0.1) * 1.4;
  const orbit = { yaw: 0.9, pitch: 0.2, distance: framed };
  world.updateCamera = function () {
    this.plane.visible = true;
    const { yaw, pitch, distance } = orbit;
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(
      centre.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      centre.y + Math.sin(pitch) * distance,
      centre.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.camera.lookAt(centre.x, centre.y, centre.z);
  };

  const panel = document.createElement("div");
  panel.className = "model-inspector";
  panel.innerHTML = `
    <h3>Model inspector</h3>
    <p class="hint">
      Drag to orbit · scroll to zoom · click a part to hide it · shift-click to reset
    </p>
    <ol data-list></ol>
    <button type="button" data-copy>Copy prune list</button>
  `;
  document.body.append(panel);
  const list = panel.querySelector("[data-list]");
  const copyButton = panel.querySelector("[data-copy]");

  const triCount = (mesh) => {
    const g = mesh.geometry;
    return Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
  };

  /**
   * Describes a mesh the way the loader matches one: triangle count, plus the
   * centre of its bounding box in the model file's own units.
   */
  const fingerprint = (mesh) => {
    const root = world.plane.userData.modelRoot;
    const point = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    if (root) root.worldToLocal(point);
    return {
      tris: triCount(mesh),
      at: [+point.x.toFixed(3), +point.y.toFixed(3), +point.z.toFixed(3)],
      material: mesh.material?.name ?? "",
    };
  };

  const render = () => {
    list.innerHTML = "";
    for (const entry of hidden.values()) {
      const item = document.createElement("li");
      item.textContent = `${entry.tris} tris · ${entry.material || "—"} · [${entry.at.join(", ")}]`;
      list.append(item);
    }
    copyButton.disabled = hidden.size === 0;
  };

  const pick = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, world.camera);
    return raycaster.intersectObject(world.plane, true)
      .find((hit) => hit.object.isMesh && hit.object.visible)?.object ?? null;
  };

  const clearHover = () => {
    if (hovered && originalMaterial) hovered.material = originalMaterial;
    hovered = null;
    originalMaterial = null;
  };

  let drag = null;

  canvas.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY, moved: 0 };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      orbit.yaw -= dx * 0.008;
      orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.006, -1.4, 1.4);
      drag.x = event.clientX;
      drag.y = event.clientY;
      clearHover();
      return;
    }
    const mesh = pick(event);
    if (mesh === hovered) return;
    clearHover();
    if (mesh) {
      hovered = mesh;
      originalMaterial = mesh.material;
      mesh.material = HIGHLIGHT;
    }
    canvas.style.cursor = mesh ? "crosshair" : "grab";
  });

  canvas.addEventListener("pointerup", (event) => {
    const wasClick = drag && drag.moved < CLICK_SLOP;
    drag = null;
    if (!wasClick) return;
    if (event.shiftKey) {
      for (const mesh of hidden.keys()) mesh.visible = true;
      hidden.clear();
      render();
      return;
    }
    const mesh = pick(event);
    if (!mesh) return;
    clearHover();
    mesh.visible = false;
    hidden.set(mesh, fingerprint(mesh));
    render();
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    orbit.distance = THREE.MathUtils.clamp(
      orbit.distance * (1 + event.deltaY * 0.001),
      framed * 0.4,
      framed * 8,
    );
  }, { passive: false });

  copyButton.addEventListener("click", async () => {
    const body = [...hidden.values()]
      .map((e) => `  { tris: ${e.tris}, at: [${e.at.join(", ")}] }, // ${e.material}`)
      .join("\n");
    await navigator.clipboard.writeText(`const PRUNE = [\n${body}\n];`);
    copyButton.textContent = "Copied";
    setTimeout(() => (copyButton.textContent = "Copy prune list"), 1600);
  });

  render();
  canvas.style.cursor = "grab";
}
