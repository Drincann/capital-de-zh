// Run against a freshly built reader. PLAYWRIGHT_MODULE may point to a shared
// Playwright installation; READER_TEST_URL defaults to the local Pages preview.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url = process.env.READER_TEST_URL || "http://127.0.0.1:4188/capital-de-zh/";

test("reading rail handles touch, mouse, cancellation and keyboard input", async (t) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true,
  });
  await page.goto(`${url}#ch01-s01`);
  await page.locator(".paragraph-marker").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const rail = await page.locator(".reading-position").boundingBox();
  const x = rail.x + rail.width / 2;
  const y = rail.y + rail.height * 0.2;

  await t.test("real touch moves immediately, stays monotonic, and stops on release", async () => {
    const cdp = await page.context().newCDPSession(page);
    const dispatch = (type, pointY) => cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: type === "touchEnd" ? [] : [{ x, y: pointY, id: 1 }],
    });
    await dispatch("touchStart", y);
    const positions = [];
    for (let i = 1; i <= 7; i++) {
      await dispatch("touchMove", y + i * 30);
      await page.waitForTimeout(25);
      positions.push(await page.evaluate(() => scrollY));
    }
    assert.ok(positions[0] > 100, "touch must move before finger release");
    positions.slice(1).forEach((value, i) => assert.ok(value >= positions[i], JSON.stringify(positions)));
    await dispatch("touchEnd", 0);
    const released = await page.evaluate(() => scrollY);
    await page.waitForTimeout(400);
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - released) < 2);
    await cdp.detach();
  });

  await t.test("page-relative screenY and changing rail height cannot feed back into dragging", async () => {
    const result = await page.evaluate(async ({ x, y }) => {
      const rail = document.querySelector(".reading-position");
      const target = rail.querySelector("button");
      // Synthetic pointer capture has no active hardware pointer. Real capture
      // is covered above; this case recreates the observed iPhone screenY=pageY.
      const capture = rail.setPointerCapture;
      rail.setPointerCapture = () => {};
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const emit = (phase, clientY) => {
        const screenY = clientY + scrollY;
        target.dispatchEvent(new PointerEvent(`pointer${phase === "start" ? "down" : phase === "end" ? "up" : "move"}`, {
          pointerId: 71, pointerType: "touch", isPrimary: true,
          clientX: x, clientY, screenX: x, screenY, bubbles: true, cancelable: true,
        }));
        const touch = new Touch({ identifier: 5, target, clientX: x, clientY, screenX: x, screenY });
        target.dispatchEvent(new TouchEvent(`touch${phase}`, {
          changedTouches: [touch], touches: phase === "end" ? [] : [touch],
          targetTouches: phase === "end" ? [] : [touch], bubbles: true, cancelable: true,
        }));
      };
      const bounds = rail.getBoundingClientRect();
      const maximum = document.documentElement.scrollHeight - innerHeight;
      emit("start", y);
      const values = [];
      for (let i = 1; i <= 6; i++) {
        emit("move", y + i * 25);
        if (i === 2) rail.style.bottom = "90px";
        await frame();
        values.push({ actual: scrollY, expected: (y + i * 25 - bounds.top) / bounds.height * maximum });
      }
      emit("end", 0); // Ending/cancel events may have unusable coordinates.
      await frame();
      const after = scrollY;
      rail.style.removeProperty("bottom");
      rail.setPointerCapture = capture;
      return { values, after };
    }, { x, y });
    result.values.forEach(({ actual, expected }) => assert.ok(Math.abs(actual - expected) < 2, JSON.stringify(result)));
    assert.ok(Math.abs(result.after - result.values.at(-1).actual) < 2, JSON.stringify(result));
  });

  await t.test("delayed compatibility click after dragging cannot jump to a paragraph", async () => {
    const before = await page.evaluate(() => scrollY);
    await page.waitForTimeout(350);
    await page.locator(".paragraph-marker").first().evaluate(target => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    await page.waitForTimeout(400);
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) < 2);
  });

  await t.test("touch tap and keyboard activation still select a paragraph", async () => {
    await page.evaluate(() => {
      window.__paragraphJumps = 0;
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args) {
        window.__paragraphJumps += 1;
        return original.apply(this, args);
      };
    });
    const marker = page.locator(".paragraph-marker").nth(2);
    await marker.tap();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__paragraphJumps), 1);
    await marker.focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => window.__paragraphJumps), 2);
    // Let that intentional smooth navigation finish before the next gesture.
    await page.waitForTimeout(500);
  });

  await t.test("cancelling a touch discards its pending frame and releases the gesture", async () => {
    const result = await page.evaluate(async ({ x, y }) => {
      const target = document.querySelector(".paragraph-marker");
      const touch = pointY => new Touch({ identifier: 77, target, clientX: x, clientY: pointY, screenX: x, screenY: pointY + 100 });
      const emit = (phase, pointY) => target.dispatchEvent(new TouchEvent(`touch${phase}`, {
        changedTouches: [touch(pointY)], touches: phase === "cancel" ? [] : [touch(pointY)],
        bubbles: true, cancelable: true,
      }));
      emit("start", y);
      const before = scrollY;
      emit("move", y + 250);
      emit("cancel", 0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { before, after: scrollY, dragging: document.body.classList.contains("reading-position-dragging"), behavior: document.documentElement.style.scrollBehavior };
    }, { x, y });
    assert.ok(Math.abs(result.after - result.before) < 2, JSON.stringify(result));
    assert.equal(result.dragging, false);
    assert.equal(result.behavior, "");
  });

  await t.test("desktop mouse drag follows the pointer and ordinary article swiping still works", async () => {
    await page.waitForTimeout(850);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 100, { steps: 5 });
    await page.waitForTimeout(30);
    const first = await page.evaluate(() => scrollY);
    await page.mouse.move(x, y + 200, { steps: 5 });
    await page.waitForTimeout(30);
    assert.ok(await page.evaluate(() => scrollY) > first + 100);
    await page.mouse.up();
    const before = await page.evaluate(() => scrollY);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 650, id: 3 }] });
    for (let i = 1; i <= 5; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y: 650 - i * 40, id: 3 }] });
      await page.waitForTimeout(20);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.ok(await page.evaluate(() => scrollY) > before, "touch scrolling outside the rail must remain enabled");
    await cdp.detach();
  });
});

