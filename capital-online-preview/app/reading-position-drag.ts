type Drag = {
  kind: "touch" | "pointer";
  id: number;
  startClientY: number;
  top: number;
  height: number;
  maximumScroll: number;
  pendingY: number;
  moved: boolean;
  frame: number;
  scrollBehavior: string;
  marker: HTMLElement | null;
};

// Own each gesture through exactly one event stream. Coordinates and rail bounds
// must both use viewport CSS pixels. An iPhone Safari trace returned screenY equal
// to pageY: using it feeds our own scroll offset back into the next drag update.
// clientY already accounts for page zoom; dividing it by visualViewport.scale
// would apply that conversion twice.
export function attachReadingPositionDrag(
  rail: HTMLElement,
  onActivate: (paragraphIndex: number) => void,
) {
  const doc = rail.ownerDocument;
  const win = doc.defaultView!;
  const root = doc.documentElement;
  let drag: Drag | null = null;
  let lastTouchAt = -Infinity;

  function markerAt(target: EventTarget | null) {
    const marker = (target as Element | null)?.closest<HTMLElement>("[data-paragraph-index]");
    return marker && rail.contains(marker) ? marker : null;
  }

  function begin(kind: Drag["kind"], id: number, clientY: number, target: EventTarget | null) {
    const bounds = rail.getBoundingClientRect();
    drag = {
      kind, id, startClientY: clientY,
      top: bounds.top, height: Math.max(1, bounds.height),
      maximumScroll: Math.max(0, (doc.scrollingElement || root).scrollHeight - win.innerHeight),
      pendingY: clientY, moved: false, frame: 0,
      scrollBehavior: root.style.scrollBehavior, marker: markerAt(target),
    };
    root.style.scrollBehavior = "auto";
    // Stop any in-flight smooth jump before this gesture takes ownership.
    win.scrollTo({ top: win.scrollY, behavior: "instant" });
  }

  function flush(current: Drag) {
    current.frame = 0;
    const ratio = Math.min(1, Math.max(0, (current.pendingY - current.top) / current.height));
    win.scrollTo({ top: ratio * current.maximumScroll, behavior: "instant" });
  }

  function move(clientY: number) {
    const current = drag;
    if (!current) return;
    const delta = clientY - current.startClientY;
    if (!current.moved && Math.abs(delta) < 4) return;
    current.moved = true;
    current.pendingY = clientY;
    doc.body.classList.add("reading-position-dragging");
    if (!current.frame) {
      current.frame = win.requestAnimationFrame(() => {
        if (drag === current) flush(current);
      });
    }
  }

  function finish(cancelled = false) {
    const current = drag;
    if (!current) return;
    drag = null;
    if (current.frame) win.cancelAnimationFrame(current.frame);
    // End/cancel coordinates can be zero or stale. Only flush the last MOVE.
    if (!cancelled && current.moved) flush(current);
    root.style.scrollBehavior = current.scrollBehavior;
    doc.body.classList.remove("reading-position-dragging");
    if (current.kind === "pointer" && rail.hasPointerCapture(current.id)) {
      rail.releasePointerCapture(current.id);
    }
    if (!cancelled && !current.moved && current.marker?.isConnected) {
      onActivate(Number(current.marker.dataset.paragraphIndex));
    }
  }

  function touchStart(event: TouchEvent) {
    lastTouchAt = Date.now();
    if (event.touches.length !== 1 || drag) return;
    if (event.cancelable) event.preventDefault();
    const touch = event.changedTouches[0];
    if (touch) begin("touch", touch.identifier, touch.clientY, event.target);
  }

  function touchMove(event: TouchEvent) {
    if (drag?.kind !== "touch") return;
    if (event.touches.length !== 1) { finish(true); return; }
    const touch = Array.from(event.changedTouches).find(item => item.identifier === drag?.id);
    if (!touch) return;
    if (event.cancelable) event.preventDefault();
    move(touch.clientY);
  }

  function touchEnd(event: TouchEvent) {
    if (drag?.kind !== "touch") return;
    if (!Array.from(event.changedTouches).some(item => item.identifier === drag?.id)) return;
    if (event.cancelable) event.preventDefault();
    lastTouchAt = Date.now();
    finish(event.type === "touchcancel");
  }

  function cancelMultiTouch(event: TouchEvent) {
    if (drag?.kind === "touch" && event.touches.length > 1) finish(true);
  }

  function pointerStart(event: PointerEvent) {
    if (event.pointerType === "touch" || !event.isPrimary || event.button !== 0 || drag) return;
    if (Date.now() - lastTouchAt < 800) return;
    event.preventDefault();
    begin("pointer", event.pointerId, event.clientY, event.target);
    rail.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent) {
    if (drag?.kind !== "pointer" || drag.id !== event.pointerId) return;
    event.preventDefault();
    move(event.clientY);
  }

  function pointerEnd(event: PointerEvent) {
    if (drag?.kind === "pointer" && drag.id === event.pointerId) {
      finish(event.type !== "pointerup");
    }
  }

  function click(event: MouseEvent) {
    event.preventDefault();
    // Physical taps are activated once on release above. Do not let a delayed
    // synthetic click start a second smooth scroll; keyboard/AT clicks still work.
    if (event.detail === 0 && !drag) {
      const marker = markerAt(event.target);
      if (marker) onActivate(Number(marker.dataset.paragraphIndex));
    }
  }

  const cancel = () => finish(true);
  const visibility = () => { if (doc.hidden) cancel(); };
  rail.addEventListener("touchstart", touchStart, { passive: false });
  rail.addEventListener("touchmove", touchMove, { passive: false });
  rail.addEventListener("touchend", touchEnd, { passive: false });
  rail.addEventListener("touchcancel", touchEnd, { passive: false });
  rail.addEventListener("pointerdown", pointerStart);
  rail.addEventListener("lostpointercapture", pointerEnd);
  rail.addEventListener("click", click);
  doc.addEventListener("pointermove", pointerMove);
  doc.addEventListener("pointerup", pointerEnd);
  doc.addEventListener("pointercancel", pointerEnd);
  doc.addEventListener("touchstart", cancelMultiTouch, { passive: true });
  doc.addEventListener("visibilitychange", visibility);
  win.addEventListener("blur", cancel);
  win.addEventListener("orientationchange", cancel);

  return () => {
    cancel();
    rail.removeEventListener("touchstart", touchStart);
    rail.removeEventListener("touchmove", touchMove);
    rail.removeEventListener("touchend", touchEnd);
    rail.removeEventListener("touchcancel", touchEnd);
    rail.removeEventListener("pointerdown", pointerStart);
    rail.removeEventListener("lostpointercapture", pointerEnd);
    rail.removeEventListener("click", click);
    doc.removeEventListener("pointermove", pointerMove);
    doc.removeEventListener("pointerup", pointerEnd);
    doc.removeEventListener("pointercancel", pointerEnd);
    doc.removeEventListener("touchstart", cancelMultiTouch);
    doc.removeEventListener("visibilitychange", visibility);
    win.removeEventListener("blur", cancel);
    win.removeEventListener("orientationchange", cancel);
  };
}
