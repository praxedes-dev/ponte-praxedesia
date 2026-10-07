/**
 * Offscreen Document — runs in a hidden context that is NOT subject to
 * Manifest V3's 30-second Service Worker idle timeout.
 *
 * Responsibilities:
 * 1. SW Keepalive: pings the service worker every 20 s to reset its idle timer.
 * 2. Audio playback for notification sounds via Web Audio API.
 * 3. GIF generation with action overlays (clicks, drags, labels).
 */

console.log('[Offscreen] Document loaded and ready');

// ═══════════════════════════════════════════════════════════════════════
// 1. SW KEEPALIVE
// ═══════════════════════════════════════════════════════════════════════
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'SW_KEEPALIVE' }).catch(() => {});
}, 20_000);

// ═══════════════════════════════════════════════════════════════════════
// 2. WEB AUDIO — NOTIFICATION SOUND
// ═══════════════════════════════════════════════════════════════════════
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

async function playSound(audioUrl: string, volume: number = 0.5): Promise<void> {
  try {
    const ctx = getAudioContext();
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, volume));

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.error('[Offscreen] Failed to play sound:', err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. GIF GENERATOR — Canvas-based with action overlays
// ═══════════════════════════════════════════════════════════════════════

interface GifAction {
  type: string;              // "left_click", "left_click_drag", "type", "scroll_down", etc.
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
}

interface GifFrame {
  imageData: string;         // base64 PNG
  action?: GifAction;
  delay?: number;            // ms per frame
}

interface GifOptions {
  width: number;
  height: number;
  scaleFactor?: number;
  quality?: number;          // 1-30, lower = better
}

/**
 * Draw a click indicator — 3 concentric circles at the click point.
 */
function drawClickIndicator(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const rings = [
    { radius: 20, alpha: 0.3 },
    { radius: 14, alpha: 0.5 },
    { radius: 8,  alpha: 0.8 },
  ];
  for (const ring of rings) {
    ctx.beginPath();
    ctx.arc(x, y, ring.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(59, 130, 246, ${ring.alpha})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(59, 130, 246, ${ring.alpha + 0.2})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Center dot
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

/**
 * Draw a drag path — arrow from start to end.
 */
function drawDragPath(
  ctx: CanvasRenderingContext2D,
  startX: number, startY: number,
  endX: number, endY: number,
): void {
  // Line
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Start marker
  ctx.beginPath();
  ctx.arc(startX, startY, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
  ctx.fill();

  // Arrowhead at end
  const angle = Math.atan2(endY - startY, endX - startX);
  const arrowLen = 12;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - arrowLen * Math.cos(angle - 0.4), endY - arrowLen * Math.sin(angle - 0.4));
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - arrowLen * Math.cos(angle + 0.4), endY - arrowLen * Math.sin(angle + 0.4));
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // End dot
  ctx.beginPath();
  ctx.arc(endX, endY, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
  ctx.fill();
}

/**
 * Draw an action label tooltip.
 */
function drawActionLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const metrics = ctx.measureText(text);
  const padding = 8;
  const boxW = metrics.width + padding * 2;
  const boxH = 24;
  const bx = Math.max(0, Math.min(x - boxW / 2, ctx.canvas.width - boxW));
  const by = Math.max(0, y - boxH - 8);

  // Background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.beginPath();
  const r = 6;
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + boxW - r, by);
  ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
  ctx.lineTo(bx + boxW, by + boxH - r);
  ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
  ctx.lineTo(bx + r, by + boxH);
  ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.fill();

  // Text
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + boxW / 2, by + boxH / 2);
}

/**
 * Draw a progress bar at the bottom of the frame.
 */
function drawProgressBar(ctx: CanvasRenderingContext2D, progress: number): void {
  const barHeight = 4;
  const y = ctx.canvas.height - barHeight;
  // Background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
  ctx.fillRect(0, y, ctx.canvas.width, barHeight);
  // Fill
  const gradient = ctx.createLinearGradient(0, y, ctx.canvas.width * progress, y);
  gradient.addColorStop(0, '#3b82f6');
  gradient.addColorStop(1, '#8b5cf6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y, ctx.canvas.width * progress, barHeight);
}

/**
 * Draw a subtle watermark in the bottom-right corner.
 */
function drawWatermark(ctx: CanvasRenderingContext2D): void {
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('PraxedesIA', ctx.canvas.width - 8, ctx.canvas.height - 8);
}

/**
 * Scale coordinates from viewport space to image space.
 */
function scaleCoordinates(
  action: GifAction,
  scaleFactor: number,
): { x: number; y: number; startX?: number; startY?: number } | null {
  if (action.coordinate) {
    const [x, y] = action.coordinate;
    const result: { x: number; y: number; startX?: number; startY?: number } = {
      x: Math.round(x * scaleFactor),
      y: Math.round(y * scaleFactor),
    };
    if (action.type === 'left_click_drag' && action.start_coordinate) {
      result.startX = Math.round(action.start_coordinate[0] * scaleFactor);
      result.startY = Math.round(action.start_coordinate[1] * scaleFactor);
    }
    return result;
  }
  return null;
}

/**
 * Generate an animated GIF from a sequence of screenshots + actions.
 * Returns a base64-encoded GIF string.
 *
 * NOTE: This uses a simple frame-by-frame approach without gif.js dependency.
 * For a production-grade GIF, integrate gif.js WebWorker library.
 */
async function generateAnnotatedFrames(
  frames: GifFrame[],
  options: GifOptions,
): Promise<{ annotatedFrames: string[]; width: number; height: number }> {
  const { width, height, scaleFactor = 1 } = options;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d') as any as CanvasRenderingContext2D;
  const annotatedFrames: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    // Draw base screenshot
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = `data:image/png;base64,${frame.imageData}`;
    });
    ctx.drawImage(img, 0, 0, width, height);

    // Draw overlays if action exists
    if (frame.action) {
      const coords = scaleCoordinates(frame.action, scaleFactor);

      if (coords) {
        if (frame.action.type === 'left_click_drag' && coords.startX != null && coords.startY != null) {
          drawDragPath(ctx, coords.startX, coords.startY, coords.x, coords.y);
          drawActionLabel(ctx, 'drag', coords.x, coords.y);
        } else if (frame.action.type.includes('click')) {
          drawClickIndicator(ctx, coords.x, coords.y);
          drawActionLabel(ctx, frame.action.type.replace(/_/g, ' '), coords.x, coords.y);
        }
      }

      // Non-coordinate actions get a centered label
      if (!coords && frame.action.type) {
        const label = frame.action.text
          ? `${frame.action.type}: "${frame.action.text.substring(0, 30)}"`
          : frame.action.type.replace(/_/g, ' ');
        drawActionLabel(ctx, label, width / 2, height - 40);
      }
    }

    // Progress bar
    drawProgressBar(ctx, (i + 1) / frames.length);

    // Watermark on last frame
    if (i === frames.length - 1) drawWatermark(ctx);

    // Export frame
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    annotatedFrames.push(base64);
  }

  return { annotatedFrames, width, height };
}

// ═══════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_PLAY_SOUND') {
    playSound(message.audioUrl, message.volume ?? 0.5)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === 'OFFSCREEN_GENERATE_GIF') {
    generateAnnotatedFrames(message.frames, message.options)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
});