for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
  test(`${name}: iPhone coordinate feedback regression at different page zooms`, async (t) => {
    const browser = await engine.launch({ ...(name === "Chromium" ? { channel: "chrome" } : {}), headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 860, height: 1550 }, isMobile: true, hasTouch: true });
    await page.goto(`${url}#ch01-s01`);
    await page.locator(".paragraph-marker").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);

    for (const scale of [0.5, 1, 2]) {
      await t.test(`viewport scale ${scale}: follows CSS coordinates from the top, middle and bottom`, async () => {
        const result = await page.evaluate(async scale => {
          // Reproduce the property exposed by the physical iPhone, not desktop
          // device emulation: its screenY included scrollY, while clientY was
          // already in viewport CSS pixels at visualViewport.scale=0.5.
          const viewport = window.visualViewport;
          const descriptor = Object.getOwnPropertyDescriptor(viewport, "scale");
          Object.defineProperty(viewport, "scale", { configurable: true, value: scale });
          const rail = document.querySelector(".reading-position");
          const target = rail.querySelector("button");
          const bounds = rail.getBoundingClientRect();
          const maximum = document.documentElement.scrollHeight - innerHeight;
          const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const values = [];
          const emit = (phase, clientY) => {
            // Desktop WebKit exposes Touch but disallows its constructor. Replay
            // the captured properties on an Event, rather than claiming hardware
            // input: Chromium's separate CDP test covers actual touch dispatch.
            const touch = { identifier: 91, target, clientX: bounds.x + 5, clientY,
              screenX: bounds.x + 5, screenY: clientY + scrollY, pageY: clientY + scrollY };
            const event = new Event(`touch${phase}`, { bubbles: true, cancelable: true });
            Object.defineProperties(event, {
              changedTouches: { value: [touch] }, touches: { value: phase === "end" ? [] : [touch] },
              targetTouches: { value: phase === "end" ? [] : [touch] },
            });
            target.dispatchEvent(event);
          };
          try {
            for (const startingScroll of [0, maximum / 2, maximum]) {
              window.scrollTo({ top: startingScroll, behavior: "instant" });
              await frame();
              emit("start", 336.66666666666663);
              // The opening coordinates are from the physical iPhone trace.
              // Also reverse without releasing: no sticking at either boundary.
              for (const clientY of [363.3333333333333, 366, 372.6666666666665, 390, 500, 450, 380]) {
                emit("move", clientY);
                await frame();
                values.push({ startingScroll, clientY, actual: scrollY,
                  expected: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)) * maximum });
              }
              emit("end", 0);
              await frame();
              values.push({ actual: scrollY, expected: values.at(-1).expected });
            }
          } finally {
            if (descriptor) Object.defineProperty(viewport, "scale", descriptor);
            else delete viewport.scale;
          }
          return values;
        }, scale);
        for (const point of result) {
          assert.ok(Math.abs(point.actual - point.expected) < 2, `${name} scale=${scale}: ${JSON.stringify(point)}`);
        }
      });
    }
  });
}
